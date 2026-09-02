import { db } from "../db";
import type { TaskRecord } from "../types";

export function contentTaskTitle(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

export function matchesUnscheduledContentTask(task: TaskRecord, title: string, conversionKey: string, cardId?: string) {
  return !task.done
    && !task.dueAt
    && !task.sourceTaskId
    && task.conversionKey === conversionKey
    && task.cardId === cardId
    && contentTaskTitle(task.title) === contentTaskTitle(title);
}

export async function createUnscheduledContentTask(input: { title: string; sourceKey: string; cardId?: string }) {
  const title = contentTaskTitle(input.title);
  if (!title) throw new Error("empty-task-title");
  const conversionKey = `content:${input.sourceKey}`;
  const candidates = await db.tasks.where("conversionKey").equals(conversionKey).toArray();
  const existing = candidates.find((task) => matchesUnscheduledContentTask(task, title, conversionKey, input.cardId));
  if (existing) return { task: existing, created: false };
  const timestamp = Date.now();
  const task: TaskRecord = {
    id: crypto.randomUUID(),
    title,
    done: false,
    cardId: input.cardId,
    conversionKey,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.tasks.add(task);
  return { task, created: true };
}
