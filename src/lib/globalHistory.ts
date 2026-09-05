import { useSyncExternalStore } from "react";
import { db } from "../db";
import { ignoreTransactionHistory } from "./historyTransactions";

type HistoryValue = Record<string, unknown>;
type HistoryChange = {
  table: string;
  key: string;
  before?: HistoryValue;
  after?: HistoryValue;
};
type HistoryEntry = { changes: HistoryChange[]; createdAt: number };
type DatabaseMutation = {
  type: "creating" | "updating" | "deleting";
  table: string;
  key: string;
  value?: HistoryValue;
  oldValue?: HistoryValue;
  modifications?: Record<string, unknown>;
};

const HISTORY_LIMIT = 50;
const CAPTURE_DELAY_MS = 420;
const listeners = new Set<() => void>();
const pending = new Map<string, HistoryChange>();
let entries: HistoryEntry[] = [];
let index = -1;
let initialized = false;
let restoring = false;
let captureTimer: ReturnType<typeof setTimeout> | null = null;
let hookedTableCount = 0;
let state = { canUndo: false, canRedo: false, restoring: false, entryCount: 0, changedRecordCount: 0, hookedTableCount: 0 };

function publish() {
  state = { canUndo: index >= 0, canRedo: index < entries.length - 1, restoring, entryCount: entries.length, changedRecordCount: entries.reduce((sum, entry) => sum + entry.changes.length, 0), hookedTableCount };
  listeners.forEach((listener) => listener());
}

function cloneValue<T>(value: T): T {
  return typeof structuredClone === "function" ? structuredClone(value) : value;
}

function changeId(table: string, key: string) {
  return `${table}:${typeof key}:${String(key)}`;
}

function sameValue(left: HistoryValue | undefined, right: HistoryValue | undefined) {
  if (left === undefined || right === undefined) return left === right;
  const replacer = (_key: string, value: unknown) => value instanceof Blob ? { type: value.type, size: value.size } : value;
  return JSON.stringify(left, replacer) === JSON.stringify(right, replacer);
}

function queueChange(change: HistoryChange) {
  if (!initialized) return;
  const id = changeId(change.table, change.key);
  const current = pending.get(id);
  const merged: HistoryChange = current
    ? { ...current, after: change.after === undefined ? undefined : cloneValue(change.after) }
    : {
      table: change.table,
      key: change.key,
      before: change.before === undefined ? undefined : cloneValue(change.before),
      after: change.after === undefined ? undefined : cloneValue(change.after),
    };
  if (sameValue(merged.before, merged.after)) pending.delete(id);
  else pending.set(id, merged);
  if (captureTimer) clearTimeout(captureTimer);
  captureTimer = setTimeout(commitPending, CAPTURE_DELAY_MS);
}

function applyModifications(value: HistoryValue, modifications: Record<string, unknown>) {
  const next = cloneValue(value);
  for (const [key, replacement] of Object.entries(modifications)) {
    if (!key.includes(".")) {
      if (replacement === undefined) delete next[key];
      else next[key] = cloneValue(replacement);
      continue;
    }
    const parts = key.split(".");
    let target: Record<string, unknown> = next;
    for (const part of parts.slice(0, -1)) {
      const child = target[part];
      target = child && typeof child === "object" ? child as Record<string, unknown> : (target[part] = {} as Record<string, unknown>);
    }
    const leaf = parts.at(-1)!;
    if (replacement === undefined) delete target[leaf];
    else target[leaf] = cloneValue(replacement);
  }
  return next;
}

function recordDatabaseMutation(mutation: DatabaseMutation) {
  if (mutation.type === "creating" && mutation.value) queueChange({ table: mutation.table, key: mutation.key, after: mutation.value });
  else if (mutation.type === "updating" && mutation.oldValue) queueChange({
    table: mutation.table,
    key: mutation.key,
    before: mutation.oldValue,
    after: applyModifications(mutation.oldValue, mutation.modifications || {}),
  });
  else if (mutation.type === "deleting" && mutation.oldValue) queueChange({ table: mutation.table, key: mutation.key, before: mutation.oldValue });
}

function commitPending() {
  if (captureTimer) clearTimeout(captureTimer);
  captureTimer = null;
  if (restoring || pending.size === 0) return;
  const changes = [...pending.values()].filter((change) => !sameValue(change.before, change.after));
  pending.clear();
  if (!changes.length) return;
  entries = entries.slice(0, index + 1);
  entries.push({ changes, createdAt: Date.now() });
  if (entries.length > HISTORY_LIMIT) entries.shift();
  index = entries.length - 1;
  publish();
}

async function applyEntry(entry: HistoryEntry, direction: "undo" | "redo") {
  const changes = direction === "undo" ? [...entry.changes].reverse() : entry.changes;
  const tables = [...new Set(changes.map((change) => change.table))].map((name) => db.table(name));
  await db.transaction("rw", tables, async (transaction) => {
    ignoreTransactionHistory(transaction);
    for (const change of changes) {
      const value = direction === "undo" ? change.before : change.after;
      const table = db.table(change.table);
      if (value === undefined) await table.delete(change.key);
      else await table.put(cloneValue(value));
    }
  });
}

async function restore(direction: "undo" | "redo") {
  commitPending();
  const target = direction === "undo" ? entries[index] : entries[index + 1];
  if (!target || restoring) return false;
  restoring = true;
  publish();
  try {
    await applyEntry(target, direction);
    index += direction === "undo" ? -1 : 1;
    return true;
  } finally {
    restoring = false;
    publish();
  }
}

export async function initializeGlobalHistory() {
  if (initialized) return;
  const shared = globalThis as typeof globalThis & { __chengjingHistoryRecorder?: (mutation: DatabaseMutation) => void };
  shared.__chengjingHistoryRecorder = recordDatabaseMutation;
  hookedTableCount = db.tables.length;
  initialized = true;
  publish();
}

export async function undoGlobalAction() {
  return restore("undo");
}

export async function redoGlobalAction() {
  return restore("redo");
}

export function useGlobalHistoryState() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => state,
    () => state,
  );
}

export function globalHistoryState() {
  return state;
}

export async function runWithoutGlobalHistory<T>(operation: () => Promise<T>) {
  return db.transaction("rw", db.tables, (transaction) => {
    ignoreTransactionHistory(transaction);
    return operation();
  });
}

export function clearGlobalHistory() {
  if (captureTimer) clearTimeout(captureTimer);
  captureTimer = null;
  pending.clear();
  entries = [];
  index = -1;
  publish();
}

/**
 * 讓外部整合的一次寫入形成單一、可復原的歷史紀錄，並避免和使用者剛才
 * 在介面上的編輯被 420ms 合併視窗黏在一起。
 */
export async function runGlobalHistoryAction<T>(operation: () => Promise<T>) {
  commitPending();
  try { return await operation(); }
  finally { commitPending(); }
}
