import type { CardRecord, TaskRecord } from "../types";

export type CardCollection = "library" | "archive" | "trash";

/** Visibility is not deletion: placements, links, tasks and backup data stay intact. */
export function isActiveCard<T extends Pick<CardRecord, "state">>(card: T | null | undefined): card is T {
  return Boolean(card && (card.state === "active" || card.state === "inbox"));
}

export function matchesCardCollection(card: Pick<CardRecord, "state">, collection: CardCollection) {
  return collection === "library" ? isActiveCard(card) : card.state === (collection === "archive" ? "archived" : "trash");
}

/** Include descendants even when only their parent has a source card. Cycle-safe. */
export function hiddenTaskIds(tasks: Pick<TaskRecord, "id" | "cardId" | "parentTaskId">[], hiddenCards: ReadonlySet<string>) {
  const hidden = new Set(tasks.filter((task) => task.cardId && hiddenCards.has(task.cardId)).map((task) => task.id));
  const children = new Map<string, string[]>();
  for (const task of tasks) if (task.parentTaskId) children.set(task.parentTaskId, [...(children.get(task.parentTaskId) || []), task.id]);
  const queue = [...hidden];
  for (let i = 0; i < queue.length; i += 1) {
    for (const id of children.get(queue[i]) || []) if (!hidden.has(id)) { hidden.add(id); queue.push(id); }
  }
  return hidden;
}
