import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AutoBackupManager } from "./AutoBackupManager";

const { isAutoBackupDue, announceAutoBackup, flushPendingSync, reportSyncActivity } = vi.hoisted(() => ({
  isAutoBackupDue: vi.fn(() => true),
  announceAutoBackup: vi.fn(),
  flushPendingSync: vi.fn(async () => {}),
  reportSyncActivity: vi.fn(),
}));

vi.mock("../lib/autoBackup", () => ({
  announceAutoBackup,
  isAutoBackupDue,
  prepareCompleteBackup: async () => ({ data: "snapshot", assets: [] }),
}));
vi.mock("../lib/syncEngine", () => ({ flushPendingSync }));
vi.mock("../lib/syncActivity", () => ({ reportSyncActivity }));

let root: Root;
let exit: () => Promise<void>;
let localWrite: ReturnType<typeof vi.fn>;
let cloudWrite: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.useFakeTimers();
  localStorage.clear();
  isAutoBackupDue.mockReturnValue(true);
  announceAutoBackup.mockClear();
  flushPendingSync.mockReset().mockResolvedValue(undefined);
  reportSyncActivity.mockClear();

  const settings = {
    enabled: true,
    directory: "/tmp/chengjing-backups",
    intervalDays: 1,
    retentionCount: 10,
    lastSuccessAt: 0,
  };

  localWrite = vi.fn(async () => ({ settings }));
  cloudWrite = vi.fn();

  window.chengjing = {
    backups: {
      getSettings: async () => settings,
      write: localWrite,
    },
    cloudBackups: {
      write: cloudWrite,
      onBeforeQuit: (callback: () => Promise<void>) => {
        exit = callback;
        return () => {};
      },
    },
    sync: { list: async () => ({ files: [] }), get: vi.fn(), put: vi.fn() },
  } as unknown as NonNullable<Window["chengjing"]>;

  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<AutoBackupManager />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  delete window.chengjing;
});

it("啟動後若本機備份到期，只寫入本機備份", async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_001);
  });

  expect(localWrite).toHaveBeenCalledTimes(1);
  expect(cloudWrite).not.toHaveBeenCalled();
  expect(announceAutoBackup).toHaveBeenCalledTimes(1);
});

it("本機備份尚未到期時不會寫入", async () => {
  isAutoBackupDue.mockReturnValue(false);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000);
  });

  expect(localWrite).not.toHaveBeenCalled();
  expect(cloudWrite).not.toHaveBeenCalled();
});

it("退出前只補做已到期的本機備份，不寫 Google snapshot", async () => {
  const quitting = exit();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(750);
    await quitting;
  });

  expect(localWrite).toHaveBeenCalledTimes(1);
  expect(cloudWrite).not.toHaveBeenCalled();
});

it("本機備份失敗後等待一分鐘再重試", async () => {
  localWrite
    .mockRejectedValueOnce(new Error("disk unavailable"))
    .mockResolvedValue({ settings: {
      enabled: true,
      directory: "/tmp/chengjing-backups",
      intervalDays: 1,
      retentionCount: 10,
      lastSuccessAt: 0,
    } });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_001);
  });

  expect(localWrite).toHaveBeenCalledTimes(1);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(59_000);
  });

  expect(localWrite).toHaveBeenCalledTimes(1);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });

  expect(localWrite).toHaveBeenCalledTimes(2);
  expect(cloudWrite).not.toHaveBeenCalled();
});

it("退出前先儲存編輯器，未啟用本機備份仍會完成 Google 同步", async () => {
  localStorage.setItem("chengjing-sync-enabled", "true");
  isAutoBackupDue.mockReturnValue(false);
  const flushed = vi.fn();
  window.addEventListener("chengjing:flush-editors", flushed);
  const quitting = exit();
  expect(flushed).toHaveBeenCalledOnce();
  expect(flushPendingSync).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(750); await quitting; });
  expect(flushPendingSync).toHaveBeenCalledOnce();
  expect(localWrite).not.toHaveBeenCalled();
  expect(cloudWrite).not.toHaveBeenCalled();
  window.removeEventListener("chengjing:flush-editors", flushed);
});

it("Google 同步失敗仍完成本機備份，退出重試會再傳送", async () => {
  localStorage.setItem("chengjing-sync-enabled", "true");
  flushPendingSync.mockRejectedValueOnce(new Error("offline"));
  const failed = expect(exit()).rejects.toThrow("offline");
  await act(async () => { await vi.advanceTimersByTimeAsync(750); await failed; });
  expect(localWrite).toHaveBeenCalledOnce();
  expect(reportSyncActivity).toHaveBeenCalledWith("error", "offline");

  const quitting = exit();
  await act(async () => { await vi.advanceTimersByTimeAsync(750); await quitting; });
  expect(flushPendingSync).toHaveBeenCalledTimes(2);
});

it("本機備份失敗仍完成 Google 同步，兩者都停用時只儲存編輯器", async () => {
  localStorage.setItem("chengjing-sync-enabled", "true");
  localWrite.mockRejectedValueOnce(new Error("disk unavailable"));
  const failed = expect(exit()).rejects.toThrow("disk unavailable");
  await act(async () => { await vi.advanceTimersByTimeAsync(750); await failed; });
  expect(flushPendingSync).toHaveBeenCalledOnce();

  localStorage.removeItem("chengjing-sync-enabled");
  isAutoBackupDue.mockReturnValue(false);
  const quitting = exit();
  await act(async () => { await vi.advanceTimersByTimeAsync(750); await quitting; });
  expect(flushPendingSync).toHaveBeenCalledOnce();
  expect(localWrite).toHaveBeenCalledOnce();
});

it("尚在等待退出時的重試共用同一流程，返回後可再次退出", async () => {
  localStorage.setItem("chengjing-sync-enabled", "true");
  const first = exit();
  const retry = exit();
  expect(first).toBe(retry);
  await act(async () => { await vi.advanceTimersByTimeAsync(750); await first; });
  expect(flushPendingSync).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event("chengjing:quit-backup-cancelled"));
  const again = exit();
  await act(async () => { await vi.advanceTimersByTimeAsync(750); await again; });
  expect(flushPendingSync).toHaveBeenCalledTimes(2);
});
