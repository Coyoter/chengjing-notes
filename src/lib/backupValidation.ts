const REQUIRED_TABLES = ["cards", "boards", "boardNodes", "boardEdges", "tags", "tasks", "attachments"];

export function validateBackup(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("backup-invalid");
  const parsed = value as { format?: string; version?: number; data?: Record<string, unknown>; communityIdentity?: unknown };
  if (parsed.format !== "chengjing-backup" || ![1, 2].includes(parsed.version || 0) || !parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) throw new Error("backup-invalid");
  for (const name of REQUIRED_TABLES) if (!Array.isArray(parsed.data[name])) throw new Error("backup-invalid");
  for (const [name, records] of Object.entries(parsed.data)) {
    if (!Array.isArray(records)) throw new Error("backup-invalid");
    const keys = new Set<string>();
    for (const record of records) {
      const key = record?.[name === "preferences" ? "key" : "id"];
      if (!record || typeof record !== "object" || Array.isArray(record) || typeof key !== "string" || !key || keys.has(key)) throw new Error("backup-invalid");
      keys.add(key);
    }
  }
  for (const record of parsed.data.cards as Array<Record<string, unknown>>) {
    if (!["title", "contentHtml", "plainText", "kind", "state"].every((key) => typeof record[key] === "string") || !Array.isArray(record.tagIds) || !Array.isArray(record.attachmentIds)) throw new Error("backup-invalid");
    if (record.sourceUrl) { try { const url = new URL(String(record.sourceUrl)); if (!["https:", "http:"].includes(url.protocol)) throw new Error(); } catch { throw new Error("backup-invalid"); } }
  }
  return parsed as { format: string; version: number; data: Record<string, Array<Record<string, unknown>>>; communityIdentity?: unknown };
}

/** Keep names portable across Windows and macOS, including case-insensitive disks. */
export function uniqueArchiveName(title: string, used: Set<string>) {
  const base = title.normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").slice(0, 90) || "Untitled";
  const safe = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base) ? `_${base}` : base;
  let name = safe;
  let suffix = 2;
  while (used.has(name.toLowerCase())) name = `${safe} (${suffix++})`;
  used.add(name.toLowerCase());
  return name;
}
