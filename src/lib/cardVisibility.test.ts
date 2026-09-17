import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCard, createTag, db, getOrCreateJournal } from "../db";
import { isActiveCard, matchesCardCollection, hiddenTaskIds } from "./cardVisibility";
import { getHiddenTaskIds } from "./visibleContent";
import { buildBrainGraph } from "./brain";
import { createBackupObject } from "./backup";
import { contextForCard, searchSpace } from "./ai";
import { handleMcpWorkspaceRequest } from "./mcpWorkspace";
import { initializeGlobalHistory, runWithoutGlobalHistory } from "./globalHistory";
import { useAppStore } from "../store";
import type { CardRecord } from "../types";

beforeAll(async () => { await db.open(); await initializeGlobalHistory(); });
beforeEach(async () => { await runWithoutGlobalHistory(() => db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); })); });

describe("Archive is an exclusive, non-destructive collection", () => {
  it.each(["active", "inbox", "archived", "trash"] as const)("classifies %s in exactly one collection", (state) => {
    expect(["library", "archive", "trash"].filter((collection) => matchesCardCollection({ state }, collection as "library" | "archive" | "trash"))).toHaveLength(1);
    expect(isActiveCard({ state })).toBe(state === "active" || state === "inbox");
  });
  it("handles hidden descendants and cycles without hiding standalone tasks", () => {
    expect([...hiddenTaskIds([{ id: "a", cardId: "hidden", parentTaskId: "b" }, { id: "b", parentTaskId: "a" }, { id: "c", parentTaskId: "b" }, { id: "independent" }], new Set(["hidden"]))].sort()).toEqual(["a", "b", "c"]);
  });
  it("archive and restore preserve tags, custom properties, placements, tasks, highlights and backup records", async () => {
    const tag = await createTag("保留標籤");
    const card = await createCard({ title: "ArchiveSourceUnique", contentHtml: "<p>完整封存內容</p>", tagIds: [tag.id], properties: { 階段: "自訂階段", 自訂欄位: "keep" } });
    const stamp = Date.now();
    await db.kanbanPlacements.put({ id: "p", cardId: card.id, boardId: "b", listId: "l", order: 7, createdAt: stamp, updatedAt: stamp });
    await db.boardNodes.put({ id: "n", cardId: card.id, boardId: "w", kind: "card", x: 317, y: 219 });
    await db.tasks.bulkPut([{ id: "linked", cardId: card.id, title: "ArchiveTaskUnique", done: false, createdAt: stamp, updatedAt: stamp }, { id: "child", parentTaskId: "linked", title: "child", done: false, createdAt: stamp, updatedAt: stamp }, { id: "independent", title: "independent", done: false, createdAt: stamp, updatedAt: stamp }]);
    await db.highlights.put({ id: "h", cardId: card.id, text: "preserved highlight", note: "", color: "amber", createdAt: stamp });
    await db.cards.update(card.id, { state: "archived", updatedAt: stamp + 1 });
    expect([...await getHiddenTaskIds()].sort()).toEqual(["child", "linked"]);
    expect(await searchSpace("ArchiveSourceUnique")).toEqual([]);
    expect(await contextForCard(card.id)).toBe("");
    const archived = await db.cards.get(card.id);
    expect(archived?.properties).toEqual(card.properties);
    const graph = buildBrainGraph({ cards: [archived!], boards: [], tasks: await db.tasks.toArray(), fragments: [], tags: [tag], storedEdges: [], boardNodes: [] });
    expect(graph.nodes.map((node) => node.key)).toEqual(["task:independent"]);
    const backup = await createBackupObject();
    expect((backup.data.cards as CardRecord[]).find((item) => item.id === card.id)?.state).toBe("archived");
    await expect(handleMcpWorkspaceRequest({ requestId: "archive", tool: "chengjing_get_item", arguments: { type: "note", id: card.id } })).rejects.toThrow("mcp-item-not-found");
    const found = await handleMcpWorkspaceRequest({ requestId: "search", tool: "chengjing_search", arguments: { query: "Archive", types: ["note", "task"] } }) as { results: unknown[] };
    expect(found.results).toEqual([]);
    await db.cards.update(card.id, { state: "active" });
    expect((await getHiddenTaskIds()).size).toBe(0);
    expect((await db.kanbanPlacements.get("p"))?.order).toBe(7);
    expect((await db.boardNodes.get("n"))?.x).toBe(317);
    expect(await db.highlights.get("h")).toBeDefined();
    expect((await db.cards.get(card.id))?.tagIds).toEqual([tag.id]);
  });
  it("calendar does not reopen archived journal content", async () => {
    const journal = await createCard({ title: "私密日誌", kind: "journal", state: "archived", journalDate: "2026-01-17", journalTouched: true, contentHtml: "<p>封存後不可從日誌重開</p>" });
    const replacement = await getOrCreateJournal("2026-01-17");
    expect(replacement.id).not.toBe(journal.id);
    expect(isActiveCard(replacement)).toBe(true);
    expect((await db.cards.get(journal.id))?.state).toBe("archived");
    expect(replacement.plainText).not.toContain("封存後");
  });
  it("legacy database navigation resolves to the library; explicit archive editor access is transient", () => {
    useAppStore.getState().setView("database");
    expect(useAppStore.getState().view).toBe("library");
    useAppStore.getState().openCard("card", "archive");
    expect(useAppStore.getState().cardOpenCollection).toBe("archive");
    useAppStore.getState().openCard("another");
    expect(useAppStore.getState().cardOpenCollection).toBe("library");
  });
});
