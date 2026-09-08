import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { initializeGlobalHistory } from "./globalHistory";
import { handleMcpWorkspaceRequest, type McpWorkspaceTool } from "./mcpWorkspace";

function request(tool: McpWorkspaceTool, arguments_: Record<string, unknown> = {}): Promise<unknown> {
  return handleMcpWorkspaceRequest({ requestId: crypto.randomUUID(), tool, arguments: arguments_ }) as Promise<unknown>;
}

describe("澄境 MCP 工作區", () => {
  beforeAll(async () => { await db.open(); await initializeGlobalHistory(); });
  beforeEach(async () => { await db.transaction("rw", db.tables, async () => Promise.all(db.tables.map((table) => table.clear()))); });

  it("分頁讀到全部資料，批次不會在第 40 筆被截斷", async () => {
    const actions = Array.from({ length: 121 }, (_, i) => ({ type: "create_card", description: `新增 ${i}`, title: `Batch ${i}`, content: "content" }));
    const created = await request("chengjing_apply_actions", { plan: { summary: "新增", actions } }) as { applied: number };
    expect(created.applied).toBe(121);
    const ids: string[] = [];
    let after: string | null = null;
    do {
      const page = await request("chengjing_list_records", { table: "cards", after, limit: 50 }) as { records: { id: string }[]; nextCursor: string | null };
      ids.push(...page.records.map(row => row.id));
      after = page.nextCursor;
    } while (after);
    expect(new Set(ids).size).toBe(121);
    await request("chengjing_apply_actions", { plan: { summary: "刪除", actions: ids.map(id => ({ type: "delete_card", targetId: id, description: "移至垃圾桶" })) } });
    expect(await db.cards.filter(card => card.state === "trash").count()).toBe(121);
    await expect(request("chengjing_list_records", { table: "settings" })).rejects.toThrow("mcp-table-not-allowed");
  });

  it("混入不支援的動作時整批拒絕，不假裝已完成", async () => {
    await expect(request("chengjing_apply_actions", { plan: { summary: "invalid", actions: [
      { type: "create_card", title: "Must not appear" }, { type: "run_shell" },
    ] } })).rejects.toThrow("mcp-unsupported-action");
    expect(await db.cards.count()).toBe(0);
  });

  it("可設定筆記標籤與表格屬性，拒絕未知關聯和系統欄位", async () => {
    const card = await request("chengjing_create_note", { title: "Fields" }) as { id: string };
    const tag = await request("chengjing_manage_metadata", { table: "tags", operation: "create", name: "Research" }) as { id: string };
    await request("chengjing_update_fields", { table: "cards", id: card.id, fields: { tagIds: [tag.id], properties: { progress: 80 }, content: "Updated" } });
    expect(await db.cards.get(card.id)).toMatchObject({ tagIds: [tag.id], properties: { progress: 80 }, plainText: "Updated" });
    await expect(request("chengjing_update_fields", { table: "cards", id: card.id, fields: { tagIds: ["missing"] } })).rejects.toThrow("mcp-tag-not-found");
    await expect(request("chengjing_update_fields", { table: "cards", id: card.id, fields: { id: "replacement" } })).rejects.toThrow("mcp-field-not-writable");
  });

  it("長文字可逐段讀回，不把第一段當作全部內容", async () => {
    const content = "ABCDEFGHIJ".repeat(2500);
    const card = await request("chengjing_create_note", { title: "Long", content }) as { id: string };
    let offset: number | null = 0;
    let received = "";
    do {
      const page = await request("chengjing_list_records", { table: "cards", id: card.id, contentOffset: offset, contentLength: 4000 }) as { records: Array<{ plainText: string }>; contentRanges: Array<{ fields: { plainText: { nextOffset: number | null } } }> };
      received += page.records[0].plainText;
      offset = page.contentRanges[0].fields.plainText.nextOffset;
    } while (offset !== null);
    expect(received).toBe(content);
  });

  it("可建立、搜尋、防衝突修改筆記，並操作白板、看板與神經元", async () => {
    const note = await request("chengjing_create_note", { title: "MCP 研究", content: "整理本機整合的重點" }) as { id: string; updatedAt: number };
    const search = await request("chengjing_search", { query: "本機整合", types: ["note"] }) as { results: Array<{ id: string }> };
    expect(search.results[0].id).toBe(note.id);
    await expect(request("chengjing_update_note", { id: note.id, expectedUpdatedAt: 1, content: "不應寫入", contentMode: "replace" })).rejects.toThrow("mcp-conflict");
    const updated = await request("chengjing_update_note", { id: note.id, expectedUpdatedAt: note.updatedAt, content: "補上安全邊界", contentMode: "append" }) as { content: string; updatedAt: number };
    expect(updated.content).toContain("補上安全邊界");
    expect(updated.updatedAt).toBeGreaterThan(note.updatedAt);

    const whiteboard = await request("chengjing_create_whiteboard", { title: "整合架構" }) as { id: string; updatedAt: number };
    const boardItem = await request("chengjing_add_whiteboard_item", { boardId: whiteboard.id, expectedUpdatedAt: whiteboard.updatedAt, kind: "existing_note", noteId: note.id, x: 100, y: 140 }) as { id: string };
    const board = await request("chengjing_get_item", { type: "whiteboard", id: whiteboard.id }) as { nodes: Array<{ id: string; noteId?: string; note?: { id: string } }>; updatedAt: number };
    expect(board.nodes.find((item) => item.id === boardItem.id)?.note?.id).toBe(note.id);

    const kanban = await request("chengjing_create_kanban", { title: "上線流程", lists: ["待處理", "完成"] }) as { id: string; updatedAt: number; lists: Array<{ id: string }> };
    await request("chengjing_update_kanban", { boardId: kanban.id, expectedUpdatedAt: kanban.updatedAt, operation: "place_note", listId: kanban.lists[0].id, noteId: note.id });
    const kanbanRead = await request("chengjing_get_item", { type: "kanban", id: kanban.id }) as { placements: Array<{ note: { id: string } }> };
    expect(kanbanRead.placements[0].note.id).toBe(note.id);

    const fragment = await request("chengjing_create_neuron", { type: "fragment", content: "MCP 應保持本機連線" }) as { id: string };
    const relation = await request("chengjing_connect_neurons", { sourceType: "card", sourceId: note.id, targetType: "fragment", targetId: fragment.id, relationType: "reinforcement", reason: "共同強調本機安全" }) as { created: boolean };
    expect(relation.created).toBe(true);
    const neuron = await request("chengjing_get_item", { type: "neuron", neuronType: "card", id: note.id }) as { relations: unknown[] };
    expect(neuron.relations).toHaveLength(1);
  });
});
