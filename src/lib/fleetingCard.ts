import type { CardRecord, FragmentRecord } from "../types";

/** A capture is a card from its first write, not a second content store. */
export function isFleetingCard(card: CardRecord) {
  return card.properties.captureSource === "fragment";
}

export function fleetingTextPatch(text: string) {
  const escaped = text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return { title: text.split(/\r?\n/)[0].slice(0, 80), plainText: text, contentHtml: `<p>${escaped.replace(/\r?\n/g, "<br>")}</p>` };
}

export function fragmentAsCard(fragment: FragmentRecord, id = fragment.id): CardRecord {
  return {
    id, ...fleetingTextPatch(fragment.text), kind: "note", state: "inbox",
    createdAt: fragment.createdAt, updatedAt: fragment.updatedAt,
    tagIds: [...new Set(fragment.tagIds || [])], favorite: fragment.pinned,
    color: "slate", attachmentIds: [],
    properties: { captureSource: "fragment", legacyFragmentId: fragment.id },
  };
}

/** Compatibility result for capture integrations; never persisted in fragments. */
export function cardAsFragment(card: CardRecord): FragmentRecord {
  return { id: card.id, text: card.plainText, pinned: card.favorite, tagIds: [...card.tagIds], createdAt: card.createdAt, updatedAt: card.updatedAt };
}
