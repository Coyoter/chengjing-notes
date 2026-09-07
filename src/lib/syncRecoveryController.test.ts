import { expect, it, vi } from "vitest";
import type {
  SyncRecoveryBridge, SyncRecoveryStatus, SyncRecoverySnapshot,
  SyncRecoveryDownloadResult, SyncRecoveryWriteResult,
} from "../types";
import {
  createSyncRecoveryController, type RecoveryControllerDependencies,
} from "./syncRecoveryController";

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  let now = Date.parse("2026-09-09T12:00:00Z"), enabled = true;
  let status: SyncRecoveryStatus = {
    dayBasis: "UTC", today: null, yesterday: null, dayBeforeYesterday: null,
  };
  const order: string[] = [];
  function point(timestamp = now): SyncRecoverySnapshot {
    return {
      id: `snapshot-${timestamp}`, day: new Date(timestamp).toISOString().slice(0, 10),
      snapshotAt: timestamp, contentHash: "a".repeat(64), size: 100,
    };
  }
  function created(): SyncRecoveryWriteResult {
    const snapshot = point();
    status = { ...status, today: snapshot };
    return { skipped: false, uploadedAssets: 0, snapshot, status };
  }
  const selected = point(now - 86_400_000);
  const download: SyncRecoveryDownloadResult = {
    restoreId: "restore-test", data: "verified-by-data-layer",
    backupFilePath: "/test/download.json", snapshot: selected,
  };
  const bridge = {
    getStatus: vi.fn(async () => { order.push("status"); return status; }),
    setEnabled: vi.fn(async (value: boolean) => ({ enabled: value })),
    createDaily: vi.fn(async (_request: { data: string; assets: unknown[] }) => {
      order.push("create"); return created();
    }),
    download: vi.fn(async (_id: string) => { order.push("download"); return download; }),
    releaseDownload: vi.fn(async (_id: string) => {
      order.push("release"); return { cleaned: true };
    }),
  } satisfies SyncRecoveryBridge;
  let available: SyncRecoveryBridge | undefined = bridge;
  const deps: RecoveryControllerDependencies = {
    bridge: () => available,
    isEnabled: () => enabled,
    now: () => now,
    withWorkspace: async <T>(operation: () => Promise<T>): Promise<T> => {
      order.push("lock-enter");
      try { return await operation(); } finally { order.push("lock-exit"); }
    },
    capture: vi.fn(async () => { order.push("capture"); return { data: "snapshot", assets: [] }; }),
    flushEditors: vi.fn(async () => { order.push("flush"); }),
    restore: vi.fn(async (_download, _expected, assertAllowed) => {
      assertAllowed(); order.push("restore");
      return { restoredItems: 2, deletedItems: 1, safetyCopyPath: "/test/safety.json" };
    }),
    synchronize: vi.fn(async () => { order.push("sync-restored"); }),
  };
  const controller = createSyncRecoveryController(deps);
  return {
    controller, deps, bridge, order, selected, download, created, point,
    setStatus: (value: SyncRecoveryStatus) => { status = value; },
    setEnabled: (value: boolean) => { enabled = value; },
    setAvailable: (value: boolean) => { available = value ? bridge : undefined; },
    advance: (milliseconds: number) => { now += milliseconds; },
  };
}

it("does nothing until explicitly notified of a successful sync", async () => {
  const h = fixture();
  expect(h.bridge.createDaily).not.toHaveBeenCalled();
  await h.controller.afterSuccessfulSync();
  expect(h.order).toEqual(["status", "lock-enter", "capture", "lock-exit", "create"]);
  expect(h.controller.getSnapshot().phase).toBe("idle");
  expect(h.controller.getSnapshot().status?.today).not.toBeNull();
});

it("checks a day only once after a successful point and checks again on the next UTC day", async () => {
  const h = fixture();
  await h.controller.afterSuccessfulSync();
  await h.controller.afterSuccessfulSync();
  expect(h.bridge.createDaily).toHaveBeenCalledTimes(1);
  expect(h.bridge.getStatus).toHaveBeenCalledTimes(1);
  h.advance(86_400_000);
  h.setStatus({ dayBasis: "UTC", today: null, yesterday: h.point(Date.parse("2026-09-09T12:00:00Z")), dayBeforeYesterday: null });
  await h.controller.afterSuccessfulSync();
  expect(h.bridge.createDaily).toHaveBeenCalledTimes(2);
});

it("reuses a point already published by another device without capturing or uploading", async () => {
  const h = fixture();
  h.setStatus({ dayBasis: "UTC", today: h.point(), yesterday: null, dayBeforeYesterday: null });
  await h.controller.afterSuccessfulSync();
  expect(h.deps.capture).not.toHaveBeenCalled();
  expect(h.bridge.createDaily).not.toHaveBeenCalled();
});

it("paused sync and platforms without the bridge do not create snapshots", async () => {
  const h = fixture(); h.setEnabled(false);
  await h.controller.afterSuccessfulSync();
  expect(h.bridge.getStatus).not.toHaveBeenCalled();
  h.setEnabled(true); h.setAvailable(false);
  await h.controller.afterSuccessfulSync();
  expect(h.bridge.setEnabled).not.toHaveBeenCalled();
});

it("recovery upload failure is nonfatal to sync and retries only after backoff", async () => {
  const h = fixture();
  h.bridge.createDaily.mockRejectedValueOnce(new Error("network outage"));
  await expect(h.controller.afterSuccessfulSync()).resolves.toBeUndefined();
  expect(h.controller.getSnapshot().error).toBe("sync-recovery-operation-failed");
  await h.controller.afterSuccessfulSync();
  expect(h.bridge.createDaily).toHaveBeenCalledTimes(1);
  h.advance(60_001);
  await h.controller.afterSuccessfulSync();
  expect(h.bridge.createDaily).toHaveBeenCalledTimes(2);
  expect(h.controller.getSnapshot().error).toBe("");
});

it("new unsent changes defer recovery without reporting a broken snapshot", async () => {
  const h = fixture();
  h.deps.capture = vi.fn(async () => { throw new Error("sync-recovery-pending-changes"); });
  await h.controller.afterSuccessfulSync();
  expect(h.bridge.createDaily).not.toHaveBeenCalled();
  expect(h.controller.getSnapshot().error).toBe("");
});

it("overlapping success notifications never start duplicate uploads", async () => {
  const h = fixture(), entered = signal(), release = signal();
  h.bridge.createDaily.mockImplementationOnce(async () => {
    entered.resolve(); await release.promise; return h.created();
  });
  const first = h.controller.afterSuccessfulSync();
  await entered.promise;
  await h.controller.afterSuccessfulSync();
  const count = h.bridge.createDaily.mock.calls.length;
  release.resolve(); await first;
  expect(count).toBe(1);
});

it("pause and resume invalidate a previously started operation", async () => {
  const h = fixture(), entered = signal(), release = signal();
  h.bridge.createDaily.mockImplementationOnce(async () => {
    entered.resolve(); await release.promise; return h.created();
  });
  const pending = h.controller.afterSuccessfulSync();
  await entered.promise;
  h.setEnabled(false); await h.controller.syncStateChanged();
  h.setEnabled(true); await h.controller.syncStateChanged();
  const enabledCalls = h.bridge.setEnabled.mock.calls.map(([value]) => value);
  release.resolve(); await pending;
  expect(enabledCalls).toEqual([true, false, true]);
  expect(h.controller.getSnapshot().status).toBeNull();
  expect(h.controller.getSnapshot().error).toBe("");
});

it("unmount suspension prevents new work until the manager starts again", async () => {
  const h = fixture();
  await h.controller.suspend();
  await h.controller.afterSuccessfulSync();
  expect(h.bridge.createDaily).not.toHaveBeenCalled();
  expect(h.bridge.setEnabled).toHaveBeenCalledWith(false);
  await h.controller.syncStateChanged();
  await h.controller.afterSuccessfulSync();
  expect(h.bridge.createDaily).toHaveBeenCalledTimes(1);
});

it("explicit refresh only reads metadata and never captures or enables sync", async () => {
  const h = fixture(); h.setEnabled(false);
  await h.controller.refresh();
  expect(h.bridge.getStatus).toHaveBeenCalledTimes(1);
  expect(h.bridge.setEnabled).not.toHaveBeenCalled();
  expect(h.deps.capture).not.toHaveBeenCalled();
});

it("restores under the workspace lock and uploads only after releasing it", async () => {
  const h = fixture();
  const result = await h.controller.restorePoint(h.selected);
  expect(h.order).toEqual([
    "flush", "lock-enter", "download", "restore", "lock-exit", "sync-restored", "release",
  ]);
  expect(result).toEqual({
    restoredItems: 2, deletedItems: 1, safetyCopyPath: "/test/safety.json", syncPending: false,
  });
  expect(h.bridge.createDaily).not.toHaveBeenCalled();
  expect(h.bridge.releaseDownload).toHaveBeenCalledWith(h.download.restoreId);
});

it("post-restore network failure preserves local success and does not repeat the restoration", async () => {
  const h = fixture();
  h.deps.synchronize = vi.fn(async () => { throw new Error("offline"); });
  const result = await h.controller.restorePoint(h.selected);
  expect(result.syncPending).toBe(true);
  expect(h.controller.getSnapshot().lastRestore?.safetyCopyPath).toBe("/test/safety.json");
  expect(h.controller.getSnapshot().error).toBe("sync-recovery-restored-sync-pending");
  expect(h.deps.restore).toHaveBeenCalledTimes(1);
  expect(h.bridge.releaseDownload).toHaveBeenCalledTimes(1);
});

it("safety or validation failure cleans the download without uploading or claiming success", async () => {
  const h = fixture();
  h.deps.restore = vi.fn(async () => { throw new Error("sync-recovery-safety-copy-required"); });
  await expect(h.controller.restorePoint(h.selected)).rejects.toThrow("safety-copy-required");
  expect(h.deps.synchronize).not.toHaveBeenCalled();
  expect(h.controller.getSnapshot().lastRestore).toBeNull();
  expect(h.bridge.releaseDownload).toHaveBeenCalledTimes(1);
});

it("pausing during download cancels restoration but still releases the staging session", async () => {
  const h = fixture();
  h.bridge.download.mockImplementationOnce(async () => {
    h.setEnabled(false);
    await h.controller.syncStateChanged();
    return h.download;
  });
  await expect(h.controller.restorePoint(h.selected)).rejects.toThrow("paused");
  expect(h.deps.restore).not.toHaveBeenCalled();
  expect(h.bridge.releaseDownload).toHaveBeenCalledTimes(1);
});

it("cleanup failure is a separate warning rather than a false restore failure", async () => {
  const h = fixture();
  h.bridge.releaseDownload.mockRejectedValueOnce(new Error("temporary cleanup failure"));
  const result = await h.controller.restorePoint(h.selected);
  expect(result.syncPending).toBe(false);
  expect(h.controller.getSnapshot().warning).toBe("sync-recovery-staging-cleanup-deferred");
  expect(h.controller.getSnapshot().error).toBe("");
});

it("does not permit restore and automatic publication to run simultaneously", async () => {
  const h = fixture(), entered = signal(), release = signal();
  h.bridge.createDaily.mockImplementationOnce(async () => {
    entered.resolve(); await release.promise; return h.created();
  });
  const pending = h.controller.afterSuccessfulSync();
  await entered.promise;
  const rejected = h.controller.restorePoint(h.selected).catch(error => error.message);
  release.resolve(); await pending;
  expect(await rejected).toBe("sync-recovery-busy");
  expect(h.deps.restore).not.toHaveBeenCalled();
});

it("provides stable state snapshots between updates and unsubscribes listeners", async () => {
  const h = fixture(), listener = vi.fn();
  const before = h.controller.getSnapshot();
  expect(h.controller.getSnapshot()).toBe(before);
  const unsubscribe = h.controller.subscribe(listener);
  await h.controller.refresh();
  expect(h.controller.getSnapshot()).not.toBe(before);
  expect(listener).toHaveBeenCalled();
  unsubscribe(); listener.mockClear();
  await h.controller.refresh();
  expect(listener).not.toHaveBeenCalled();
});
