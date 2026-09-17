import { db } from "../db";
import { cardAsFragment, fragmentAsCard, isFleetingCard } from "./fleetingCard";
import { ignoreTransactionHistory } from "./historyTransactions";
import type { CardRecord } from "../types";

const marker = (id: string) => `fragment-card-migration:${id}`;
export const FLEETING_MIGRATION_KEY = "fleeting-cards-v1";

export async function resolveFleetingCard(id: string): Promise<CardRecord | undefined> {
  const direct = await db.cards.get(id);
  if (direct && isFleetingCard(direct)) return direct;
  const mapped = await db.preferences.get(marker(id));
  return typeof mapped?.value === "string" ? db.cards.get(mapped.value) : undefined;
}

export async function readLegacyFragment(id: string) {
  const card = await resolveFleetingCard(id);
  if (card) return cardAsFragment(card);
  return db.fragments.get(id);
}

/** Repeatable, atomic migration for startup, old backups and late sync packets.
 * Original IDs/timestamps/tags are retained. The legacy table remains an import
 * compatibility surface, not an authoritative second copy. Local mapping markers
 * also prevent a replayed old fragment from resurrecting a permanently deleted card.
 */
export async function migrateLegacyFragments() {
  return db.transaction("rw", [db.cards, db.fragments, db.brainEdges, db.brainShares, db.tasks, db.preferences, db.cardVersions], async (transaction) => {
    ignoreTransactionHistory(transaction);
    const mappings = new Map<string, string>();
    const previous = await db.preferences.where("key").startsWith("fragment-card-migration:").toArray();
    previous.forEach(row => { if (typeof row.value === "string") mappings.set(row.key.slice("fragment-card-migration:".length), row.value); });
    const fragments = await db.fragments.toArray();
    let migrated = 0;
    for (const fragment of fragments) {
      let id = mappings.get(fragment.id) || fragment.id;
      let existing = await db.cards.get(id);
      if (existing && existing.properties.legacyFragmentId !== fragment.id) {
        id = `fragment-card:${fragment.id}`;
        existing = await db.cards.get(id);
        if (existing && existing.properties.legacyFragmentId !== fragment.id) throw new Error("fragment-migration-id-conflict");
      }
      // A known mapping without its card means it was permanently deleted.
      if (!existing && !mappings.has(fragment.id)) {
        await db.cards.add(fragmentAsCard(fragment, id));
        migrated += 1;
      } else if (existing) {
        const incoming = fragmentAsCard(fragment, id);
        const different = existing.plainText !== incoming.plainText || existing.favorite !== incoming.favorite || JSON.stringify([...existing.tagIds].sort()) !== JSON.stringify([...incoming.tagIds].sort());
        if (different) {
          const applyIncoming = fragment.updatedAt > existing.updatedAt && existing.state === "inbox";
          // Preserve the non-selected edit as a restorable card version, not a second card.
          // This also keeps late edits from old devices without reviving archived content.
          const snapshot = applyIncoming ? existing : incoming;
          const captureSnapshot = { tagIds: snapshot.tagIds, favorite: snapshot.favorite };
          const duplicate = await db.cardVersions.where("cardId").equals(id).filter(version => version.contentHtml === snapshot.contentHtml && JSON.stringify(version.captureSnapshot) === JSON.stringify(captureSnapshot)).first();
          if (!duplicate) await db.cardVersions.add({ id: crypto.randomUUID(), cardId: id, title: snapshot.title, plainText: snapshot.plainText, contentHtml: snapshot.contentHtml, createdAt: Date.now(), captureSnapshot });
          if (applyIncoming) await db.cards.update(id, { title: incoming.title, contentHtml: incoming.contentHtml, plainText: incoming.plainText, tagIds: incoming.tagIds, favorite: incoming.favorite, updatedAt: incoming.updatedAt });
        }
      }
      mappings.set(fragment.id, id);
      await db.preferences.put({ key: marker(fragment.id), value: id });
      await db.fragments.delete(fragment.id);
    }
    // A migrated card may arrive from another device before its legacy references.
    for (const card of await db.cards.filter(isFleetingCard).toArray()) {
      const oldId = card.properties.legacyFragmentId;
      if (typeof oldId === "string" && mappings.get(oldId) !== card.id) {
        mappings.set(oldId, card.id);
        await db.preferences.put({ key: marker(oldId), value: card.id });
      }
    }
    await db.brainEdges.filter(edge => (edge.sourceType === "fragment" && mappings.has(edge.sourceId)) || (edge.targetType === "fragment" && mappings.has(edge.targetId))).modify(edge => {
      if (edge.sourceType === "fragment" && mappings.has(edge.sourceId)) { edge.sourceType = "card"; edge.sourceId = mappings.get(edge.sourceId)!; }
      if (edge.targetType === "fragment" && mappings.has(edge.targetId)) { edge.targetType = "card"; edge.targetId = mappings.get(edge.targetId)!; }
    });
    for (const share of await db.brainShares.filter(share => share.localType === "fragment" && mappings.has(share.localId)).toArray()) {
      const localId = mappings.get(share.localId)!;
      const id = `card:${localId}`;
      const existing = await db.brainShares.get(id);
      if (existing && existing.remoteId !== share.remoteId) throw new Error("fragment-migration-share-conflict");
      if (!existing || share.updatedAt > existing.updatedAt) await db.brainShares.put({ ...share, id, localId, localType: "card" });
      if (share.id !== id) await db.brainShares.delete(share.id);
    }
    await db.tasks.filter(task => Boolean(task.conversionKey?.startsWith("content:fragment:") && mappings.has(task.conversionKey.slice("content:fragment:".length)))).modify(task => {
      const prefix = "content:fragment:";
      if (!task.conversionKey?.startsWith(prefix)) return;
      const cardId = mappings.get(task.conversionKey.slice(prefix.length));
      if (cardId) { task.conversionKey = `content:card:${cardId}`; if (!task.cardId) task.cardId = cardId; }
    });
    if (!await db.preferences.get(FLEETING_MIGRATION_KEY)) await db.preferences.put({ key: FLEETING_MIGRATION_KEY, value: true });
    return migrated;
  });
}
