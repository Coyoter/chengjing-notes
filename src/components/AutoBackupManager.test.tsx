import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AutoBackupManager } from "./AutoBackupManager";

const { isAutoBackupDue, announceAutoBackup } = vi.hoisted(() => ({
  isAutoBackupDue: vi.fn(() => true),
  announceAutoBackup: vi.fn(),
}));

vi.mock("../lib/autoBackup", () => ({
  announceAutoBackup,
  isAutoBackupDue,
  prepareCompleteBackup: async () => ({ data: "snapshot", assets: [] }),
}));

let root: Root;
let exit: () => Promise<void>;
let localWrite: ReturnType<typeof vi.fn>;
let cloudWrite: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.useFakeTimers();
  localStorage.clear();
  isAutoBackupDue.mockReturnValue(true);
  announceAutoBackup.mockClear();

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
