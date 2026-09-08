import { db } from "../db";
import { runGlobalHistoryAction } from "./globalHistory";

/** Delete only the confirmed snapshot, rechecking state inside one transaction. */
export async function permanentlyDeleteTrashItems(confirmedIds: string[]) {
  return runGlobalHistoryAction(() => db.transaction("rw", db.tables, async () => {
    const cards = (await db.cards.bulkGet([...new Set(confirmedIds)])).filter(card => card?.state === "trash").map(card => card!);
    const ids = new Set(cards.map(card => card.id));
    if (!ids.size) return { deleted: 0 };
    const sharedAssets = new Set<string>();
    await db.cards.filter(card => !ids.has(card.id)).each(card => card.attachmentIds.forEach(id => sharedAssets.add(id)));
    const assets = [...new Set(cards.flatMap(card => card.attachmentIds))].filter(id => !sharedAssets.has(id));
    const tasks = await db.tasks.filter(task => Boolean(task.cardId && ids.has(task.cardId))).primaryKeys();
    const taskIds = new Set(tasks.map(String));
    const nodes = await db.boardNodes.filter(node => Boolean(node.cardId && ids.has(node.cardId))).primaryKeys();
    const nodeIds = new Set(nodes.map(String));
    await db.boardEdges.filter(edge => nodeIds.has(edge.source) || nodeIds.has(edge.target)).delete();
    await db.boardNodes.bulkDelete([...nodeIds]);
    await db.kanbanPlacements.filter(item => ids.has(item.cardId)).delete();
    await db.highlights.filter(item => ids.has(item.cardId)).delete();
    await db.cardVersions.filter(item => ids.has(item.cardId)).delete();
    await db.tasks.bulkDelete([...taskIds]);
    await db.brainEdges.filter(edge => (edge.sourceType === "card" && ids.has(edge.sourceId)) || (edge.targetType === "card" && ids.has(edge.targetId)) || (edge.sourceType === "task" && taskIds.has(edge.sourceId)) || (edge.targetType === "task" && taskIds.has(edge.targetId))).delete();
    await db.attachments.bulkDelete(assets);
    await db.cards.bulkDelete([...ids]);
    await db.preferences.put({ key: "demo-seed-complete", value: true });
    // File bytes remain available to the existing Undo/recovery lifecycle.
    return { deleted: ids.size };
  }));
}
