import type { Transaction } from "dexie";

const ignored = new WeakSet<Transaction>();

export function ignoreTransactionHistory(transaction: Transaction) {
  ignored.add(transaction);
}

export function transactionHistoryIgnored(transaction: Transaction) {
  for (let current: Transaction | undefined = transaction; current; current = current.parent) {
    if (ignored.has(current)) return true;
  }
  return false;
}
