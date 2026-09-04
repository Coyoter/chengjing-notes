import type { AutoBackupSettings, AutoBackupWriteResult, CloudBackupSettings, CloudBackupWriteResult } from "../types";
import { createIncrementalBackupPayload } from "./backup";

export const AUTO_BACKUP_DAY_MS = 86_400_000;
export const CLOUD_BACKUP_MINUTE_MS = 60_000;
export type CompleteBackupPayload = Awaited<ReturnType<typeof createIncrementalBackupPayload>>;

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

export function isCloudBackupDue(settings: Pick<CloudBackupSettings, "enabled" | "intervalMinutes" | "lastSuccessAt" | "conflict">, now = Date.now()) {
  if (!settings.enabled || settings.conflict) return false;
  if (!settings.lastSuccessAt) return true;
  return now - settings.lastSuccessAt >= settings.intervalMinutes * CLOUD_BACKUP_MINUTE_MS;
}

export async function prepareCompleteBackup(): Promise<CompleteBackupPayload> {
  return createIncrementalBackupPayload();
}

export async function writeCompleteBackup(reason: "scheduled" | "manual", prepared?: CompleteBackupPayload): Promise<AutoBackupWriteResult> {
  if (!window.chengjing?.backups) throw new Error("automatic-backup-desktop-required");
  const payload = prepared || await prepareCompleteBackup();
  return window.chengjing.backups.write({ ...payload, reason });
}

export async function writeCloudBackup(reason: "scheduled" | "manual", prepared?: CompleteBackupPayload, force = false): Promise<CloudBackupWriteResult> {
  if (!window.chengjing?.cloudBackups) throw new Error("cloud-backup-desktop-required");
  const payload = prepared || await prepareCompleteBackup();
  return window.chengjing.cloudBackups.write({ ...payload, reason, force });
}

export async function writeRestoreSafetyBackup(prepared?: CompleteBackupPayload) {
  if (!window.chengjing?.backups) throw new Error("automatic-backup-desktop-required");
  const payload = prepared || await prepareCompleteBackup();
  return window.chengjing.backups.writeSafety(payload);
}

export function announceAutoBackup(settings: AutoBackupSettings) {
  window.dispatchEvent(new CustomEvent<AutoBackupSettings>("chengjing:auto-backup-status", { detail: settings }));
}
