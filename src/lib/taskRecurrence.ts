import type { TaskRecord } from "../types";
import { localDateKey, timestampForLocalDateKey } from "./taskTimeline";

export type TaskRecurrence = { frequency: "daily" } | { frequency: "weekly"; weekday: number } | { frequency: "monthly"; day: number };

export function nextRecurringDate(rule: TaskRecurrence, after: number): number {
  if (!Number.isFinite(after)) throw new Error("Invalid recurrence date");
  const date = new Date(after);
  const year = date.getFullYear(), month = date.getMonth(), day = date.getDate();
  if (rule.frequency === "daily") return new Date(year, month, day + 1, 12).getTime();
  if (rule.frequency === "weekly") {
    if (!Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6) throw new Error("Invalid weekday");
    const offset = (rule.weekday - date.getDay() + 7) % 7 || 7;
    return new Date(year, month, day + offset, 12).getTime();
  }
  if (!Number.isInteger(rule.day) || rule.day < 1 || rule.day > 31) throw new Error("Invalid month day");
  // Dates 29–31 fall on the last day in shorter months, then recover naturally.
  const targetMonth = month + 1;
  const last = new Date(year, targetMonth + 1, 0).getDate();
  return new Date(year, targetMonth, Math.min(rule.day, last), 12).getTime();
}

export function firstRecurringDate(rule: TaskRecurrence, now = Date.now()): number {
  const today = timestampForLocalDateKey(localDateKey(now));
  if (rule.frequency === "daily") return today;
  if (rule.frequency === "weekly") {
    if (!Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6) throw new Error("Invalid weekday");
    return new Date(new Date(today).getFullYear(), new Date(today).getMonth(), new Date(today).getDate() + (rule.weekday - new Date(today).getDay() + 7) % 7, 12).getTime();
  }
  if (!Number.isInteger(rule.day) || rule.day < 1 || rule.day > 31) throw new Error("Invalid month day");
  const date = new Date(today);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const candidate = new Date(date.getFullYear(), date.getMonth(), Math.min(rule.day, last), 12).getTime();
  return candidate >= today ? candidate : nextRecurringDate(rule, candidate);
}

export function nextRecurringTask(task: TaskRecord, now = Date.now()): TaskRecord | null {
  if (!task.recurrence || !task.dueAt || task.parentTaskId) return null;
  const dueAt = nextRecurringDate(task.recurrence, task.dueAt);
  const seriesId = task.recurrenceSeriesId || task.id;
  return { id: `recurrence:${seriesId}:${localDateKey(dueAt)}`, title: task.title, done: false, recurrence: task.recurrence,
    recurrenceSeriesId: seriesId, dueAt, createdAt: now, updatedAt: now };
}
