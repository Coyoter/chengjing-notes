import { withPausedSyncWorkspace } from "./syncEngine";
import { resetSyncActivity } from "./syncActivity";

export async function disconnectGoogleAccount(deps: {
  suspendRecovery: () => Promise<unknown>;
  pauseNative?: () => Promise<unknown>;
  disconnect: () => Promise<unknown>;
}) {
  // Stop scheduling immediately; retain local records and the pending outbox.
  localStorage.removeItem("chengjing-sync-enabled");
  await deps.suspendRecovery();
  await deps.pauseNative?.();
  // Let an already-started sync finish/cancel before clearing its credentials.
  await withPausedSyncWorkspace(deps.disconnect);
  resetSyncActivity();
}
