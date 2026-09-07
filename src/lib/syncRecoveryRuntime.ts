import { db } from "../db";
import type { AttachmentRecord } from "../types";
import { restoreFileAttachment } from "./attachments";
import { prepareCompleteBackup, writeRestoreSafetyBackup } from "./autoBackup";
import { reportSyncActivity } from "./syncActivity";
import { synchronize, withSynchronizedWorkspace, type SyncTransport } from "./syncEngine";
import { syncEnabled } from "./syncJournal";
import {
  captureSyncRecoveryPayload, restoreRecoverySnapshot, type RecoveryRow,
} from "./syncRecoveryData";
import { createSyncRecoveryController } from "./syncRecoveryController";

function transport(): SyncTransport {
  const bridge = window.chengjing?.sync;
  if (!bridge) throw new Error("sync-recovery-unavailable");
  return {
    list: async () => (await bridge.list()).files,
    get: bridge.get, put: bridge.put, stage: bridge.stage,
    uploadAsset: bridge.uploadAsset, downloadAsset: bridge.downloadAsset,
  };
}

const controller = createSyncRecoveryController({
  bridge: () => window.chengjing?.syncRecovery,
  isEnabled: syncEnabled,
  now: () => Date.now(),
  withWorkspace: operation => withSynchronizedWorkspace(transport(), operation),
  capture: captureSyncRecoveryPayload,
  flushEditors: async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.dispatchEvent(new Event("chengjing:flush-editors"));
    await new Promise<void>(resolve => setTimeout(resolve, 750));
  },
  restore: (download, expected, assertAllowed) => restoreRecoverySnapshot(
    download, expected, {
      assertAllowed,
      restoreAttachment: async (row, backupFilePath) => {
        const restored = await restoreFileAttachment(
          row as unknown as AttachmentRecord, backupFilePath,
        );
        return restored as unknown as RecoveryRow;
      },
      writeSafety: async () => {
        const result = await writeRestoreSafetyBackup(await prepareCompleteBackup());
        return { filePath: result.filePath, bytes: result.bytes };
      },
    },
  ),
  synchronize: async () => {
    reportSyncActivity("syncing");
    try {
      await synchronize(transport());
      if (!syncEnabled()) throw new Error("sync-recovery-paused");
      if (await db.table("syncOutbox").count()) throw new Error("sync-recovery-pending-changes");
      reportSyncActivity("idle", "", true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "sync-recovery-operation-failed";
      reportSyncActivity("error", message);
      throw error;
    }
  },
});

export const syncRecovery = {
  ...controller,
  async afterSuccessfulSync() {
    // synchronize() may finish while newer edits remain queued. Such a result is
    // not a complete baseline for a new daily point.
    if (!syncEnabled() || !window.chengjing?.syncRecovery) return;
    try {
      if (await db.table("syncOutbox").count()) return;
      await controller.afterSuccessfulSync();
    } catch {
      // Do not produce an unhandled rejection from a background notification.
      // Restore operations and explicit refreshes report errors through the UI.
    }
  },
};
