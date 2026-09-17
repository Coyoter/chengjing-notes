import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, createFleetingCard, createFragment, updateFleetingText, moveCardToTrash, restoreCardVersion } from "../db";
import { fragmentAsCard } from "./fleetingCard";
import { migrateLegacyFragments, resolveFleetingCard } from "./migrateFragments";
import { organizeCard } from "./cardOrganization";
import { createUnscheduledContentTask } from "./contentTask";
import { isVisibleCard } from "./cardVisibility";
import type { FragmentRecord } from "../types";

const legacy = (id = "old", text = "舊片語 AI\n第二行"): FragmentRecord => ({ id, text, tagIds: ["AI"], pinned: true, createdAt: 10, updatedAt: 20 });
beforeAll(() => db.open());
beforeEach(async () => {
  localStorage.removeItem("chengjing-sync-enabled"); localStorage.removeItem("chengjing-sync-tracking");
  await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
});

async function destinations() {
  const now = Date.now();
  await db.knowledgeGroups.add({ id: "topic", name: "研究", kind: "topic", order: 0, createdAt: now, updatedAt: now });
  await db.boards.add({ id: "board", title: "白板", description: "", tagIds: [], favorite: false, createdAt: now, updatedAt: now });
  await db.kanbanBoards.add({ id: "kanban", title: "看板", description: "", favorite: false, createdAt: now, updatedAt: now });
  await db.kanbanLists.add({ id: "list", boardId: "kanban", title: "待處理", order: 0, createdAt: now, updatedAt: now });
}

describe("隻言片語以同一張卡片保存", () => {
  it("第一筆写入就能由卡片庫標籤找到，不寫入 fragments", async () => {
    const card = await createFleetingCard("  AI 原生卡片  ", ["AI"]);
    expect(card.state).toBe("inbox"); expect(card.collectionId).toBeUndefined();
    expect(isVisibleCard(card)).toBe(true);
    expect((await db.cards.where("tagIds").equals("AI").toArray()).map(row => row.id)).toEqual([card.id]);
    expect(await db.fragments.count()).toBe(0);
  });
  it("相容快速記錄 API 回傳同一個卡片 ID", async () => {
    const fragment = await createFragment("快速記錄", ["AI"]);
    expect((await db.cards.get(fragment.id))?.plainText).toBe(fragment.text);
    expect(await db.cards.count()).toBe(1); expect(await db.fragments.count()).toBe(0);
  });
  it("原文不截斷且 HTML 跳脫；只縮短標題", async () => {
    const text = `<script>alert('x')</script>\n${"長文字".repeat(500)}`;
    const card = await createFleetingCard(text);
    expect(card.plainText).toBe(text); expect(card.contentHtml).not.toContain("<script>");
    expect(card.contentHtml).toContain("&lt;script&gt;"); expect(card.title.length).toBeLessThanOrEqual(80);
  });
  it("原生分享重試不重複、不讓封存內容復活", async () => {
    const card = await createFleetingCard("分享內容", [], "native-id");
    await db.cards.update(card.id, { state: "archived" });
    expect((await createFleetingCard("分享內容", [], "native-id")).state).toBe("archived");
    expect(await db.cards.count()).toBe(1);
  });
  it("編輯保留卡片身分、標籤與待整理狀態，並可復原", async () => {
    const card = await createFleetingCard("之前", ["AI"]);
    await updateFleetingText(card.id, "之後");
    expect(await db.cards.get(card.id)).toMatchObject({ plainText: "之後", tagIds: ["AI"], state: "inbox" });
    expect((await db.cardVersions.where("cardId").equals(card.id).first())?.plainText).toBe("之前");
    await moveCardToTrash(card.id); await expect(updateFleetingText(card.id, "不應更新")).rejects.toThrow();
  });
  it("分類、白板、看板沿用同一張卡片，重複整理不重複放置", async () => {
    await destinations(); const card = await createFleetingCard("整理這一張", ["AI"]);
    await organizeCard(card.id, { kind: "topic", id: "topic" });
    for (let i = 0; i < 2; i++) {
      await organizeCard(card.id, { kind: "board", id: "board" });
      await organizeCard(card.id, { kind: "kanban", id: "kanban", listId: "list" });
    }
    expect(await db.cards.get(card.id)).toMatchObject({ state: "active", collectionId: "topic", tagIds: ["AI"] });
    expect(await db.cards.count()).toBe(1); expect(await db.boardNodes.count()).toBe(1); expect(await db.kanbanPlacements.count()).toBe(1);
    expect((await db.boardNodes.toArray())[0].cardId).toBe(card.id);
    expect((await db.kanbanPlacements.toArray())[0].cardId).toBe(card.id);
  });
  it("目的地不存在或看板列表不匹配時原子回滾", async () => {
    await destinations(); const card = await createFleetingCard("保持待整理");
    await expect(organizeCard(card.id, { kind: "board", id: "missing" })).rejects.toThrow();
    await expect(organizeCard(card.id, { kind: "kanban", id: "kanban", listId: "missing" })).rejects.toThrow();
    expect((await db.cards.get(card.id))?.state).toBe("inbox"); expect(await db.boardNodes.count()).toBe(0);
  });
  it("加待辦是連結來源卡片而非复制卡片，重複操作不重複待辦", async () => {
    const card = await createFleetingCard("待辦來源", ["AI"]);
    const input = { title: card.title, sourceKey: `card:${card.id}`, cardId: card.id };
    expect((await createUnscheduledContentTask(input)).created).toBe(true);
    expect((await createUnscheduledContentTask(input)).created).toBe(false);
    expect(await db.tasks.count()).toBe(1); expect(await db.cards.count()).toBe(1);
    expect((await db.cards.get(card.id))?.state).toBe("active");
    await db.cards.update(card.id, { state: "archived" });
    await expect(createUnscheduledContentTask(input)).rejects.toThrow();
    await expect(organizeCard(card.id, { kind: "topic", id: "topic" })).rejects.toThrow();
  });
});

describe("舊片語搬移與同步相容", () => {
  it("保留 ID、全文、時間、標籤與釘選，重跑不再寫資料", async () => {
    await db.fragments.add(legacy()); expect(await migrateLegacyFragments()).toBe(1);
    expect(await db.cards.get("old")).toMatchObject({ id: "old", plainText: legacy().text, tagIds: ["AI"], favorite: true, createdAt: 10, updatedAt: 20, state: "inbox" });
    expect(await db.fragments.count()).toBe(0); expect(await migrateLegacyFragments()).toBe(0);
    expect(await db.cards.count()).toBe(1); expect(await db.cardVersions.count()).toBe(0);
  });
  it("搬移雙端腦圖連線、共享對照與舊待辦來源", async () => {
    await db.fragments.bulkAdd([legacy(), legacy("other")]);
    await db.brainEdges.add({ id: "edge", sourceType: "fragment", sourceId: "old", targetType: "fragment", targetId: "other", origin: "manual", reason: "保留", createdAt: 15 });
    await db.brainShares.add({ id: "fragment:old", localType: "fragment", localId: "old", remoteId: "public-original", status: "shared", sharedAt: 15, updatedAt: 15 });
    await db.tasks.add({ id: "task", title: "舊待辦", done: false, conversionKey: "content:fragment:old", createdAt: 15, updatedAt: 15 });
    await migrateLegacyFragments();
    expect(await db.brainEdges.get("edge")).toMatchObject({ sourceType: "card", sourceId: "old", targetType: "card", targetId: "other", reason: "保留", createdAt: 15 });
    expect(await db.brainShares.get("card:old")).toMatchObject({ remoteId: "public-original", localType: "card", localId: "old", sharedAt: 15 });
    expect(await db.brainShares.get("fragment:old")).toBeUndefined();
    expect(await db.tasks.get("task")).toMatchObject({ cardId: "old", conversionKey: "content:card:old" });
  });
  it("意外 ID 衝突不覆寫一般卡片，仍可解析舊片語 ID", async () => {
    await db.cards.add({ ...fragmentAsCard(legacy()), properties: {}, title: "不能覆寫" });
    await db.fragments.add(legacy()); await migrateLegacyFragments();
    expect((await db.cards.get("old"))?.title).toBe("不能覆寫");
    expect((await resolveFleetingCard("old"))?.id).toBe("fragment-card:old"); expect(await db.cards.count()).toBe(2);
  });
  it("舊備份再次匯入不復活已永久刪除卡片", async () => {
    await db.fragments.add(legacy()); await migrateLegacyFragments(); await db.cards.delete("old");
    await db.fragments.add(legacy()); await migrateLegacyFragments();
    expect(await db.cards.count()).toBe(0); expect(await db.fragments.count()).toBe(0);
  });
  it("從其他裝置收到的卡片也記住搬移關係", async () => {
    await db.cards.add(fragmentAsCard(legacy())); await migrateLegacyFragments(); await db.cards.delete("old");
    await db.fragments.add(legacy()); await migrateLegacyFragments(); expect(await db.cards.count()).toBe(0);
  });
  it("較新的舊裝置編輯更新待整理卡片，原內容可用版本復原", async () => {
    await db.fragments.add(legacy()); await migrateLegacyFragments();
    await db.fragments.add({ ...legacy(), text: "較新", tagIds: ["new"], updatedAt: 100 }); await migrateLegacyFragments();
    expect((await db.cards.get("old"))?.plainText).toBe("較新");
    const version = await db.cardVersions.where("cardId").equals("old").first();
    expect(version?.captureSnapshot?.tagIds).toEqual(["AI"]);
    await restoreCardVersion(version!.id); expect((await db.cards.get("old"))?.plainText).toBe(legacy().text);
  });
  it("較新的舊裝置編輯不復活封存卡片，另存可復原版本", async () => {
    await db.fragments.add(legacy()); await migrateLegacyFragments(); await db.cards.update("old", { state: "archived" });
    await db.fragments.add({ ...legacy(), text: "來自舊装置", updatedAt: 100 }); await migrateLegacyFragments();
    expect(await db.cards.get("old")).toMatchObject({ state: "archived", plainText: legacy().text });
    expect((await db.cardVersions.where("cardId").equals("old").first())?.plainText).toBe("來自舊装置");
    expect(await db.cards.count()).toBe(1);
  });
  it("搬移衝突整筆回滾，不只刪除前半段片語", async () => {
    await db.fragments.bulkAdd([legacy("first"), legacy()]);
    await db.cards.bulkAdd(["old", "fragment-card:old"].map(id => ({ ...fragmentAsCard(legacy(), id), properties: {} })));
    await expect(migrateLegacyFragments()).rejects.toThrow("fragment-migration-id-conflict");
    expect(await db.fragments.count()).toBe(2); expect(await db.cards.get("first")).toBeUndefined();
  });
});
