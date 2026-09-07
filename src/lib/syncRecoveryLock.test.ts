import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import { db } from "../db";
import {
  synchronize, stagePendingSync, withSynchronizedWorkspace, type SyncTransport,
} from "./syncEngine";

beforeAll(async () => {
  Object.defineProperty(crypto, "subtle", { value: webcrypto.subtle, configurable: true });
  await db.open();
});
beforeEach(async () => {
  localStorage.clear();
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
  localStorage.setItem("chengjing-sync-enabled", "true");
});
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
function transport(overrides: Partial<SyncTransport> = {}): SyncTransport {
  return {
    list: vi.fn(async () => []),
    get: vi.fn(async () => ""),
    put: vi.fn(async () => {}),
    ...overrides,
  };
}
const fragment = (id: string, text = id) => ({
  id, text, pinned: false, tagIds: [], createdAt: 1, updatedAt: 1,
});

it("finishes incoming and outgoing sync before entering recovery", async () => {
  await db.fragments.put(fragment("local"));
  const packet = {
    protocol: "chengjing-sync-v1", id: "incoming-packet",
    operations: [{
      id: "remote-op", table: "fragments", key: "remote",
      clock: { other: 1 }, value: fragment("remote"),
    }],
  };
  const io = transport({
    list: async () => [{ id: "drive-file", name: packet.id }],
    get: async () => JSON.stringify(packet),
  });
  const result = await withSynchronizedWorkspace(io, async () => {
    expect(await db.fragments.get("local")).toBeDefined();
    expect(await db.fragments.get("remote")).toBeDefined();
    expect(await db.table("syncInbox").get(packet.id)).toBeDefined();
    expect(await db.table("syncOutbox").count()).toBe(0);
    return { ready: true };
  });
  expect(result).toEqual({ ready: true });
  expect(io.put).toHaveBeenCalledTimes(1);
});

it("two recovery operations cannot overlap", async () => {
  const entered = signal(), release = signal(), order: string[] = [];
  const first = withSynchronizedWorkspace(transport(), async () => {
    order.push("first-enter");
    entered.resolve();
    await release.promise;
    order.push("first-exit");
    return 1;
  });
  await entered.promise;
  const second = withSynchronizedWorkspace(transport(), async () => {
    order.push("second-enter");
    return 2;
  });
  await Promise.resolve();
  const beforeRelease = [...order];
  release.resolve();
  expect(await Promise.all([first, second])).toEqual([1, 2]);
  expect(beforeRelease).toEqual(["first-enter"]);
  expect(order).toEqual(["first-enter", "first-exit", "second-enter"]);
});

it("ordinary synchronization waits until the recovery operation releases the workspace", async () => {
  const entered = signal(), release = signal();
  const recovery = withSynchronizedWorkspace(transport(), async () => {
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const io = transport();
  const sync = synchronize(io);
  await Promise.resolve();
  const callsWhileHeld = vi.mocked(io.list).mock.calls.length;
  release.resolve();
  await Promise.all([recovery, sync]);
  expect(callsWhileHeld).toBe(0);
  expect(io.list).toHaveBeenCalledTimes(1);
});

it("recovery waits for an already running synchronization", async () => {
  const entered = signal(), release = signal(), order: string[] = [];
  const io = transport({
    list: async () => {
      order.push("sync-enter");
      entered.resolve();
      await release.promise;
      order.push("sync-exit");
      return [];
    },
  });
  const sync = synchronize(io);
  await entered.promise;
  const recovery = withSynchronizedWorkspace(transport(), async () => {
    order.push("recovery-enter");
  });
  await Promise.resolve();
  const beforeRelease = [...order];
  release.resolve();
  await Promise.all([sync, recovery]);
  expect(beforeRelease).toEqual(["sync-enter"]);
  expect(order).toEqual(["sync-enter", "sync-exit", "recovery-enter"]);
});

it("native staging waits and then reads the restored outgoing operations", async () => {
  const entered = signal(), release = signal();
  const recovery = withSynchronizedWorkspace(transport(), async () => {
    await db.fragments.put(fragment("restored", "restored content"));
    entered.resolve();
    await release.promise;
  });
  await entered.promise;
  const stage = vi.fn(async () => {});
  const pending = stagePendingSync(transport({ stage }));
  await Promise.resolve();
  const callsWhileHeld = stage.mock.calls.length;
  release.resolve();
  await Promise.all([recovery, pending]);
  expect(callsWhileHeld).toBe(0);
  expect(stage).toHaveBeenCalledTimes(1);
  expect(stage).toHaveBeenCalledWith(expect.objectContaining({
    operations: expect.arrayContaining([
      expect.objectContaining({
        key: "restored",
        value: expect.objectContaining({ text: "restored content" }),
      }),
    ]),
  }));
});

it("a failed recovery callback releases the lock for later synchronization", async () => {
  await expect(withSynchronizedWorkspace(transport(), async () => {
    throw new Error("recovery failed");
  })).rejects.toThrow("recovery failed");
  const io = transport();
  await synchronize(io);
  expect(io.list).toHaveBeenCalledTimes(1);
});

it("a failed pre-restore synchronization never invokes the recovery callback", async () => {
  const callback = vi.fn(async () => "should not run");
  await expect(withSynchronizedWorkspace(transport({
    list: async () => { throw new Error("offline"); },
  }), callback)).rejects.toThrow("offline");
  expect(callback).not.toHaveBeenCalled();
  await expect(withSynchronizedWorkspace(transport(), async () => "retry"))
    .resolves.toBe("retry");
});

it("paused sync cannot enter recovery or be silently re-enabled", async () => {
  localStorage.removeItem("chengjing-sync-enabled");
  const io = transport(), callback = vi.fn(async () => {});
  await expect(withSynchronizedWorkspace(io, callback)).rejects.toThrow("paused");
  expect(io.list).not.toHaveBeenCalled();
  expect(callback).not.toHaveBeenCalled();
  expect(localStorage.getItem("chengjing-sync-enabled")).toBeNull();
});

it("pausing during remote listing stops recovery before any data changes", async () => {
  const callback = vi.fn(async () => {});
  const io = transport({
    list: async () => {
      localStorage.removeItem("chengjing-sync-enabled");
      return [];
    },
  });
  await expect(withSynchronizedWorkspace(io, callback)).rejects.toThrow("paused");
  expect(callback).not.toHaveBeenCalled();
  expect(io.put).not.toHaveBeenCalled();
});

it("unsent edits made during upload prevent capture or restore from using an incomplete baseline", async () => {
  await db.fragments.put(fragment("before-sync"));
  const callback = vi.fn(async () => {});
  const io = transport({
    put: async () => {
      await db.fragments.put(fragment("during-upload"));
    },
  });
  await expect(withSynchronizedWorkspace(io, callback)).rejects.toThrow("pending-changes");
  expect(callback).not.toHaveBeenCalled();
  expect(await db.fragments.get("during-upload")).toBeDefined();
  expect(await db.table("syncOutbox").count()).toBe(1);
});

it("ordinary simultaneous sync calls still share one operation", async () => {
  const entered = signal(), release = signal();
  const list = vi.fn(async () => {
    entered.resolve();
    await release.promise;
    return [];
  });
  const io = transport({ list });
  const first = synchronize(io);
  await entered.promise;
  const second = synchronize(io);
  const sharedPromise = first === second;
  release.resolve();
  await Promise.all([first, second]);
  expect(sharedPromise).toBe(true);
  expect(list).toHaveBeenCalledTimes(1);
});

it("a staging failure does not strand the lock or erase pending changes", async () => {
  await db.fragments.put(fragment("queued"));
  await expect(stagePendingSync(transport({
    stage: async () => { throw new Error("native staging failed"); },
  }))).rejects.toThrow("native staging failed");
  expect(await db.table("syncOutbox").count()).toBe(1);
  const io = transport();
  await synchronize(io);
  expect(io.put).toHaveBeenCalledTimes(1);
  expect(await db.table("syncOutbox").count()).toBe(0);
});
