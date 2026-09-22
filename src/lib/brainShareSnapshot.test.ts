import "fake-indexeddb/auto";
import Dexie from "dexie";
import { expect, it } from "vitest";
import type { BrainNodeView } from "./brain";
import { readBrainShareSnapshot } from "./brainShareSnapshot";
import { createBrainShareRecord } from "./sharedBrain";

it("previews and sends full source text while preserving the preview version across later edits", async () => {
  const database = new Dexie("brain-share-snapshot-test");
  database.version(1).stores({ cards: "id,legacyFragmentId", tasks: "id", boards: "id", boardNodes: "id,boardId", fragments: "id" });
  await database.open();
  try {
    const fullText = "重要研究內容".repeat(600) + "完整文章結尾";
    await database.table("cards").put({ id: "long", title: "完整長篇", plainText: fullText, state: "active", kind: "note", updatedAt: 1000 });
    const excerpt = { key: "card:long", type: "card", id: "long", title: "舊標題", text: fullText.slice(0, 2400), updatedAt: 500 } as BrainNodeView;
    const snapshot = await readBrainShareSnapshot(database as unknown as Parameters<typeof readBrainShareSnapshot>[0], excerpt, "zh-TW");
    expect(snapshot?.text).toBe(fullText);
    expect(snapshot?.title).toBe("完整長篇");
    await database.table("cards").update("long", { plainText: "預覽後編輯的內容", updatedAt: 1500 });
    expect(snapshot?.text).toBe(fullText);
    expect(createBrainShareRecord(snapshot!, "remote", 2000).updatedAt).toBe(1000);
    await database.table("cards").update("long", { state: "trash" });
    expect(await readBrainShareSnapshot(database as unknown as Parameters<typeof readBrainShareSnapshot>[0], excerpt, "zh-TW")).toBeNull();
  } finally { await database.delete(); }
});

it("includes all loose whiteboard text in the sharing preview", async () => {
  const database = new Dexie("brain-share-board-snapshot-test");
  database.version(1).stores({ cards: "id,legacyFragmentId", tasks: "id", boards: "id", boardNodes: "id,boardId", fragments: "id" });
  await database.open();
  try {
    await database.table("boards").put({ id: "board", title: "白板", description: "白板說明", updatedAt: 1200 });
    await database.table("boardNodes").bulkPut([
      { id: "text", boardId: "board", text: "完整文字" },
      { id: "section", boardId: "board", title: "區塊標題" },
      { id: "card", boardId: "board", cardId: "private", title: "不要自動公開引用卡片" },
    ]);
    const snapshot = await readBrainShareSnapshot(database as unknown as Parameters<typeof readBrainShareSnapshot>[0], { key: "board:board", type: "board", id: "board", text: "摘錄" } as BrainNodeView, "zh-TW");
    expect(snapshot?.text).toContain("白板說明");
    expect(snapshot?.text).toContain("完整文字");
    expect(snapshot?.text).toContain("區塊標題");
    expect(snapshot?.text).not.toContain("不要自動公開");
    expect(snapshot?.updatedAt).toBe(1200);
  } finally { await database.delete(); }
});
