import { createCard, db } from "../db";
import { useAppStore } from "../store";
import type { BrainContentType, BrainRelationType, CardRecord, TaskRecord } from "../types";
import { richHtmlFromPlainText } from "./boardContent";
import { runGlobalHistoryAction } from "./globalHistory";
import { createKanbanBoard, createKanbanList, moveKanbanPlacement, placeCardOnKanban } from "./kanban";
import { searchQueryTerms } from "./searchIndex";
import { dueDateInputToTimestamp, updateTaskEverywhere } from "./taskSync";

export type McpWorkspaceTool =
  | "chengjing_status" | "chengjing_search" | "chengjing_get_item"
  | "chengjing_create_note" | "chengjing_update_note"
  | "chengjing_create_task" | "chengjing_update_task"
  | "chengjing_create_whiteboard" | "chengjing_update_whiteboard" | "chengjing_add_whiteboard_item" | "chengjing_move_whiteboard_item"
  | "chengjing_create_kanban" | "chengjing_update_kanban"
  | "chengjing_create_neuron" | "chengjing_connect_neurons";

export interface McpWorkspaceRequest { requestId: string; tool: McpWorkspaceTool; arguments: Record<string, unknown> }

const writeTools = new Set<McpWorkspaceTool>([
  "chengjing_create_note", "chengjing_update_note", "chengjing_create_task", "chengjing_update_task",
  "chengjing_create_whiteboard", "chengjing_update_whiteboard", "chengjing_add_whiteboard_item", "chengjing_move_whiteboard_item",
  "chengjing_create_kanban", "chengjing_update_kanban", "chengjing_create_neuron", "chengjing_connect_neurons",
]);

export function isMcpWorkspaceWrite(tool: McpWorkspaceTool) { return writeTools.has(tool); }

function text(value: unknown, maximum = 20_000) { return typeof value === "string" ? value.trim().slice(0, maximum) : ""; }
function identifier(value: unknown) { return text(value, 180); }
function numberValue(value: unknown, fallback = 0, minimum = -20_000, maximum = 20_000) { const number = Number(value); return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback; }
function booleanValue(value: unknown, fallback = false) { return typeof value === "boolean" ? value : fallback; }
function cleanDate(value: unknown) { const date = text(value, 10); return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ""; }
function localeLower(value: string) { return value.toLocaleLowerCase(useAppStore.getState().language || "zh-TW"); }
function matchesQuery(value: string, query: string, terms: string[]) { const haystack = localeLower(value); return haystack.includes(localeLower(query)) || (terms.length > 0 && terms.every((term) => haystack.includes(localeLower(term)))); }
function compactCard(card: CardRecord, contentLimit = 4_000) { return { type: "note", id: card.id, title: card.title, content: card.plainText.slice(0, contentLimit), contentTruncated: card.plainText.length > contentLimit, kind: card.kind, state: card.state, favorite: card.favorite, tagIds: card.tagIds, collectionId: card.collectionId, createdAt: card.createdAt, updatedAt: card.updatedAt }; }
function assertExpected(type: string, id: string, current: number, expected: unknown) {
  const value = Number(expected);
  if (!Number.isFinite(value) || value !== current) throw new Error(`mcp-conflict:${type}:${id}:${current}`);
}
function nextUpdatedAt(current: number) { return Math.max(Date.now(), current + 1); }
function requireText(value: unknown, code: string, maximum: number) { const result = text(value, maximum); if (!result) throw new Error(code); return result; }

async function workspaceStatus() {
  const [notes, whiteboards, kanban, tasks, fragments, relations] = await Promise.all([
    db.cards.filter((card) => card.state !== "trash").count(), db.boards.count(), db.kanbanBoards.count(), db.tasks.count(), db.fragments.count(), db.brainEdges.count(),
  ]);
  return {
    app: "ChengJing", databaseVersion: db.verno, counts: { notes, whiteboards, kanban, tasks, fragments, relations },
    writeSafety: "Updates require the current updatedAt value. Permanent deletion is not exposed through MCP.",
    neuronModel: "Notes, whiteboards, tasks and fragments are neurons. connect_neurons creates an explicit relationship between them.",
  };
}

async function workspaceSearch(args: Record<string, unknown>) {
  const query = requireText(args.query, "mcp-query-required", 500);
  const requested = Array.isArray(args.types) ? new Set(args.types.map((item) => String(item))) : new Set(["note", "whiteboard", "kanban", "task", "fragment"]);
  const limit = Math.floor(numberValue(args.limit, 20, 1, 50));
  const terms = searchQueryTerms(query, useAppStore.getState().language || "zh-TW");
  const results: Array<Record<string, unknown>> = [];
  if (requested.has("note") && terms.length) {
    const values = await db.cards.where("searchTerms").anyOf(terms).distinct().limit(limit * 5).toArray();
    for (const card of values) if (card.state !== "trash" && matchesQuery(`${card.title} ${card.plainText}`, query, terms)) results.push({ ...compactCard(card, 700), excerpt: card.plainText.slice(0, 700) });
  }
  if (requested.has("task") && terms.length) {
    const values = await db.tasks.where("searchTerms").anyOf(terms).distinct().limit(limit * 4).toArray();
    for (const task of values) if (matchesQuery(task.title, query, terms)) results.push({ type: "task", id: task.id, title: task.title, done: task.done, cardId: task.cardId, parentTaskId: task.parentTaskId, dueAt: task.dueAt, createdAt: task.createdAt, updatedAt: task.updatedAt });
  }
  if (requested.has("fragment") && terms.length) {
    const values = await db.fragments.where("searchTerms").anyOf(terms).distinct().limit(limit * 4).toArray();
    for (const fragment of values) if (matchesQuery(fragment.text, query, terms)) results.push({ type: "fragment", id: fragment.id, text: fragment.text.slice(0, 900), pinned: fragment.pinned, tagIds: fragment.tagIds, createdAt: fragment.createdAt, updatedAt: fragment.updatedAt });
  }
  if (requested.has("whiteboard")) {
    const values = await db.boards.orderBy("updatedAt").reverse().limit(300).toArray();
    for (const board of values) if (matchesQuery(`${board.title} ${board.description}`, query, terms)) results.push({ type: "whiteboard", id: board.id, title: board.title, description: board.description.slice(0, 800), updatedAt: board.updatedAt });
  }
  if (requested.has("kanban")) {
    const values = await db.kanbanBoards.orderBy("updatedAt").reverse().limit(200).toArray();
    for (const board of values) if (matchesQuery(`${board.title} ${board.description}`, query, terms)) results.push({ type: "kanban", id: board.id, title: board.title, description: board.description.slice(0, 800), updatedAt: board.updatedAt });
  }
  results.sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
  return { query, results: results.slice(0, limit), hasMore: results.length > limit };
}

async function getItem(args: Record<string, unknown>) {
  const type = text(args.type, 30); const id = identifier(args.id);
  if (!id) throw new Error("mcp-id-required");
  if (type === "note") { const item = await db.cards.get(id); if (!item || item.state === "trash") throw new Error("mcp-item-not-found"); return compactCard(item, 100_000); }
  if (type === "task") { const item = await db.tasks.get(id); if (!item) throw new Error("mcp-item-not-found"); const children = await db.tasks.where("parentTaskId").equals(id).toArray(); return { type, ...item, children: children.map((child) => ({ id: child.id, title: child.title, done: child.done, updatedAt: child.updatedAt })) }; }
  if (type === "fragment") { const item = await db.fragments.get(id); if (!item) throw new Error("mcp-item-not-found"); return { type, ...item, searchTerms: undefined }; }
  if (type === "whiteboard") {
    const board = await db.boards.get(id); if (!board) throw new Error("mcp-item-not-found");
    const [nodes, edges] = await Promise.all([db.boardNodes.where("boardId").equals(id).toArray(), db.boardEdges.where("boardId").equals(id).toArray()]);
    const cardIds = [...new Set(nodes.map((node) => node.cardId).filter(Boolean) as string[])];
    const cards = await db.cards.bulkGet(cardIds);
    const cardMap = new Map(cards.filter(Boolean).map((card) => [card!.id, compactCard(card!, 1_500)]));
    return { type, ...board, nodes: nodes.slice(0, 300).map((node) => ({ ...node, note: node.cardId ? cardMap.get(node.cardId) : undefined })), edges: edges.slice(0, 500), truncated: nodes.length > 300 || edges.length > 500 };
  }
  if (type === "kanban") {
    const board = await db.kanbanBoards.get(id); if (!board) throw new Error("mcp-item-not-found");
    const [lists, placements] = await Promise.all([db.kanbanLists.where("boardId").equals(id).sortBy("order"), db.kanbanPlacements.where("boardId").equals(id).sortBy("order")]);
    const cards = await db.cards.bulkGet([...new Set(placements.map((item) => item.cardId))]);
    const cardMap = new Map(cards.filter(Boolean).map((card) => [card!.id, compactCard(card!, 1_000)]));
    return { type, ...board, lists: lists.slice(0, 100), placements: placements.slice(0, 300).map((item) => ({ ...item, note: cardMap.get(item.cardId) })), truncated: lists.length > 100 || placements.length > 300 };
  }
  if (type === "neuron") {
    const neuronType = text(args.neuronType, 20) as BrainContentType;
    const entity = await brainEntity(neuronType, id); if (!entity) throw new Error("mcp-item-not-found");
    const [outgoing, incoming] = await Promise.all([db.brainEdges.where("[sourceType+sourceId]").equals([neuronType, id]).toArray(), db.brainEdges.where("[targetType+targetId]").equals([neuronType, id]).toArray()]);
    return { type, neuronType, entity, relations: [...outgoing, ...incoming].slice(0, 200), truncated: outgoing.length + incoming.length > 200 };
  }
  throw new Error("mcp-item-type-invalid");
}

async function createNote(args: Record<string, unknown>) {
  const title = requireText(args.title, "mcp-title-required", 240); const content = text(args.content, 100_000);
  const collectionId = identifier(args.collectionId) || undefined;
  if (collectionId) { const collection = await db.knowledgeGroups.get(collectionId); if (!collection || collection.kind !== "topic") throw new Error("mcp-collection-not-found"); }
  const card = await createCard({ title, contentHtml: richHtmlFromPlainText(content, useAppStore.getState().language || "zh-TW"), plainText: content, state: "active", favorite: booleanValue(args.favorite), color: "slate", collectionId });
  return compactCard(card);
}

async function updateNote(args: Record<string, unknown>) {
  const id = identifier(args.id); const card = await db.cards.get(id);
  if (!card || card.state === "trash") throw new Error("mcp-item-not-found");
  assertExpected("note", id, card.updatedAt, args.expectedUpdatedAt);
  const timestamp = nextUpdatedAt(card.updatedAt); const patch: Partial<CardRecord> = { updatedAt: timestamp };
  if (typeof args.title === "string") patch.title = requireText(args.title, "mcp-title-required", 240);
  if (typeof args.content === "string") {
    const incoming = text(args.content, 100_000); const replace = args.contentMode === "replace";
    patch.plainText = replace ? incoming : `${card.plainText}\n\n${incoming}`.trim();
    patch.contentHtml = richHtmlFromPlainText(patch.plainText, useAppStore.getState().language || "zh-TW");
  }
  if (typeof args.favorite === "boolean") patch.favorite = args.favorite;
  if (Object.keys(patch).length === 1) throw new Error("mcp-no-changes");
  await db.transaction("rw", [db.cards, db.cardVersions], async () => {
    await db.cardVersions.add({ id: crypto.randomUUID(), cardId: card.id, title: card.title, contentHtml: card.contentHtml, plainText: card.plainText, createdAt: timestamp });
    await db.cards.update(id, patch);
  });
  return compactCard({ ...card, ...patch } as CardRecord);
}

async function createTask(args: Record<string, unknown>) {
  const title = requireText(args.title, "mcp-title-required", 240); const timestamp = Date.now();
  let cardId = identifier(args.cardId) || undefined; const parentTaskId = identifier(args.parentTaskId) || undefined;
  if (cardId && !(await db.cards.get(cardId))) throw new Error("mcp-card-not-found");
  const parent = parentTaskId ? await db.tasks.get(parentTaskId) : undefined;
  if (parentTaskId && !parent) throw new Error("mcp-parent-task-not-found");
  if (!cardId && parent?.cardId) cardId = parent.cardId;
  const dueDate = cleanDate(args.dueDate);
  const task: TaskRecord = { id: crypto.randomUUID(), title, done: false, cardId, parentTaskId, dueAt: dueDate ? dueDateInputToTimestamp(dueDate) : parent?.dueAt, createdAt: timestamp, updatedAt: timestamp };
  await db.tasks.add(task); return { type: "task", ...task };
}

async function updateTask(args: Record<string, unknown>) {
  const id = identifier(args.id); const task = await db.tasks.get(id); if (!task) throw new Error("mcp-item-not-found");
  assertExpected("task", id, task.updatedAt, args.expectedUpdatedAt);
  const patch: { title?: string; done?: boolean; dueAt?: number | undefined } = {};
  if (typeof args.title === "string") patch.title = requireText(args.title, "mcp-title-required", 240);
  if (typeof args.done === "boolean") patch.done = args.done;
  if (Object.prototype.hasOwnProperty.call(args, "dueDate")) { const dueDate = cleanDate(args.dueDate); patch.dueAt = dueDate ? dueDateInputToTimestamp(dueDate) : undefined; }
  if (Object.keys(patch).length === 0) throw new Error("mcp-no-changes");
  await updateTaskEverywhere(id, patch); let updated = await db.tasks.get(id);
  if (updated && updated.updatedAt <= task.updatedAt) { await db.tasks.update(id, { updatedAt: task.updatedAt + 1 }); updated = await db.tasks.get(id); }
  return { type: "task", ...updated };
}

async function createWhiteboard(args: Record<string, unknown>) {
  const timestamp = Date.now(); const board = { id: crypto.randomUUID(), title: requireText(args.title, "mcp-title-required", 240), description: text(args.description, 10_000), favorite: booleanValue(args.favorite), tagIds: [] as string[], createdAt: timestamp, updatedAt: timestamp };
  await db.boards.add(board); return { type: "whiteboard", ...board };
}

async function updateWhiteboard(args: Record<string, unknown>) {
  const id = identifier(args.id); const board = await db.boards.get(id); if (!board) throw new Error("mcp-item-not-found"); assertExpected("whiteboard", id, board.updatedAt, args.expectedUpdatedAt);
  const patch = { updatedAt: nextUpdatedAt(board.updatedAt), ...(typeof args.title === "string" ? { title: requireText(args.title, "mcp-title-required", 240) } : {}), ...(typeof args.description === "string" ? { description: text(args.description, 10_000) } : {}), ...(typeof args.favorite === "boolean" ? { favorite: args.favorite } : {}) };
  if (Object.keys(patch).length === 1) throw new Error("mcp-no-changes");
  await db.boards.update(id, patch); return { type: "whiteboard", ...board, ...patch };
}

async function addWhiteboardItem(args: Record<string, unknown>) {
  const boardId = identifier(args.boardId); const board = await db.boards.get(boardId); if (!board) throw new Error("mcp-item-not-found"); assertExpected("whiteboard", boardId, board.updatedAt, args.expectedUpdatedAt);
  const kind = text(args.kind, 30); const timestamp = nextUpdatedAt(board.updatedAt); const nodeId = crypto.randomUUID(); const x = numberValue(args.x, 120); const y = numberValue(args.y, 120);
  let card: CardRecord | undefined;
  await db.transaction("rw", [db.cards, db.boardNodes, db.boards], async () => {
    if (kind === "existing_note") { const noteId = identifier(args.noteId); card = await db.cards.get(noteId); if (!card || card.state === "trash") throw new Error("mcp-card-not-found"); }
    else if (kind === "note") card = await createCard({ title: requireText(args.title, "mcp-title-required", 240), plainText: text(args.content, 100_000), contentHtml: richHtmlFromPlainText(text(args.content, 100_000), useAppStore.getState().language || "zh-TW"), state: "active", color: "slate" });
    if (card) await db.boardNodes.add({ id: nodeId, boardId, kind: "card", cardId: card.id, x, y, width: numberValue(args.width, 265, 120, 1_200), height: numberValue(args.height, 220, 80, 1_200) });
    else if (kind === "text") await db.boardNodes.add({ id: nodeId, boardId, kind: "text", text: requireText(args.text, "mcp-text-required", 8_000), x, y, width: numberValue(args.width, 300, 80, 1_200), height: numberValue(args.height, 100, 50, 1_200) });
    else if (kind === "section") await db.boardNodes.add({ id: nodeId, boardId, kind: "section", title: requireText(args.title, "mcp-title-required", 240), x, y, width: numberValue(args.width, 660, 180, 2_000), height: numberValue(args.height, 440, 120, 2_000) });
    else throw new Error("mcp-whiteboard-item-kind-invalid");
    await db.boards.update(boardId, { updatedAt: timestamp });
  });
  return { type: "whiteboard_item", id: nodeId, boardId, kind, noteId: card?.id, updatedAt: timestamp };
}

async function moveWhiteboardItem(args: Record<string, unknown>) {
  const id = identifier(args.id); const node = await db.boardNodes.get(id); if (!node) throw new Error("mcp-item-not-found"); const board = await db.boards.get(node.boardId); if (!board) throw new Error("mcp-item-not-found"); assertExpected("whiteboard", board.id, board.updatedAt, args.expectedBoardUpdatedAt);
  const patch = { ...(Number.isFinite(Number(args.x)) ? { x: numberValue(args.x) } : {}), ...(Number.isFinite(Number(args.y)) ? { y: numberValue(args.y) } : {}), ...(Number.isFinite(Number(args.width)) ? { width: numberValue(args.width, node.width || 260, 50, 2_000) } : {}), ...(Number.isFinite(Number(args.height)) ? { height: numberValue(args.height, node.height || 180, 40, 2_000) } : {}) };
  if (Object.keys(patch).length === 0) throw new Error("mcp-no-changes");
  await db.transaction("rw", [db.boardNodes, db.boards], async () => { await db.boardNodes.update(id, patch); await db.boards.update(board.id, { updatedAt: nextUpdatedAt(board.updatedAt) }); });
  return { type: "whiteboard_item", ...node, ...patch, boardUpdatedAt: (await db.boards.get(board.id))?.updatedAt };
}

async function createKanban(args: Record<string, unknown>) {
  const title = requireText(args.title, "mcp-title-required", 240); const lists = Array.isArray(args.lists) ? args.lists.map((item) => text(item, 120)).filter(Boolean).slice(0, 12) : [];
  const defaults = { "zh-TW": ["待處理", "進行中", "完成"], "zh-CN": ["待处理", "进行中", "完成"], en: ["To do", "Doing", "Done"], ja: ["未着手", "進行中", "完了"], ko: ["할 일", "진행 중", "완료"] } as const;
  const language = useAppStore.getState().language || "zh-TW";
  const board = await createKanbanBoard(title, lists.length ? lists : [...defaults[language]]);
  if (typeof args.description === "string") { const description = text(args.description, 10_000); await db.kanbanBoards.update(board.id, { description, updatedAt: Date.now() }); return { type: "kanban", ...board, description, updatedAt: (await db.kanbanBoards.get(board.id))!.updatedAt, lists: await db.kanbanLists.where("boardId").equals(board.id).sortBy("order") }; }
  return { type: "kanban", ...board, lists: await db.kanbanLists.where("boardId").equals(board.id).sortBy("order") };
}

async function updateKanban(args: Record<string, unknown>) {
  const boardId = identifier(args.boardId); const board = await db.kanbanBoards.get(boardId); if (!board) throw new Error("mcp-item-not-found"); assertExpected("kanban", boardId, board.updatedAt, args.expectedUpdatedAt);
  const operation = text(args.operation, 40);
  if (operation === "rename_board") {
    const patch = { title: requireText(args.title, "mcp-title-required", 240), ...(typeof args.description === "string" ? { description: text(args.description, 10_000) } : {}), updatedAt: nextUpdatedAt(board.updatedAt) }; await db.kanbanBoards.update(boardId, patch); return { type: "kanban", ...board, ...patch };
  }
  if (operation === "add_list") { const list = await createKanbanList(boardId, requireText(args.title, "mcp-title-required", 120)); const next = await db.kanbanBoards.get(boardId); if (next && next.updatedAt <= board.updatedAt) await db.kanbanBoards.update(boardId, { updatedAt: board.updatedAt + 1 }); return { type: "kanban_list", ...list, boardUpdatedAt: (await db.kanbanBoards.get(boardId))!.updatedAt }; }
  if (operation === "rename_list") {
    const listId = identifier(args.listId); const list = await db.kanbanLists.get(listId); if (!list || list.boardId !== boardId) throw new Error("mcp-list-not-found"); const timestamp = nextUpdatedAt(board.updatedAt); await db.transaction("rw", [db.kanbanLists, db.kanbanBoards], async () => { await db.kanbanLists.update(listId, { title: requireText(args.title, "mcp-title-required", 120), updatedAt: timestamp }); await db.kanbanBoards.update(boardId, { updatedAt: timestamp }); }); return { type: "kanban_list", ...list, title: text(args.title, 120), updatedAt: timestamp, boardUpdatedAt: timestamp };
  }
  if (operation === "place_note") {
    const listId = identifier(args.listId); const noteId = identifier(args.noteId); const [list, note] = await Promise.all([db.kanbanLists.get(listId), db.cards.get(noteId)]); if (!list || list.boardId !== boardId) throw new Error("mcp-list-not-found"); if (!note || note.state === "trash") throw new Error("mcp-card-not-found");
    const existing = await db.kanbanPlacements.where("boardId").equals(boardId).filter((placement) => placement.cardId === noteId).first();
    if (existing) return { type: "kanban_placement", ...existing, created: false, boardUpdatedAt: board.updatedAt };
    const placement = await placeCardOnKanban(boardId, listId, noteId); const next = await db.kanbanBoards.get(boardId); if (next && next.updatedAt <= board.updatedAt) await db.kanbanBoards.update(boardId, { updatedAt: board.updatedAt + 1 }); return { type: "kanban_placement", ...placement, created: true, boardUpdatedAt: (await db.kanbanBoards.get(boardId))!.updatedAt };
  }
  if (operation === "move_note") {
    const placementId = identifier(args.placementId); const listId = identifier(args.listId); const [placement, list] = await Promise.all([db.kanbanPlacements.get(placementId), db.kanbanLists.get(listId)]); if (!placement || placement.boardId !== boardId) throw new Error("mcp-placement-not-found"); if (!list || list.boardId !== boardId) throw new Error("mcp-list-not-found"); await moveKanbanPlacement(placementId, listId, Math.floor(numberValue(args.index, Number.MAX_SAFE_INTEGER, 0, 100_000))); const next = await db.kanbanBoards.get(boardId); if (next && next.updatedAt <= board.updatedAt) await db.kanbanBoards.update(boardId, { updatedAt: board.updatedAt + 1 }); return { type: "kanban_placement", ...(await db.kanbanPlacements.get(placementId)), boardUpdatedAt: (await db.kanbanBoards.get(boardId))!.updatedAt };
  }
  throw new Error("mcp-kanban-operation-invalid");
}

async function brainEntity(type: BrainContentType, id: string) {
  if (type === "card") { const value = await db.cards.get(id); return value && value.state !== "trash" ? compactCard(value, 6_000) : null; }
  if (type === "board") { const value = await db.boards.get(id); return value ? { type: "whiteboard", ...value } : null; }
  if (type === "task") { const value = await db.tasks.get(id); return value ? { type: "task", ...value } : null; }
  if (type === "fragment") { const value = await db.fragments.get(id); return value ? { type: "fragment", ...value, searchTerms: undefined } : null; }
  return null;
}

async function createNeuron(args: Record<string, unknown>) {
  const type = text(args.type, 30);
  if (type === "note") return createNote(args);
  if (type === "task") return createTask(args);
  if (type === "fragment") { const value = requireText(args.content, "mcp-content-required", 20_000); const timestamp = Date.now(); const fragment = { id: crypto.randomUUID(), text: value, pinned: booleanValue(args.pinned), tagIds: [] as string[], createdAt: timestamp, updatedAt: timestamp }; await db.fragments.add(fragment); return { type: "fragment", ...fragment }; }
  if (type === "whiteboard") return createWhiteboard(args);
  throw new Error("mcp-neuron-type-invalid");
}

async function connectNeurons(args: Record<string, unknown>) {
  const sourceType = text(args.sourceType, 20) as BrainContentType; const targetType = text(args.targetType, 20) as BrainContentType; const sourceId = identifier(args.sourceId); const targetId = identifier(args.targetId);
  if (!sourceId || !targetId || (sourceType === targetType && sourceId === targetId)) throw new Error("mcp-neuron-reference-invalid");
  if (!(await brainEntity(sourceType, sourceId)) || !(await brainEntity(targetType, targetId))) throw new Error("mcp-item-not-found");
  const relationType = text(args.relationType, 40) as BrainRelationType;
  const allowedRelations = new Set<BrainRelationType>(["semantic", "shared_context", "possible_influence", "goal_obstacle", "sequence", "contrast", "reinforcement"]);
  if (!allowedRelations.has(relationType)) throw new Error("mcp-relation-type-invalid");
  const duplicate = await db.brainEdges.where("[sourceType+sourceId]").equals([sourceType, sourceId]).filter((edge) => edge.targetType === targetType && edge.targetId === targetId && edge.relationType === relationType).first();
  if (duplicate) return { type: "neuron_relation", ...duplicate, created: false };
  const edge = { id: crypto.randomUUID(), sourceType, sourceId, targetType, targetId, origin: "manual" as const, reason: text(args.reason, 2_000), relationType, createdAt: Date.now() };
  await db.brainEdges.add(edge); return { type: "neuron_relation", ...edge, created: true };
}

async function executeWrite(tool: McpWorkspaceTool, args: Record<string, unknown>) {
  if (tool === "chengjing_create_note") return createNote(args);
  if (tool === "chengjing_update_note") return updateNote(args);
  if (tool === "chengjing_create_task") return createTask(args);
  if (tool === "chengjing_update_task") return updateTask(args);
  if (tool === "chengjing_create_whiteboard") return createWhiteboard(args);
  if (tool === "chengjing_update_whiteboard") return updateWhiteboard(args);
  if (tool === "chengjing_add_whiteboard_item") return addWhiteboardItem(args);
  if (tool === "chengjing_move_whiteboard_item") return moveWhiteboardItem(args);
  if (tool === "chengjing_create_kanban") return createKanban(args);
  if (tool === "chengjing_update_kanban") return updateKanban(args);
  if (tool === "chengjing_create_neuron") return createNeuron(args);
  if (tool === "chengjing_connect_neurons") return connectNeurons(args);
  throw new Error("mcp-tool-unsupported");
}

export async function handleMcpWorkspaceRequest(request: McpWorkspaceRequest) {
  if (request.tool === "chengjing_status") return workspaceStatus();
  if (request.tool === "chengjing_search") return workspaceSearch(request.arguments);
  if (request.tool === "chengjing_get_item") return getItem(request.arguments);
  if (!isMcpWorkspaceWrite(request.tool)) throw new Error("mcp-tool-unsupported");
  return runGlobalHistoryAction(() => executeWrite(request.tool, request.arguments));
}
