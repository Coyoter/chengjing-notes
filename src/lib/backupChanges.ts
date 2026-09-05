const KEY = "chengjing-cloud-pending-v1";
export function backupRevision() { return localStorage.getItem(KEY) || ""; }
export function markBackupChanged() {
  localStorage.setItem(KEY, crypto.randomUUID());
  window.dispatchEvent(new Event("chengjing:backup-changed"));
}
export function acknowledgeBackup(revision: string) {
  if (backupRevision() === revision) localStorage.removeItem(KEY);
}
export function cloudBackupReady(dirty: boolean, quietMs: number, due: boolean) {
  return due || (dirty && quietMs >= 30_000);
}
