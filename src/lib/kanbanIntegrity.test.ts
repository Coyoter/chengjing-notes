import "fake-indexeddb/auto";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { createCard, db } from "../db";
import { createKanbanBoard, createKanbanCard, createKanbanList, moveKanbanPlacement, placeCardOnKanban } from "./kanban";

beforeAll(async () => { await db.open(); });
beforeEach(async () => { await db.transaction("rw", db.tables, () => Promise.all(db.tables.map((table) => table.clear()))); });

it("並發加入同一卡片只產生一份看板放置", async () => {
  const board = await createKanbanBoard("Board", ["Todo"]);
  const list = (await db.kanbanLists.where("boardId").equals(board.id).first())!;
  const card = await createCard({ title: "Shared note" });
  const results = await Promise.all(Array.from({ length: 3 }, () => placeCardOnKanban(board.id, list.id, card.id)));
  expect(new Set(results.map((item) => item.id)).size).toBe(1);
  expect(await db.kanbanPlacements.count()).toBe(1);
});

it("並發把兩張卡片移到同一欄位，不會以舊快照覆蓋另一張的位置", async () => {
  const board = await createKanbanBoard("Board", ["Todo", "Done"]);
  const [source, target] = await db.kanbanLists.where("boardId").equals(board.id).sortBy("order");
  const first = await createKanbanCard(board.id, source.id, "One");
  const second = await createKanbanCard(board.id, source.id, "Two");
  await Promise.all([moveKanbanPlacement(first.id, target.id, 0), moveKanbanPlacement(second.id, target.id, 0)]);
  const saved = await db.kanbanPlacements.where("listId").equals(target.id).sortBy("order");
  expect(saved.map((item) => item.id).sort()).toEqual([first.id, second.id].sort());
  expect(saved.map((item) => item.order)).toEqual([0, 1]);
  expect(await db.kanbanPlacements.where("listId").equals(source.id).count()).toBe(0);
});

it("錯誤的看板欄位不會留下新卡片，移動也不會破壞跨看板關係", async () => {
  const board = await createKanbanBoard("First", ["Todo"]);
  const other = await createKanbanBoard("Other", ["Todo"]);
  const list = (await db.kanbanLists.where("boardId").equals(board.id).first())!;
  const otherList = (await db.kanbanLists.where("boardId").equals(other.id).first())!;
  await expect(createKanbanCard(board.id, otherList.id, "Must roll back")).rejects.toThrow("kanban-target-missing");
  expect(await db.cards.count()).toBe(0);
  const placement = await createKanbanCard(board.id, list.id, "Stays here");
  await expect(moveKanbanPlacement(placement.id, otherList.id, 0)).rejects.toThrow("kanban-target-missing");
  expect((await db.kanbanPlacements.get(placement.id))?.listId).toBe(list.id);
});

it("並發建立欄位仍維持不重複順序", async () => {
  const board = await createKanbanBoard("Board");
  await Promise.all([createKanbanList(board.id, "One"), createKanbanList(board.id, "Two")]);
  expect((await db.kanbanLists.where("boardId").equals(board.id).sortBy("order")).map((list) => list.order)).toEqual([0, 1]);
});
