import JSZip from "jszip";
import { db } from "../db";
import { intlLocale, translate } from "../i18n";
import { useAppStore } from "../store";
import { blobToDataUrl, dataUrlToBlob } from "./utils";
import { getCommunityIdentity, isCommunityIdentity, saveCommunityIdentity } from "./community";
import { migrateLegacyAttachments, portableAttachmentBlob, restoreFileAttachment } from "./attachments";
import type { AttachmentRecord } from "../types";
import { uniqueArchiveName, validateBackup } from "./backupValidation";
import { clearGlobalHistory, runWithoutGlobalHistory } from "./globalHistory";
import { getHealthCopy } from "./healthCopy";

const TABLES = ["cards", "cardVersions", "boards", "boardNodes", "boardEdges", "kanbanBoards", "kanbanLists", "kanbanPlacements", "tags", "tasks", "highlights", "chatThreads", "chatMessages", "courses", "preferences", "fragments", "brainEdges", "brainReports", "brainShares", "knowledgeGroups"] as const;

export async function estimateNoteStorageBytes() {
  return db.transaction("r", TABLES.map((name) => db.table(name)), async () => {
    let bytes = 0;
    for (const name of TABLES) bytes += new TextEncoder().encode(JSON.stringify(await db.table(name).toArray())).byteLength;
    return bytes;
  });
}

export async function createBackupObject() {
  const snapshot = await db.transaction("r", db.tables, async () => {
    const records = await Promise.all(TABLES.map(async (table) => [table, await db.table(table).toArray()] as const));
    return { records, attachments: await db.attachments.toArray() };
  });
  const data: Record<string, unknown> = Object.fromEntries(snapshot.records);
  data.attachments = await Promise.all(snapshot.attachments.map(async (item) => ({
    ...item,
    blob: await blobToDataUrl(await portableAttachmentBlob(item)),
  })));
  return {
    format: "chengjing-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    communityIdentity: getCommunityIdentity(),
    data,
  };
}

export async function createIncrementalBackupPayload() {
  await migrateLegacyAttachments();
  const snapshot = await db.transaction("r", db.tables, async () => {
    const records = await Promise.all(TABLES.map(async (table) => [table, await db.table(table).toArray()] as const));
    return { records, attachments: await db.attachments.toArray() };
  });
  const data: Record<string, unknown> = Object.fromEntries(snapshot.records);
  const attachments = snapshot.attachments.map(({ blob: _blob, ...attachment }) => attachment);
  data.attachments = attachments;
  const payload = {
    format: "chengjing-backup",
    version: 2,
    attachmentMode: "content-addressed",
    exportedAt: new Date().toISOString(),
    communityIdentity: getCommunityIdentity(),
    data,
  };
  return {
    data: JSON.stringify(payload),
    assets: attachments
      .filter((attachment) => attachment.storage === "file" && attachment.relativePath && attachment.sha256)
      .map((attachment) => ({ relativePath: attachment.relativePath!, sha256: attachment.sha256!, size: attachment.size })),
  };
}

export async function saveJsonBackup() {
  const language = useAppStore.getState().language || "zh-TW";
  const payload = JSON.stringify(await createBackupObject(), null, 2);
  const name = `${translate(language, "backup.filename")}-${new Date().toISOString().slice(0, 10)}.json`;
  if (window.chengjing) {
    return window.chengjing.files.save({ title: translate(language, "backup.exportTitle"), defaultPath: name, filters: [{ name: translate(language, "backup.filename"), extensions: ["json"] }], data: payload });
  }
  const blob = new Blob([payload], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
  return { canceled: false };
}

export async function saveMarkdownArchive() {
  const language = useAppStore.getState().language || "zh-TW";
  const zip = new JSZip();
  const cards = await db.cards.toArray();
  const usedNames = new Set<string>();
  for (const card of cards) {
    const safeTitle = uniqueArchiveName(card.title || card.id, usedNames);
    const frontMatter = [
      "---",
      `id: ${card.id}`,
      `type: ${card.kind}`,
      `created: ${new Date(card.createdAt).toISOString()}`,
      `updated: ${new Date(card.updatedAt).toISOString()}`,
      `tags: [${card.tagIds.join(", ")}]`,
      "---",
      "",
    ].join("\n");
    const text = card.plainText || card.contentHtml.replace(/<[^>]+>/g, " ");
    zip.file(`${translate(language, "backup.cardsFolder")}/${safeTitle}.md`, `${frontMatter}# ${card.title}\n\n${text}\n`);
  }
  const attachments = await db.attachments.toArray();
  for (const attachment of attachments) zip.file(`${translate(language, "backup.attachmentsFolder")}/${attachment.id}-${attachment.name}`, await portableAttachmentBlob(attachment));
  const fragments = await db.fragments.orderBy("createdAt").toArray();
  if (fragments.length) zip.file(`${translate(language, "backup.fragmentsFile")}.md`, fragments.map((fragment) => `- ${new Date(fragment.createdAt).toLocaleString(intlLocale[language])}  ${fragment.text}`).join("\n"));
  const reports = await db.brainReports.orderBy("date").toArray();
  if (reports.length) zip.file(`${translate(language, "backup.brainFolder")}/${translate(language, "backup.reflectionsFile")}.md`, reports.map((report) => `# ${report.date}\n\n${report.content}\n\n${translate(language, "backup.model")}: ${report.model}\n`).join("\n---\n\n"));
  const name = `ChengJing-Markdown-${new Date().toISOString().slice(0, 10)}.zip`;
  if (window.chengjing) {
    const base64 = await zip.generateAsync({ type: "base64", compression: "DEFLATE" });
    return window.chengjing.files.save({ title: translate(language, "backup.markdownTitle"), defaultPath: name, filters: [{ name: translate(language, "backup.zipFile"), extensions: ["zip"] }], data: base64, encoding: "base64" });
  }
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([buffer], { type: "application/zip" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
  return { canceled: false };
}

export async function restoreBackup(raw: string, backupFilePath = "") {
  const language = useAppStore.getState().language || "zh-TW";
  let parsed: ReturnType<typeof validateBackup>;
  try { parsed = validateBackup(JSON.parse(raw)); }
  catch { throw new Error(translate(language, "backup.invalid")); }
  const restoredAttachments: AttachmentRecord[] = parsed.version === 2
    ? await Promise.all((parsed.data.attachments as unknown as AttachmentRecord[]).map((item) => restoreFileAttachment(item, backupFilePath)))
    : parsed.data.attachments.map((item) => ({
      ...item as unknown as AttachmentRecord,
      storage: "indexeddb",
      blob: dataUrlToBlob(String(item.blob || "")),
    }));
  await runWithoutGlobalHistory(async () => {
    for (const table of db.tables) await table.clear();
    for (const name of TABLES) {
      const values = parsed.data[name];
      if (Array.isArray(values) && values.length) await db.table(name).bulkAdd(values);
    }
    if (restoredAttachments.length) await db.attachments.bulkAdd(restoredAttachments);
  });
  clearGlobalHistory();
  await window.chengjing?.attachments?.cleanup(restoredAttachments.map((attachment: AttachmentRecord) => attachment.relativePath).filter(Boolean) as string[]);
  if (isCommunityIdentity(parsed.communityIdentity)) {
    saveCommunityIdentity(parsed.communityIdentity);
    window.dispatchEvent(new CustomEvent("chengjing-community-identity", { detail: parsed.communityIdentity }));
  }
}

export async function restoreLocalBackup(raw: string, backupFilePath: string) {
  const language = useAppStore.getState().language || "zh-TW";
  try { validateBackup(JSON.parse(raw)); }
  catch { throw new Error(translate(language, "backup.invalid")); }
  if (!window.confirm(getHealthCopy(language).restoreConfirm)) return false;
  if (!window.chengjing?.backups?.writeSafety) throw new Error(translate(language, "settings.desktopRequired"));
  await window.chengjing.backups.writeSafety(await createIncrementalBackupPayload());
  await restoreBackup(raw, backupFilePath);
  return true;
}
