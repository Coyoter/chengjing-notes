import { beforeEach, describe, expect, it } from "vitest";
import { acknowledgeBackup, backupRevision, cloudBackupReady, markBackupChanged } from "./backupChanges";
describe("雲端備份變更記錄", () => {
  beforeEach(() => localStorage.clear());
  it("停筆30秒會備份，持續輸入到期也會備份", () => {
    expect(cloudBackupReady(true, 29_999, false)).toBe(false);
    expect(cloudBackupReady(true, 30_000, false)).toBe(true);
    expect(cloudBackupReady(true, 0, true)).toBe(true);
    expect(cloudBackupReady(false, 60_000, false)).toBe(false);
  });
  it("上傳期間的新修改不能被舊備份清除", () => {
    markBackupChanged(); const old = backupRevision();
    markBackupChanged(); const current = backupRevision();
    acknowledgeBackup(old); expect(backupRevision()).toBe(current);
    acknowledgeBackup(current); expect(backupRevision()).toBe("");
  });
  it("失敗時不確認，待備份標記保留在持久儲存", () => {
    markBackupChanged();
    expect(localStorage.getItem("chengjing-cloud-pending-v1")).toBe(backupRevision());
    expect(backupRevision()).not.toBe("");
  });
});
