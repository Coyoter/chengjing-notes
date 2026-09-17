import type { CardRecord, FragmentRecord } from "../types";
import { isVisibleCard } from "./cardVisibility";

export function captureTitle(text: string) {
  return text.trim().split(/\r?\n/)[0].slice(0, 80) || "…";
}

export function captureHtml(text: string) {
  const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const escaped = text.replace(/[&<>"']/g, (character) => entities[character]);
  return `<p>${escaped.replace(/\r?\n/g, "<br>")}</p>`;
}

export function isCaptureCard(card: CardRecord | undefined | null): card is CardRecord & { captureStatus: "unfiled" | "filed" } {
  return Boolean(card && (card.captureStatus === "unfiled" || card.captureStatus === "filed"));
}

/** A compatibility DTO, never a second persisted copy of the card. */
export function cardAsFragment(card: CardRecord): FragmentRecord {
  return { id: card.id, text: card.plainText, pinned: card.favorite, tagIds: [...card.tagIds], createdAt: card.createdAt, updatedAt: card.updatedAt };
}

export function captureCardRecord(fragment: FragmentRecord, legacy = false): CardRecord {
  return { id: fragment.id, title: captureTitle(fragment.text), contentHtml: captureHtml(fragment.text), plainText: fragment.text, kind: "note", state: "active", createdAt: fragment.createdAt, updatedAt: fragment.updatedAt, tagIds: [...new Set(fragment.tagIds || [])], favorite: fragment.pinned, color: "slate", attachmentIds: [], properties: {}, captureStatus: "unfiled", ...(legacy ? { legacyFragmentId: fragment.id } : {}) };
}

/** Tags and pins are not filing destinations. Archived/trash cards never enter the inbox. */
export function isUnfiledCapture(card: CardRecord, assigned: ReadonlySet<string> = new Set()) {
  return card.captureStatus === "unfiled" && isVisibleCard(card) && !card.collectionId && !assigned.has(card.id);
}
