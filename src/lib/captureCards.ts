import { db, updateCardWithHistory } from "../db";
import type { CardRecord, FragmentRecord } from "../types";
import { captureCardRecord, captureHtml, captureTitle, cardAsFragment, isCaptureCard, isUnfiledCapture } from "./captureModel";
import { ignoreTransactionHistory } from "./historyTransactions";
import { materializedHead, type SyncRecord } from "./syncProtocol";

export async function captureAssignedIds() {
  const [nodes, placements, tasks] = await Promise.all([db.boardNodes.toArray(), db.kanbanPlacements.toArray(), db.tasks.toArray()]);
  return new Set([...nodes, ...placements, ...tasks].map((row) => row.cardId).filter((id): id is string => Boolean(id)));
}

export async function captureInboxCards(limit = Number.MAX_SAFE_INTEGER) {
  const assigned = await captureAssignedIds();
  const cards = await db.cards.where("captureStatus").equals("unfiled").filter((card) => isUnfiledCapture(card, assigned)).toArray();
  return cards.sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).slice(0, limit);
}

export async function captureInboxCount() {
  const assigned = await captureAssignedIds();
  return db.cards.where("captureStatus").equals("unfiled").filter((card) => isUnfiledCapture(card, assigned)).count();
}

/** Resolve old fragment references without ever reading a stale second content copy. */
export async function getCaptureCard(id: string): Promise<CardRecord | undefined> {
  const direct = await db.cards.get(id);
  if (isCaptureCard(direct)) return direct;
  return db.cards.where("legacyFragmentId").equals(id).first();
}

export async function updateCaptureFragment(id: string, patch: Partial<Pick<FragmentRecord, "text" | "tagIds" | "pinned">>) {
  const card = await getCaptureCard(id);
  if (!card) throw new Error("capture-card-not-found");
  const changes: Partial<CardRecord> = {};
  if (patch.text !== undefined) {
    const text = patch.text.trim();
    if (!text) throw new Error("empty-capture-content");
    changes.plainText = text;
    changes.contentHtml = captureHtml(text);
    if (card.title === captureTitle(card.plainText)) changes.title = captureTitle(text);
  }
  if (patch.tagIds) changes.tagIds = [...new Set(patch.tagIds)];
  if (patch.pinned !== undefined) changes.favorite = patch.pinned;
  await updateCardWithHistory(card.id, changes);
  return cardAsFragment((await db.cards.get(card.id))!);
}

/**
 * Atomic, repeatable compatibility migration. The fragments store remains readable
 * by the old backup/sync protocol, but no new UI or API writes content into it.
 * Never overwrite an existing card with a re-imported legacy snapshot. Different
 * legacy content is retained as a version, including its original metadata.
 */
export async function migrateLegacyFragments(options: { restore?: boolean } = {}) {
  return db.transaction("rw", [db.cards, db.fragments, db.brainEdges, db.brainShares, db.tasks, db.cardVersions, db.preferences, db.table("syncRecords")], async (transaction) => {
    ignoreTransactionHistory(transaction);
    const fragments = await db.fragments.toArray();
    const aliases = new Map<string, string>();
    let migrated = 0;
    for (const fragment of fragments) {
      const key = `capture-migration:${fragment.id}`;
      const prior = await db.preferences.get(key);
      let card = await getCaptureCard(fragment.id);
      let cardId = card?.id || (typeof prior?.value === "string" ? prior.value : fragment.id);
      const syncRecord = await db.table<SyncRecord>("syncRecords").get(`cards:${cardId}`);
      const deleted = Boolean(syncRecord?.heads.length && materializedHead(syncRecord.heads).value === null);
      if (!card && !options.restore && (prior || deleted)) {
        // A removed card must not be resurrected by an old imported fragment.
        aliases.set(fragment.id, cardId);
        await db.fragments.delete(fragment.id);
        continue;
      }
      if (!card) {
        let suffix = 0;
        while (await db.cards.get(cardId)) cardId = `legacy-fragment:${fragment.id}${suffix++ ? `:${suffix}` : ""}`;
        card = { ...captureCardRecord(fragment, true), id: cardId };
        await db.cards.add(card);
        migrated++;
      } else if (card.plainText !== fragment.text || JSON.stringify(card.tagIds) !== JSON.stringify(fragment.tagIds) || card.favorite !== fragment.pinned) {
        // Preserve a legacy edit as recoverable content, not a duplicate live card.
        const versions = await db.cardVersions.where("cardId").equals(card.id).toArray();
        const alreadySaved = versions.some((version) => JSON.stringify(version.legacyFragment) === JSON.stringify(fragment));
        if (!alreadySaved) await db.cardVersions.add({ id: crypto.randomUUID(), cardId: card.id, title: captureTitle(fragment.text), plainText: fragment.text, contentHtml: captureHtml(fragment.text), createdAt: fragment.updatedAt, legacyFragment: fragment });
      }
      aliases.set(fragment.id, cardId);
      await db.preferences.put({ key, value: cardId });
      await db.fragments.delete(fragment.id);
    }
    async function resolve(id: string) {
      if (aliases.has(id)) return aliases.get(id);
      const card = await getCaptureCard(id);
      const mapping = card?.id || (await db.preferences.get(`capture-migration:${id}`))?.value;
      if (typeof mapping === "string") { aliases.set(id, mapping); return mapping; }
      return undefined;
    }
    for (const edge of await db.brainEdges.filter((edge) => edge.sourceType === "fragment" || edge.targetType === "fragment").toArray()) {
      const source = edge.sourceType === "fragment" ? await resolve(edge.sourceId) : undefined;
      const target = edge.targetType === "fragment" ? await resolve(edge.targetId) : undefined;
      if (source || target) await db.brainEdges.update(edge.id, { ...(source ? { sourceType: "card" as const, sourceId: source } : {}), ...(target ? { targetType: "card" as const, targetId: target } : {}) });
    }
    for (const share of await db.brainShares.filter((share) => share.localType === "fragment").toArray()) {
      const cardId = await resolve(share.localId);
      if (cardId) await db.brainShares.update(share.id, { localType: "card", localId: cardId });
    }
    for (const task of await db.tasks.filter((task) => Boolean(task.conversionKey?.startsWith("content:fragment:"))).toArray()) {
      const cardId = await resolve(task.conversionKey!.slice("content:fragment:".length));
      if (cardId) await db.tasks.update(task.id, { cardId: task.cardId || cardId, conversionKey: `content:card:${cardId}` });
    }
    return migrated;
  });
}
