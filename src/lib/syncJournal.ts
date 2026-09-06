import type Dexie from "dexie";
import { type DBCoreTransaction } from "dexie";
import { SYNC_TABLES, joinedClock, type SyncOperation, type SyncRecord, type SyncTable } from "./syncProtocol";

export const remoteSyncTransactions = new WeakSet<object>();
export function syncEnabled() { return typeof localStorage !== "undefined" && localStorage.getItem("chengjing-sync-enabled") === "true"; }
function tracking() { return syncEnabled() || (typeof localStorage !== "undefined" && localStorage.getItem("chengjing-sync-tracking") === "true"); }
export function syncDeviceId() {
  let value = localStorage.getItem("chengjing-sync-device");
  if (!value) { value = crypto.randomUUID(); localStorage.setItem("chengjing-sync-device", value); }
  return value;
}
export function installSyncJournal(db: Dexie) {
  db.use({ stack: "dbcore", name: "chengjing-sync-journal", level: 0,
    create(down) {
      const queues = new WeakMap<DBCoreTransaction, Promise<unknown>>();
      const notified = new WeakSet<DBCoreTransaction>();
      return { ...down,
        transaction(stores, mode, options) {
          const tracked = mode === "readwrite" && tracking() && stores.some((name) => (SYNC_TABLES as readonly string[]).includes(name));
          return down.transaction(tracked ? [...new Set([...stores, "syncRecords", "syncOutbox", "syncState"])] : stores, mode, options);
        },
        table(name) {
          const table = down.table(name);
          if (!(SYNC_TABLES as readonly string[]).includes(name)) return table;
          return { ...table, async mutate(request) {
            if (!tracking() || remoteSyncTransactions.has(request.trans)) return table.mutate(request);
            const execute = async () => {
            const trans: DBCoreTransaction = request.trans;
            if (!notified.has(trans)) {
              notified.add(trans);
              (trans as unknown as IDBTransaction).addEventListener("complete", () => window.dispatchEvent(new Event("chengjing:sync-dirty")), { once: true });
            }
            const records = down.table("syncRecords"); const outbox = down.table("syncOutbox"); const state = down.table("syncState");
            const keysBefore = request.type === "deleteRange" ? (await table.query({ trans, values: false, query: { index: table.schema.primaryKey, range: request.range } })).result : null;
            const response = await table.mutate(request);
            const keys = keysBefore || (request.type === "delete" ? request.keys : response.results || []);
            const successful = keys.filter((_key, index) => !response.failures[index]);
            const values = request.type === "delete" || request.type === "deleteRange" ? successful.map(() => null) : await table.getMany({ trans, keys: successful });
            const device = syncDeviceId();
            const current = await state.get({ trans, key: "sequence" }) || { id: "sequence", value: 0 };
            for (let index = 0; index < successful.length; index++) {
              const key = String(successful[index]); const id = `${name}:${key}`;
              const prior: SyncRecord | undefined = await records.get({ trans, key: id });
              const clock = joinedClock(prior?.heads || []);
              current.value = Math.max(current.value, clock[device] || 0) + 1; clock[device] = current.value;
              const value = values[index] ? { ...values[index] } : null;
              if (value) { delete value.blob; delete value.searchTerms; }
              const operation: SyncOperation = { id: crypto.randomUUID(), table: name as SyncTable, key, clock, value };
              const result = await records.mutate({ trans, type: "put", values: [{ id, heads: [operation] }] });
              const queued = await outbox.mutate({ trans, type: "put", values: [operation] });
              if (result.numFailures || queued.numFailures) { trans.abort(); throw new Error("sync-journal-write-failed"); }
            }
            if (successful.length) { const saved = await state.mutate({ trans, type: "put", values: [current] }); if (saved.numFailures) { trans.abort(); throw new Error("sync-sequence-write-failed"); } }
            return response;
            };
            const pending = (queues.get(request.trans) || Promise.resolve()).then(execute);
            queues.set(request.trans, pending.catch(() => {}));
            return pending;
          } };
        },
      };
    },
  });
}
