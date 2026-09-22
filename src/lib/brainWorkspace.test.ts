import "fake-indexeddb/auto";
import Dexie from "dexie";
import { expect, it } from "vitest";
import { BRAIN_WINDOW, readBrainWorkspace } from "./brainWorkspace";
import { COMPLETED_TASK_FADE_MS } from "./taskCompletion";
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

it("does not let fully faded tasks consume the current task page", async () => {
  const database = new Dexie("brain-task-window-test");
  database.version(1).stores({ cards: "id,updatedAt", tasks: "id,updatedAt", boards: "id,updatedAt", boardNodes: "id,boardId", tags: "id", brainEdges: "id,[sourceType+sourceId],[targetType+targetId]" });
  await database.open();
  try {
    const now = Date.now();
    await database.table("tasks").bulkPut([
      ...Array.from({ length: BRAIN_WINDOW.tasks + 1 }, (_, i) => ({ id: `done${i}`, title: "已完成的舊待辦", createdAt: 1, updatedAt: now, done: true, completedAt: now - COMPLETED_TASK_FADE_MS - 1 })),
      { id: "active", title: "還要處理的待辦", createdAt: 1, updatedAt: now - 100, done: false },
      { id: "fading", title: "剛完成的待辦", createdAt: 1, updatedAt: now - 100, done: true, completedAt: now - 100 },
    ]);
    const result = await readBrainWorkspace({ database: database.name, query: "", page: 0, language: "zh-TW" });
    expect(result.graph.nodes.map((node) => node.key).sort()).toEqual(["task:active", "task:fading"]);
    expect(result.hasMore).toBe(false);
  } finally { await database.delete(); }
});

it("preserves visible links when off-page relationships exceed the edge budget", async () => {
  const defaultBudget = BRAIN_WINDOW.edges;
  BRAIN_WINDOW.edges = 8;
  const database = new Dexie("brain-edge-window-test");
  database.version(1).stores({ cards: "id,updatedAt", tasks: "id,updatedAt", boards: "id,updatedAt", boardNodes: "id,boardId", tags: "id", brainEdges: "id,[sourceType+sourceId],[targetType+targetId]" });
  await database.open();
  try {
    await database.table("cards").bulkPut(["a", "b"].map((id) => ({ id, updatedAt: 1, createdAt: 1, title: id, plainText: "工作筆記", kind: "note", state: "active", tagIds: [], contentHtml: "" })));
    await database.table("brainEdges").bulkPut([
      ...Array.from({ length: BRAIN_WINDOW.edges + 1 }, (_, i) => [
        { id: `out${i}`, sourceType: "card", sourceId: "a", targetType: "card", targetId: `older${i}`, origin: "ai", createdAt: 1 },
        { id: `in${i}`, sourceType: "card", sourceId: `older${i}`, targetType: "card", targetId: "b", origin: "ai", createdAt: 1 },
      ]).flat(),
      { id: "z-visible", sourceType: "card", sourceId: "a", targetType: "card", targetId: "b", origin: "manual", createdAt: 1 },
    ]);
    const result = await readBrainWorkspace({ database: database.name, query: "", page: 0, language: "zh-TW" });
    expect(result.graph.edges.map((edge) => edge.id)).toEqual(["z-visible"]);
  } finally { BRAIN_WINDOW.edges = defaultBudget; await database.delete(); }
});
