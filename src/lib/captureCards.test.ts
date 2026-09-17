import "fake-indexeddb/auto";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { db, createCard, createFragment, deleteCardPermanently, moveCardToTrash, restoreCardFromTrash, restoreCardVersion, pruneCardVersions } from "../db";
import type { AppLanguage, CardRecord, FragmentRecord } from "../types";
import { captureInboxCards, captureInboxCount, getCaptureCard, migrateLegacyFragments, updateCaptureFragment } from "./captureCards";
import { captureHtml, cardAsFragment } from "./captureModel";
import { createUnscheduledContentTask } from "./contentTask";
import { createKanbanBoard, placeCardOnKanban } from "./kanban";
import { isVisibleCard } from "./cardVisibility";
import { matchesLibraryCard, matchesLibraryTask, type LibraryFilters } from "./libraryFilters";
import { buildBrainGraph } from "./brain";
import { createBackupObject, restoreBackup } from "./backup";
import { applyAIActionPlan, buildAIActionContext } from "./aiActions";
import { handleMcpWorkspaceRequest, type McpWorkspaceTool } from "./mcpWorkspace";
import { applySyncPacket } from "./syncEngine";
import { translate } from "../i18n";
import { initializeGlobalHistory, clearGlobalHistory, undoGlobalAction, redoGlobalAction, runGlobalHistoryAction } from "./globalHistory";

const legacy = (id = "legacy", text = "AI 舊念頭"): FragmentRecord => ({ id, text, tagIds: ["AI"], pinned: true, createdAt: 100, updatedAt: 200 });
const filters: LibraryFilters = { collection: "library", group: "all", topicIds: null, tagId: "AI", kind: "all", query: "", language: "zh-TW" };
const request = (tool: McpWorkspaceTool, args: Record<string, unknown> = {}): Promise<unknown> => handleMcpWorkspaceRequest({ requestId: crypto.randomUUID(), tool, arguments: args });
const card = async (id: string) => (await db.cards.get(id))!;
const backup = (data: Record<string, unknown>) => JSON.stringify({ format: "chengjing-backup", version: 1, data: { cards: [], boards: [], boardNodes: [], boardEdges: [], tags: [], tasks: [], attachments: [], ...data } });

beforeAll(async () => { await db.open(); await initializeGlobalHistory(); });
beforeEach(async () => {
  localStorage.removeItem("chengjing-sync-enabled"); localStorage.removeItem("chengjing-sync-tracking");
  await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
  clearGlobalHistory();
});
afterEach(() => { vi.restoreAllMocks(); localStorage.removeItem("chengjing-sync-enabled"); localStorage.removeItem("chengjing-sync-tracking"); });

describe("隻言片語與卡片同一份資料", () => {
  it("儲存即是未整理卡片，AI 標籤可直接找到，沒有第二份片語", async () => {
    const item = await createFragment("  AI 念頭\n<script> & 第二行  ", ["AI", "AI"]);
    const saved = await card(item.id);
    expect(saved).toMatchObject({ captureStatus: "unfiled", kind: "note", state: "active", title: "AI 念頭", tagIds: ["AI"] });
    expect(saved.contentHtml).toBe("<p>AI 念頭<br>&lt;script&gt; &amp; 第二行</p>");
    expect(matchesLibraryCard(saved, filters)).toBe(true);
    expect(saved.searchTerms?.length).toBeGreaterThan(0);
    expect(await captureInboxCount()).toBe(1);
    expect(await db.fragments.count()).toBe(0);
    expect(await db.cards.count()).toBe(1);
  });
  it("拒絕空白輸入，不會留下空白卡片", async () => {
    await expect(createFragment(" \n ")).rejects.toThrow();
    expect(await db.cards.count()).toBe(0);
  });
  it("釘選與標籤不代表完成整理；編輯會保留同一個 ID", async () => {
    const item = await createFragment("第一版");
    const updated = await updateCaptureFragment(item.id, { text: "第二版", tagIds: ["AI"], pinned: true });
    expect(updated.id).toBe(item.id);
    expect(updated.updatedAt).toBeGreaterThan(item.updatedAt);
    expect((await captureInboxCards())[0]).toMatchObject({ id: item.id, favorite: true, plainText: "第二版", tagIds: ["AI"] });
    expect(await db.cards.count()).toBe(1);
    expect(await db.fragments.count()).toBe(0);
  });
  it("保留使用者自訂標題；純文字內容與 HTML 正確轉義", async () => {
    const item = await createFragment("初稿");
    await db.cards.update(item.id, { title: "自訂標題" });
    await updateCaptureFragment(item.id, { text: '文字 "<&>\'\n尾段' });
    expect((await card(item.id)).title).toBe("自訂標題");
    expect((await card(item.id)).contentHtml).toBe(captureHtml('文字 "<&>\'\n尾段'));
  });
  it("加入待辦連回原卡片且承接標籤，連按不重複", async () => {
    const item = await createFragment("AI 明天檢查", ["AI"]);
    const input = { title: item.text, sourceKey: `card:${item.id}`, cardId: item.id };
    const tasks = await Promise.all([createUnscheduledContentTask(input), createUnscheduledContentTask(input)]);
    expect(tasks[0].task.id).toBe(tasks[1].task.id);
    expect(await db.tasks.count()).toBe(1);
    expect(matchesLibraryTask(tasks[0].task, await card(item.id), filters)).toBe(true);
    expect(await captureInboxCount()).toBe(0);
    expect(await db.cards.count()).toBe(1);
    await db.tasks.delete(tasks[0].task.id);
    expect(await captureInboxCount()).toBe(1);
  });
  it("主題、白板、看板都只歸類原卡片，移除最後關聯後可回收件匣", async () => {
    const item = await createFragment("待整理", ["AI"]);
    await db.cards.update(item.id, { collectionId: "topic" });
    expect(await captureInboxCount()).toBe(0);
    await db.cards.update(item.id, { collectionId: undefined });
    await db.boardNodes.add({ id: "node", boardId: "board", cardId: item.id, kind: "card", x: 0, y: 0 });
    expect(await captureInboxCount()).toBe(0);
    await db.boardNodes.delete("node");
    const board = await createKanbanBoard("Project", ["待處理"]);
    const list = (await db.kanbanLists.where("boardId").equals(board.id).first())!;
    const placed = await placeCardOnKanban(board.id, list.id, item.id);
    expect((await placeCardOnKanban(board.id, list.id, item.id)).id).toBe(placed.id);
    expect(await captureInboxCount()).toBe(0);
    expect(await db.cards.count()).toBe(1);
    await db.kanbanPlacements.delete(placed.id);
    expect(await captureInboxCount()).toBe(1);
  });
  it("封存、垃圾桶與完成整理有明確區別；還原不改 ID", async () => {
    const item = await createFragment("Lifecycle", ["AI"]);
    await db.cards.update(item.id, { state: "archived" });
    expect(await captureInboxCount()).toBe(0);
    expect(matchesLibraryCard(await card(item.id), filters)).toBe(false);
    await db.cards.update(item.id, { state: "active" });
    expect(await captureInboxCount()).toBe(1);
    await moveCardToTrash(item.id);
    expect(await captureInboxCount()).toBe(0);
    await restoreCardFromTrash(item.id);
    expect(await captureInboxCount()).toBe(1);
    await db.cards.update(item.id, { captureStatus: "filed" });
    expect(await captureInboxCount()).toBe(0);
    expect(matchesLibraryCard(await card(item.id), filters)).toBe(true);
  });
  it("卡片库原本未分類的普通卡片不會倒灌快速收件匣", async () => {
    await createCard({ title: "正常卡片" });
    expect(await captureInboxCount()).toBe(0);
  });
  it("支援分頁與釘選優先，不會只計算第一頁", async () => {
    const items = await Promise.all(Array.from({ length: 45 }, (_, i) => createFragment(`thought ${i}`)));
    await db.cards.update(items[0].id, { favorite: true });
    expect((await captureInboxCards(40))[0].id).toBe(items[0].id);
    expect(await captureInboxCount()).toBe(45);
    expect(await captureInboxCards(40)).toHaveLength(40);
  });
  it("第二大腦只建立卡片神經元，不產生片語副本", async () => {
    const item = await createFragment("神經元", ["AI"]);
    const graph = buildBrainGraph({ cards: [await card(item.id)], fragments: [], boards: [], boardNodes: [], tasks: [], tags: [], storedEdges: [] });
    expect(graph.nodes.map((node) => node.key)).toEqual([`card:${item.id}`]);
  });
  it("使用者可復原或重做建立卡片，不會重建舊片語", async () => {
    const item = await runGlobalHistoryAction(() => createFragment("Undo capture"));
    await undoGlobalAction(); expect(await db.cards.get(item.id)).toBeUndefined();
    await redoGlobalAction(); expect((await card(item.id)).captureStatus).toBe("unfiled");
    expect(await db.fragments.count()).toBe(0);
  });
});

describe("舊片語安全搬移", () => {
  it("自動清理版本不會移除舊片語衝突的復原紀錄", async () => {
    const item = await createFragment("Current content");
    const now = Date.now();
    await db.cardVersions.bulkAdd(Array.from({ length: 35 }, (_, i) => ({ id: `edit-${i}`, cardId: item.id, title: "Edit", contentHtml: "<p>edit</p>", plainText: "edit", createdAt: now - i * 1000 })));
    await db.cardVersions.bulkAdd([1, 2, 3].map((i) => ({ id: `legacy-version-${i}`, cardId: item.id, title: "Legacy", contentHtml: "<p>legacy</p>", plainText: "legacy", createdAt: i, legacyFragment: legacy(item.id, `Old content ${i}`) })));
    await pruneCardVersions(item.id);
    expect((await db.cardVersions.where("cardId").equals(item.id).toArray()).filter((v) => v.legacyFragment)).toHaveLength(3);
  });
  it("保留 ID、時間、標籤、釘選，重接神經元、共享紀錄與既有待辦", async () => {
    const old = legacy(); await db.fragments.add(old);
    await db.brainEdges.add({ id: "edge", sourceType: "fragment", sourceId: old.id, targetType: "card", targetId: "other", origin: "manual", relationType: "semantic", reason: "why", createdAt: 20 });
    await db.brainShares.add({ id: "share", localType: "fragment", localId: old.id, remoteId: "remote", status: "shared", sharedAt: 30, updatedAt: 40 });
    await db.tasks.add({ id: "task", title: old.text, conversionKey: `content:fragment:${old.id}`, done: false, createdAt: 10, updatedAt: 10 });
    expect(await migrateLegacyFragments()).toBe(1);
    expect(cardAsFragment(await card(old.id))).toEqual({ id: old.id, text: old.text, pinned: old.pinned, tagIds: old.tagIds, createdAt: old.createdAt, updatedAt: old.updatedAt });
    expect(await db.fragments.count()).toBe(0);
    expect(await db.brainEdges.get("edge")).toMatchObject({ sourceType: "card", sourceId: old.id, reason: "why" });
    expect(await db.brainShares.get("share")).toMatchObject({ localType: "card", localId: old.id, remoteId: "remote", updatedAt: 40 });
    expect(await db.tasks.get("task")).toMatchObject({ cardId: old.id, conversionKey: `content:card:${old.id}` });
    expect(await captureInboxCount()).toBe(0);
  });
  it("撞號不覆寫其他卡片，舊連結可解析到安全的新 ID", async () => {
    const regular = await createCard({ title: "不要覆寫" });
    const old = legacy(regular.id); await db.fragments.add(old);
    await migrateLegacyFragments();
    const captured = (await getCaptureCard(old.id))!;
    expect(captured.id).not.toBe(regular.id);
    expect(captured.legacyFragmentId).toBe(old.id);
    expect(await db.cards.get(regular.id)).toEqual(await card(regular.id));
    expect((await card(regular.id)).title).toBe("不要覆寫");
    expect(await db.cards.count()).toBe(2);
    await db.fragments.put(old); await migrateLegacyFragments();
    expect(await db.cards.count()).toBe(2);
  });
  it("重複匯入不生副本；舊編輯保存為可還原版本，包含標籤與釘選", async () => {
    const old = legacy(); await db.fragments.add(old); await migrateLegacyFragments();
    await updateCaptureFragment(old.id, { text: "較新的內容", tagIds: ["new"], pinned: false });
    await db.fragments.put(old); await migrateLegacyFragments();
    await db.fragments.put(old); await migrateLegacyFragments();
    expect((await card(old.id)).plainText).toBe("較新的內容");
    const saved = (await db.cardVersions.toArray()).filter((version) => version.legacyFragment);
    expect(saved).toHaveLength(1);
    await restoreCardVersion(saved[0].id);
    expect(await card(old.id)).toMatchObject({ plainText: old.text, tagIds: old.tagIds, favorite: old.pinned });
    expect(await db.cards.count()).toBe(1);
  });
  it("保留不同標籤的舊快照，即使文字與時間相同", async () => {
    const old = legacy(); await db.fragments.add(old); await migrateLegacyFragments();
    await updateCaptureFragment(old.id, { text: "新版" });
    for (const tagIds of [["tag1"], ["tag2"]]) { await db.fragments.put({ ...old, tagIds }); await migrateLegacyFragments(); }
    expect((await db.cardVersions.toArray()).filter((v) => v.legacyFragment)).toHaveLength(2);
  });
  it("永久刪除後，重送舊片語不會讓內容復活", async () => {
    const old = legacy(); await db.fragments.add(old); await migrateLegacyFragments();
    await deleteCardPermanently(old.id);
    await db.fragments.put(old); await migrateLegacyFragments();
    expect(await db.cards.count()).toBe(0);
    expect(await db.fragments.count()).toBe(0);
  });
  it("另一台裝置收到刪除墓碑後，也不會重建舊片語", async () => {
    await applySyncPacket({ protocol: "chengjing-sync-v1", id: "deleted", operations: [{ id: "delete", table: "cards", key: "legacy", value: null, clock: { remote: 1 }, changedAt: 900 }] });
    await db.fragments.add(legacy()); await migrateLegacyFragments();
    expect(await db.cards.count()).toBe(0);
  });
  it("關聯稍後到達，也會改指向原卡片", async () => {
    await db.fragments.add(legacy()); await migrateLegacyFragments();
    await db.brainEdges.add({ id: "late", sourceType: "card", sourceId: "other", targetType: "fragment", targetId: "legacy", origin: "manual", reason: "late", createdAt: 1 });
    await migrateLegacyFragments();
    expect(await db.brainEdges.get("late")).toMatchObject({ targetType: "card", targetId: "legacy" });
  });
  it("交易失敗整批回滾，不會刪掉尚未搬妥的片語", async () => {
    await db.fragments.bulkAdd([legacy("one"), legacy("two")]);
    const original = db.cards.add.bind(db.cards); let calls = 0;
    vi.spyOn(db.cards, "add").mockImplementation(((...args: Parameters<typeof db.cards.add>) => { if (++calls === 2) throw new Error("migration-test-failure"); return original(...args); }) as typeof db.cards.add);
    await expect(migrateLegacyFragments()).rejects.toThrow("migration-test-failure");
    expect(await db.cards.count()).toBe(0);
    expect(await db.fragments.count()).toBe(2);
  });
  it("新備份不重複保存片語；完整還原保留未整理狀態", async () => {
    const item = await createFragment("Backup", ["AI"]);
    const exported = await createBackupObject();
    expect(exported.data.fragments).toEqual([]);
    await restoreBackup(JSON.stringify(exported));
    expect(await db.cards.count()).toBe(1);
    expect((await card(item.id)).captureStatus).toBe("unfiled");
    expect(await captureInboxCount()).toBe(1);
  });
  it("明確還原舊備份可以恢復內容，即使已有刪除紀錄", async () => {
    const old = legacy(); await db.fragments.add(old); await migrateLegacyFragments(); await deleteCardPermanently(old.id);
    await restoreBackup(backup({ fragments: [old] }));
    expect(cardAsFragment(await card(old.id))).toEqual({ id: old.id, text: old.text, pinned: old.pinned, tagIds: old.tagIds, createdAt: old.createdAt, updatedAt: old.updatedAt });
    expect(await db.fragments.count()).toBe(0);
  });
  it("新版卡片同步保留標籤、狀態與原 ID", async () => {
    const item = await createFragment("Sync", ["AI"]); const source = await card(item.id);
    await db.cards.delete(item.id);
    await applySyncPacket({ protocol: "chengjing-sync-v1", id: "capture", operations: [{ id: "remote-capture", table: "cards", key: item.id, value: { ...source }, clock: { remote: 1 }, changedAt: Date.now() + 1000 }] });
    expect(await card(item.id)).toMatchObject({ id: item.id, captureStatus: "unfiled", tagIds: ["AI"] });
    expect(await captureInboxCount()).toBe(1);
  });
});

describe("AI 與 MCP 共用卡片", () => {
  it("AI 建立、更新與刪除片語操作同一張卡片，刪除可由垃圾桶還原", async () => {
    const result = await applyAIActionPlan({ summary: "create", actions: [{ type: "create_fragment", text: "AI capture", description: "create" }] }, {});
    const id = result.createdCardIds[0]; expect(id).toBeTruthy();
    await applyAIActionPlan({ summary: "update", actions: [{ type: "update_fragment", targetId: id, text: "Updated capture", description: "update" }] }, {});
    expect((await card(id)).plainText).toBe("Updated capture");
    const catalog = JSON.parse(await buildAIActionContext("space")).workspaceCatalog;
    expect(catalog.cards.map((item: CardRecord) => item.id)).toEqual([id]);
    expect(catalog.fragments).toEqual([]);
    await applyAIActionPlan({ summary: "delete", actions: [{ type: "delete_fragment", targetId: id, description: "delete" }] }, {});
    expect((await card(id)).state).toBe("trash");
    expect(await db.fragments.count()).toBe(0);
    await restoreCardFromTrash(id); expect(await captureInboxCount()).toBe(1);
  });
  it("MCP 舊片語名稱為相容別名，預設搜尋只回傳一張卡片", async () => {
    const created = await request("chengjing_create_neuron", { type: "fragment", content: "MCP capture", pinned: true }) as { id: string; cardId: string };
    expect(created.cardId).toBe(created.id);
    const search = await request("chengjing_search", { query: "MCP capture" }) as { results: Array<{ id: string; type: string }> };
    expect(search.results).toHaveLength(1); expect(search.results[0]).toMatchObject({ id: created.id, type: "note" });
    const alias = await request("chengjing_search", { query: "MCP capture", types: ["fragment"] }) as { results: Array<{ id: string }> };
    expect(alias.results.map((item) => item.id)).toEqual([created.id]);
    const status = await request("chengjing_status") as { counts: { notes: number; fragments: number } };
    expect(status.counts).toMatchObject({ notes: 1, fragments: 1 });
    expect(await db.fragments.count()).toBe(0);
  });
  it("MCP 關聯一律存卡片，不能透過相容別名建立自我連線", async () => {
    const one = await createFragment("One"); const two = await createFragment("Two");
    await expect(request("chengjing_connect_neurons", { sourceType: "fragment", sourceId: one.id, targetType: "card", targetId: one.id, relationType: "semantic" })).rejects.toThrow("mcp-neuron-reference-invalid");
    await request("chengjing_connect_neurons", { sourceType: "fragment", sourceId: one.id, targetType: "fragment", targetId: two.id, relationType: "semantic" });
    expect((await db.brainEdges.toArray())[0]).toMatchObject({ sourceType: "card", targetType: "card" });
    const result = await request("chengjing_get_item", { type: "neuron", neuronType: "fragment", id: one.id }) as { relations: unknown[] };
    expect(result.relations).toHaveLength(1);
  });
  it.each(["archived", "trash"] as const)("封存或刪除卡片後，MCP 片語別名也無法讀取：%s", async (state) => {
    const item = await createFragment("Private capture"); await db.cards.update(item.id, { state });
    await expect(request("chengjing_get_item", { type: "fragment", id: item.id })).rejects.toThrow("mcp-item-not-found");
    const result = await request("chengjing_search", { query: "Private", types: ["fragment"] }) as { results: unknown[] };
    expect(result.results).toEqual([]);
    expect(isVisibleCard(await card(item.id))).toBe(false);
  });
  it.each(["zh-TW", "zh-CN", "en", "ja", "ko"] as AppLanguage[])("%s 操作提示不再要求先轉卡片", (language) => {
    expect(translate(language, "fragments.hint")).not.toMatch(/轉成卡片|转成卡片|convert to a card|カード化|카드 변환/);
    expect(translate(language, "fragments.description")).not.toBe("fragments.description");
    expect(translate(language, "fragments.saved")).not.toBe("fragments.saved");
  });
});
