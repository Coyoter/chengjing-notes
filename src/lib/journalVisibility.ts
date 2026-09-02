import type { CardRecord } from "../types";

const journalLocales = ["zh-TW", "zh-CN", "en", "ja", "ko"] as const;
const defaultHeadingKeys = new Set(["今天", "今日", "today", "오늘"]);

function normalized(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "").trim();
}

function textFromHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function defaultJournalTitles(date: string | undefined) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Set<string>();
  const localDate = new Date(`${date}T12:00:00`);
  if (!Number.isFinite(localDate.getTime())) return new Set<string>();
  return new Set(journalLocales.map((locale) => normalized(new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(localDate))));
}

export function inferJournalTouched(card: Pick<CardRecord, "kind" | "title" | "plainText" | "contentHtml" | "journalDate">) {
  if (card.kind !== "journal") return true;
  const defaultTitles = defaultJournalTitles(card.journalDate);
  const title = normalized(card.title || "");
  const customTitle = Boolean(title) && !defaultTitles.has(title);
  if (customTitle) return true;

  const source = card.plainText.trim() || textFromHtml(card.contentHtml || "");
  const meaningfulLines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !defaultHeadingKeys.has(normalized(line)));
  return meaningfulLines.length > 0;
}

export function isMaterializedCard(card: CardRecord) {
  if (card.kind !== "journal") return true;
  return card.journalTouched === true || inferJournalTouched(card);
}
