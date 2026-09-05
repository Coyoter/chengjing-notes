import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AutoBackupManager } from "./AutoBackupManager";
import { backupRevision, markBackupChanged } from "../lib/backupChanges";
vi.mock("../lib/autoBackup", () => ({
  announceAutoBackup: vi.fn(), isAutoBackupDue: () => false,
  isCloudBackupDue: (settings: { lastSuccessAt: number }) => Date.now() - settings.lastSuccessAt >= 1_800_000,
  prepareCompleteBackup: async () => ({ data: "snapshot", assets: [] }),
}));
let root: Root; let exit: () => Promise<void>; let write: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.useFakeTimers(); localStorage.clear();
  const settings = { enabled: true, conflict: false, lastSuccessAt: Date.now() };
  write = vi.fn(async () => ({ settings }));
  window.chengjing = { cloudBackups: {
    getLocalStatus: async () => ({ connected: true, settings }), write,
    onBeforeQuit: (callback: () => Promise<void>) => { exit = callback; return () => {}; },
  } } as unknown as NonNullable<Window["chengjing"]>;
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<AutoBackupManager />));
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); delete window.chengjing; });
it("短時使用停筆後備份，滑鼠和滾輪不會延後", async () => {
  await act(async () => { markBackupChanged(); await vi.advanceTimersByTimeAsync(20_000); });
  window.dispatchEvent(new Event("wheel")); window.dispatchEvent(new Event("pointerdown"));
  await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
  expect(write).toHaveBeenCalledTimes(1); expect(backupRevision()).toBe("");
});
it("退出前不用等30秒，失敗保留待傳內容，重試成功才清除", async () => {
  write.mockRejectedValueOnce(new Error("offline"));
  await act(async () => { markBackupChanged(); });
  const first = exit(); const caught = first.catch((error) => error.message);
  await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  expect(await caught).toBe("offline"); expect(backupRevision()).not.toBe("");
  const second = exit();
  await act(async () => { await vi.advanceTimersByTimeAsync(750); await second; });
  expect(backupRevision()).toBe(""); expect(write).toHaveBeenCalledTimes(2);
});
it("持續修改仍會在30分鐘期限執行", async () => {
  for (let index = 0; index < 90; index++) {
    await act(async () => { markBackupChanged(); await vi.advanceTimersByTimeAsync(20_000); });
  }
  expect(write).toHaveBeenCalledTimes(1);
});
it("重新啟動後補傳留下的待備份內容", async () => {
  await act(async () => { markBackupChanged(); root.unmount(); });
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<AutoBackupManager />));
  await act(async () => { await vi.advanceTimersByTimeAsync(2_001); });
  expect(write).toHaveBeenCalledTimes(1); expect(backupRevision()).toBe("");
});
it("上傳未結束時不重送，失敗後保留待傳記號", async () => {
  let rejectUpload!: (error: Error) => void;
  write.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectUpload = reject; }));
  await act(async () => { markBackupChanged(); await vi.advanceTimersByTimeAsync(40_000); });
  expect(write).toHaveBeenCalledTimes(1);
  await act(async () => { rejectUpload(new Error("offline")); await vi.advanceTimersByTimeAsync(1); });
  expect(backupRevision()).not.toBe("");
});
