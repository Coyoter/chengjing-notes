"use strict";
const { createHash } = require("node:crypto");
const { utcDay } = require("./sync-recovery-policy.cjs");

const RECOVERY_TABLES = Object.freeze([
  "cards", "boards", "boardNodes", "boardEdges", "kanbanBoards", "kanbanLists",
  "kanbanPlacements", "tags", "tasks", "highlights", "attachments", "fragments",
  "knowledgeGroups", "chatThreads", "chatMessages", "cardVersions", "brainEdges",
  "brainReports", "brainShares",
]);
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const digest = raw => createHash("sha256").update(raw, "utf8").digest("hex");

function parseRecoveryPayload(raw) {
  if (typeof raw !== "string" || !raw.length || Buffer.byteLength(raw, "utf8") > MAX_MANIFEST_BYTES) {
    throw new Error("sync-recovery-payload-size");
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error("sync-recovery-payload-invalid"); }
  if (!object(parsed) || parsed.format !== "chengjing-sync-recovery" || parsed.version !== 1
    || parsed.dayBasis !== "UTC" || !Number.isSafeInteger(parsed.snapshotAt) || parsed.snapshotAt < 0
    || !object(parsed.data)) throw new Error("sync-recovery-payload-invalid");
  const keys = Object.keys(parsed).sort().join(",");
  if (keys !== "data,dayBasis,format,snapshotAt,version") throw new Error("sync-recovery-private-fields");
  if (Object.keys(parsed.data).sort().join(",") !== [...RECOVERY_TABLES].sort().join(",")) {
    throw new Error("sync-recovery-tables-incomplete");
  }
  const assets = new Map();
  for (const table of RECOVERY_TABLES) {
    const rows = parsed.data[table];
    if (!Array.isArray(rows)) throw new Error("sync-recovery-table-invalid");
    const ids = new Set();
    for (const row of rows) {
      if (!object(row) || typeof row.id !== "string" || !row.id.trim() || row.id.length > 1024 || ids.has(row.id)) {
        throw new Error("sync-recovery-record-invalid");
      }
      ids.add(row.id);
      if (table !== "attachments") continue;
      if (Object.hasOwn(row, "blob") || Object.hasOwn(row, "relativePath")) throw new Error("sync-recovery-local-attachment-path");
      if (typeof row.sha256 !== "string" || !HASH_PATTERN.test(row.sha256) || !Number.isSafeInteger(row.size) || row.size < 0) {
        throw new Error("sync-recovery-asset-invalid");
      }
      const prior = assets.get(row.sha256);
      if (prior && prior.size !== row.size) throw new Error("sync-recovery-asset-size-conflict");
      assets.set(row.sha256, { sha256: row.sha256, size: row.size });
    }
  }
  return { parsed, day: utcDay(parsed.snapshotAt), assets: [...assets.values()], contentHash: digest(raw) };
}

function validateRecoverySources(required, sources) {
  if (!Array.isArray(sources)) throw new Error("sync-recovery-asset-sources-required");
  const byHash = new Map();
  for (const source of sources) {
    if (!object(source) || typeof source.sha256 !== "string" || !HASH_PATTERN.test(source.sha256) || typeof source.relativePath !== "string"
      || !source.relativePath || !Number.isSafeInteger(source.size) || source.size < 0) {
      throw new Error("sync-recovery-asset-source-invalid");
    }
    const prior = byHash.get(source.sha256);
    if (prior && prior.size !== source.size) throw new Error("sync-recovery-asset-size-conflict");
    byHash.set(source.sha256, source);
  }
  for (const expected of required) {
    if (byHash.get(expected.sha256)?.size !== expected.size) throw new Error("sync-recovery-asset-missing");
  }
  // Only sources referenced by the manifest may be uploaded.
  return required.map(item => byHash.get(item.sha256));
}

module.exports = { RECOVERY_TABLES, MAX_MANIFEST_BYTES, parseRecoveryPayload, validateRecoverySources, digest };
