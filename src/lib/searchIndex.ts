import type { AppLanguage, CardRecord, FragmentRecord, TaskRecord } from "../types";
import { intlLocale } from "../i18n";

const MAX_INDEX_TERMS = 192;

function normalized(value: string, language: AppLanguage) {
  return value.normalize("NFKC").toLocaleLowerCase(intlLocale[language]).replace(/https?:\/\/\S+/g, " ");
}

function addPrefixes(target: Set<string>, token: string) {
  if (token.length < 2) return;
  target.add(token);
  const maximum = Math.min(12, token.length);
  for (let length = 2; length <= maximum; length += 1) target.add(token.slice(0, length));
}

export function searchIndexTerms(value: string, language: AppLanguage = "zh-TW", limit = MAX_INDEX_TERMS) {
  const source = normalized(value, language);
  const terms = new Set<string>();
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(intlLocale[language], { granularity: "word" });
    for (const part of segmenter.segment(source)) {
      const token = part.segment.trim().replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
      if (part.isWordLike && token.length >= 2) addPrefixes(terms, token);
      if (terms.size >= limit) break;
    }
  } else {
    source.split(/[^\p{L}\p{N}]+/gu).forEach((token) => addPrefixes(terms, token));
  }
  for (const run of source.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]{2,}/gu) || []) {
    for (let index = 0; index < run.length - 1 && terms.size < limit; index += 1) terms.add(run.slice(index, index + 2));
  }
  return [...terms].slice(0, limit);
}

export function searchQueryTerms(value: string, language: AppLanguage = "zh-TW") {
  const query = normalized(value.trim(), language);
  if (!query) return [];
  const indexed = searchIndexTerms(query, language, 32);
  return [...new Set([query, ...indexed])].filter((term) => term.length >= 2).slice(0, 32);
}

export function cardSearchTerms(card: Pick<CardRecord, "title" | "plainText" | "sourceUrl">, language: AppLanguage = "zh-TW") {
  return searchIndexTerms(`${card.title}\n${card.plainText}\n${card.sourceUrl || ""}`, language);
}

export function taskSearchTerms(task: Pick<TaskRecord, "title">, language: AppLanguage = "zh-TW") {
  return searchIndexTerms(task.title, language, 64);
}

export function fragmentSearchTerms(fragment: Pick<FragmentRecord, "text">, language: AppLanguage = "zh-TW") {
  return searchIndexTerms(fragment.text, language, 96);
}

export function normalizedSearchHaystack(value: string, language: AppLanguage = "zh-TW") {
  return normalized(value, language);
}
