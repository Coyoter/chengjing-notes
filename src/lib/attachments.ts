import { db } from "../db";
import type { AttachmentRecord } from "../types";
import { blobToDataUrl, dataUrlToBlob } from "./utils";
import { ignoreTransactionHistory } from "./historyTransactions";

function base64FromDataUrl(value: string) {
  return value.slice(value.indexOf(",") + 1);
}

export function attachmentUrl(attachment: AttachmentRecord) {
  if (attachment.storage === "file" && attachment.relativePath) {
    return `chengjing-attachment://local/${encodeURIComponent(attachment.relativePath)}`;
  }
  return attachment.blob ? URL.createObjectURL(attachment.blob) : "";
}

export function shouldRevokeAttachmentUrl(attachment: AttachmentRecord) {
  return attachment.storage !== "file" && Boolean(attachment.blob);
}

export async function persistAttachment(name: string, blob: Blob, mime: string, sourcePath?: string): Promise<AttachmentRecord> {
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  let attachment: AttachmentRecord;
  if (window.chengjing?.attachments) {
    attachment = sourcePath
      ? await window.chengjing.attachments.importPath({ id, sourcePath, name, mime, createdAt })
      : await window.chengjing.attachments.importData({ id, data: base64FromDataUrl(await blobToDataUrl(blob)), name, mime, createdAt });
  } else {
    const storedBlob = blob.type === mime ? blob : blob.slice(0, blob.size, mime);
    attachment = { id, name, mime, size: storedBlob.size, blob: storedBlob, storage: "indexeddb", createdAt };
  }
  await db.attachments.add(attachment);
  return attachment;
}

export async function migrateLegacyAttachment(attachment: AttachmentRecord) {
  if (attachment.storage === "file" && attachment.relativePath) return attachment;
  if (!attachment.blob || !window.chengjing?.attachments) return attachment;
  const stored = await window.chengjing.attachments.importData({
    id: attachment.id,
    name: attachment.name,
    mime: attachment.mime,
    createdAt: attachment.createdAt,
    data: base64FromDataUrl(await blobToDataUrl(attachment.blob)),
  });
  await db.transaction("rw", db.attachments, async (transaction) => {
    ignoreTransactionHistory(transaction);
    await db.attachments.put(stored);
  });
  return stored;
}

export async function migrateLegacyAttachments() {
  const legacy = await db.attachments.filter((attachment) => attachment.storage !== "file" || !attachment.relativePath).toArray();
  let migrated = 0;
  for (const attachment of legacy) {
    const stored = await migrateLegacyAttachment(attachment);
    if (stored.storage === "file") migrated += 1;
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  }
  return migrated;
}

export async function portableAttachmentBlob(attachment: AttachmentRecord) {
  if (attachment.blob) return attachment.blob;
  if (attachment.storage === "file" && attachment.relativePath && window.chengjing?.attachments) {
    const base64 = await window.chengjing.attachments.readData(attachment.relativePath);
    return dataUrlToBlob(`data:${attachment.mime};base64,${base64}`);
  }
  return new Blob([], { type: attachment.mime });
}

export async function removeStoredAttachment(attachment: AttachmentRecord) {
  if (attachment.storage === "file" && attachment.relativePath) await window.chengjing?.attachments?.remove(attachment.relativePath);
  await db.attachments.delete(attachment.id);
}

export async function restoreFileAttachment(attachment: AttachmentRecord, backupFilePath: string) {
  if (!attachment.sha256 || !window.chengjing?.attachments) return attachment;
  return window.chengjing.attachments.restoreFromBackup({
    id: attachment.id,
    backupFilePath,
    sha256: attachment.sha256,
    name: attachment.name,
    mime: attachment.mime,
    createdAt: attachment.createdAt,
  });
}
