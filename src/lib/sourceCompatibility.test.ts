import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCard, createFragment, db } from "../db";
import { handleMcpWorkspaceRequest, type McpWorkspaceTool } from "./mcpWorkspace";
import { initializeGlobalHistory, clearGlobalHistory } from "./globalHistory";
import { DEFAULT_SIDEBAR_ORDER, normalizeSidebarOrder } from "./sidebarOrder";

const request = (tool: McpWorkspaceTool, args: Record<string, unknown>) => handleMcpWorkspaceRequest({ requestId: crypto.randomUUID(), tool, arguments: args });
beforeAll(async () => { await db.open(); await initializeGlobalHistory(); });
beforeEach(async () => {
  localStorage.removeItem("chengjing-sync-enabled");
  await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
  clearGlobalHistory();
});

describe("complete-release history remains compatible with unified captures", () => {
  it("maps a saved Database sidebar entry to Library without duplicating it", () => {
    const order = normalizeSidebarOrder(["database", "tasks", "library", "database"]);
    expect(order.slice(0, 2)).toEqual(["library", "tasks"]);
    expect(order).not.toContain("database");
    expect(order.filter(id => id === "library")).toHaveLength(1);
    expect(order).toHaveLength(DEFAULT_SIDEBAR_ORDER.length);
  });

  it("pages legacy fragment reads over canonical cards and excludes regular notes", async () => {
    const first = await createFragment("First capture");
    const second = await createFragment("Second capture");
    await createCard({ title: "Not a fragment", plainText: "Regular" });
    const ids: string[] = [];
    let after: string | null = null;
    do {
      const page = await request("chengjing_list_records", { table: "fragments", limit: 1, after }) as { records: { id: string; text: string }[]; nextCursor: string | null };
      ids.push(...page.records.map(row => row.id));
      expect(page.records.every(row => row.text.includes("capture"))).toBe(true);
      after = page.nextCursor;
    } while (after);
    expect(ids.sort()).toEqual([first.id, second.id].sort());
    expect(await db.fragments.count()).toBe(0);
  });

  it("metadata and field updates edit the original capture card and keep its tags", async () => {
    const item = await createFragment("Before");
    await db.tags.add({ id: "AI", name: "AI", color: "sky", createdAt: 1 });
    await request("chengjing_manage_metadata", { table: "fragments", operation: "update", id: item.id, content: "Metadata edit", pinned: true });
    expect(await db.cards.get(item.id)).toMatchObject({ plainText: "Metadata edit", favorite: true });
    await request("chengjing_update_fields", { table: "fragments", id: item.id, fields: { text: "Field edit", tagIds: ["AI"], pinned: false } });
    expect(await db.cards.get(item.id)).toMatchObject({ plainText: "Field edit", favorite: false, tagIds: ["AI"] });
    expect(await db.cards.count()).toBe(1);
    expect(await db.fragments.count()).toBe(0);
  });

  it("fragment batch deletion respects explicit scope and does not delete regular cards", async () => {
    const item = await createFragment("Remove capture");
    const regular = await createCard({ title: "Keep regular note" });
    await request("chengjing_delete_items", { table: "fragments", ids: [item.id] });
    expect((await db.cards.get(item.id))?.state).toBe("trash");
    expect((await db.cards.get(regular.id))?.state).not.toBe("trash");
    await request("chengjing_delete_items", { table: "fragments", all: true, permanent: true });
    expect(await db.cards.get(item.id)).toBeUndefined();
    expect(await db.cards.get(regular.id)).toBeDefined();
  });
});
