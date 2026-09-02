import type { AppLanguage, CardKind } from "../types";
import { intlLocale, translate, type MessageKey } from "../i18n";

export const kindLabel: Record<CardKind, string> = {
  note: "筆記",
  journal: "日誌",
  web: "網頁",
  pdf: "PDF",
  image: "圖片",
  audio: "音訊",
  video: "影片",
  highlight: "劃記",
  ai: "AI 產出",
};

const kindKeys: Record<CardKind, MessageKey> = {
  note: "kind.note", journal: "kind.journal", web: "kind.web", pdf: "kind.pdf", image: "kind.image", audio: "kind.audio", video: "kind.video", highlight: "kind.highlight", ai: "kind.ai",
};

export function localizedKindLabel(kind: CardKind, language: AppLanguage) {
  return translate(language, kindKeys[kind]);
}

export function relativeTime(timestamp: number, language: AppLanguage = "zh-TW") {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return translate(language, "common.justNow");
  if (minutes < 60) return translate(language, "common.minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return translate(language, "common.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return translate(language, "common.daysAgo", { count: days });
  return new Intl.DateTimeFormat(intlLocale[language], { year: "numeric", month: "numeric", day: "numeric" }).format(timestamp);
}

export function stripHtml(value: string) {
  const doc = new DOMParser().parseFromString(value || "", "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
}

export function truncate(value: string, length = 120) {
  const text = String(value || "").trim();
  return text.length > length ? `${text.slice(0, length).trim()}…` : text;
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

export function friendlyErrorMessage(error: unknown, fallback = "操作失敗，請再試一次。") {
  if (!(error instanceof Error) || !error.message.trim()) return fallback;
  return error.message
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim() || fallback;
}

export function dataUrlToBlob(dataUrl: string) {
  const [meta, encoded] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(meta)?.[1] || "application/octet-stream";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
