import { db } from "../db";

/** Call within useLiveQuery so cross-table state changes invalidate the result. */
export async function getHiddenCardIds() {
  return new Set<string>(await db.cards.where("state").anyOf("archived", "trash").primaryKeys());
}

export async function getHiddenTaskIds() {
  const cards = await getHiddenCardIds();
  if (!cards.size) return new Set<string>();
  const hidden = new Set<string>(await db.tasks.where("cardId").anyOf([...cards]).primaryKeys());
  let frontier = [...hidden];
  while (frontier.length) {
    const children = await db.tasks.where("parentTaskId").anyOf(frontier).primaryKeys();
    frontier = children.filter((id) => !hidden.has(id));
    frontier.forEach((id) => hidden.add(id));
  }
  return hidden;
}
