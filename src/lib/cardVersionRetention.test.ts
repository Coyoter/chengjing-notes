import { describe, expect, it } from "vitest";
import { cardVersionIdsToKeep } from "../db";
import type { CardVersionRecord } from "../types";

function version(id: string, createdAt: number): CardVersionRecord {
  return { id, cardId: "card", title: id, contentHtml: `<p>${id}</p>`, plainText: id, createdAt };
}

describe("卡片版本稀疏保留", () => {
  it("保留最新 30 份、近一年每日一份、久遠資料每月一份", () => {
    const now = new Date("2026-08-30T12:00:00+08:00").getTime();
    const recent = Array.from({ length: 36 }, (_, index) => version(`recent-${index}`, now - index * 60_000));
    const sameDay = [version("day-new", now - 40 * 86_400_000), version("day-old", now - 40 * 86_400_000 - 3_600_000)];
    const oldMonth = [version("month-new", now - 500 * 86_400_000), version("month-old", now - 510 * 86_400_000)];
    const keep = cardVersionIdsToKeep([...recent, ...sameDay, ...oldMonth], now);
    expect([...keep].filter((id) => id.startsWith("recent-"))).toHaveLength(31);
    expect(keep.has("day-new")).toBe(true);
    expect(keep.has("day-old")).toBe(false);
    expect([...keep].filter((id) => id.startsWith("month-"))).toHaveLength(1);
  });
});
