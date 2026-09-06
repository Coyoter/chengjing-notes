export const SYNC_TABLES = ["cards", "boards", "boardNodes", "boardEdges", "kanbanBoards", "kanbanLists", "kanbanPlacements", "tags", "tasks", "highlights", "attachments", "fragments", "knowledgeGroups", "chatThreads", "chatMessages", "cardVersions", "brainEdges", "brainReports", "brainShares"] as const;
export type SyncTable = typeof SYNC_TABLES[number];
export type SyncClock = Record<string, number>;
export interface SyncOperation { id: string; table: SyncTable; key: string; clock: SyncClock; value: Record<string, unknown> | null; changedAt?: number }
export interface SyncRecord { id: string; heads: SyncOperation[]; recovery?: SyncOperation[] }
export interface SyncPacket { protocol: "chengjing-sync-v1"; id: string; operations: SyncOperation[] }
export function dominates(a: SyncClock, b: SyncClock) {
  return Object.keys(b).every((key) => (a[key] || 0) >= b[key]) && Object.keys(a).some((key) => a[key] > (b[key] || 0));
}
export function joinedClock(heads: SyncOperation[]): SyncClock {
  const clock: SyncClock = Object.create(null);
  for (const head of heads) for (const [actor, sequence] of Object.entries(head.clock)) clock[actor] = Math.max(clock[actor] || 0, sequence);
  return clock;
}
export function mergeHeads(existing: SyncOperation[], incoming: SyncOperation[]): SyncOperation[] {
  const all = [...new Map([...existing, ...incoming].map((item) => [item.id, item])).values()];
  const heads = all.filter((candidate) => !all.some((other) => other.id !== candidate.id && dominates(other.clock, candidate.clock))).sort((a, b) => a.id.localeCompare(b.id));
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
    return JSON.stringify(value) ?? "null";
  };
  const comparable = (value: SyncOperation["value"]) => canonical(value && Object.fromEntries(Object.entries(value).filter(([key]) => !["searchTerms","taskSyncState","relativePath","storage","createdAt","updatedAt"].includes(key))));
  if (heads.length > 1 && heads.every((head) => comparable(head.value) === comparable(heads[0].value))) {
    const clock=joinedClock(heads);
    const value = heads[0].value && { ...heads[0].value };
    if (value) for (const key of ["createdAt","updatedAt"] as const) {
      const times=heads.map(head=>head.value?.[key]).filter((time): time is number=>typeof time==="number"&&Number.isFinite(time));
      if(times.length)value[key]=key==="createdAt"?Math.min(...times):Math.max(...times);
    }
    return [{ ...heads[0], value, changedAt: Math.max(...heads.map(operationTime)), id: `merged:${JSON.stringify(Object.entries(clock).sort())}`, clock }];
  }
  return heads;
}
export function operationTime(operation: SyncOperation): number {
  // Legacy packets have no operation time. A deadline is NEVER a modification time.
  for (const time of [operation.changedAt, operation.value?.updatedAt, operation.value?.createdAt]) {
    if (typeof time === "number" && Number.isSafeInteger(time) && time >= 0) return time;
  }
  return 0;
}
export function materializedHead(heads: SyncOperation[]) {
  // Causality outranks wall clocks. Only truly concurrent edits use last-write-wins.
  const candidates = heads.filter(a => !heads.some(b => dominates(b.clock, a.clock)));
  return candidates.reduce((winner, head) => {
    const delta = operationTime(head) - operationTime(winner);
    if (delta !== 0) return delta > 0 ? head : winner;
    // Legacy undated deletions cannot establish that they followed an offline edit.
    if (operationTime(head) === 0 && Boolean(head.value) !== Boolean(winner.value)) return head.value ? head : winner;
    return head.id > winner.id ? head : winner;
  });
}
export function mergeSyncRecord(previous: SyncRecord | undefined, incoming: SyncOperation[]): SyncRecord {
  const heads = mergeHeads(previous?.heads || [], incoming);
  const winner = materializedHead(heads);
  const recovery = [...new Map([...(previous?.recovery || []), ...heads.filter(head => head.id !== winner.id)].map(head => [head.id, head])).values()];
  return { id: previous?.id || `${winner.table}:${winner.key}`, heads, recovery };
}
export function validateSyncPacket(value: unknown): SyncPacket {
  const packet = value as SyncPacket;
  if (!packet || packet.protocol !== "chengjing-sync-v1" || typeof packet.id !== "string" || !Array.isArray(packet.operations) || packet.operations.length > 500) throw new Error("sync-invalid-packet");
  for (const op of packet.operations) {
    if (!op || !SYNC_TABLES.includes(op.table) || typeof op.id !== "string" || typeof op.key !== "string" || !op.key || !op.clock || Array.isArray(op.clock)) throw new Error("sync-invalid-operation");
    for (const [actor, sequence] of Object.entries(op.clock)) if (!/^[\w-]{1,100}$/.test(actor) || !Number.isSafeInteger(sequence) || sequence < 1) throw new Error("sync-invalid-clock");
    if (op.changedAt !== undefined && (!Number.isSafeInteger(op.changedAt) || op.changedAt < 0)) throw new Error("sync-invalid-time");
    if (op.value !== null && (typeof op.value !== "object" || Array.isArray(op.value) || op.value.id !== op.key)) throw new Error("sync-invalid-record");
  }
  return packet;
}
