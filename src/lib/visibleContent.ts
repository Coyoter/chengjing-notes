import { db } from "../db";

export async function getHiddenCardIds(): Promise<Set<string>> {
  return new Set(await db.cards.where("state").anyOf("archived", "trash").primaryKeys());
}

/** Indexed reads inside live queries also subscribe to source-card state changes. */
export async function getHiddenTaskIds(): Promise<Set<string>> {
  const cards = [...await getHiddenCardIds()];
  const hidden = new Set<string>();
  if (!cards.length) return hidden;
  let frontier = await db.tasks.where("cardId").anyOf(cards).primaryKeys();
  while (frontier.length) {
    frontier.forEach((id) => hidden.add(id));
    const children = await db.tasks.where("parentTaskId").anyOf(frontier).primaryKeys();
    frontier = children.filter((id) => !hidden.has(id));
  }
  return hidden;
}
