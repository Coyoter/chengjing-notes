import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { createAndroidSyncRecoveryBridge } from "./androidSyncRecovery";

function fixture() {
  let connected = true;
  let refresh: () => Promise<void> = async () => {};
  const call = vi.fn(async (method: string, args?: Record<string, unknown>): Promise<unknown> => {
    if (method === "google.status") return { connected };
    if (method === "google.refresh") { await refresh(); return {}; }
    if (method === "syncRecovery.setEnabled") return { enabled: args?.enabled };
    if (method === "syncRecovery.getStatus") return {
      dayBasis: "UTC", today: null, yesterday: null, dayBeforeYesterday: null,
    };
    if (method === "syncRecovery.releaseDownload") return { cleaned: true };
    return { ok: true };
  });
  const bridge = createAndroidSyncRecoveryBridge(call);
  return {
    call, bridge,
    connected: (value: boolean) => { connected = value; },
    refresh: (fn: () => Promise<void>) => { refresh = fn; },
  };
}

it("refreshes authorization before reading recovery metadata without enabling sync", async () => {
  const h = fixture();
  await h.bridge.getStatus();
  expect(h.call.mock.calls.map(([method]) => method)).toEqual([
    "google.status", "google.refresh", "syncRecovery.getStatus",
  ]);
});

it("does not start authorization or a restore operation while disabled", async () => {
  const h = fixture();
  await expect(h.bridge.download("point")).rejects.toThrow("paused");
  await expect(h.bridge.createDaily({ data: "test", assets: [] })).rejects.toThrow("paused");
  expect(h.call).not.toHaveBeenCalled();
});

it("disconnected accounts fail before requesting a Google refresh", async () => {
  const h = fixture();
  h.connected(false);
  await expect(h.bridge.getStatus()).rejects.toThrow("auth-required");
  expect(h.call.mock.calls.map(([method]) => method)).toEqual(["google.status"]);
});

it("forwards the daily snapshot and attachment sources after authorization", async () => {
  const h = fixture();
  await h.bridge.setEnabled(true);
  const request = { data: "payload", assets: [{ relativePath: "local", sha256: "a".repeat(64), size: 12 }] };
  await h.bridge.createDaily(request);
  expect(h.call).toHaveBeenLastCalledWith("syncRecovery.createDaily", request);
});

it("pause and resume during authorization invalidate the older publication", async () => {
  const h = fixture();
  await h.bridge.setEnabled(true);
  h.refresh(async () => {
    await h.bridge.setEnabled(false);
    await h.bridge.setEnabled(true);
  });
  await expect(h.bridge.createDaily({ data: "old", assets: [] })).rejects.toThrow("paused");
  expect(h.call.mock.calls.some(([method]) => method === "syncRecovery.createDaily")).toBe(false);
});

it("disabling and cleanup bypass authorization and remain immediately available", async () => {
  const h = fixture();
  await h.bridge.setEnabled(true);
  h.call.mockClear();
  await h.bridge.setEnabled(false);
  h.connected(false);
  await h.bridge.releaseDownload("session");
  expect(h.call.mock.calls).toEqual([
    ["syncRecovery.setEnabled", { enabled: false }],
    ["syncRecovery.releaseDownload", { restoreId: "session" }],
  ]);
});

it("authorization failure prevents a native download request", async () => {
  const h = fixture();
  await h.bridge.setEnabled(true);
  h.refresh(async () => { throw new Error("refresh rejected"); });
  await expect(h.bridge.download("point")).rejects.toThrow("refresh rejected");
  expect(h.call.mock.calls.some(([method]) => method === "syncRecovery.download")).toBe(false);
});

it("wires recovery into Android while preserving the isolated workspace boundary", () => {
  const platform = readFileSync(resolve(process.cwd(), "src/platform/android.ts"), "utf8");
  const activity = readFileSync(resolve(process.cwd(),
    "android/app/src/main/java/tw/techtarian/chengjing/MainActivity.kt"), "utf8");
  const native = readFileSync(resolve(process.cwd(),
    "android/app/src/main/java/tw/techtarian/chengjing/NativeServices.kt"), "utf8");
  expect(platform).toContain("syncRecovery: createAndroidSyncRecoveryBridge(androidCall)");
  expect(platform).toContain("window.chengjing.syncRecovery=undefined;");
  expect(activity).toContain('listOf("google","cloud","sync","syncRecovery")');
  expect(activity).toContain("services.prepareSyncRecoveryCall");
  expect(activity).toContain("services.suspendSyncRecovery()");
  expect(native).toContain("SyncRecoveryService.BACKUP_PREFIX");
});
