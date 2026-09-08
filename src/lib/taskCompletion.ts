import type { TaskRecord } from "../types";

export const COMPLETED_TASK_FADE_MS = 3 * 24 * 60 * 60 * 1000;
const timestamp = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

export function taskCompletionTime(task: TaskRecord): number {
  return timestamp(task.completedAt) ? task.completedAt : timestamp(task.updatedAt) ? task.updatedAt : timestamp(task.createdAt) ? task.createdAt : 0;
}

export function taskBrainOpacity(task: TaskRecord, now = Date.now()): number {
  if (!task.done) return 1;
  return Math.max(0, Math.min(1, 1 - Math.max(0, now - taskCompletionTime(task)) / COMPLETED_TASK_FADE_MS));
}

export function taskCompletionPatch(previous: TaskRecord, patch: Partial<TaskRecord>, now = Date.now()) {
  const done = patch.done ?? previous.done;
  if (!done) return { completedAt: undefined };
  if (timestamp(patch.completedAt)) return { completedAt: patch.completedAt };
  if (!previous.done) return { completedAt: timestamp(patch.updatedAt) ? patch.updatedAt : now };
  // Editing an already-completed legacy task must not reset its fade clock.
  return { completedAt: taskCompletionTime(previous) };
}
