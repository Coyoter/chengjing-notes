import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, seedDatabase } from "../db";
import { applyAIActionPlan, parseAIActionPlan } from "./aiActions";
import * as taskSync from "./taskSync";
import { initializeGlobalHistory, clearGlobalHistory, undoGlobalAction } from "./globalHistory";

describe("AI batches commit together", () => {
  beforeAll(async () => { await db.open(); await initializeGlobalHistory(); });
  beforeEach(async () => { vi.restoreAllMocks(); localStorage.removeItem("chengjing-sync-enabled"); await db.transaction("rw", db.tables, () => Promise.all(db.tables.map(table => table.clear()))); clearGlobalHistory(); });

  it("workspace deletion reaches beyond the initial catalog, preserves recovery/settings, and can undo", async () => {
    await applyAIActionPlan(parseAIActionPlan(JSON.stringify({ summary: "create", actions: Array.from({ length: 125 }, (_, i) => ({ type: "create_card", title: `Note ${i}`, description: "create", content: "test" })) })), {});
    await db.preferences.put({ key: "keep-setting", value: "unchanged" });
    await db.chatThreads.add({ id: "thread", title: "Keep conversation", contextType: "space", createdAt: 1, updatedAt: 1 });
    clearGlobalHistory();
    localStorage.setItem("chengjing-sync-enabled", "true");
    await applyAIActionPlan({ summary: "Clear", actions: [{ type: "workspace_tool", tool: "chengjing_delete_items", arguments: { table: "workspace", all: true, permanent: true }, description: "Clear private content" }] }, {});
    expect(await db.cards.count()).toBe(0);
    expect((await db.preferences.get("keep-setting"))?.value).toBe("unchanged");
    expect(await db.chatThreads.count()).toBe(1);
    const deletions = await db.table("syncOutbox").filter(row => row.table === "cards" && row.value === null).count();
    expect(deletions).toBe(125);
    await seedDatabase();
    expect(await db.cards.count()).toBe(0);
    await undoGlobalAction();
    expect(await db.cards.count()).toBe(125);
    localStorage.removeItem("chengjing-sync-enabled");
  });

  it("shared tool actions create a kanban and reference its generated IDs", async () => {
    await applyAIActionPlan({ summary: "Kanban", actions: [
      { type: "workspace_tool", tool: "chengjing_create_kanban", tempId: "board", arguments: { title: "Board", lists: ["To do"] }, description: "create" },
      { type: "workspace_tool", tool: "chengjing_update_kanban", arguments: { boardId: "$board.id", expectedUpdatedAt: "$board.updatedAt", operation: "add_list", title: "Done" }, description: "add list" },
    ] }, {});
    expect(await db.kanbanBoards.count()).toBe(1);
    expect(await db.kanbanLists.count()).toBe(2);
  });

  it("a failure after a workspace tool rolls back both operations", async () => {
    await expect(applyAIActionPlan({ summary: "rollback", actions: [
      { type: "workspace_tool", tool: "chengjing_create_kanban", arguments: { title: "Must roll back" }, description: "create" },
      { type: "workspace_tool", tool: "chengjing_delete_items", arguments: { table: "workspace" }, description: "missing explicit selection" },
    ] }, {})).rejects.toThrow("mcp-explicit-all-required");
    expect(await db.kanbanBoards.count()).toBe(0);
  });

  it("does not silently discard actions beyond 40", async () => {
    const plan = parseAIActionPlan(JSON.stringify({ summary: "批次建立", actions: Array.from({ length: 120 }, (_, i) => ({ type: "create_task", title: `Task ${i}`, description: `新增 ${i}` })) }));
    expect(plan.actions).toHaveLength(120);
    expect((await applyAIActionPlan(plan, {})).applied).toBe(120);
    expect(await db.tasks.count()).toBe(120);
  });

  it("rolls back an earlier note when a linked task update fails", async () => {
    await db.tasks.add({ id: "existing", title: "Existing", done: false, createdAt: 1, updatedAt: 1 });
    vi.spyOn(taskSync, "updateTaskEverywhere").mockRejectedValueOnce(new Error("simulated-storage-failure"));
    await expect(applyAIActionPlan({ summary: "batch", actions: [
      { type: "create_card", title: "Must roll back", content: "text", description: "create" },
      { type: "update_task", targetId: "existing", done: true, description: "finish" },
    ] }, {})).rejects.toThrow("simulated-storage-failure");
    expect(await db.cards.count()).toBe(0);
    expect((await db.tasks.get("existing"))?.done).toBe(false);
  });

  it("deleting fragments removes their graph links", async () => {
    await db.fragments.add({ id: "fragment", text: "test", tagIds: [], pinned: false, createdAt: 1, updatedAt: 1 });
    await db.brainEdges.add({ id: "edge", sourceType: "fragment", sourceId: "fragment", targetType: "card", targetId: "other", origin: "manual", relationType: "sequence", createdAt: 1 });
    await applyAIActionPlan({ summary: "delete", actions: [{ type: "delete_fragment", targetId: "fragment", description: "delete" }] }, {});
    expect(await db.brainEdges.count()).toBe(0);
    expect(await db.fragments.count()).toBe(0);
  });
});
