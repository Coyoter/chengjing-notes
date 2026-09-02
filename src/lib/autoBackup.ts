import type { AutoBackupSettings, AutoBackupWriteResult } from "../types";
import { createIncrementalBackupPayload } from "./backup";

export const AUTO_BACKUP_DAY_MS = 86_400_000;

export function isAutoBackupDue(settings: Pick<AutoBackupSettings, "enabled" | "directory" | "intervalDays" | "lastSuccessAt">, now = Date.now()) {
  if (!settings.enabled || !settings.directory) return false;
  if (!settings.lastSuccessAt) return true;
  return now - settings.lastSuccessAt >= settings.intervalDays * AUTO_BACKUP_DAY_MS;
}

export function nextAutoBackupAt(settings: Pick<AutoBackupSettings, "enabled" | "directory" | "intervalDays" | "lastSuccessAt">) {
  if (!settings.enabled || !settings.directory) return 0;
  if (!settings.lastSuccessAt) return Date.now();
  return settings.lastSuccessAt + settings.intervalDays * AUTO_BACKUP_DAY_MS;
}

export async function writeCompleteBackup(reason: "scheduled" | "manual"): Promise<AutoBackupWriteResult> {
  if (!window.chengjing?.backups) throw new Error("automatic-backup-desktop-required");
  const payload = await createIncrementalBackupPayload();
  return window.chengjing.backups.write({ ...payload, reason });
}

export function announceAutoBackup(settings: AutoBackupSettings) {
  window.dispatchEvent(new CustomEvent<AutoBackupSettings>("chengjing:auto-backup-status", { detail: settings }));
}
