import "fake-indexeddb/auto";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { db } from "../db";
import { buildBrainGraph } from "./brain";
import { COMPLETED_TASK_FADE_MS, taskBrainOpacity, taskCompletionPatch } from "./taskCompletion";
import type { TaskRecord } from "../types";
const task: TaskRecord = { id: "task", title: "Done", done: true, completedAt: 1000, createdAt: 0, updatedAt: 1000 };
beforeAll(() => db.open());
beforeEach(async () => { vi.restoreAllMocks(); await db.tasks.clear(); });

it("fades linearly and disappears at exactly three days, not by deleting the task", () => {
  expect(taskBrainOpacity(task, 1000)).toBe(1);
  expect(taskBrainOpacity(task, 1000 + COMPLETED_TASK_FADE_MS / 2)).toBe(.5);
  expect(taskBrainOpacity(task, 1000 + COMPLETED_TASK_FADE_MS)).toBe(0);
  const base = { cards: [], boards: [], fragments: [], boardNodes: [], tags: [], storedEdges: [], tasks: [task] };
  expect(buildBrainGraph({ ...base, now: 1000 + COMPLETED_TASK_FADE_MS }).nodes).toHaveLength(0);
  expect(base.tasks).toHaveLength(1);
  expect(buildBrainGraph({ ...base, tasks: [{ ...task, done: false }], now: 1000 + COMPLETED_TASK_FADE_MS }).nodes).toHaveLength(1);
});

it("preserves completed time on edits, clears on reopen, and records recompletion", async () => {
  await db.tasks.add(task);
  await db.tasks.update(task.id, { title: "Renamed", updatedAt: 9000 });
  expect((await db.tasks.get(task.id))?.completedAt).toBe(1000);
  await db.tasks.update(task.id, { done: false, updatedAt: 10000 });
  expect((await db.tasks.get(task.id))?.completedAt).toBeUndefined();
  await db.tasks.update(task.id, { done: true, updatedAt: 12000 });
  expect((await db.tasks.get(task.id))?.completedAt).toBe(12000);
});

it("retains a legacy completion estimate and respects a synced completion timestamp", () => {
  expect(taskCompletionPatch({ ...task, completedAt: undefined }, { title: "edit", updatedAt: 10000 })).toEqual({ completedAt: 1000 });
  expect(taskCompletionPatch({ ...task, done: false }, { done: true, completedAt: 500 })).toEqual({ completedAt: 500 });
});
