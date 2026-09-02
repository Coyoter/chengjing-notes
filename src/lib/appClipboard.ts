import { createCard, db } from "../db";
import type { CardRecord } from "../types";

export type AppClipboardPayload =
  | { kind: "card-ref"; cardId: string }
  | { kind: "kanban-list-ref"; listId: string; boardId: string }
  | { kind: "board-nodes"; boardId: string; nodeIds: string[] }
  | { kind: "fragment-ref"; fragmentId: string };

export async function writeAppClipboard(payload: AppClipboardPayload, text: string) {
  if (window.chengjing?.clipboard) return window.chengjing.clipboard.write({ payload, text });
  await navigator.clipboard.writeText(text);
  return { written: true };
}

export async function readAppClipboard(): Promise<{ payload: AppClipboardPayload | null; text: string }> {
  if (window.chengjing?.clipboard) {
    const result = await window.chengjing.clipboard.read();
    return { text: result.text || "", payload: result.payload && typeof result.payload.kind === "string" ? result.payload as AppClipboardPayload : null };
  }
  return { text: await navigator.clipboard.readText(), payload: null };
}

export async function duplicateCardFromId(cardId: string, title?: string): Promise<CardRecord | null> {
  const card = await db.cards.get(cardId);
  if (!card) return null;
  const attachmentCopies = (await Promise.all(card.attachmentIds.map(async (id) => {
    const attachment = await db.attachments.get(id);
    return attachment ? { ...attachment, id: crypto.randomUUID(), createdAt: Date.now() } : null;
  }))).filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (attachmentCopies.length) await db.attachments.bulkAdd(attachmentCopies);
  return createCard({
    ...card,
    id: undefined,
    title: title || card.title,
    state: card.state === "trash" ? "active" : card.state,
    favorite: false,
    deletedAt: undefined,
    attachmentIds: attachmentCopies.map((attachment) => attachment.id),
    tagIds: [...card.tagIds],
    properties: { ...card.properties },
  });
}
