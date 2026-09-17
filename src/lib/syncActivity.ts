export type SyncActivity = { phase: "idle" | "syncing" | "error"; error: string; lastSuccessAt: number };
let activity: SyncActivity = { phase: "idle", error: "", lastSuccessAt: Number(localStorage.getItem("chengjing-sync-last-success")) || 0 };
const listeners = new Set<() => void>();
export const getSyncActivity = () => activity;
export function subscribeSyncActivity(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function reportSyncActivity(phase: SyncActivity["phase"], error = "", completed = phase === "idle") {
  const lastSuccessAt = completed ? Date.now() : activity.lastSuccessAt;
  if (completed) localStorage.setItem("chengjing-sync-last-success", String(lastSuccessAt));
  activity = { phase, error, lastSuccessAt };
  listeners.forEach(listener => listener());
}
export function syncStatusKind(enabled: boolean, working: boolean, error: string, pending: number, lastSuccessAt: number) {
  if (working) return "working";
  if (error) return "error";
  if (!enabled) return "paused";
  if (pending > 0) return "pending";
  return lastSuccessAt ? "ready" : "waiting";
}

export function googleSyncNeedsAuthorization(error: string) {
  return /AUTH_REQUIRED|Google authorization required/i.test(error);
}

export function resetSyncActivity() {
  localStorage.removeItem("chengjing-sync-last-success");
  activity = { phase: "idle", error: "", lastSuccessAt: 0 };
  listeners.forEach(listener => listener());
}
