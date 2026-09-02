import { db, createCard } from "../db";
import type { KanbanBoardRecord, KanbanListRecord, KanbanPlacementRecord } from "../types";

export async function createKanbanBoard(title: string, defaultLists: string[] = []): Promise<KanbanBoardRecord> {
  const timestamp = Date.now();
  const board: KanbanBoardRecord = { id: crypto.randomUUID(), title: title.trim(), description: "", favorite: false, createdAt: timestamp, updatedAt: timestamp };
  await db.transaction("rw", [db.kanbanBoards, db.kanbanLists], async () => {
    await db.kanbanBoards.add(board);
    if (defaultLists.length) await db.kanbanLists.bulkAdd(defaultLists.map((listTitle, order): KanbanListRecord => ({ id: crypto.randomUUID(), boardId: board.id, title: listTitle, order, createdAt: timestamp, updatedAt: timestamp })));
  });
  return board;
}

export async function createKanbanList(boardId: string, title: string): Promise<KanbanListRecord> {
  const siblings = await db.kanbanLists.where("boardId").equals(boardId).sortBy("order");
  const timestamp = Date.now();
  const list: KanbanListRecord = { id: crypto.randomUUID(), boardId, title: title.trim(), order: siblings.length, createdAt: timestamp, updatedAt: timestamp };
  await db.kanbanLists.add(list);
  await db.kanbanBoards.update(boardId, { updatedAt: timestamp });
  return list;
}

export async function createKanbanCard(boardId: string, listId: string, title: string): Promise<KanbanPlacementRecord> {
  const card = await createCard({ title: title.trim(), state: "active", color: "slate" });
  return placeCardOnKanban(boardId, listId, card.id);
}

export async function placeCardOnKanban(boardId: string, listId: string, cardId: string): Promise<KanbanPlacementRecord> {
  const existing = await db.kanbanPlacements.where("boardId").equals(boardId).filter((placement) => placement.cardId === cardId).first();
  if (existing) return existing;
  const siblings = await db.kanbanPlacements.where("listId").equals(listId).sortBy("order");
  const timestamp = Date.now();
  const placement: KanbanPlacementRecord = { id: crypto.randomUUID(), boardId, listId, cardId, order: siblings.length, createdAt: timestamp, updatedAt: timestamp };
  await db.kanbanPlacements.add(placement);
  await db.kanbanBoards.update(boardId, { updatedAt: timestamp });
  return placement;
}

function reordered<T extends { id: string; order: number; updatedAt: number }>(items: T[], now: number) {
  return items.map((item, order) => ({ ...item, order, updatedAt: now }));
}

export async function moveKanbanPlacement(placementId: string, targetListId: string, targetIndex: number): Promise<void> {
  const placement = await db.kanbanPlacements.get(placementId);
  if (!placement) return;
  const sourceItems = await db.kanbanPlacements.where("listId").equals(placement.listId).sortBy("order");
  const targetItems = placement.listId === targetListId ? sourceItems : await db.kanbanPlacements.where("listId").equals(targetListId).sortBy("order");
  const current = sourceItems.find((item) => item.id === placementId);
  if (!current) return;
  const timestamp = Date.now();
  const sourceWithout = sourceItems.filter((item) => item.id !== placementId);
  const targetWithout = placement.listId === targetListId ? sourceWithout : targetItems.filter((item) => item.id !== placementId);
  const boundedIndex = Math.max(0, Math.min(targetWithout.length, targetIndex));
  targetWithout.splice(boundedIndex, 0, { ...current, listId: targetListId, updatedAt: timestamp });
  await db.transaction("rw", [db.kanbanPlacements, db.kanbanBoards], async () => {
    if (placement.listId !== targetListId && sourceWithout.length) await db.kanbanPlacements.bulkPut(reordered(sourceWithout, timestamp));
    await db.kanbanPlacements.bulkPut(reordered(targetWithout, timestamp));
    await db.kanbanBoards.update(placement.boardId, { updatedAt: timestamp });
  });
}

export async function reorderKanbanList(boardId: string, listId: string, targetIndex: number): Promise<void> {
  const lists = await db.kanbanLists.where("boardId").equals(boardId).sortBy("order");
  const current = lists.find((list) => list.id === listId);
  if (!current) return;
  const remaining = lists.filter((list) => list.id !== listId);
  remaining.splice(Math.max(0, Math.min(remaining.length, targetIndex)), 0, current);
  const timestamp = Date.now();
  await db.transaction("rw", [db.kanbanLists, db.kanbanBoards], async () => {
    await db.kanbanLists.bulkPut(reordered(remaining, timestamp));
    await db.kanbanBoards.update(boardId, { updatedAt: timestamp });
  });
}

export async function deleteKanbanList(listId: string): Promise<void> {
  const list = await db.kanbanLists.get(listId);
  if (!list) return;
  await db.transaction("rw", [db.kanbanLists, db.kanbanPlacements, db.kanbanBoards], async () => {
    await db.kanbanPlacements.where("listId").equals(listId).delete();
    await db.kanbanLists.delete(listId);
    const remaining = await db.kanbanLists.where("boardId").equals(list.boardId).sortBy("order");
    if (remaining.length) await db.kanbanLists.bulkPut(reordered(remaining, Date.now()));
    await db.kanbanBoards.update(list.boardId, { updatedAt: Date.now() });
  });
}

export async function deleteKanbanBoard(boardId: string): Promise<void> {
  await db.transaction("rw", [db.kanbanBoards, db.kanbanLists, db.kanbanPlacements], async () => {
    await db.kanbanPlacements.where("boardId").equals(boardId).delete();
    await db.kanbanLists.where("boardId").equals(boardId).delete();
    await db.kanbanBoards.delete(boardId);
  });
}

export function checklistProgress(contentHtml: string) {
  const total = (contentHtml.match(/data-type=["']taskItem["']/g) || []).length;
  const done = (contentHtml.match(/data-type=["']taskItem["'][^>]*data-checked=["']true["']/g) || []).length;
  return { done, total };
}
