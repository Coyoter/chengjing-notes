import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCard, db } from "../db";
import { clearGlobalHistory, globalHistoryState, initializeGlobalHistory, redoGlobalAction, runGlobalHistoryAction, runWithoutGlobalHistory, undoGlobalAction } from "./globalHistory";
import { includesQuery, searchRecords } from "./searchRecords";
import { uniqueArchiveName, validateBackup } from "./backupValidation";
import { handleMcpWorkspaceRequest } from "./mcpWorkspace";
import { syncCardTasksFromHtml } from "./taskSync";
import { createIncrementalBackupPayload, restoreBackup } from "./backup";
import { isUnsupportedResponseFormat, runAI } from "./ai";
import { useAppStore } from "../store";

describe("健檢回歸：資料完整性與完整搜尋", () => {
  beforeAll(async () => { await db.open(); await initializeGlobalHistory(); });
  beforeEach(async () => { await runWithoutGlobalHistory(() => db.transaction("rw", db.tables, () => Promise.all(db.tables.map((table) => table.clear())))); clearGlobalHistory(); });

  it("交易取消不留下假的復原紀錄，復原重做只影響成功的寫入", async () => {
    await expect(runGlobalHistoryAction(() => db.transaction("rw", db.cards, async () => {
      await createCard({ id: "rolled-back", title: "不應出現" });
      throw new Error("cancel");
    }))).rejects.toThrow("cancel");
    expect(await db.cards.count()).toBe(0);
    expect(globalHistoryState().canUndo).toBe(false);
    const saved = await runGlobalHistoryAction(() => createCard({ title: "保留" }));
    expect(await undoGlobalAction()).toBe(true);
    expect(await db.cards.get(saved.id)).toBeUndefined();
    expect(await redoGlobalAction()).toBe(true);
    expect((await db.cards.get(saved.id))?.title).toBe("保留");
    expect(globalHistoryState().entryCount).toBe(1);
  });

  it("失敗但已捕捉的單筆寫入不污染成功交易", async () => {
    const existing = await runWithoutGlobalHistory(() => createCard({ title: "原本" }));
    await runGlobalHistoryAction(() => db.transaction("rw", db.cards, async () => {
      await db.cards.add({ ...existing, title: "重複" }).catch(() => {});
      await db.cards.update(existing.id, { title: "新標題" });
    }));
    await undoGlobalAction();
    expect((await db.cards.get(existing.id))?.title).toBe("原本");
  });

  it("背景整理不會吞掉獨立的使用者操作", async () => {
    const [maintenance, user] = await Promise.all([
      runWithoutGlobalHistory(() => createCard({ id: "maintenance", title: "整理" })),
      runGlobalHistoryAction(() => createCard({ id: "user-write", title: "使用者" })),
    ]);
    await undoGlobalAction();
    expect(await db.cards.get(user.id)).toBeUndefined();
    expect(await db.cards.get(maintenance.id)).toBeDefined();
  });

  it("搜尋能找出大量候選之後、長文尾端與單字元的內容", async () => {
    const target = await db.transaction("rw", db.cards, async () => {
      for (let index = 0; index < 100; index++) await createCard({ id: `a${index}`, title: `product ${index}`, plainText: "一般內容" });
      return createCard({ title: "product unique", plainText: `${Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ")} 尾端斑馬` });
    });
    for (const query of ["product unique", "尾端斑馬", "斑", "ＵＮＩＱＵＥ"]) {
      const result = await searchRecords(db.cards, query, "zh-TW", (card) => includesQuery(`${card.title} ${card.plainText}`, query, "zh-TW"), 6);
      expect(result.map((card) => card.id)).toContain(target.id);
    }
  });

  it("MCP 追加保留格式，並發修改必須有一個回報衝突", async () => {
    const card = await createCard({ title: "格式保留", contentHtml: '<p><strong>粗體</strong> <a href="https://example.com">連結</a></p>', plainText: "粗體 連結" });
    const write = (content: string) => handleMcpWorkspaceRequest({ requestId: crypto.randomUUID(), tool: "chengjing_update_note", arguments: { id: card.id, expectedUpdatedAt: card.updatedAt, content, contentMode: "append" } });
    const results = await Promise.allSettled([write("第一筆"), write("第二筆")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const saved = await db.cards.get(card.id);
    expect(saved?.contentHtml).toContain('<strong>粗體</strong>');
    expect(saved?.contentHtml).toContain('href="https://example.com"');
  });

  it("MCP 新增子項目會重新開啟母項目；重新同步保留關聯", async () => {
    const card = await createCard({ title: "Checklist", contentHtml: '<ul data-type="taskList"><li data-task-id="root" data-checked="true"><div><p>母項目</p></div></li></ul>' });
    await syncCardTasksFromHtml(card.id, card.contentHtml);
    const parent = (await db.tasks.where("cardId").equals(card.id).toArray())[0];
    await handleMcpWorkspaceRequest({ requestId: "child", tool: "chengjing_create_task", arguments: { title: "子項目", parentTaskId: parent.id } });
    expect((await db.tasks.get(parent.id))?.done).toBe(false);
    expect((await db.cards.get(card.id))?.contentHtml).toContain('data-checked="false"');
    await db.tasks.update(parent.id, { parentTaskId: "external-parent", conversionKey: "preserve-key" });
    await syncCardTasksFromHtml(card.id, (await db.cards.get(card.id))!.contentHtml);
    expect((await db.tasks.get(parent.id))?.parentTaskId).toBe("external-parent");
    expect((await db.tasks.get(parent.id))?.conversionKey).toBe("preserve-key");
  });

  it("損壞或缺少資料表的備份會在清空資料之前被拒絕", () => {
    expect(() => validateBackup({ format: "chengjing-backup", version: 2, data: {} })).toThrow("backup-invalid");
    const data = Object.fromEntries(["cards", "boards", "boardNodes", "boardEdges", "tags", "tasks", "attachments"].map((name) => [name, []]));
    expect(validateBackup({ format: "chengjing-backup", version: 1, data }).version).toBe(1);
    expect(() => validateBackup({ format: "chengjing-backup", version: 2, data: { ...data, cards: [{ id: "a" }, { id: "a" }] } })).toThrow();
  });

  it("Markdown 匯出同名與 Windows 不合法名稱皆不遺失", () => {
    const used = new Set<string>();
    const names = ["筆記", "筆記", "Notes", "notes", "a/b", "a:b", "CON"].map((title) => uniqueArchiveName(title, used));
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(7);
    expect(names).toEqual(["筆記", "筆記 (2)", "Notes", "notes (2)", "a-b", "a-b (2)", "_CON"]);
  });

  it("備份可完整復原並清除舊操作歷史，拒絕空殼檔且原資料保持完整", async () => {
    const original = await createCard({ title: "安全復原", plainText: "重要內容" });
    const backup = await createIncrementalBackupPayload();
    await runGlobalHistoryAction(() => db.cards.update(original.id, { title: "被改掉" }));
    await expect(restoreBackup('{"format":"chengjing-backup","version":2,"data":{}}')).rejects.toThrow();
    expect((await db.cards.get(original.id))?.title).toBe("被改掉");
    await restoreBackup(backup.data);
    expect((await db.cards.get(original.id))?.title).toBe("安全復原");
    expect(globalHistoryState().canUndo).toBe(false);
  });

  it("只有明確不支援結構化輸出才降級，授權與額度錯誤不重送", () => {
    expect(isUnsupportedResponseFormat(new Error("Unsupported parameter: response_format"))).toBe(true);
    expect(isUnsupportedResponseFormat(new Error("json_schema is not supported"))).toBe(true);
    expect(isUnsupportedResponseFormat(new Error("HTTP 429 quota exceeded"))).toBe(false);
    expect(isUnsupportedResponseFormat(new Error("401 unauthorized"))).toBe(false);
  });

  it("請求重試固定使用原 Provider，不把內容傳到中途切換的新連線", async () => {
    const saved = Object.getOwnPropertyDescriptor(window, "chengjing");
    const profiles: string[] = [];
    useAppStore.getState().setCustomProvider({ id: "original", name: "Original", model: "model" });
    Object.defineProperty(window, "chengjing", { configurable: true, value: { ai: { providerChat: async (request: { profileId: string }) => {
      profiles.push(request.profileId);
      if (profiles.length === 1) { useAppStore.getState().setCustomProvider({ id: "new", name: "New", model: "model" }); throw new Error("response_format is not supported"); }
      return { text: "OK", model: "model", usage: null, finishReason: "stop" };
    } } } });
    try { await runAI({ engine: "custom-provider", model: "model", prompt: "私人內容", responseFormat: { type: "json_object" } }); expect(profiles).toEqual(["original", "original"]); }
    finally { if (saved) Object.defineProperty(window, "chengjing", saved); else Reflect.deleteProperty(window, "chengjing"); }
  });
});
