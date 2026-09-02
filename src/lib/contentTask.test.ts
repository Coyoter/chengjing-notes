import { describe, expect, it } from "vitest";
import type { TaskRecord } from "../types";
import { contentTaskTitle, matchesUnscheduledContentTask } from "./contentTask";

function task(patch: Partial<TaskRecord> = {}): TaskRecord {
  return { id: "task", title: "整理會議結論", done: false, createdAt: 1, updatedAt: 1, ...patch };
}

describe("content to unscheduled task", () => {
  it("turns multiline content into a compact task title", () => {
    expect(contentTaskTitle("  整理會議\n\n結論  ")).toBe("整理會議 結論");
  });

  it("recognizes the same active unscheduled card task", () => {
    expect(matchesUnscheduledContentTask(task({ cardId: "card", conversionKey: "content:card:card" }), "整理會議結論", "content:card:card", "card")).toBe(true);
  });

  it("allows a new task after completion or when the source differs", () => {
    expect(matchesUnscheduledContentTask(task({ cardId: "card", conversionKey: "content:card:card", done: true }), "整理會議結論", "content:card:card", "card")).toBe(false);
    expect(matchesUnscheduledContentTask(task({ cardId: "other", conversionKey: "content:card:other" }), "整理會議結論", "content:card:card", "card")).toBe(false);
  });

  it("does not confuse editor checklist items with converted tasks", () => {
    expect(matchesUnscheduledContentTask(task({ cardId: "card", conversionKey: "content:card:card", sourceTaskId: "editor-item" }), "整理會議結論", "content:card:card", "card")).toBe(false);
  });
});
