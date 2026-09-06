import { db } from "../db";
import { ignoreTransactionHistory } from "./historyTransactions";
import { syncEnabled, remoteSyncTransactions } from "./syncJournal";
import { SYNC_TABLES, validateSyncPacket, mergeHeads, materializedHead, type SyncPacket, type SyncRecord, type SyncOperation } from "./syncProtocol";

export interface SyncTransport {
  stage?: (packet: SyncPacket) => Promise<unknown>;
  uploadAsset?: (asset: Record<string, unknown>) => Promise<unknown>;
  downloadAsset?: (asset: Record<string, unknown>) => Promise<Record<string, unknown>>;
  list: () => Promise<Array<{ id: string; name: string }>>;
  get: (id: string) => Promise<string>;
  put: (id: string, data: string) => Promise<unknown>;
}
let active: Promise<void> | null = null;
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
export async function stagePendingSync(transport: SyncTransport) {
  if (!syncEnabled() || !transport.stage) return;
  for await (const packet of pendingSyncPackets()) {
    if (!syncEnabled()) break;
    await transport.stage(packet);
  }
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
      const missing = [];
      for (const row of rows.slice(index, index + 100)) if (!await db.table("syncRecords").get(`${table}:${row.id}`)) missing.push(row);
      if (missing.length) await db.table(table).bulkPut(missing);
    }
  }
}
export async function reconcileMetadataOnlyConflicts() {
  if (await db.table("syncState").get("metadata-conflicts-v2")) return;
  const records: SyncRecord[] = await db.table("syncRecords").filter((record: SyncRecord) => record.heads.length > 1).toArray();
  for (const candidate of records) {
    const table = candidate.heads[0].table;
    if (table === "attachments") continue; // Device-local file paths require separate handling.
    await db.transaction("rw", db.table(table), db.table("syncRecords"), async () => {
      const current: SyncRecord | undefined = await db.table("syncRecords").get(candidate.id);
      if (!current || current.heads.length < 2) return;
      const heads = mergeHeads(current.heads, []);
      if (heads.length !== 1) return;
      const resolved = heads[0];
      // A normal journaled write joins all clocks and preserves history/undo.
      if (resolved.value) await db.table(table).put(resolved.value);
      else await db.table(table).delete(resolved.key);
    });
  }
  await db.table("syncState").put({ id:"metadata-conflicts-v2", complete:true });
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
      const heads = mergeHeads(previous?.heads || [], [operation]);
      await db.table("syncRecords").put({ id, heads });
      const visible = materializedHead(heads);
      if (visible.value) {
        if (operation.table === "attachments" && visible.id !== operation.id) continue;
        await db.table(operation.table).put(assets.get(visible.id) || visible.value);
      }
      else await db.table(operation.table).delete(operation.key);
    }
    await db.table("syncInbox").put({ id: packet.id });
    // Background native uploads cannot touch IndexedDB. Read-back is their receipt.
    await db.table("syncOutbox").bulkDelete(packet.operations.map(operation => operation.id));
  });
}
export function synchronize(transport: SyncTransport): Promise<void> {
  if (active) return active;
  active = (async () => {
    if (!syncEnabled()) return;
    await reconcileMetadataOnlyConflicts();
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
  })().finally(() => { active = null; });
  return active;
}
