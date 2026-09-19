import "fake-indexeddb/auto";
import Dexie from "dexie";
import { expect, it } from "vitest";
import { readBrainWorkspace } from "./brainWorkspace";
it("bounds working cards, finds old text, and protects descendants of archived parents", async () => {
  const database = new Dexie("brain-window-test");
  database.version(1).stores({ cards: "id,updatedAt", tasks: "id,updatedAt", boards: "id,updatedAt", boardNodes: "id,boardId", tags: "id", brainEdges: "id,[sourceType+sourceId],[targetType+targetId]" });
  await database.open();
  try {
    const cards = Array.from({ length: 1050 }, (_, i) => ({ id: `c${i}`, updatedAt: i, createdAt: i, title: `筆記${i}`, plainText: i === 0 ? "古老但重要的獨特全文" : "普通工作內容", kind: "note", state: "active", tagIds: [], contentHtml: "" }));
    await database.table("cards").bulkPut(cards);
    await database.table("cards").put({ ...cards[0], id: "archived", state: "archived" });
    await database.table("tasks").bulkPut([{ id: "parent", cardId: "archived", title: "隱藏父項", updatedAt: 0, createdAt: 0 }, { id: "child", parentTaskId: "parent", title: "不可洩漏的子項", updatedAt: 9000, createdAt: 9000 }]);
    const first = await readBrainWorkspace({ database: database.name, query: "", page: 0, language: "zh-TW" });
    expect(first.graph.nodes.filter((node) => node.type === "card")).toHaveLength(1000);
    expect(first.hasMore).toBe(true); expect(first.graph.nodes.some((node) => node.key === "task:child")).toBe(false);
    const old = await readBrainWorkspace({ database: database.name, query: "獨特全文", page: 0, language: "zh-TW" });
    expect(old.graph.nodes.map((node) => node.key)).toEqual(["card:c0"]);
  } finally { await database.delete(); }
});
