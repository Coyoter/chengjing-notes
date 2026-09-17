import type { AppLanguage, CardRecord, TaskRecord } from "../types";
import { isActiveCard, isCardInCollection, type CardCollection } from "./cardVisibility";
import { includesQuery } from "./searchRecords";

export interface LibraryFilters {
  collection: CardCollection;
  group: string;
  topicIds: ReadonlySet<string> | null;
  tagId: string | null;
  kind: string;
  query: string;
  language: AppLanguage;
}
function matchesOrganization(card: CardRecord, filters: LibraryFilters) {
  return (filters.group === "all"
    || (filters.group === "pinned" && card.favorite)
    || (filters.group === "unassigned" && !card.collectionId)
    || Boolean(card.collectionId && filters.topicIds?.has(card.collectionId)))
    && (!filters.tagId || card.tagIds.includes(filters.tagId))
    && (filters.kind === "all" || card.kind === filters.kind);
}
export function matchesLibraryCard(card: CardRecord, filters: LibraryFilters) {
  return isCardInCollection(card, filters.collection) && matchesOrganization(card, filters)
    && includesQuery(`${card.title} ${card.plainText}`, filters.query, filters.language);
}
export function matchesLibraryTask(task: TaskRecord, source: CardRecord | undefined, filters: LibraryFilters) {
  if (filters.collection !== "library" || !includesQuery(task.title, filters.query, filters.language)) return false;
  if (source) return isActiveCard(source) && matchesOrganization(source, filters);
  return !filters.tagId && filters.kind === "all" && ["all", "unassigned"].includes(filters.group);
}
