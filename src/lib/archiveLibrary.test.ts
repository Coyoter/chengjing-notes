import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, createCard, getOrCreateJournal, pruneUntouchedJournalDrafts } from "../db";
import { useAppStore } from "../store";
import type { CardRecord, CardState, TaskRecord } from "../types";
import { isActiveCard, isCardInCollection, isVisibleCard, hiddenTaskIds } from "./cardVisibility";
import { getHiddenTaskIds } from "./activeContent";
import { matchesLibraryCard, matchesLibraryTask, type LibraryFilters } from "./libraryFilters";
import { buildBrainGraph } from "./brain";
import { buildAIActionContext } from "./aiActions";
import { handleMcpWorkspaceRequest } from "./mcpWorkspace";
import { liveQuery } from "dexie";

const card = (state: CardState = "active", extra: Partial<CardRecord> = {}): CardRecord => ({ id: "note", title: "ArchiveProbe", plainText: "Private details", contentHtml: "<p>Private details</p>", kind: "note", state, tagIds: ["tag"], favorite: true, color: "slate", attachmentIds: [], properties: { 階段: "自訂階段", budget: 42 }, createdAt: 1, updatedAt: 1, collectionId: "topic", ...extra });
const task = (id: string, extra: Partial<TaskRecord> = {}): TaskRecord => ({ id, title: `ArchiveProbe ${id}`, done: false, createdAt: 1, updatedAt: 1, ...extra });
const filters: LibraryFilters = { collection: "library", group: "all", topicIds: null, tagId: null, kind: "all", query: "", language: "zh-TW" };

beforeAll(() => db.open());
beforeEach(async () => { await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); }); useAppStore.setState({ inactiveCardAccessId: null }); });

describe("Archive visibility and unified library", () => {
  it.each(["active", "inbox", "archived", "trash"] as CardState[])("places %s in exactly its intended collection", (state) => {
    const value = card(state);
    expect(isVisibleCard(value)).toBe(state === "active" || state === "inbox");
    expect(["library", "archive", "trash"].filter((collection) => isCardInCollection(value, collection as typeof filters.collection))).toEqual([state === "archived" ? "archive" : state === "trash" ? "trash" : "library"]);
  });
  it("keeps explicitly archived blank journals discoverable and safe from maintenance", async () => {
    const journal = await getOrCreateJournal("2026-09-17");
    expect(isVisibleCard(journal)).toBe(false);
    await db.cards.update(journal.id, { state: "archived" });
    expect(isCardInCollection((await db.cards.get(journal.id))!, "archive")).toBe(true);
    await pruneUntouchedJournalDrafts();
    expect((await db.cards.get(journal.id))?.state).toBe("archived");
    const next = await getOrCreateJournal("2026-09-17");
    expect(next.id).not.toBe(journal.id);
    expect(next.state).toBe("active");
    expect((await db.cards.get(journal.id))?.state).toBe("archived");
  });
  it("combines tags, area/topic, type, pinned scope, text and collection without changing data", () => {
    const value = card();
    expect(matchesLibraryCard(value, { ...filters, tagId: "tag", group: "area", topicIds: new Set(["topic"]), query: "archive", kind: "note" })).toBe(true);
    expect(matchesLibraryCard(value, { ...filters, tagId: "missing" })).toBe(false);
    expect(matchesLibraryCard(value, { ...filters, group: "pinned" })).toBe(true);
    expect(matchesLibraryCard(value, { ...filters, group: "unassigned" })).toBe(false);
    expect(matchesLibraryCard({ ...value, state: "archived" }, filters)).toBe(false);
    expect(matchesLibraryCard({ ...value, state: "archived" }, { ...filters, collection: "archive", tagId: "tag" })).toBe(true);
    expect(value.properties).toEqual({ 階段: "自訂階段", budget: 42 });
  });
  it("filters task source tags but leaves unlinked tasks available", () => {
    expect(matchesLibraryTask(task("a"), card(), { ...filters, tagId: "tag" })).toBe(true);
    expect(matchesLibraryTask(task("a"), card("archived"), filters)).toBe(false);
    expect(matchesLibraryTask(task("a"), undefined, filters)).toBe(true);
    expect(matchesLibraryTask(task("a"), undefined, { ...filters, tagId: "tag" })).toBe(false);
    expect(matchesLibraryTask(task("a"), card(), { ...filters, collection: "archive" })).toBe(false);
  });
  it("hides linked tasks and all descendants, including cycles, without deleting them", async () => {
    const tasks = [task("parent", { cardId: "note", parentTaskId: "grandchild" }), task("child", { parentTaskId: "parent" }), task("grandchild", { parentTaskId: "child" }), task("independent")];
    expect([...hiddenTaskIds(tasks, new Set(["note"]))].sort()).toEqual(["child", "grandchild", "parent"]);
    await db.cards.add(card("archived")); await db.tasks.bulkAdd(tasks);
    expect([...(await getHiddenTaskIds())].sort()).toEqual(["child", "grandchild", "parent"]);
    await db.cards.update("note", { state: "active" });
    expect((await getHiddenTaskIds()).size).toBe(0);
    expect(await db.tasks.count()).toBe(4);
  });
  it("reacts to card-state changes even when task rows never change", async () => {
    await db.cards.add(card()); await db.tasks.add(task("parent", { cardId: "note" }));
    const seen: number[] = [];
    const subscription = liveQuery(async () => { const hidden = await getHiddenTaskIds(); return db.tasks.filter((row) => !hidden.has(row.id)).count(); }).subscribe((count) => seen.push(count));
    try {
      await expect.poll(() => seen.at(-1)).toBe(1);
      await db.cards.update("note", { state: "archived" });
      await expect.poll(() => seen.at(-1)).toBe(0);
      await db.cards.update("note", { state: "active" });
      await expect.poll(() => seen.at(-1)).toBe(1);
    } finally { subscription.unsubscribe(); }
  });
  it("preserves board/kanban placement, edges, tasks, tags and highlights through archive/restore", async () => {
    await db.cards.add(card());
    await db.boards.add({ id: "board", title: "Board", description: "", favorite: false, tagIds: [], createdAt: 1, updatedAt: 1 });
    await db.boardNodes.bulkAdd([{ id: "node", boardId: "board", cardId: "note", kind: "card", x: 82, y: 31 }, { id: "text", boardId: "board", kind: "text", text: "Other", x: 90, y: 20 }]);
    await db.boardEdges.add({ id: "edge", boardId: "board", source: "node", target: "text", label: "Relationship" });
    await db.kanbanBoards.add({ id: "kanban", title: "Kanban", description: "", favorite: false, createdAt: 1, updatedAt: 1 });
    await db.kanbanLists.add({ id: "list", boardId: "kanban", title: "Todo", order: 0, createdAt: 1, updatedAt: 1 });
    await db.kanbanPlacements.add({ id: "placement", boardId: "kanban", listId: "list", cardId: "note", order: 4, createdAt: 1, updatedAt: 1 });
    await db.tasks.add(task("parent", { cardId: "note" }));
    await db.highlights.add({ id: "highlight", cardId: "note", text: "ArchiveProbe", note: "", color: "amber", createdAt: 1 });
    const before = await Promise.all([db.boardNodes.toArray(), db.boardEdges.toArray(), db.kanbanPlacements.toArray(), db.tasks.toArray(), db.highlights.toArray()]);
    const read = (type: string, id: string) => handleMcpWorkspaceRequest({ requestId: crypto.randomUUID(), tool: "chengjing_get_item", arguments: { type, id } }) as Promise<any>;
    await db.cards.update("note", { state: "archived" });
    expect((await read("kanban", "kanban")).placements).toHaveLength(0);
    const board = await read("whiteboard", "board"); expect(board.nodes.map((node: { id: string }) => node.id)).toEqual(["text"]); expect(board.edges).toHaveLength(0);
    await expect(read("note", "note")).rejects.toThrow("mcp-item-not-found");
    await expect(read("task", "parent")).rejects.toThrow("mcp-item-not-found");
    const search = await handleMcpWorkspaceRequest({ requestId: "search", tool: "chengjing_search", arguments: { query: "ArchiveProbe", types: ["note", "task"] } }) as { results: unknown[] };
    expect(search.results).toEqual([]);
    expect(await buildAIActionContext("space")).not.toContain("ArchiveProbe");
    expect(await buildAIActionContext("board", null, "board")).not.toContain("Private details");
    const graph = buildBrainGraph({ cards: await db.cards.toArray(), tasks: await db.tasks.toArray(), boards: await db.boards.toArray(), boardNodes: await db.boardNodes.toArray(), fragments: [], tags: [], storedEdges: [] });
    expect(graph.nodes.some((node) => node.key === "card:note" || node.key === "task:parent")).toBe(false);
    await db.cards.update("note", { state: "active" });
    expect((await read("kanban", "kanban")).placements[0]).toMatchObject({ id: "placement", listId: "list", order: 4 });
    expect((await read("whiteboard", "board")).edges).toHaveLength(1);
    expect(await Promise.all([db.boardNodes.toArray(), db.boardEdges.toArray(), db.kanbanPlacements.toArray(), db.tasks.toArray(), db.highlights.toArray()])).toEqual(before);
    expect((await db.cards.get("note"))?.tagIds).toEqual(["tag"]);
  });
  it("redirects legacy database navigation without losing card properties", async () => {
    useAppStore.getState().setView("database"); expect(useAppStore.getState().view).toBe("library");
    const original = await createCard({ title: "Legacy", properties: { 階段: "自訂階段", amount: 100 }, tagIds: ["tag"] });
    useAppStore.getState().openCard(original.id); expect(useAppStore.getState().inactiveCardAccessId).toBe(null);
    useAppStore.getState().openCard(original.id, { allowInactive: true }); expect(useAppStore.getState().inactiveCardAccessId).toBe(original.id);
    useAppStore.getState().setView("today"); expect(useAppStore.getState().inactiveCardAccessId).toBe(null);
    expect((await db.cards.get(original.id))?.properties).toEqual(original.properties);
  });
});
