import { describe, expect, it } from "vitest";
import type { TaskRecord } from "../types";
import { calendarDayDistance, groupTasksByTimeline, localDateKey, timestampForLocalDateKey } from "./taskTimeline";

function task(id: string, dueKey?: string, done = false): TaskRecord {
  return { id, title: id, done, dueAt: dueKey ? timestampForLocalDateKey(dueKey) : undefined, createdAt: Number(id.replace(/\D/g, "")) || 1, updatedAt: Number(id.replace(/\D/g, "")) || 1 };
}

describe("待辦時間軸", () => {
  it("依今天、過期、未來日期、無期限與已完成分組", () => {
    const timeline = groupTasksByTimeline([
      task("today-1", "2026-08-26"),
      task("overdue-1", "2026-08-20"),
      task("overdue-2", "2026-08-25"),
      task("future-1", "2026-08-27"),
      task("future-2", "2026-09-02"),
      task("no-date"),
      task("done-1", "2026-08-26", true),
    ], timestampForLocalDateKey("2026-08-26"));
    expect(timeline.today.map((item) => item.id)).toEqual(["today-1"]);
    expect(timeline.overdue.map((group) => group.key)).toEqual(["2026-08-20", "2026-08-25"]);
    expect(timeline.future.map((group) => group.key)).toEqual(["2026-08-27", "2026-09-02"]);
    expect(timeline.noDate.map((item) => item.id)).toEqual(["no-date"]);
    expect(timeline.completed.map((item) => item.id)).toEqual(["done-1"]);
  });

  it("以日曆日期計算距離，不受夏令時間小時數影響", () => {
    expect(calendarDayDistance("2026-03-07", "2026-03-09")).toBe(2);
    expect(calendarDayDistance("2026-08-26", "2026-08-25")).toBe(-1);
    expect(localDateKey(timestampForLocalDateKey("2026-08-26"))).toBe("2026-08-26");
    expect(timestampForLocalDateKey("2026-02-31")).toBe(0);
  });
});
