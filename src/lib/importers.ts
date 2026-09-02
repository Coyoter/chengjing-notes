import DOMPurify from "dompurify";
import { marked } from "marked";
import { createCard } from "../db";
import { translate } from "../i18n";
import { useAppStore } from "../store";
import type { AttachmentRecord, CardKind, CardRecord } from "../types";
import { attachmentUrl, persistAttachment, removeStoredAttachment } from "./attachments";

function language() {
  return useAppStore.getState().language || "zh-TW";
}

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || translate(language(), "importer.defaultFile");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] || character);
}

export function inferAttachmentMime(name: string, provided = "") {
  if (provided && provided !== "application/octet-stream") return provided;
  const lower = name.toLowerCase();
  return lower.endsWith(".pdf") ? "application/pdf"
    : /\.(png|jpe?g|webp|gif|avif|svg)$/.test(lower) ? `image/${lower.endsWith(".svg") ? "svg+xml" : lower.match(/\.([^.]+)$/)?.[1]?.replace("jpg", "jpeg")}`
      : /\.(mp3|m4a|wav|ogg|flac)$/.test(lower) ? `audio/${lower.match(/\.([^.]+)$/)?.[1]?.replace("m4a", "mp4")}`
        : /\.(mp4|mov|webm|mkv)$/.test(lower) ? `video/${lower.match(/\.([^.]+)$/)?.[1]?.replace("mov", "quicktime")}`
          : lower.endsWith(".md") ? "text/markdown"
            : lower.endsWith(".txt") ? "text/plain"
              : lower.endsWith(".html") ? "text/html"
                : lower.endsWith(".docx") ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  : "application/octet-stream";
}

export async function storeAttachment(name: string, blob: Blob, sourcePath?: string): Promise<AttachmentRecord> {
  const mime = inferAttachmentMime(name, blob.type);
  const storedBlob = blob.type === mime ? blob : blob.slice(0, blob.size, mime);
  return persistAttachment(name, storedBlob, mime, sourcePath);
}

async function extractPdf(blob: Blob) {
  const currentLanguage = language();
  const { getPdfDocument } = await import("./pdfRuntime");
  const data = new Uint8Array(await blob.arrayBuffer());
  const document = await getPdfDocument({ data }).promise;
  const pages: string[] = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " ").trim());
  }
  return { text: pages.map((text, index) => `${translate(currentLanguage, "importer.page", { page: index + 1 })}\n${text}`).join("\n\n"), pageCount: document.numPages };
}

function textToHtml(text: string) {
  const escaped = text.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char] || char));
  return escaped.split(/\n{2,}/).map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`).join("");
}

export async function importFile(name: string, blob: Blob, sourcePath?: string): Promise<CardRecord> {
  const currentLanguage = language();
  const safeName = escapeHtml(name);
  const lower = name.toLowerCase();
  const attachment = await storeAttachment(name, blob, sourcePath);
  const { id: attachmentId, mime } = attachment;
  try {
  let storedBlob = blob.type === mime ? blob : blob.slice(0, blob.size, mime);
  const needsContent = lower.endsWith(".pdf") || lower.endsWith(".md") || lower.endsWith(".txt") || lower.endsWith(".html") || lower.endsWith(".docx")
    || mime === "application/pdf" || mime.startsWith("text/") || mime.includes("wordprocessingml");
  if (sourcePath && storedBlob.size === 0 && needsContent) {
    const response = await fetch(attachmentUrl(attachment));
    if (!response.ok) throw new Error(translate(currentLanguage, "importer.filePlain", { name }));
    storedBlob = await response.blob();
  }

  let kind: CardKind = "note";
  let contentHtml = "";
  let plainText = "";
  let properties: CardRecord["properties"] = { [translate(currentLanguage, "importer.filename")]: name, [translate(currentLanguage, "importer.size")]: attachment.size };

  if (lower.endsWith(".pdf") || mime === "application/pdf") {
    kind = "pdf";
    const parsed = await extractPdf(storedBlob);
    plainText = parsed.text;
    contentHtml = `<h2>${translate(currentLanguage, "importer.pdfText")}</h2>${textToHtml(parsed.text)}`;
    properties = { ...properties, [translate(currentLanguage, "importer.pages")]: parsed.pageCount };
  } else if (lower.endsWith(".md") || mime === "text/markdown") {
    plainText = await storedBlob.text();
    contentHtml = DOMPurify.sanitize(await marked.parse(plainText));
  } else if (lower.endsWith(".txt") || mime.startsWith("text/plain")) {
    plainText = await storedBlob.text();
    contentHtml = textToHtml(plainText);
  } else if (lower.endsWith(".html") || mime === "text/html") {
    const source = await storedBlob.text();
    contentHtml = DOMPurify.sanitize(source);
    plainText = new DOMParser().parseFromString(contentHtml, "text/html").body.textContent || "";
  } else if (lower.endsWith(".docx") || mime.includes("wordprocessingml")) {
    const mammoth = (await import("mammoth/mammoth.browser")).default;
    const result = await mammoth.convertToHtml({ arrayBuffer: await storedBlob.arrayBuffer() });
    contentHtml = DOMPurify.sanitize(result.value);
    plainText = new DOMParser().parseFromString(contentHtml, "text/html").body.textContent || "";
    properties = { ...properties, [translate(currentLanguage, "importer.format")]: translate(currentLanguage, "importer.word") };
  } else if (mime.startsWith("image/")) {
    kind = "image";
    contentHtml = `<h2>${translate(currentLanguage, "importer.imageTitle")}</h2><p>${translate(currentLanguage, "importer.imageSaved", { name: safeName })}</p>`;
    plainText = translate(currentLanguage, "importer.imagePlain", { name });
  } else if (mime.startsWith("audio/")) {
    kind = "audio";
    contentHtml = `<h2>${translate(currentLanguage, "importer.audioTitle")}</h2><p>${translate(currentLanguage, "importer.audioSaved", { name: safeName })}</p>`;
    plainText = translate(currentLanguage, "importer.audioPlain", { name });
  } else if (mime.startsWith("video/")) {
    kind = "video";
    contentHtml = `<h2>${translate(currentLanguage, "importer.videoTitle")}</h2><p>${translate(currentLanguage, "importer.videoSaved", { name: safeName })}</p>`;
    plainText = translate(currentLanguage, "importer.videoPlain", { name });
  } else {
    contentHtml = `<h2>${translate(currentLanguage, "importer.fileTitle")}</h2><p>${translate(currentLanguage, "importer.fileSaved", { name: safeName })}</p>`;
    plainText = translate(currentLanguage, "importer.filePlain", { name });
  }

  return await createCard({
    title: baseName(name),
    kind,
    state: "active",
    contentHtml: contentHtml || "<p></p>",
    plainText,
    attachmentIds: [attachmentId],
    properties,
    color: kind === "pdf" ? "rose" : kind === "image" ? "amber" : kind === "audio" || kind === "video" ? "violet" : "slate",
  });
  } catch (error) {
    await removeStoredAttachment(attachment).catch(() => {});
    throw error;
  }
}

export async function importWebUrl(rawUrl: string): Promise<CardRecord> {
  const currentLanguage = language();
  const target = new URL(rawUrl.trim());
  const isYouTube = /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(target.hostname);
  if (isYouTube) {
    return createCard({
      title: translate(currentLanguage, "importer.youtubeTitle"),
      kind: "video",
      state: "active",
      sourceUrl: target.href,
      contentHtml: `<h2>${translate(currentLanguage, "importer.youtubeSource")}</h2><p><a href="${target.href}">${target.href}</a></p><p>${translate(currentLanguage, "importer.youtubeHint")}</p>`,
      plainText: translate(currentLanguage, "importer.youtubePlain", { url: target.href }),
      color: "rose",
      properties: { [translate(currentLanguage, "importer.source")]: "YouTube" },
    });
  }
  if (!window.chengjing) throw new Error(translate(currentLanguage, "importer.desktopWeb"));
  const article = await window.chengjing.web.read(target.href);
  return createCard({
    title: article.title,
    kind: "web",
    state: "active",
    sourceUrl: article.url,
    contentHtml: DOMPurify.sanitize(article.content, { ADD_ATTR: ["target"] }),
    plainText: article.textContent,
    color: "sky",
    properties: { [translate(currentLanguage, "importer.sourceSite")]: article.siteName, [translate(currentLanguage, "importer.author")]: article.byline || null },
  });
}
