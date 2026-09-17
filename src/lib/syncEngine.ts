import { db } from "../db";
import { ignoreTransactionHistory } from "./historyTransactions";
import { syncEnabled, remoteSyncTransactions, baselineSyncTransactions } from "./syncJournal";
import { SYNC_TABLES, validateSyncPacket, mergeSyncRecord, materializedHead, type SyncPacket, type SyncRecord, type SyncOperation } from "./syncProtocol";

export interface SyncTransport {
  stage?: (packet: SyncPacket) => Promise<unknown>;
  uploadAsset?: (asset: Record<string, unknown>) => Promise<unknown>;
  downloadAsset?: (asset: Record<string, unknown>) => Promise<Record<string, unknown>>;
  list: () => Promise<Array<{ id: string; name: string }>>;
  get: (id: string) => Promise<string>;
  put: (id: string, data: string) => Promise<unknown>;
}
let active: Promise<void> | null = null;

// Synchronization, native staging, and recovery share the same workspace lock.
// Errors release the lock; no caller can permanently block subsequent work.
let syncWorkspaceTail: Promise<void> = Promise.resolve();
function serializeSyncWorkspace<T>(operation: () => Promise<T>): Promise<T> {
  const result = syncWorkspaceTail.then(operation);
  syncWorkspaceTail = result.then(() => undefined, () => undefined);
  return result;
}

export function withPausedSyncWorkspace<T>(operation: () => Promise<T>): Promise<T> {
  localStorage.removeItem("chengjing-sync-enabled");
  return serializeSyncWorkspace(operation);
}
function withLocalAsset(value: Record<string, unknown>, asset?: Record<string, unknown>) {
  return asset ? { ...value, storage: asset.storage, relativePath: asset.relativePath } : value;
}
export async function* pendingSyncPackets(): AsyncGenerator<SyncPacket> {
  // Freeze IDs, not the entire database. Changes made during upload stay queued.
  const keys = await db.table("syncOutbox").toCollection().primaryKeys();
  for (let index = 0; index < keys.length; index += 500) {
    const operations: SyncOperation[] = (await db.table("syncOutbox").bulkGet(keys.slice(index, index + 500))).filter(Boolean);
    if (!operations.length) continue;
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(operations.map(op => op.id).sort().join("\n")));
    const id = `packet-${Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("")}`;
    yield { protocol: "chengjing-sync-v1", id, operations };
  }
}
export function stagePendingSync(transport: SyncTransport): Promise<void> {
  return serializeSyncWorkspace(async () => {
    if (!syncEnabled() || !transport.stage) return;
    for await (const packet of pendingSyncPackets()) {
      if (!syncEnabled()) break;
      await transport.stage(packet);
    }
  });
}
export async function enableSync() {
  await initializeSyncBaseline();
  localStorage.setItem("chengjing-sync-enabled", "true");
}
export async function initializeSyncBaseline() {
  const { migrateLegacyAttachments } = await import("./attachments");
  await migrateLegacyAttachments();
  localStorage.setItem("chengjing-sync-tracking", "true");
  // Existing content becomes an initial publication. No second authoritative content store.
  for (const table of SYNC_TABLES) {
    const rows = await db.table(table).toArray();
    for (let index = 0; index < rows.length; index += 100) {
      const missing: Array<{ id: string }> = [];
      for (const row of rows.slice(index, index + 100)) if (!await db.table("syncRecords").get(`${table}:${row.id}`)) missing.push(row);
      if (missing.length) await db.transaction("rw", db.table(table), db.table("syncRecords"), async transaction => {
        baselineSyncTransactions.add(transaction.idbtrans);
        // Recheck inside the transaction: an editor may have saved while baseline was scanning.
        for (const row of missing) if (!await db.table("syncRecords").get(`${table}:${row.id}`)) {
          const current = await db.table(table).get(row.id);
          if (current) await db.table(table).put(current);
        }
      });
    }
  }
}
export async function reconcileLatestRecords(transport?: SyncTransport) {
  if (await db.table("syncState").get("latest-wins-v1")) return;
  const records: SyncRecord[] = await db.table("syncRecords").filter((record: SyncRecord) => record.heads.length > 1).toArray();
  for (const candidate of records) {
    const table = candidate.heads[0].table;
    const candidateWinner = materializedHead(mergeSyncRecord(candidate, []).heads);
    let asset: Record<string, unknown> | undefined;
    if (table === "attachments" && candidateWinner.value) {
      const existing = await db.attachments.get(candidateWinner.key);
      if (existing?.sha256 !== candidateWinner.value.sha256 || existing?.storage !== "file") {
        if (!transport?.downloadAsset) throw new Error("sync-attachment-transport-required");
        asset = await transport.downloadAsset(candidateWinner.value);
      } else asset = existing as unknown as Record<string, unknown>;
    }
    await db.transaction("rw", db.table(table), db.table("syncRecords"), async (transaction) => {
      const current: SyncRecord | undefined = await db.table("syncRecords").get(candidate.id);
      if (!current || current.heads.length < 2) return;
      const record = mergeSyncRecord(current, []);
      const resolved = materializedHead(record.heads);
      if (table === "attachments" && resolved.id !== candidateWinner.id) throw new Error("sync-content-changed-retry");
      ignoreTransactionHistory(transaction);
      remoteSyncTransactions.add(transaction.idbtrans);
      await db.table("syncRecords").put(record);
      if (resolved.value) await db.table(table).put(withLocalAsset(resolved.value, asset));
      else await db.table(table).delete(resolved.key);
    });
  }
  await db.table("syncState").put({ id:"latest-wins-v1", complete:true });
}
export async function applySyncPacket(input: unknown, transport?: SyncTransport) {
  const packet = validateSyncPacket(input);
  if (await db.table("syncInbox").get(packet.id)) return;
  const names = [...new Set(packet.operations.map((op) => op.table))];
  const assets = new Map<string, Record<string, unknown>>();
  for (const op of packet.operations) if (op.table === "attachments" && op.value) {
    const existing = await db.attachments.get(op.key);
    if (existing?.sha256 === op.value.sha256 && existing?.storage === "file") assets.set(op.id, existing as unknown as Record<string, unknown>);
    else {
      if (!transport?.downloadAsset) throw new Error("sync-attachment-transport-required");
      assets.set(op.id, await transport.downloadAsset(op.value));
    }
  }
  await db.transaction("rw", [...names.map((name) => db.table(name)), db.table("syncRecords"), db.table("syncInbox"), db.table("syncOutbox")], async (transaction) => {
    ignoreTransactionHistory(transaction);
    remoteSyncTransactions.add(transaction.idbtrans);
    for (const operation of packet.operations) {
      const id = `${operation.table}:${operation.key}`;
      const previous: SyncRecord | undefined = await db.table("syncRecords").get(id);
      const record = mergeSyncRecord(previous, [operation]);
      await db.table("syncRecords").put(record);
      const visible = materializedHead(record.heads);
      if (visible.value) {
        if (operation.table === "attachments") {
          // Synthetic equivalent heads and a previously selected winner still need
          // the winning metadata, but must never import another device's file path.
          const local = await db.attachments.get(operation.key);
          const asset = assets.get(visible.id) || (local?.sha256 === visible.value.sha256 ? local as unknown as Record<string, unknown> : undefined)
            || [...assets.values()].find(asset => asset.sha256 === visible.value?.sha256);
          if (!asset) throw new Error("sync-attachment-transport-required");
          await db.attachments.put(withLocalAsset(visible.value, asset) as unknown as import("../types").AttachmentRecord);
        } else await db.table(operation.table).put(visible.value);
      }
      else await db.table(operation.table).delete(operation.key);
    }
    await db.table("syncInbox").put({ id: packet.id });
    // Background native uploads cannot touch IndexedDB. Read-back is their receipt.
    await db.table("syncOutbox").bulkDelete(packet.operations.map(operation => operation.id));
  });
}
async function synchronizeRecords(transport: SyncTransport): Promise<void> {
  if (!syncEnabled()) return;
  await reconcileLatestRecords(transport);
  const listed = await transport.list();
  for (const file of listed) {
    if (!syncEnabled()) return;
    if (!await db.table("syncInbox").get(file.name)) await applySyncPacket(JSON.parse(await transport.get(file.id)), transport);
  }
  for await (const packet of pendingSyncPackets()) {
    if (!syncEnabled()) return;
    await transport.stage?.(packet);
    for (const operation of packet.operations) if (operation.table === "attachments" && operation.value) {
      if (!syncEnabled()) return;
      if (!transport.uploadAsset) throw new Error("sync-attachment-transport-required");
      await transport.uploadAsset(operation.value);
    }
    if (!syncEnabled()) return;
    await transport.put(packet.id, JSON.stringify(packet));
    await db.transaction("rw", db.table("syncOutbox"), db.table("syncInbox"), async () => {
      await db.table("syncOutbox").bulkDelete(packet.operations.map((op) => op.id));
      await db.table("syncInbox").put({ id: packet.id });
    });
  }
}

export function synchronize(transport: SyncTransport): Promise<void> {
  if (active) return active;
  active = serializeSyncWorkspace(() => synchronizeRecords(transport))
    .finally(() => { active = null; });
  return active;
}

/**
 * Synchronize first, then hold the workspace exclusively for capture or restore.
 * The callback must not call synchronize(), stagePendingSync(), or this function
 * recursively. Post-restore uploads run after this promise resolves.
 *
 * Ordinary editor writes remain possible. Recovery separately verifies its
 * safety-copy baseline and commits content plus sync operations atomically.
 */
export function withSynchronizedWorkspace<T>(
  transport: SyncTransport,
  operation: () => Promise<T>,
): Promise<T> {
  return serializeSyncWorkspace(async () => {
    if (!syncEnabled()) throw new Error("sync-recovery-paused");
    await synchronizeRecords(transport);
    if (!syncEnabled()) throw new Error("sync-recovery-paused");
    if (await db.table("syncOutbox").count()) {
      throw new Error("sync-recovery-pending-changes");
    }
    return operation();
  });
}
