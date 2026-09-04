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
