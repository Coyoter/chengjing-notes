import { describe, expect, it } from "vitest";
import type { AutoBackupSettings, CloudBackupSettings } from "../types";
import { AUTO_BACKUP_DAY_MS, CLOUD_BACKUP_MINUTE_MS, isAutoBackupDue, isCloudBackupDue, nextAutoBackupAt } from "./autoBackup";

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

  it("Google 雲端預設可每 30 分鐘執行，但衝突時一定暫停", () => {
    const cloud: CloudBackupSettings = {
      enabled: true,
      intervalMinutes: 30,
      accountName: "",
      accountEmail: "",
      deviceId: "device-12345678901234567890",
      lastAttemptAt: 0,
      lastSuccessAt: 1_000,
      lastContentHash: "",
      lastKnownManifestId: "manifest",
      lastError: "",
      conflict: false,
    };
    expect(isCloudBackupDue(cloud, cloud.lastSuccessAt + 30 * CLOUD_BACKUP_MINUTE_MS - 1)).toBe(false);
    expect(isCloudBackupDue(cloud, cloud.lastSuccessAt + 30 * CLOUD_BACKUP_MINUTE_MS)).toBe(true);
    expect(isCloudBackupDue({ ...cloud, conflict: true }, cloud.lastSuccessAt + 60 * CLOUD_BACKUP_MINUTE_MS)).toBe(false);
  });
});
