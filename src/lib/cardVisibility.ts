import type { CardRecord, TaskRecord } from "../types";
import { isMaterializedCard } from "./journalVisibility";

export type CardCollection = "library" | "archive" | "trash";

/** Front-stage visibility only. Never use this to filter backups or synchronization. */
export function isActiveCard<T extends Pick<CardRecord, "state">>(card: T | null | undefined): card is T & { state: "active" | "inbox" } {
  return Boolean(card && card.state !== "archived" && card.state !== "trash");
}

export function isVisibleCard(card: CardRecord | null | undefined): card is CardRecord {
  return isActiveCard(card) && isMaterializedCard(card);
}

export function isCardInCollection(card: CardRecord, collection: CardCollection) {
  return collection === "library" ? isVisibleCard(card) : card.state === (collection === "archive" ? "archived" : "trash");
}

/** Hide descendants too, even when a child has no direct cardId. Relationships are retained. */
export function hiddenTaskIds(tasks: TaskRecord[], hiddenCards: ReadonlySet<string>) {
  const children = new Map<string, string[]>();
  const hidden = new Set<string>();
  for (const task of tasks) {
    if (task.parentTaskId) children.set(task.parentTaskId, [...(children.get(task.parentTaskId) || []), task.id]);
    if (task.cardId && hiddenCards.has(task.cardId)) hidden.add(task.id);
  }
  const queue = [...hidden];
  for (let i = 0; i < queue.length; i += 1) {
    for (const id of children.get(queue[i]) || []) if (!hidden.has(id)) { hidden.add(id); queue.push(id); }
  }
  return hidden;
}
