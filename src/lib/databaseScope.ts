import type { CardRecord } from "../types";
import { isMaterializedCard } from "./journalVisibility";
export type ContentScope = "all" | "cards" | "tasks" | "pinned" | "archive" | "trash";
export function cardInDatabaseScope(card: CardRecord, scope: ContentScope) {
  if (scope === "trash") return card.state === "trash";
  if (scope === "archive") return card.state === "archived";
  return scope !== "tasks" && card.state !== "trash" && card.state !== "archived" && isMaterializedCard(card) && (scope !== "pinned" || card.favorite);
}
