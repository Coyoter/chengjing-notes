import type { Table } from "dexie";
import type { AppLanguage } from "../types";
import { searchQueryTerms } from "./searchIndex";

export function normalizedQuery(value: string, language: AppLanguage) {
  return value.normalize("NFKC").toLocaleLowerCase(language).trim();
}

export function includesQuery(value: string, query: string, language: AppLanguage) {
  return normalizedQuery(value, language).includes(normalizedQuery(query, language));
}

/** Bound materialized results, never truncate candidates before checking the query. */
export async function searchRecords<T extends { id: string; updatedAt: number }, TInsert>(
  table: Table<T, string, TInsert>, query: string, language: AppLanguage,
  matches: (record: T) => boolean, limit: number,
) {
  if (limit <= 0) return [];
  const terms = searchQueryTerms(query, language);
  const indexed = table.schema.indexes.some((index) => index.name === "searchTerms");
  const results = terms.length && indexed
    ? await table.where("searchTerms").anyOf(terms).distinct().filter(matches).limit(limit).toArray()
    : [];
  if (results.length < limit) {
    // Older/long notes may have truncated indexes; single characters and infixes
    // cannot use the word-prefix index. A cursor keeps this fallback bounded.
    const seen = new Set(results.map((item) => item.id));
    results.push(...await table.orderBy("updatedAt").reverse().filter((item) => !seen.has(item.id) && matches(item)).limit(limit - results.length).toArray());
  }
  return results.sort((left, right) => right.updatedAt - left.updatedAt);
}
