import { describe, expect, it } from "vitest";
import type { AutoBackupSettings } from "../types";
import { AUTO_BACKUP_DAY_MS, isAutoBackupDue, nextAutoBackupAt } from "./autoBackup";

const base: AutoBackupSettings = {
  enabled: true,
  intervalDays: 3,
  retentionCount: 10,
  directory: "/Users/test/Backups",
  lastAttemptAt: 0,
  lastSuccessAt: 1_000,
  lastFilePath: "",
  lastError: "",
};

describe("自動備份排程", () => {
  it("停用或沒有資料夾時不執行", () => {
    expect(isAutoBackupDue({ ...base, enabled: false }, 9 * AUTO_BACKUP_DAY_MS)).toBe(false);
    expect(isAutoBackupDue({ ...base, directory: "" }, 9 * AUTO_BACKUP_DAY_MS)).toBe(false);
  });

  it("首次啟用立即列為待備份，之後依週期到期", () => {
    expect(isAutoBackupDue({ ...base, lastSuccessAt: 0 }, 2_000)).toBe(true);
    expect(isAutoBackupDue(base, base.lastSuccessAt + 3 * AUTO_BACKUP_DAY_MS - 1)).toBe(false);
    expect(isAutoBackupDue(base, base.lastSuccessAt + 3 * AUTO_BACKUP_DAY_MS)).toBe(true);
    expect(nextAutoBackupAt(base)).toBe(base.lastSuccessAt + 3 * AUTO_BACKUP_DAY_MS);
  });
});
