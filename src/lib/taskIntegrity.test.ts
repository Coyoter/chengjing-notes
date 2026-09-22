import "fake-indexeddb/auto";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createCard, db } from "../db";
import { getHiddenTaskIds } from "./activeContent";
import { createTaskChild, readCompletedRootTasks, syncCardTasksFromHtml } from "./taskSync";

const checklist = (id: string, title: string) => `<ul data-type="taskList"><li data-type="taskItem" data-task-id="${id}" data-checked="false"><div><p>${title}</p></div></li></ul>`;
beforeAll(async () => { await db.open(); });
beforeEach(async () => { await db.transaction("rw", db.tables, () => Promise.all(db.tables.map((table) => table.clear()))); });
afterEach(() => { vi.restoreAllMocks(); });

it("移除筆記核取方塊後，額外建立的子待辦保留為可見獨立項目", async () => {
  const card = await createCard({ title: "Checklist", contentHtml: checklist("root", "Parent") });
  await syncCardTasksFromHtml(card.id, card.contentHtml);
  const parent = (await db.tasks.where("cardId").equals(card.id).first())!;
  const { task: child } = await createTaskChild(parent.id, "Keep child");
  const { task: grandchild } = await createTaskChild(child.id, "Keep grandchild");
  const dueAt = new Date(2026, 8, 22, 12).getTime();
  await db.tasks.update(child.id, { dueAt, done: true });
  await db.cards.update(card.id, { contentHtml: "<p>Remaining note</p>" });
  await syncCardTasksFromHtml(card.id, "<p>Remaining note</p>");
  expect(await db.tasks.get(parent.id)).toBeUndefined();
  expect(await db.tasks.get(child.id)).toMatchObject({ title: "Keep child", done: true, dueAt, cardId: card.id });
  expect((await db.tasks.get(child.id))?.parentTaskId).toBeUndefined();
  expect((await db.tasks.get(grandchild.id))?.parentTaskId).toBe(child.id);
  expect((await getHiddenTaskIds()).has(child.id)).toBe(false);
});

it("一次移除多層核取方塊時，子待辦接回最近仍存在的上層並重算完成狀態", async () => {
  const contentHtml = checklist("first", "First") + checklist("second", "Second");
  const card = await createCard({ title: "Checklist", contentHtml });
  await syncCardTasksFromHtml(card.id, contentHtml);
  const linked = await db.tasks.where("cardId").equals(card.id).toArray();
  const first = linked.find((task) => task.sourceTaskId === "first")!;
  const second = linked.find((task) => task.sourceTaskId === "second")!;
  await db.tasks.add({ id: "surviving-root", title: "Surviving", done: true, createdAt: 1, updatedAt: 1 });
  await db.tasks.update(first.id, { parentTaskId: "surviving-root" });
  await db.tasks.update(second.id, { parentTaskId: first.id });
  const { task: child } = await createTaskChild(second.id, "Keep child");
  await db.tasks.update("surviving-root", { done: true });
  await db.cards.update(card.id, { contentHtml: "<p></p>" });
  await syncCardTasksFromHtml(card.id, "<p></p>");
  expect(await db.tasks.get(child.id)).toMatchObject({ parentTaskId: "surviving-root", cardId: card.id, done: false });
  expect((await db.tasks.get("surviving-root"))?.done).toBe(false);
  expect((await getHiddenTaskIds()).has(child.id)).toBe(false);
  // The source-note relationship remains intact: archiving it intentionally hides its derived tasks.
  await db.cards.update(card.id, { state: "archived" });
  expect((await getHiddenTaskIds()).has(child.id)).toBe(true);
});

it("重新同步未改變的核取方塊不會重寫待辦資料", async () => {
  const card = await createCard({ title: "Checklist", contentHtml: checklist("root", "Unchanged") });
  await syncCardTasksFromHtml(card.id, card.contentHtml);
  const put = vi.spyOn(db.tasks, "put");
  await syncCardTasksFromHtml(card.id, card.contentHtml);
  expect(put).not.toHaveBeenCalled();
});

it("完成清單先排除未完成、子項及封存來源，再按最新時間限量讀取；顯示更多不漏項", async () => {
  const card = await createCard({ title: "Archived", state: "archived" });
  const roots = Array.from({ length: 300 }, (_, index) => ({ id: `root-${index}`, title: `Done ${index}`, done: true, createdAt: index + 1, updatedAt: index + 1 }));
  await db.tasks.bulkAdd([
    ...roots,
    ...Array.from({ length: 250 }, (_, index) => ({ id: `active-${index}`, title: "Active", done: false, createdAt: 1000 + index, updatedAt: 1000 + index })),
    { id: "child", title: "Done child", parentTaskId: "root-299", done: true, createdAt: 2000, updatedAt: 2000 },
    { id: "hidden", title: "Hidden", cardId: card.id, done: true, createdAt: 3000, updatedAt: 3000 },
  ]);
  const hidden = await getHiddenTaskIds();
  const first = await readCompletedRootTasks(hidden, 240);
  const expanded = await readCompletedRootTasks(hidden, 480);
  const expected = [...roots].reverse().map((task) => task.id);
  expect(first.map((task) => task.id)).toEqual(expected.slice(0, 240));
  expect(expanded.map((task) => task.id)).toEqual(expected);
  expect(new Set(expanded.map((task) => task.id)).size).toBe(300);
});
