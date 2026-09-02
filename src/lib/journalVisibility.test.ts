import { describe, expect, it } from "vitest";
import type { CardRecord } from "../types";
import { inferJournalTouched, isMaterializedCard } from "./journalVisibility";

function journal(patch: Partial<CardRecord> = {}): CardRecord {
  return {
    id: "journal-test",
    title: "2026年9月2日",
    contentHtml: "<h2>今天</h2><p></p>",
    plainText: "",
    kind: "journal",
    state: "active",
    createdAt: 1,
    updatedAt: 1,
    journalDate: "2026-09-02",
    tagIds: [],
    favorite: false,
    color: "slate",
    attachmentIds: [],
    properties: {},
    ...patch,
  };
}

describe("journal visibility", () => {
  it("keeps an untouched date scaffold out of content views", () => {
    expect(inferJournalTouched(journal())).toBe(false);
    expect(isMaterializedCard(journal({ journalTouched: false }))).toBe(false);
  });

  it("recognizes written content even in a legacy journal", () => {
    expect(isMaterializedCard(journal({ plainText: "今天\n完成產品測試" }))).toBe(true);
  });

  it("recognizes a title customized by the user", () => {
    expect(isMaterializedCard(journal({ title: "第一次產品訪談" }))).toBe(true);
  });

  it("keeps a once-edited journal visible after its text is cleared", () => {
    expect(isMaterializedCard(journal({ journalTouched: true, plainText: "", contentHtml: "<p></p>" }))).toBe(true);
  });
});
