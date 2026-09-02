import { intlLocale } from "../i18n";
import type { AppLanguage } from "../types";

function sentenceParts(value: string, language: AppLanguage) {
  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter(intlLocale[language], { granularity: "sentence" }).segment(value)]
      .map((part) => part.segment.trim())
      .filter(Boolean);
  }
  return value.match(/[^。！？!?]+[。！？!?]+|[^.!?]+[.!?]+(?=\s|$)|.+$/g)?.map((part) => part.trim()).filter(Boolean) || [value];
}

function segmentSingleParagraph(value: string, language: AppLanguage) {
  const sentences = sentenceParts(value, language);
  if (sentences.length < 2 || value.length < 180) return value;
  const targetCount = Math.min(4, sentences.length, Math.max(value.length >= 260 ? 3 : 2, Math.ceil(value.length / 190)));
  const targetLength = value.length / targetCount;
  const joiner = language === "en" || language === "ko" ? " " : "";
  const paragraphs: string[] = [];
  let current: string[] = [];
  let currentLength = 0;
  sentences.forEach((sentence, index) => {
    current.push(sentence);
    currentLength += sentence.length;
    const remainingSentences = sentences.length - index - 1;
    const remainingParagraphs = targetCount - paragraphs.length - 1;
    if (paragraphs.length < targetCount - 1 && currentLength >= targetLength * 0.72 && remainingSentences >= remainingParagraphs) {
      paragraphs.push(current.join(joiner));
      current = [];
      currentLength = 0;
    }
  });
  if (current.length) paragraphs.push(current.join(joiner));
  return paragraphs.join("\n\n");
}

export function segmentReflection(value: string, language: AppLanguage) {
  const normalized = String(value || "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (!normalized) return "";
  const paragraphs = normalized.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
  if (paragraphs.length > 1) return paragraphs.map((paragraph) => paragraph.length > 430 ? segmentSingleParagraph(paragraph, language) : paragraph).join("\n\n");
  return segmentSingleParagraph(normalized, language);
}
