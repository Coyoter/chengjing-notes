import { db } from "../db";
import type { TaskRecord } from "../types";

export interface EditorTaskSnapshot {
  sourceTaskId: string;
  title: string;
  done: boolean;
}

function taskTitle(item: Element) {
  const content = item.querySelector(":scope > div") || item;
  const clone = content.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('ul[data-type="taskList"], label').forEach((element) => element.remove());
  return (clone.textContent || "").replace(/\s+/g, " ").trim();
}

function createTaskSourceId() {
  return crypto.randomUUID();
}

export function editorTaskRecordId(cardId: string, sourceTaskId: string) {
  return `editor:${cardId}:${sourceTaskId}`;
}

export function normalizeEditorTaskHtml(html: string, createId: () => string = createTaskSourceId) {
  const document = new DOMParser().parseFromString(html || "<p></p>", "text/html");
  const seen = new Set<string>();
  const tasks: EditorTaskSnapshot[] = [];
  document.body.querySelectorAll('ul[data-type="taskList"] li').forEach((item) => {
    let sourceTaskId = (item.getAttribute("data-task-id") || "").trim();
    if (!sourceTaskId || seen.has(sourceTaskId)) {
      sourceTaskId = createId();
      item.setAttribute("data-task-id", sourceTaskId);
    }
    seen.add(sourceTaskId);
    const title = taskTitle(item);
    if (title) tasks.push({ sourceTaskId, title, done: item.getAttribute("data-checked") === "true" });
  });
  return { html: document.body.innerHTML || "<p></p>", tasks };
}

export function dueDateInputToTimestamp(value: string) {
  const matched = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return undefined;
  const year = Number(matched[1]);
  const month = Number(matched[2]) - 1;
  const day = Number(matched[3]);
  const date = new Date(year, month, day, 12);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) && date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? timestamp : undefined;
}

export function timestampToDueDateInput(value: number | undefined) {
  if (!value || !Number.isFinite(value)) return "";
  const date = new Date(value);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function deleteTaskBrainEdges(taskIds: string[]) {
  if (!taskIds.length) return;
  const ids = new Set(taskIds);
  await db.brainEdges.filter((edge) => (edge.sourceType === "task" && ids.has(edge.sourceId)) || (edge.targetType === "task" && ids.has(edge.targetId))).delete();
}

export async function syncCardTasksFromHtml(cardId: string, html: string) {
  const card = await db.cards.get(cardId);
  if (!card) return normalizeEditorTaskHtml(html);
  const normalized = normalizeEditorTaskHtml(html);
  const existing = (await db.tasks.where("cardId").equals(cardId).toArray()).filter((task) => Boolean(task.sourceTaskId));
  const bySource = new Map(existing.map((task) => [task.sourceTaskId!, task]));
  const activeSources = new Set(normalized.tasks.map((task) => task.sourceTaskId));
  const timestamp = Date.now();

  await db.transaction("rw", [db.cards, db.tasks, db.brainEdges], async () => {
    if (normalized.html !== html) await db.cards.update(cardId, { contentHtml: normalized.html, taskSyncState: "synced" });
    for (const snapshot of normalized.tasks) {
      const previous = bySource.get(snapshot.sourceTaskId);
      const changed = !previous || previous.title !== snapshot.title || previous.done !== snapshot.done;
      const record: TaskRecord = {
        id: previous?.id || editorTaskRecordId(cardId, snapshot.sourceTaskId),
        title: snapshot.title,
        done: snapshot.done,
        cardId,
        sourceTaskId: snapshot.sourceTaskId,
        dueAt: previous?.dueAt,
        createdAt: previous?.createdAt || timestamp,
        updatedAt: changed ? timestamp : previous.updatedAt,
      };
      await db.tasks.put(record);
    }
    const removed = existing.filter((task) => !activeSources.has(task.sourceTaskId!));
    if (removed.length) {
      const removedIds = removed.map((task) => task.id);
      await deleteTaskBrainEdges(removedIds);
      await db.tasks.bulkDelete(removedIds);
    }
    if (normalized.html === html) await db.cards.update(cardId, { taskSyncState: "synced" });
  });
  return normalized;
}

export async function syncAllCardTasks() {
  const cards = await db.cards.toArray();
  const availableCards = cards.filter((item) => item.state !== "trash");
  for (const card of availableCards) await syncCardTasksFromHtml(card.id, card.contentHtml);
  const availableCardIds = new Set(availableCards.map((item) => item.id));
  const stale = await db.tasks.filter((task) => Boolean(task.sourceTaskId) && (!task.cardId || !availableCardIds.has(task.cardId))).toArray();
  if (stale.length) await db.transaction("rw", [db.tasks, db.brainEdges], async () => {
    const staleIds = stale.map((task) => task.id);
    await deleteTaskBrainEdges(staleIds);
    await db.tasks.bulkDelete(staleIds);
  });
}

export async function syncPendingCardTasks(batchSize = 40) {
  let synced = 0;
  while (true) {
    const cards = await db.cards.where("taskSyncState").equals("pending").limit(batchSize).toArray();
    if (!cards.length) break;
    for (const card of cards) {
      if (card.state === "trash") await db.cards.update(card.id, { taskSyncState: "synced" });
      else await syncCardTasksFromHtml(card.id, card.contentHtml);
      synced += 1;
    }
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  }
  return synced;
}

function findLinkedTaskItem(document: Document, sourceTaskId: string) {
  return [...document.body.querySelectorAll('ul[data-type="taskList"] li')].find((item) => item.getAttribute("data-task-id") === sourceTaskId) || null;
}

async function setTaskDoneDirect(taskId: string, done: boolean) {
  const task = await db.tasks.get(taskId);
  if (!task) return;
  const card = task.cardId && task.sourceTaskId ? await db.cards.get(task.cardId) : undefined;
  const timestamp = Date.now();
  if (!card || !task.sourceTaskId) {
    await db.tasks.update(task.id, { done, updatedAt: timestamp });
    return;
  }
  const document = new DOMParser().parseFromString(card.contentHtml, "text/html");
  const item = findLinkedTaskItem(document, task.sourceTaskId);
  if (!item) {
    await db.tasks.update(task.id, { done, updatedAt: timestamp });
    return;
  }
  item.setAttribute("data-checked", done ? "true" : "false");
  const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
  checkbox?.toggleAttribute("checked", done);
  if (checkbox) checkbox.checked = done;
  await db.transaction("rw", [db.cards, db.tasks], async () => {
    await db.cards.update(card.id, { contentHtml: document.body.innerHTML, updatedAt: timestamp });
    await db.tasks.update(task.id, { done, updatedAt: timestamp });
  });
}

export async function taskDescendants(taskId: string) {
  const descendants: TaskRecord[] = [];
  const visited = new Set<string>([taskId]);
  let frontier = [taskId];
  while (frontier.length) {
    const children = await db.tasks.where("parentTaskId").anyOf(frontier).toArray();
    const next: string[] = [];
    for (const child of children) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      descendants.push(child);
      next.push(child.id);
    }
    frontier = next;
  }
  return descendants;
}

async function reconcileTaskChain(taskId: string | undefined) {
  const visited = new Set<string>();
  let currentId = taskId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const current = await db.tasks.get(currentId);
    if (!current) break;
    const children = await db.tasks.where("parentTaskId").equals(current.id).toArray();
    if (children.length) {
      const done = children.every((child) => child.done);
      if (current.done !== done) await setTaskDoneDirect(current.id, done);
    }
    currentId = current.parentTaskId;
  }
}

export async function createTaskChild(parentTaskId: string, value: string) {
  const parent = await db.tasks.get(parentTaskId);
  if (!parent) throw new Error("parent-task-missing");
  const title = value.replace(/\s+/g, " ").trim().slice(0, 240);
  if (!title) throw new Error("empty-task-title");
  const siblings = await db.tasks.where("parentTaskId").equals(parent.id).toArray();
  const existing = siblings.find((task) => !task.done && task.title === title);
  if (existing) return { task: existing, created: false };
  const timestamp = Date.now();
  const task: TaskRecord = {
    id: crypto.randomUUID(),
    title,
    done: false,
    cardId: parent.cardId,
    parentTaskId: parent.id,
    dueAt: parent.dueAt,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.tasks.add(task);
  await reconcileTaskChain(parent.id);
  return { task, created: true };
}

export async function setTaskDone(taskId: string, done: boolean) {
  const task = await db.tasks.get(taskId);
  if (!task) return;
  if (done) {
    const descendants = await taskDescendants(task.id);
    for (const descendant of descendants.reverse()) {
      if (!descendant.done) await setTaskDoneDirect(descendant.id, true);
    }
  }
  if (task.done !== done) await setTaskDoneDirect(task.id, done);
  await reconcileTaskChain(task.parentTaskId);
}

export async function setTaskDueAt(taskId: string, dueAt: number | undefined) {
  await db.tasks.update(taskId, { dueAt, updatedAt: Date.now() });
}

async function updateTaskDetailsEverywhere(taskId: string, patch: { title?: string; dueAt?: number | undefined }) {
  const task = await db.tasks.get(taskId);
  if (!task) return;
  if (patch.title === undefined && !("dueAt" in patch)) return;
  const timestamp = Date.now();
  const taskPatch: Partial<TaskRecord> = { updatedAt: timestamp };
  if (patch.title !== undefined) taskPatch.title = patch.title;
  if ("dueAt" in patch) taskPatch.dueAt = patch.dueAt;
  const card = task.cardId && task.sourceTaskId ? await db.cards.get(task.cardId) : undefined;
  if (!card || !task.sourceTaskId || patch.title === undefined) {
    await db.tasks.update(task.id, taskPatch);
    return;
  }
  const document = new DOMParser().parseFromString(card.contentHtml, "text/html");
  const item = findLinkedTaskItem(document, task.sourceTaskId);
  if (!item) {
    await db.tasks.update(task.id, taskPatch);
    return;
  }
  if (patch.title !== undefined) {
    const content = item.querySelector(":scope > div");
    if (content) {
      const paragraph = content.querySelector(":scope > p") || document.createElement("p");
      paragraph.textContent = patch.title;
      if (!paragraph.parentElement) content.prepend(paragraph);
    }
  }
  const plainText = (document.body.textContent || "").replace(/\s+/g, " ").trim();
  await db.transaction("rw", [db.cards, db.tasks], async () => {
    await db.cards.update(card.id, { contentHtml: document.body.innerHTML || "<p></p>", plainText, updatedAt: timestamp });
    await db.tasks.update(task.id, taskPatch);
  });
}

export async function updateTaskEverywhere(taskId: string, patch: { title?: string; done?: boolean; dueAt?: number | undefined }) {
  await updateTaskDetailsEverywhere(taskId, { title: patch.title, ...(Object.prototype.hasOwnProperty.call(patch, "dueAt") ? { dueAt: patch.dueAt } : {}) });
  if (patch.done !== undefined) await setTaskDone(taskId, patch.done);
}

async function deleteSingleTaskEverywhere(taskId: string) {
  const task = await db.tasks.get(taskId);
  if (!task) return;
  const card = task.cardId && task.sourceTaskId ? await db.cards.get(task.cardId) : undefined;
  if (!card || !task.sourceTaskId) {
    await db.transaction("rw", [db.tasks, db.brainEdges], async () => {
      await deleteTaskBrainEdges([task.id]);
      await db.tasks.delete(task.id);
    });
    return;
  }
  const document = new DOMParser().parseFromString(card.contentHtml, "text/html");
  const item = findLinkedTaskItem(document, task.sourceTaskId);
  if (!item) {
    await db.transaction("rw", [db.tasks, db.brainEdges], async () => {
      await deleteTaskBrainEdges([task.id]);
      await db.tasks.delete(task.id);
    });
    return;
  }
  const list = item.parentElement;
  item.remove();
  if (list?.matches('ul[data-type="taskList"]') && !list.querySelector("li")) list.remove();
  const timestamp = Date.now();
  const plainText = (document.body.textContent || "").replace(/\s+/g, " ").trim();
  await db.transaction("rw", [db.cards, db.tasks, db.brainEdges], async () => {
    await db.cards.update(card.id, { contentHtml: document.body.innerHTML || "<p></p>", plainText, updatedAt: timestamp });
    await deleteTaskBrainEdges([task.id]);
    await db.tasks.delete(task.id);
  });
}

export async function deleteTaskEverywhere(taskId: string) {
  const task = await db.tasks.get(taskId);
  if (!task) return;
  const descendants = await taskDescendants(task.id);
  for (const descendant of descendants.reverse()) await deleteSingleTaskEverywhere(descendant.id);
  await deleteSingleTaskEverywhere(task.id);
  await reconcileTaskChain(task.parentTaskId);
}
