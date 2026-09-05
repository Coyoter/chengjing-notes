import Dexie, { type EntityTable, type Transaction } from "dexie";
import { ignoreTransactionHistory, transactionHistoryIgnored } from "./lib/historyTransactions";
import dayjs from "dayjs";
import { intlLocale, translate } from "./i18n";
import { useAppStore } from "./store";
import { cardSearchTerms, fragmentSearchTerms, taskSearchTerms } from "./lib/searchIndex";
import { inferJournalTouched, isMaterializedCard } from "./lib/journalVisibility";
import {
  isUntouchedLegacyDemoCard,
  isUntouchedLegacyDemoEdge,
  isUntouchedLegacyDemoHighlight,
  isUntouchedLegacyDemoNode,
  LEGACY_DEMO_CARD_ID,
  LEGACY_DEMO_NODE_ID,
} from "./lib/legacySeedCleanup";
import type {
  AttachmentRecord,
  BoardEdgeRecord,
  BoardNodeRecord,
  BoardRecord,
  CardRecord,
  CardVersionRecord,
  ChatMessageRecord,
  ChatThreadRecord,
  CourseRecord,
  BrainEdgeRecord,
  BrainReportRecord,
  BrainShareRecord,
  FragmentRecord,
  HighlightRecord,
  KnowledgeGroupRecord,
  KanbanBoardRecord,
  KanbanListRecord,
  KanbanPlacementRecord,
  PreferenceRecord,
  TagRecord,
  TaskRecord,
} from "./types";

class ChengJingDatabase extends Dexie {
  cards!: EntityTable<CardRecord, "id">;
  boards!: EntityTable<BoardRecord, "id">;
  boardNodes!: EntityTable<BoardNodeRecord, "id">;
  boardEdges!: EntityTable<BoardEdgeRecord, "id">;
  tags!: EntityTable<TagRecord, "id">;
  tasks!: EntityTable<TaskRecord, "id">;
  highlights!: EntityTable<HighlightRecord, "id">;
  attachments!: EntityTable<AttachmentRecord, "id">;
  chatThreads!: EntityTable<ChatThreadRecord, "id">;
  chatMessages!: EntityTable<ChatMessageRecord, "id">;
  courses!: EntityTable<CourseRecord, "id">;
  preferences!: EntityTable<PreferenceRecord, "key">;
  cardVersions!: EntityTable<CardVersionRecord, "id">;
  fragments!: EntityTable<FragmentRecord, "id">;
  brainEdges!: EntityTable<BrainEdgeRecord, "id">;
  brainReports!: EntityTable<BrainReportRecord, "id">;
  brainShares!: EntityTable<BrainShareRecord, "id">;
  knowledgeGroups!: EntityTable<KnowledgeGroupRecord, "id">;
  kanbanBoards!: EntityTable<KanbanBoardRecord, "id">;
  kanbanLists!: EntityTable<KanbanListRecord, "id">;
  kanbanPlacements!: EntityTable<KanbanPlacementRecord, "id">;

  constructor() {
    super("chengjing");
    this.version(1).stores({
      cards: "id, title, kind, state, updatedAt, createdAt, journalDate, *tagIds, favorite, dueAt",
      boards: "id, title, parentId, favorite, updatedAt",
      boardNodes: "id, boardId, cardId, kind",
      boardEdges: "id, boardId, source, target",
      tags: "id, name, group, createdAt",
      tasks: "id, cardId, done, dueAt, updatedAt",
      highlights: "id, cardId, createdAt",
      attachments: "id, name, mime, createdAt",
      chatThreads: "id, contextType, contextId, updatedAt",
      chatMessages: "id, threadId, createdAt",
      courses: "id, updatedAt",
      preferences: "key",
    });
    this.version(2).stores({
      cardVersions: "id, cardId, createdAt",
    });
    this.version(3).stores({
      fragments: "id, pinned, createdAt, updatedAt",
      brainEdges: "id, [sourceType+sourceId], [targetType+targetId], origin, createdAt",
      brainReports: "id, &date, updatedAt",
    });
    this.version(4).stores({
      boards: "id, title, parentId, favorite, updatedAt, *tagIds",
      fragments: "id, pinned, createdAt, updatedAt, *tagIds",
    }).upgrade(async (transaction) => {
      await transaction.table("boards").toCollection().modify((board) => { if (!Array.isArray(board.tagIds)) board.tagIds = []; });
      await transaction.table("fragments").toCollection().modify((fragment) => { if (!Array.isArray(fragment.tagIds)) fragment.tagIds = []; });
    });
    this.version(5).stores({
      cards: "id, title, kind, state, updatedAt, createdAt, journalDate, collectionId, *tagIds, favorite, dueAt",
      knowledgeGroups: "id, kind, parentId, order, updatedAt, name",
      ragChunks: "id, cardId, collectionId, embeddingModel, updatedAt, contentHash",
    });
    this.version(6).stores({
      ragChunks: null,
    });
    this.version(7).stores({
      cards: "id, title, kind, state, updatedAt, createdAt, journalDate, collectionId, *tagIds, favorite, startAt, dueAt",
      kanbanBoards: "id, title, favorite, updatedAt",
      kanbanLists: "id, boardId, order, updatedAt",
      kanbanPlacements: "id, boardId, listId, cardId, order, [boardId+listId], updatedAt",
    });
    this.version(8).stores({
      cards: "id, title, kind, state, updatedAt, createdAt, journalDate, collectionId, *tagIds, favorite, startAt, dueAt",
    }).upgrade(async (transaction) => {
      await transaction.table("cards").where("state").equals("inbox").modify({ state: "active", updatedAt: Date.now() });
    });
    this.version(9).stores({
      brainShares: "id, &remoteId, [localType+localId], status, updatedAt",
    });
    this.version(10).stores({
      cards: "id, title, kind, state, updatedAt, createdAt, journalDate, collectionId, *tagIds, favorite, startAt, dueAt, taskSyncState, *searchTerms",
      tasks: "id, cardId, done, dueAt, updatedAt, doneKey, scheduleKey, [doneKey+scheduleKey], *searchTerms",
      fragments: "id, pinned, pinnedKey, createdAt, updatedAt, *tagIds, *searchTerms",
      attachments: "id, name, mime, createdAt, storage, sha256",
    }).upgrade(async (transaction) => {
      const language = useAppStore.getState().language || "zh-TW";
      await transaction.table("cards").toCollection().modify((card) => {
        card.searchTerms = cardSearchTerms(card, language);
        if (card.taskSyncState !== "synced") card.taskSyncState = "pending";
      });
      await transaction.table("tasks").toCollection().modify((task) => { task.searchTerms = taskSearchTerms(task, language); task.doneKey = task.done ? "done" : "active"; task.scheduleKey = task.dueAt || Number.MAX_SAFE_INTEGER; });
      await transaction.table("fragments").toCollection().modify((fragment) => { fragment.searchTerms = fragmentSearchTerms(fragment, language); fragment.pinnedKey = fragment.pinned ? "pinned" : "normal"; });
      await transaction.table("attachments").toCollection().modify((attachment) => { if (!attachment.storage) attachment.storage = attachment.blob ? "indexeddb" : "file"; });
    });
    this.version(11).stores({
      cards: "id, title, kind, state, updatedAt, createdAt, journalDate, collectionId, *tagIds, favorite, startAt, dueAt, taskSyncState, *searchTerms",
    }).upgrade(async (transaction) => {
      await transaction.table("cards").where("kind").equals("journal").modify((card) => {
        card.journalTouched = inferJournalTouched(card as CardRecord);
      });
    });
    this.version(12).stores({
      tasks: "id, cardId, done, dueAt, updatedAt, doneKey, scheduleKey, conversionKey, [doneKey+scheduleKey], *searchTerms",
    });
    this.version(13).stores({
      tasks: "id, cardId, parentTaskId, done, dueAt, updatedAt, doneKey, scheduleKey, conversionKey, [doneKey+scheduleKey], *searchTerms",
    });

    this.cards.hook("creating", (_key, card) => {
      const language = useAppStore.getState().language || "zh-TW";
      card.searchTerms = cardSearchTerms(card, language);
      card.taskSyncState = card.taskSyncState || "pending";
    });
    this.cards.hook("updating", (modifications, _key, oldCard) => {
      const language = useAppStore.getState().language || "zh-TW";
      const next = { ...oldCard, ...modifications } as CardRecord;
      const patch: Partial<CardRecord> = {};
      if (["title", "plainText", "sourceUrl"].some((key) => Object.prototype.hasOwnProperty.call(modifications, key))) patch.searchTerms = cardSearchTerms(next, language);
      if (Object.prototype.hasOwnProperty.call(modifications, "contentHtml") && (modifications as Partial<CardRecord>).taskSyncState !== "synced") patch.taskSyncState = "pending";
      if (oldCard.kind === "journal" && oldCard.journalTouched !== true) {
        const changedTitle = Object.prototype.hasOwnProperty.call(modifications, "title") && next.title !== oldCard.title;
        const changedHtml = Object.prototype.hasOwnProperty.call(modifications, "contentHtml") && next.contentHtml !== oldCard.contentHtml;
        const changedText = Object.prototype.hasOwnProperty.call(modifications, "plainText") && next.plainText !== oldCard.plainText;
        if (changedTitle || changedHtml || changedText) patch.journalTouched = true;
      }
      return patch;
    });
    this.tasks.hook("creating", (_key, task) => { task.searchTerms = taskSearchTerms(task, useAppStore.getState().language || "zh-TW"); task.doneKey = task.done ? "done" : "active"; task.scheduleKey = task.dueAt || Number.MAX_SAFE_INTEGER; });
    this.tasks.hook("updating", (modifications, _key, oldTask) => { const task = { ...oldTask, ...modifications } as TaskRecord; return { searchTerms: taskSearchTerms(task, useAppStore.getState().language || "zh-TW"), doneKey: task.done ? "done" : "active", scheduleKey: task.dueAt || Number.MAX_SAFE_INTEGER }; });
    this.fragments.hook("creating", (_key, fragment) => { fragment.searchTerms = fragmentSearchTerms(fragment, useAppStore.getState().language || "zh-TW"); fragment.pinnedKey = fragment.pinned ? "pinned" : "normal"; });
    this.fragments.hook("updating", (modifications, _key, oldFragment) => { const fragment = { ...oldFragment, ...modifications } as FragmentRecord; return { searchTerms: fragmentSearchTerms(fragment, useAppStore.getState().language || "zh-TW"), pinnedKey: fragment.pinned ? "pinned" : "normal" }; });
    const committedMutations = new WeakMap<Transaction, Array<Record<string, unknown>>>();
    function recordCommitted(transaction: Transaction, mutation: Record<string, unknown>) {
      if (transactionHistoryIgnored(transaction)) return;
      const shared = globalThis as typeof globalThis & { __chengjingHistoryRecorder?: (mutation: Record<string, unknown>) => void };
      if (!shared.__chengjingHistoryRecorder) return;
      let root = transaction;
      while (root.parent) root = root.parent;
      let mutations = committedMutations.get(root);
      if (!mutations) {
        mutations = [];
        committedMutations.set(root, mutations);
        root.on("complete", () => {
          for (const item of committedMutations.get(root) || []) shared.__chengjingHistoryRecorder?.(item);
          committedMutations.delete(root);
        });
        root.on("abort", () => committedMutations.delete(root));
      }
      mutations.push(structuredClone(mutation));
    }
    this.tables.forEach((table) => {
      table.hook("creating", function (key, value, transaction) {
        const keyPath = table.schema.primKey.keyPath;
        const primaryKey = typeof key === "string" ? key : typeof keyPath === "string" ? String((value as Record<string, unknown>)[keyPath] || "") : "";
        if (primaryKey) this.onsuccess = () => recordCommitted(transaction, { type: "creating", table: table.name, key: primaryKey, value });
      });
      table.hook("updating", function (modifications, key, oldValue, transaction) {
        this.onsuccess = () => recordCommitted(transaction, { type: "updating", table: table.name, key: String(key), modifications, oldValue });
      });
      table.hook("deleting", function (key, oldValue, transaction) {
        this.onsuccess = () => recordCommitted(transaction, { type: "deleting", table: table.name, key: String(key), oldValue });
      });
    });
  }
}

export const db = new ChengJingDatabase();

const now = Date.now();
const day = 86_400_000;
const tagColors = ["jade", "sky", "violet", "amber", "rose"];

function normalizedTagName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function sameTagName(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: "base" }) === 0;
}

export async function createTag(value: string): Promise<TagRecord> {
  const name = normalizedTagName(value);
  if (!name) throw new Error(translate(useAppStore.getState().language || "zh-TW", "tags.nameRequired"));
  const tags = await db.tags.toArray();
  const existing = tags.find((tag) => sameTagName(tag.name, name));
  if (existing) return existing;
  const tag: TagRecord = { id: crypto.randomUUID(), name, color: tagColors[tags.length % tagColors.length], group: "custom", createdAt: Date.now() };
  await db.tags.add(tag);
  return tag;
}

export async function createKnowledgeGroup(kind: KnowledgeGroupRecord["kind"], nameValue: string, parentId?: string) {
  const name = nameValue.trim().replace(/\s+/g, " ");
  if (!name) throw new Error(translate(useAppStore.getState().language || "zh-TW", "tags.nameRequired"));
  if (kind === "topic" && parentId) {
    const parent = await db.knowledgeGroups.get(parentId);
    if (!parent || parent.kind !== "area") throw new Error("invalid-area");
  }
  const siblings = await db.knowledgeGroups.filter((group) => group.kind === kind && group.parentId === parentId).toArray();
  const timestamp = Date.now();
  const group: KnowledgeGroupRecord = { id: crypto.randomUUID(), name, kind, parentId, order: siblings.length, createdAt: timestamp, updatedAt: timestamp };
  await db.knowledgeGroups.add(group);
  return group;
}

export async function renameKnowledgeGroup(id: string, nameValue: string) {
  const name = nameValue.trim().replace(/\s+/g, " ");
  if (!name) throw new Error(translate(useAppStore.getState().language || "zh-TW", "tags.nameRequired"));
  await db.knowledgeGroups.update(id, { name, updatedAt: Date.now() });
}

export async function deleteKnowledgeGroup(id: string) {
  const group = await db.knowledgeGroups.get(id);
  if (!group) return;
  await db.transaction("rw", [db.knowledgeGroups, db.cards], async () => {
    if (group.kind === "area") {
      await db.knowledgeGroups.where("parentId").equals(id).modify({ parentId: undefined, updatedAt: Date.now() });
    } else {
      await db.cards.where("collectionId").equals(id).modify({ collectionId: undefined, updatedAt: Date.now() });
    }
    await db.knowledgeGroups.delete(id);
  });
}

export async function moveCardToKnowledgeGroup(cardId: string, collectionId?: string) {
  if (collectionId) {
    const group = await db.knowledgeGroups.get(collectionId);
    if (!group || group.kind !== "topic") throw new Error("invalid-topic");
  }
  await db.cards.update(cardId, { collectionId, updatedAt: Date.now() });
}

export async function renameTag(tagId: string, value: string): Promise<TagRecord> {
  const name = normalizedTagName(value);
  if (!name) throw new Error(translate(useAppStore.getState().language || "zh-TW", "tags.nameRequired"));
  const current = await db.tags.get(tagId);
  if (!current) throw new Error(translate(useAppStore.getState().language || "zh-TW", "context.failed"));
  const duplicate = (await db.tags.toArray()).find((tag) => tag.id !== tagId && sameTagName(tag.name, name));
  if (!duplicate) {
    await db.tags.update(tagId, { name });
    return { ...current, name };
  }
  await db.transaction("rw", [db.tags, db.cards, db.boards, db.fragments], async () => {
    const merge = (ids: string[] = []) => [...new Set(ids.map((id) => id === tagId ? duplicate.id : id))];
    await db.cards.toCollection().modify((card) => { card.tagIds = merge(card.tagIds); });
    await db.boards.toCollection().modify((board) => { board.tagIds = merge(board.tagIds); });
    await db.fragments.toCollection().modify((fragment) => { fragment.tagIds = merge(fragment.tagIds); });
    await db.tags.delete(tagId);
  });
  return duplicate;
}

export async function deleteTag(tagId: string) {
  await db.transaction("rw", [db.tags, db.cards, db.boards, db.fragments], async () => {
    const remove = (ids: string[] = []) => ids.filter((id) => id !== tagId);
    await db.cards.toCollection().modify((card) => { card.tagIds = remove(card.tagIds); });
    await db.boards.toCollection().modify((board) => { board.tagIds = remove(board.tagIds); });
    await db.fragments.toCollection().modify((fragment) => { fragment.tagIds = remove(fragment.tagIds); });
    await db.tags.delete(tagId);
  });
}

export async function seedDatabase() {
  if ((await db.cards.count()) > 0) return;

  const tagProduct = "tag-product";
  const tagResearch = "tag-research";
  const tagAI = "tag-ai";
  const tagWriting = "tag-writing";
  const boardId = "board-welcome";
  const areaId = "area-work";
  const topicId = "topic-product-research";

  const cards: CardRecord[] = [
    {
      id: "card-welcome",
      title: "歡迎來到澄境",
      contentHtml: "<h2>讓資料慢慢變清楚</h2><p>澄境把筆記、來源、白板與 AI 放在同一個安靜的工作空間。你可以從收件匣開始，也可以直接在白板上雙擊建立卡片。</p><blockquote><p>一張卡片可以出現在多個白板，但內容永遠只有一份。</p></blockquote><h3>先試試看</h3><ul><li><p>打開右側 AI，請它摘要目前白板</p></li><li><p>拖曳卡片並建立新的連線</p></li><li><p>在卡片庫用標籤篩選內容</p></li></ul>",
      plainText: "讓資料慢慢變清楚。澄境把筆記、來源、白板與 AI 放在同一個安靜的工作空間。",
      kind: "note",
      state: "active",
      createdAt: now - day * 4,
      updatedAt: now - day,
      tagIds: [tagProduct],
      favorite: true,
      color: "jade",
      attachmentIds: [],
      properties: { 階段: "進行中", 類型: "產品說明" },
      collectionId: topicId,
    },
    {
      id: "card-ai-king",
      title: "AI 吵架王：產品研究",
      contentHtml: "<h2>研究目標</h2><p>整理 Android 與 Chrome 版本的安裝流程、模型選擇、權限邊界和常見問題。</p><h3>兩種推論方式</h3><ul><li><p><strong>OpenRouter</strong>：快速、可自由選擇模型。</p></li><li><p><strong>Gemma 4 E2B</strong>：模型下載到本機，內容不離開電腦。</p></li></ul>",
      plainText: "整理 Android 與 Chrome 版本的安裝流程、模型選擇、權限邊界和常見問題。",
      kind: "note",
      state: "active",
      createdAt: now - day * 3,
      updatedAt: now - 3_600_000,
      tagIds: [tagProduct, tagAI, tagResearch],
      favorite: true,
      color: "sky",
      attachmentIds: [],
      properties: { 階段: "研究中", 平台: ["Android", "Chrome"] },
      collectionId: topicId,
    },
    {
      id: "card-gemma",
      title: "Gemma 4 本機模式",
      contentHtml: "<h2>隱私優先的備援引擎</h2><p>Gemma 4 E2B 以 WebGPU 在本機執行。第一次使用需要下載約 3.2 GB，之後可以離線生成。</p><p>適合摘要私人日誌、未公開文章和不希望送往雲端的內容。</p>",
      plainText: "Gemma 4 E2B 以 WebGPU 在本機執行，第一次使用需要下載約 3.2 GB。",
      kind: "note",
      state: "active",
      createdAt: now - day * 2,
      updatedAt: now - 7_200_000,
      tagIds: [tagAI, tagResearch],
      favorite: false,
      color: "violet",
      attachmentIds: [],
      properties: { 階段: "已驗證", 引擎: "WebGPU" },
      collectionId: topicId,
    },
    {
      id: "card-writing",
      title: "安裝教學文章架構",
      contentHtml: "<h2>讀者先想知道什麼？</h2><ol><li><p>這個工具能幫我做什麼？</p></li><li><p>Android 與 Chrome 版有什麼差異？</p></li><li><p>我的文字會送到哪裡？</p></li><li><p>安裝完成後如何確認真的能用？</p></li></ol>",
      plainText: "安裝教學應先回答用途、平台差異、資料去向和實際驗證方式。",
      kind: "note",
      state: "active",
      createdAt: now - day,
      updatedAt: now - 1_800_000,
      tagIds: [tagWriting, tagProduct],
      favorite: false,
      color: "amber",
      dueAt: now + day * 2,
      attachmentIds: [],
      properties: { 階段: "待整理", 稿件: "教學" },
      collectionId: topicId,
    },
    {
      id: "journal-today",
      title: dayjs().format("YYYY 年 M 月 D 日"),
      contentHtml: "<h2>今天想釐清的事</h2><p>把新的筆記應用做成真正能長期使用的工具，而不是只有漂亮畫面的原型。</p><ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"false\"><label><input type=\"checkbox\"><span></span></label><div><p>完成第一個可執行版本</p></div></li></ul>",
      plainText: "把新的筆記應用做成真正能長期使用的工具。",
      kind: "journal",
      state: "active",
      createdAt: now,
      updatedAt: now,
      journalDate: dayjs().format("YYYY-MM-DD"),
      journalTouched: true,
      tagIds: [],
      favorite: false,
      color: "slate",
      attachmentIds: [],
      properties: {},
    },
  ];

  const tags: TagRecord[] = [
    { id: tagProduct, name: "產品", color: "jade", group: "工作", createdAt: now - day * 4 },
    { id: tagResearch, name: "研究", color: "sky", group: "工作", createdAt: now - day * 4 },
    { id: tagAI, name: "AI", color: "violet", group: "技術", createdAt: now - day * 4 },
    { id: tagWriting, name: "寫作", color: "amber", group: "創作", createdAt: now - day * 4 },
  ];

  const knowledgeGroups: KnowledgeGroupRecord[] = [
    { id: areaId, name: "工作", kind: "area", order: 0, createdAt: now - day * 4, updatedAt: now },
    { id: topicId, name: "產品研究", kind: "topic", parentId: areaId, order: 0, createdAt: now - day * 4, updatedAt: now },
  ];

  const board: BoardRecord = {
    id: boardId,
    title: "產品研究室",
    description: "從來源、推論方式到文章產出的完整脈絡",
    favorite: true,
    tagIds: [tagProduct, tagResearch],
    createdAt: now - day * 4,
    updatedAt: now,
  };

  const nodes: BoardNodeRecord[] = [
    { id: "node-section-1", boardId, kind: "section", x: 40, y: 70, width: 650, height: 470, title: "核心產品脈絡", color: "jade" },
    { id: "node-welcome", boardId, kind: "card", cardId: "card-welcome", x: 90, y: 130, width: 265, height: 190 },
    { id: "node-ai-king", boardId, kind: "card", cardId: "card-ai-king", x: 410, y: 130, width: 265, height: 210 },
    { id: "node-gemma", boardId, kind: "card", cardId: "card-gemma", x: 410, y: 385, width: 265, height: 180 },
    { id: "node-writing", boardId, kind: "card", cardId: "card-writing", x: 790, y: 245, width: 280, height: 200 },
    { id: "node-text", boardId, kind: "text", x: 770, y: 95, width: 340, height: 70, text: "來源 → 理解 → 連結 → 產出", color: "slate" },
  ];

  const edges: BoardEdgeRecord[] = [
    { id: "edge-1", boardId, source: "node-welcome", target: "node-ai-king", label: "開始研究" },
    { id: "edge-2", boardId, source: "node-ai-king", target: "node-gemma", label: "本機方案" },
    { id: "edge-4", boardId, source: "node-ai-king", target: "node-writing", label: "整理成文章" },
  ];

  const tasks: TaskRecord[] = [
    { id: "task-1", title: "確認 OpenRouter 預設模型清單", done: false, cardId: "card-ai-king", dueAt: now + day, createdAt: now - day, updatedAt: now - day },
    { id: "task-2", title: "整理 Android 與 Chrome 安裝差異", done: false, cardId: "card-writing", dueAt: now + day * 2, createdAt: now - day, updatedAt: now - day },
    { id: "task-3", title: "驗證 Gemma 4 本機生成", done: true, cardId: "card-gemma", createdAt: now - day * 2, updatedAt: now - 7_200_000 },
  ];

  const highlights: HighlightRecord[] = [
    { id: "highlight-1", cardId: "card-welcome", text: "一張卡片可以出現在多個白板，但內容永遠只有一份。", note: "同一份內容可以在不同視覺脈絡中重用。", color: "amber", createdAt: now - day },
  ];

  await db.transaction("rw", [db.cards, db.tags, db.boards, db.boardNodes, db.boardEdges, db.tasks, db.highlights, db.knowledgeGroups], async () => {
    await db.cards.bulkPut(cards);
    await db.tags.bulkPut(tags);
    await db.boards.put(board);
    await db.boardNodes.bulkPut(nodes);
    await db.boardEdges.bulkPut(edges);
    await db.tasks.bulkPut(tasks);
    await db.highlights.bulkPut(highlights);
    await db.knowledgeGroups.bulkPut(knowledgeGroups);
  });
}

/**
 * 0.7.4 以前的新手資料曾包含一張內部產品研究卡片。只有卡片本身、
 * 白板節點、連線與劃記都仍是原始內建內容，而且沒有被其他功能引用時，
 * 才視為未使用的示範資料一併移除；任何使用者修改或引用都會完整保留。
 */
export async function pruneLegacyDemoSourceCard() {
  return db.transaction(
    "rw",
    [db.cards, db.boardNodes, db.boardEdges, db.highlights, db.tasks, db.kanbanPlacements, db.brainShares, db.brainEdges, db.cardVersions],
    async () => {
      const card = await db.cards.get(LEGACY_DEMO_CARD_ID);
      if (!card || !isUntouchedLegacyDemoCard(card)) return 0;

      const [nodes, sourceEdges, targetEdges, highlights, tasks, placements, shares, sourceBrainEdges, targetBrainEdges, versions] = await Promise.all([
        db.boardNodes.where("cardId").equals(LEGACY_DEMO_CARD_ID).toArray(),
        db.boardEdges.where("source").equals(LEGACY_DEMO_NODE_ID).toArray(),
        db.boardEdges.where("target").equals(LEGACY_DEMO_NODE_ID).toArray(),
        db.highlights.where("cardId").equals(LEGACY_DEMO_CARD_ID).toArray(),
        db.tasks.where("cardId").equals(LEGACY_DEMO_CARD_ID).toArray(),
        db.kanbanPlacements.where("cardId").equals(LEGACY_DEMO_CARD_ID).toArray(),
        db.brainShares.where("[localType+localId]").equals(["card", LEGACY_DEMO_CARD_ID]).toArray(),
        db.brainEdges.where("[sourceType+sourceId]").equals(["card", LEGACY_DEMO_CARD_ID]).toArray(),
        db.brainEdges.where("[targetType+targetId]").equals(["card", LEGACY_DEMO_CARD_ID]).toArray(),
        db.cardVersions.where("cardId").equals(LEGACY_DEMO_CARD_ID).toArray(),
      ]);
      const edges = [...new Map([...sourceEdges, ...targetEdges].map((edge) => [edge.id, edge])).values()];
      const untouchedSeedRelations = nodes.length === 1
        && isUntouchedLegacyDemoNode(nodes[0])
        && edges.length === 1
        && isUntouchedLegacyDemoEdge(edges[0])
        && highlights.length === 1
        && isUntouchedLegacyDemoHighlight(highlights[0]);
      const hasUserReferences = tasks.length > 0
        || placements.length > 0
        || shares.length > 0
        || sourceBrainEdges.length > 0
        || targetBrainEdges.length > 0
        || versions.length > 0;
      if (!untouchedSeedRelations || hasUserReferences) return 0;

      await db.boardEdges.delete(edges[0].id);
      await db.boardNodes.delete(nodes[0].id);
      await db.highlights.delete(highlights[0].id);
      await db.cards.delete(card.id);
      return 1;
    },
  );
}

export async function createCard(input: Partial<CardRecord> & Pick<CardRecord, "title">): Promise<CardRecord> {
  const language = useAppStore.getState().language || "zh-TW";
  const timestamp = Date.now();
  const card: CardRecord = {
    id: crypto.randomUUID(),
    title: input.title || translate(language, "common.untitledCard"),
    contentHtml: input.contentHtml || "<p></p>",
    plainText: input.plainText || "",
    kind: input.kind || "note",
    state: input.state || "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    journalDate: input.journalDate,
    journalTouched: input.journalTouched,
    tagIds: input.tagIds || [],
    favorite: input.favorite || false,
    color: input.color || "slate",
    startAt: input.startAt,
    dueAt: input.dueAt,
    sourceUrl: input.sourceUrl,
    attachmentIds: input.attachmentIds || [],
    properties: input.properties || {},
    collectionId: input.collectionId,
  };
  if (card.kind === "journal" && card.journalTouched === undefined) card.journalTouched = inferJournalTouched(card);
  await db.cards.add(card);
  return card;
}

export async function getOrCreateJournal(date: string): Promise<CardRecord> {
  const existing = (await db.cards.where("journalDate").equals(date).toArray()).find((card) => card.state !== "trash");
  if (existing) return existing;
  const language = useAppStore.getState().language || "zh-TW";
  const localDate = new Date(`${date}T12:00:00`);
  return createCard({
    title: new Intl.DateTimeFormat(intlLocale[language], { year: "numeric", month: "long", day: "numeric" }).format(localDate),
    kind: "journal",
    state: "active",
    journalDate: date,
    journalTouched: false,
    contentHtml: `<h2>${translate(language, "journal.today")}</h2><p></p>`,
    color: "slate",
  });
}

export async function touchBoard(boardId: string) {
  await db.boards.update(boardId, { updatedAt: Date.now() });
}

export async function updateCardWithHistory(cardId: string, patch: Partial<CardRecord>) {
  return db.transaction("rw", [db.cards, db.cardVersions], async () => {
  const current = await db.cards.get(cardId);
  if (!current) return 0;
  const versions = await db.cardVersions.where("cardId").equals(cardId).toArray();
  const last = versions.sort((a, b) => b.createdAt - a.createdAt)[0];
  let versionAdded = false;
  if (!last || Date.now() - last.createdAt >= 180_000) {
    await db.cardVersions.add({
      id: crypto.randomUUID(),
      cardId,
      title: current.title,
      contentHtml: current.contentHtml,
      plainText: current.plainText,
      createdAt: Date.now(),
    });
    versionAdded = true;
  }
  const result = await db.cards.update(cardId, { ...patch, updatedAt: Math.max(Date.now(), current.updatedAt + 1) });
  if (versionAdded) await pruneCardVersions(cardId);
  return result;
  });
}

export async function pruneCardVersions(cardId: string, now = Date.now()) {
  const versions = (await db.cardVersions.where("cardId").equals(cardId).toArray()).sort((left, right) => right.createdAt - left.createdAt);
  if (versions.length <= 30) return 0;
  const keep = cardVersionIdsToKeep(versions, now);
  const expired = versions.filter((version) => !keep.has(version.id)).map((version) => version.id);
  if (expired.length) await db.cardVersions.bulkDelete(expired);
  return expired.length;
}

export function cardVersionIdsToKeep(versions: CardVersionRecord[], now = Date.now()) {
  const sorted = [...versions].sort((left, right) => right.createdAt - left.createdAt);
  const keep = new Set(sorted.slice(0, 30).map((version) => version.id));
  const daily = new Set<string>();
  const monthly = new Set<string>();
  const oneYear = 365 * 86_400_000;
  for (const version of sorted.slice(30)) {
    const date = new Date(version.createdAt);
    const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const monthKey = dayKey.slice(0, 7);
    if (now - version.createdAt <= oneYear) {
      if (daily.has(dayKey)) continue;
      daily.add(dayKey);
      keep.add(version.id);
    } else {
      if (monthly.has(monthKey)) continue;
      monthly.add(monthKey);
      keep.add(version.id);
    }
  }
  return keep;
}

export async function pruneUntouchedJournalDrafts(exceptJournalDate?: string) {
  const candidates = (await db.cards.where("kind").equals("journal").toArray()).filter((card) => {
    if (card.journalDate === exceptJournalDate || isMaterializedCard(card)) return false;
    return !card.favorite
      && !card.collectionId
      && !card.startAt
      && !card.dueAt
      && !card.sourceUrl
      && card.tagIds.length === 0
      && card.attachmentIds.length === 0
      && Object.keys(card.properties).length === 0;
  });
  if (!candidates.length) return 0;

  const candidateIds = candidates.map((card) => card.id);
  const cardReferences = candidateIds.map((id) => ["card", id] as ["card", string]);
  const [tasks, highlights, boardNodes, kanbanPlacements, shares, sourceEdges, targetEdges] = await Promise.all([
    db.tasks.where("cardId").anyOf(candidateIds).toArray(),
    db.highlights.where("cardId").anyOf(candidateIds).toArray(),
    db.boardNodes.where("cardId").anyOf(candidateIds).toArray(),
    db.kanbanPlacements.where("cardId").anyOf(candidateIds).toArray(),
    db.brainShares.where("[localType+localId]").anyOf(cardReferences).toArray(),
    db.brainEdges.where("[sourceType+sourceId]").anyOf(cardReferences).toArray(),
    db.brainEdges.where("[targetType+targetId]").anyOf(cardReferences).toArray(),
  ]);
  const protectedIds = new Set<string>();
  tasks.forEach((item) => item.cardId && protectedIds.add(item.cardId));
  highlights.forEach((item) => protectedIds.add(item.cardId));
  boardNodes.forEach((item) => item.cardId && protectedIds.add(item.cardId));
  kanbanPlacements.forEach((item) => protectedIds.add(item.cardId));
  shares.forEach((item) => protectedIds.add(item.localId));
  sourceEdges.forEach((item) => protectedIds.add(item.sourceId));
  targetEdges.forEach((item) => protectedIds.add(item.targetId));

  const removableIds = candidateIds.filter((id) => !protectedIds.has(id));
  if (!removableIds.length) return 0;
  await db.transaction("rw", [db.cards, db.cardVersions], async () => {
    await db.cardVersions.where("cardId").anyOf(removableIds).delete();
    await db.cards.bulkDelete(removableIds);
  });
  return removableIds.length;
}

export async function pruneAllCardVersions() {
  const cardIds = await db.cardVersions.orderBy("cardId").uniqueKeys();
  let removed = 0;
  for (const cardId of cardIds) {
    removed += await db.transaction("rw", db.cardVersions, (transaction) => {
      ignoreTransactionHistory(transaction);
      return pruneCardVersions(String(cardId));
    });
  }
  return removed;
}

export async function restoreCardVersion(versionId: string) {
  const version = await db.cardVersions.get(versionId);
  if (!version) throw new Error(translate(useAppStore.getState().language || "zh-TW", "db.versionMissing"));
  await updateCardWithHistory(version.cardId, { title: version.title, contentHtml: version.contentHtml, plainText: version.plainText });
}

export async function createFragment(text: string, tagIds: string[] = []): Promise<FragmentRecord> {
  const timestamp = Date.now();
  const fragment: FragmentRecord = {
    id: crypto.randomUUID(),
    text: text.trim(),
    pinned: false,
    tagIds: [...new Set(tagIds)],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  if (!fragment.text) throw new Error(translate(useAppStore.getState().language || "zh-TW", "db.fragmentEmpty"));
  await db.fragments.add(fragment);
  return fragment;
}

export async function moveCardToTrash(cardId: string) {
  return db.cards.update(cardId, { state: "trash", deletedAt: Date.now(), updatedAt: Date.now() });
}

export async function restoreCardFromTrash(cardId: string) {
  return db.cards.update(cardId, { state: "active", deletedAt: undefined, updatedAt: Date.now() });
}

export async function deleteCardPermanently(cardId: string) {
  const card = await db.cards.get(cardId);
  if (!card) return;
  const linkedTasks = await db.tasks.where("cardId").equals(cardId).toArray();
  const linkedTaskIds = new Set(linkedTasks.map((task) => task.id));
  const nodes = await db.boardNodes.where("cardId").equals(cardId).toArray();
  const nodeIds = new Set(nodes.map((node) => node.id));
  const boardEdges = await db.boardEdges.filter((edge) => nodeIds.has(edge.source) || nodeIds.has(edge.target)).toArray();
  const brainEdges = await db.brainEdges.filter((edge) =>
    (edge.sourceType === "card" && edge.sourceId === cardId) ||
    (edge.targetType === "card" && edge.targetId === cardId) ||
    (edge.sourceType === "task" && linkedTaskIds.has(edge.sourceId)) ||
    (edge.targetType === "task" && linkedTaskIds.has(edge.targetId)),
  ).toArray();
  const otherCards = await db.cards.filter((item) => item.id !== cardId).toArray();
  const sharedAttachmentIds = new Set(otherCards.flatMap((item) => item.attachmentIds));
  const exclusiveAttachmentIds = card.attachmentIds.filter((id) => !sharedAttachmentIds.has(id));
  const exclusiveAttachments = (await db.attachments.bulkGet(exclusiveAttachmentIds)).filter(Boolean) as AttachmentRecord[];

  await db.transaction(
    "rw",
    [db.cards, db.boardNodes, db.boardEdges, db.kanbanPlacements, db.cardVersions, db.tasks, db.highlights, db.attachments, db.brainEdges],
    async () => {
      await db.boardEdges.bulkDelete(boardEdges.map((edge) => edge.id));
      await db.boardNodes.bulkDelete(nodes.map((node) => node.id));
      await db.kanbanPlacements.where("cardId").equals(cardId).delete();
      await db.cardVersions.where("cardId").equals(cardId).delete();
      await db.tasks.where("cardId").equals(cardId).delete();
      await db.highlights.where("cardId").equals(cardId).delete();
      await db.attachments.bulkDelete(exclusiveAttachmentIds);
      await db.brainEdges.bulkDelete(brainEdges.map((edge) => edge.id));
      await db.cards.delete(cardId);
    },
  );
  if (typeof window !== "undefined") await Promise.all(exclusiveAttachments.map((attachment) => attachment.storage === "file" && attachment.relativePath ? window.chengjing?.attachments?.remove(attachment.relativePath).catch(() => {}) : undefined));
}

export async function deleteFragmentPermanently(fragmentId: string) {
  const brainEdges = await db.brainEdges.filter((edge) =>
    (edge.sourceType === "fragment" && edge.sourceId === fragmentId) ||
    (edge.targetType === "fragment" && edge.targetId === fragmentId),
  ).toArray();
  await db.transaction("rw", [db.fragments, db.brainEdges], async () => {
    await db.brainEdges.bulkDelete(brainEdges.map((edge) => edge.id));
    await db.fragments.delete(fragmentId);
  });
}

export async function deleteBoardPermanently(boardId: string) {
  const brainEdges = await db.brainEdges.filter((edge) =>
    (edge.sourceType === "board" && edge.sourceId === boardId) ||
    (edge.targetType === "board" && edge.targetId === boardId),
  ).toArray();
  await db.transaction("rw", [db.boards, db.boardNodes, db.boardEdges, db.brainEdges], async () => {
    await db.boardEdges.where("boardId").equals(boardId).delete();
    await db.boardNodes.where("boardId").equals(boardId).delete();
    await db.brainEdges.bulkDelete(brainEdges.map((edge) => edge.id));
    await db.boards.delete(boardId);
  });
}
