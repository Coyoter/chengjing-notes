import { db } from "../db";
import { migrateLegacyAttachments } from "./attachments";
import { ignoreTransactionHistory } from "./historyTransactions";
import { syncEnabled } from "./syncJournal";
import { SYNC_TABLES, type SyncRecord, type SyncTable } from "./syncProtocol";
import type {
  SyncRecoveryAssetSource,
  SyncRecoveryDownloadResult,
  SyncRecoverySnapshot,
} from "../types";

export type RecoveryRow = Record<string, unknown> & { id: string };
export interface RecoveryPayload {
  format: "chengjing-sync-recovery";
  version: 1;
  dayBasis: "UTC";
  snapshotAt: number;
  data: Record<SyncTable, RecoveryRow[]>;
}

export interface RecoveryRestoreEffects {
  assertAllowed: () => void;
  restoreAttachment: (row: RecoveryRow, backupFilePath: string) => Promise<RecoveryRow>;
  writeSafety: () => Promise<{ filePath: string; bytes: number }>;
}

const MAX_BYTES = 64 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const STATE_TABLES = [...SYNC_TABLES, "syncRecords", "syncOutbox", "syncState", "syncInbox"];
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function recoveryUtcDay(timestamp: number): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 8_640_000_000_000_000) {
    throw new Error("sync-recovery-invalid-time");
  }
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function parseSyncRecoveryPayload(raw: string): RecoveryPayload {
  if (typeof raw !== "string" || !raw.length || new TextEncoder().encode(raw).byteLength > MAX_BYTES) {
    throw new Error("sync-recovery-payload-size");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("sync-recovery-payload-invalid"); }
  if (!isObject(parsed) || parsed.format !== "chengjing-sync-recovery"
    || parsed.version !== 1 || parsed.dayBasis !== "UTC" || !isObject(parsed.data)
    || typeof parsed.snapshotAt !== "number") throw new Error("sync-recovery-payload-invalid");
  recoveryUtcDay(parsed.snapshotAt);
  if (Object.keys(parsed).sort().join(",") !== "data,dayBasis,format,snapshotAt,version") {
    throw new Error("sync-recovery-private-fields");
  }
  if (Object.keys(parsed.data).sort().join(",") !== [...SYNC_TABLES].sort().join(",")) {
    throw new Error("sync-recovery-tables-incomplete");
  }

  const assetSizes = new Map<string, number>();
  for (const name of SYNC_TABLES) {
    const rows = parsed.data[name];
    if (!Array.isArray(rows)) throw new Error("sync-recovery-table-invalid");
    const ids = new Set<string>();
    for (const row of rows) {
      if (!isObject(row) || typeof row.id !== "string" || !row.id.trim()
        || row.id.length > 1024 || ids.has(row.id)) throw new Error("sync-recovery-record-invalid");
      ids.add(row.id);
      if (name !== "attachments") continue;
      if (Object.prototype.hasOwnProperty.call(row, "blob")
        || Object.prototype.hasOwnProperty.call(row, "relativePath")) {
        throw new Error("sync-recovery-local-attachment-path");
      }
      if (typeof row.sha256 !== "string" || !HASH.test(row.sha256)
        || typeof row.size !== "number" || !Number.isSafeInteger(row.size) || row.size < 0) {
        throw new Error("sync-recovery-asset-invalid");
      }
      const prior = assetSizes.get(row.sha256);
      if (prior !== undefined && prior !== row.size) throw new Error("sync-recovery-asset-size-conflict");
      assetSizes.set(row.sha256, row.size);
    }
  }
  return parsed as unknown as RecoveryPayload;
}

export async function recoveryHash(raw: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Capture only synchronized content, never preferences, credentials or journal state. */
export async function captureSyncRecoveryPayload() {
  if (!syncEnabled()) throw new Error("sync-recovery-paused");
  await migrateLegacyAttachments();
  const captured = await db.transaction(
    "r", [...SYNC_TABLES.map(name => db.table(name)), db.table("syncOutbox")],
    async () => {
      if (!syncEnabled()) throw new Error("sync-recovery-paused");
      if (await db.table("syncOutbox").count()) throw new Error("sync-recovery-pending-changes");
      const data = {} as RecoveryPayload["data"];
      const sources = new Map<string, SyncRecoveryAssetSource>();
      const snapshotAt = Date.now();
      for (const name of SYNC_TABLES) {
        const rows = await db.table<RecoveryRow>(name).toArray();
        data[name] = rows.map(row => {
          const portable = { ...row };
          delete portable.searchTerms;
          if (name === "attachments") {
            if (row.storage !== "file" || typeof row.relativePath !== "string" || !row.relativePath
              || typeof row.sha256 !== "string" || !HASH.test(row.sha256)
              || typeof row.size !== "number" || !Number.isSafeInteger(row.size) || row.size < 0) {
              throw new Error("sync-recovery-asset-not-ready");
            }
            const prior = sources.get(row.sha256);
            if (prior && prior.size !== row.size) throw new Error("sync-recovery-asset-size-conflict");
            sources.set(row.sha256, {
              relativePath: row.relativePath, sha256: row.sha256, size: row.size,
            });
            delete portable.blob;
            delete portable.relativePath;
            delete portable.storage;
          }
          return portable;
        });
      }
      if (!syncEnabled()) throw new Error("sync-recovery-paused");
      const payload: RecoveryPayload = {
        format: "chengjing-sync-recovery", version: 1, dayBasis: "UTC", snapshotAt, data,
      };
      return { data: JSON.stringify(payload), assets: [...sources.values()] };
    },
  );
  parseSyncRecoveryPayload(captured.data);
  return captured;
}

async function stateTokenInTransaction(): Promise<string> {
  const rows = [];
  for (const name of STATE_TABLES) rows.push([name, await db.table(name).toArray()]);
  // This token stays in memory. It is never sent to Google or stored in a snapshot.
  return JSON.stringify(rows);
}

export function readRecoveryBaseline(): Promise<string> {
  return db.transaction("r", STATE_TABLES.map(name => db.table(name)), stateTokenInTransaction);
}

export async function verifyRecoveryDownload(
  download: SyncRecoveryDownloadResult,
  expected: SyncRecoverySnapshot,
): Promise<RecoveryPayload> {
  if (!download || !download.snapshot || typeof download.backupFilePath !== "string"
    || !download.backupFilePath || typeof expected?.id !== "string"
    || !/^[A-Za-z0-9_-]{1,200}$/.test(expected.id)) {
    throw new Error("sync-recovery-download-invalid");
  }
  for (const key of ["id", "day", "snapshotAt", "size", "contentHash"] as const) {
    if (download.snapshot[key] !== expected[key]) throw new Error("sync-recovery-selection-changed");
  }
  const payload = parseSyncRecoveryPayload(download.data);
  if (payload.snapshotAt !== expected.snapshotAt || recoveryUtcDay(payload.snapshotAt) !== expected.day
    || new TextEncoder().encode(download.data).byteLength !== expected.size
    || await recoveryHash(download.data) !== expected.contentHash) {
    throw new Error("sync-recovery-manifest-corrupt");
  }
  return payload;
}

/**
 * The caller must first finish a synchronization and hold the synchronization
 * operation lock for this entire function. External I/O finishes before the
 * write transaction. Concurrent local edits invalidate the safety baseline.
 */
export async function restoreRecoverySnapshot(
  download: SyncRecoveryDownloadResult,
  expected: SyncRecoverySnapshot,
  effects: RecoveryRestoreEffects,
) {
  const assertAllowed = () => {
    if (!syncEnabled()) throw new Error("sync-recovery-paused");
    effects.assertAllowed();
  };
  assertAllowed();
  const payload = await verifyRecoveryDownload(download, expected);
  assertAllowed();
  const restoredAttachments = new Map<string, RecoveryRow>();

  for (const row of payload.data.attachments) {
    assertAllowed();
    const restored = await effects.restoreAttachment({ ...row }, download.backupFilePath);
    if (!restored || restored.id !== row.id || restored.sha256 !== row.sha256
      || restored.size !== row.size || restored.storage !== "file"
      || typeof restored.relativePath !== "string" || !restored.relativePath) {
      throw new Error("sync-recovery-attachment-corrupt");
    }
    restoredAttachments.set(row.id, {
      ...row, storage: "file", relativePath: restored.relativePath,
    });
  }

  assertAllowed();
  const baseline = await readRecoveryBaseline();
  const safety = await effects.writeSafety();
  if (!safety || typeof safety.filePath !== "string" || !safety.filePath
    || !Number.isSafeInteger(safety.bytes) || safety.bytes <= 0) {
    throw new Error("sync-recovery-safety-copy-required");
  }
  assertAllowed();

  const result = await db.transaction("rw", STATE_TABLES.map(name => db.table(name)), async transaction => {
    assertAllowed();
    if (await stateTokenInTransaction() !== baseline) throw new Error("sync-recovery-content-changed");
    ignoreTransactionHistory(transaction);
    const restoredAt = Date.now();
    let restoredItems = 0, deletedItems = 0;

    for (const name of SYNC_TABLES) {
      assertAllowed();
      const current = await db.table<RecoveryRow>(name).toArray();
      const desired = payload.data[name].map(row => name === "attachments" ? restoredAttachments.get(row.id)! : row);
      const desiredIds = new Set(desired.map(row => row.id));
      const deleted = current.filter(row => !desiredIds.has(row.id)).map(row => row.id);
      const changedIds = [...new Set([...desiredIds, ...deleted])];

      // Keep current winners as recoverable versions. Do not reset clocks,
      // inbox receipts, device identity or the persistent outgoing queue.
      for (let index = 0; index < changedIds.length; index += 100) {
        const ids = changedIds.slice(index, index + 100).map(id => `${name}:${id}`);
        const records = await db.table<SyncRecord>("syncRecords").bulkGet(ids);
        for (const prior of records) {
          if (!prior) continue;
          if (!Array.isArray(prior.heads)) throw new Error("sync-recovery-journal-invalid");
          const recovery = [...new Map(
            [...(prior.recovery || []), ...prior.heads].map(head => [head.id, head]),
          ).values()];
          await db.table("syncRecords").put({ ...prior, recovery });
        }
      }
      for (let index = 0; index < deleted.length; index += 100) {
        assertAllowed();
        await db.table(name).bulkDelete(deleted.slice(index, index + 100));
      }
      for (let index = 0; index < desired.length; index += 100) {
        assertAllowed();
        await db.table(name).bulkPut(
          desired.slice(index, index + 100).map(row => ({ ...row, updatedAt: restoredAt })),
        );
      }
      restoredItems += desired.length;
      deletedItems += deleted.length;
    }
    assertAllowed();
    return { restoredItems, deletedItems };
  });

  return { ...result, safetyCopyPath: safety.filePath };
}
