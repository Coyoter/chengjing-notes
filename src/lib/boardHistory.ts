import type { BoardEdgeRecord, BoardNodeRecord, CardRecord } from "../types";

export type BoardCardSnapshot = Pick<CardRecord, "id" | "title" | "contentHtml" | "plainText" | "updatedAt">;

export interface BoardSnapshot {
  nodes: BoardNodeRecord[];
  edges: BoardEdgeRecord[];
  cards: BoardCardSnapshot[];
}

export interface BoardHistoryState {
  entries: BoardSnapshot[];
  index: number;
}

function sortedCopies<T extends { id: string }>(values: T[]) {
  return values.map((value) => ({ ...value })).sort((left, right) => left.id.localeCompare(right.id));
}

export function createBoardSnapshot(nodes: BoardNodeRecord[], edges: BoardEdgeRecord[], cards: BoardCardSnapshot[] = []): BoardSnapshot {
  return { nodes: sortedCopies(nodes), edges: sortedCopies(edges), cards: sortedCopies(cards) };
}

export function boardSnapshotKey(snapshot: BoardSnapshot) {
  return JSON.stringify(snapshot);
}

export function appendBoardSnapshot(state: BoardHistoryState, snapshot: BoardSnapshot, limit = 80): BoardHistoryState {
  if (state.index >= 0 && boardSnapshotKey(state.entries[state.index]) === boardSnapshotKey(snapshot)) return state;
  const entries = [...state.entries.slice(0, state.index + 1), snapshot];
  const trimmed = entries.length > limit ? entries.slice(entries.length - limit) : entries;
  return { entries: trimmed, index: trimmed.length - 1 };
}

export function boardHistoryTarget(state: BoardHistoryState, direction: "undo" | "redo") {
  const index = direction === "undo" ? state.index - 1 : state.index + 1;
  return index >= 0 && index < state.entries.length ? { index, snapshot: state.entries[index] } : null;
}
