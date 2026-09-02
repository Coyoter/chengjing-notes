import { intlLocale } from "../i18n";
import type { AppLanguage } from "../types";

export interface BoardPreviewBlock {
  kind: "paragraph" | "bullet";
  text: string;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character] || character));
}

function sentenceParts(value: string, language: AppLanguage) {
  if (typeof Intl.Segmenter === "function") return [...new Intl.Segmenter(intlLocale[language], { granularity: "sentence" }).segment(value)].map((part) => part.segment.trim()).filter(Boolean);
  return value.match(/[^。！？!?]+[。！？!?]+|[^.!?]+[.!?]+(?=\s|$)|.+$/g)?.map((part) => part.trim()).filter(Boolean) || [value];
}

export function normalizeBoardPlainText(value: string, language: AppLanguage = "zh-TW") {
  const normalized = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]*([•●▪◦])\s*/g, "\n• ")
    .replace(/\n{2,}(?=• )/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
  if (!normalized || normalized.includes("\n\n") || normalized.includes("\n• ") || normalized.length < 220) return normalized;
  const sentences = sentenceParts(normalized, language);
  if (sentences.length < 3) return normalized;
  const joiner = language === "en" || language === "ko" ? " " : "";
  const midpoint = Math.ceil(sentences.length / 2);
  return `${sentences.slice(0, midpoint).join(joiner)}\n\n${sentences.slice(midpoint).join(joiner)}`;
}

export function boardPreviewBlocks(value: string, language: AppLanguage, maximum = 4) {
  const normalized = normalizeBoardPlainText(value, language);
  const blocks: BoardPreviewBlock[] = [];
  normalized.split(/\n+/).forEach((line) => {
    const clean = line.trim();
    if (!clean || blocks.length >= maximum) return;
    const bullet = clean.match(/^(?:[•●▪◦*-]|\d+[.)、])\s*(.+)$/);
    blocks.push({ kind: bullet ? "bullet" : "paragraph", text: (bullet?.[1] || clean).trim() });
  });
  return blocks;
}

export function richHtmlFromPlainText(value: string, language: AppLanguage = "zh-TW") {
  const normalized = normalizeBoardPlainText(value, language);
  if (!normalized) return "<p></p>";
  const lines = normalized.split("\n");
  const html: string[] = [];
  let bullets: string[] = [];
  const flushBullets = () => {
    if (!bullets.length) return;
    html.push(`<ul>${bullets.map((item) => `<li><p>${escapeHtml(item)}</p></li>`).join("")}</ul>`);
    bullets = [];
  };
  lines.forEach((line) => {
    const clean = line.trim();
    const bullet = clean.match(/^(?:[•●▪◦*-]|\d+[.)、])\s*(.+)$/);
    if (bullet) { bullets.push(bullet[1].trim()); return; }
    flushBullets();
    if (clean) html.push(`<p>${escapeHtml(clean)}</p>`);
  });
  flushBullets();
  return html.join("") || "<p></p>";
}
