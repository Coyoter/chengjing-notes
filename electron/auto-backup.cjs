const fs = require("node:fs/promises");
const { createHash } = require("node:crypto");
const { createReadStream } = require("node:fs");
const path = require("node:path");

const SETTINGS_FILE = "auto-backup-settings.json";
const BACKUP_PREFIX = "ChengJing-AutoBackup-";
const BACKUP_PATTERN = /^ChengJing-AutoBackup-\d{4}-\d{2}-\d{2}_\d{6}(?:-\d+)?\.json$/;
const ASSET_DIRECTORY = "ChengJing-AutoBackup-Assets";
const ALLOWED_INTERVALS = new Set([1, 3, 7]);
const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  intervalDays: 1,
  retentionCount: 10,
  directory: "",
  lastAttemptAt: 0,
  lastSuccessAt: 0,
  lastFilePath: "",
  lastError: "",
});

function finiteTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function normalizeSettings(value = {}) {
  const rawDirectory = typeof value.directory === "string" ? value.directory.trim() : "";
  const directory = rawDirectory && path.isAbsolute(rawDirectory) ? path.normalize(rawDirectory) : "";
  const intervalDays = ALLOWED_INTERVALS.has(Number(value.intervalDays)) ? Number(value.intervalDays) : DEFAULT_SETTINGS.intervalDays;
  const retentionNumber = Math.floor(Number(value.retentionCount));
  const retentionCount = Number.isFinite(retentionNumber) ? Math.min(30, Math.max(3, retentionNumber)) : DEFAULT_SETTINGS.retentionCount;
  return {
    enabled: Boolean(value.enabled),
    intervalDays,
    retentionCount,
    directory,
    lastAttemptAt: finiteTimestamp(value.lastAttemptAt),
    lastSuccessAt: finiteTimestamp(value.lastSuccessAt),
    lastFilePath: typeof value.lastFilePath === "string" ? value.lastFilePath : "",
    lastError: typeof value.lastError === "string" ? value.lastError.slice(0, 600) : "",
  };
}

function settingsPath(userDataDirectory) {
  return path.join(userDataDirectory, SETTINGS_FILE);
}

async function readSettings(userDataDirectory) {
  try {
    const raw = await fs.readFile(settingsPath(userDataDirectory), "utf8");
    return normalizeSettings(JSON.parse(raw));
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.name !== "SyntaxError") throw error;
    return { ...DEFAULT_SETTINGS };
  }
}

async function writeSettings(userDataDirectory, value) {
  const normalized = normalizeSettings(value);
  await fs.mkdir(userDataDirectory, { recursive: true });
  const destination = settingsPath(userDataDirectory);
  const temporary = `${destination}.tmp-${process.pid}`;
  const handle = await fs.open(temporary, "w", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, destination);
  return normalized;
}

function backupFilename(date = new Date(), collisionIndex = 0) {
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ];
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()].map((value) => String(value).padStart(2, "0")).join("");
  const suffix = collisionIndex > 0 ? `-${collisionIndex}` : "";
  return `${BACKUP_PREFIX}${parts.join("-")}_${time}${suffix}.json`;
}

function isOwnedBackupFilename(filename) {
  return BACKUP_PATTERN.test(filename);
}

function selectExpiredBackups(entries, retentionCount) {
  const keep = Math.min(30, Math.max(3, Math.floor(Number(retentionCount)) || DEFAULT_SETTINGS.retentionCount));
  return entries
    .filter((entry) => entry && isOwnedBackupFilename(entry.name) && entry.isFile !== false)
    .sort((left, right) => {
      const modified = Number(right.mtimeMs || 0) - Number(left.mtimeMs || 0);
      return modified || right.name.localeCompare(left.name);
    })
    .slice(keep);
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function safeAssetSource(root, relativePath) {
  const base = path.resolve(root || "");
  const normalized = String(relativePath || "").replaceAll("\\", "/").replace(/^\/+/, "");
  const candidate = path.resolve(base, normalized);
  if (!normalized || (candidate !== base && !candidate.startsWith(`${base}${path.sep}`))) throw new Error("backup-asset-path-invalid");
  return candidate;
}

async function copyIncrementalAssets(directory, assetsDirectory, assets = []) {
  if (!assets.length) return { copiedAssets: 0, reusedAssets: 0 };
  const assetStore = path.join(directory, ASSET_DIRECTORY);
  await fs.mkdir(assetStore, { recursive: true });
  let copiedAssets = 0;
  let reusedAssets = 0;
  for (const asset of assets) {
    const sha256 = String(asset?.sha256 || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("backup-asset-hash-invalid");
    const source = safeAssetSource(assetsDirectory, asset.relativePath);
    const destination = path.join(assetStore, sha256);
    try {
      const stat = await fs.stat(destination);
      if (stat.isFile() && (!Number.isFinite(Number(asset.size)) || stat.size === Number(asset.size))) { reusedAssets += 1; continue; }
      await fs.rm(destination, { force: true });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (await hashFile(source) !== sha256) throw new Error("backup-asset-hash-mismatch");
    const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
    await fs.copyFile(source, temporary);
    await fs.rename(temporary, destination);
    copiedAssets += 1;
  }
  return { copiedAssets, reusedAssets };
}

async function cleanupIncrementalAssets(directory) {
  const assetStore = path.join(directory, ASSET_DIRECTORY);
  let backups;
  try { backups = (await fs.readdir(directory)).filter(isOwnedBackupFilename); }
  catch { return 0; }
  const referenced = new Set();
  for (const filename of backups) {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(directory, filename), "utf8"));
      for (const attachment of Array.isArray(parsed?.data?.attachments) ? parsed.data.attachments : []) {
        const hash = String(attachment?.sha256 || "").toLowerCase();
        if (/^[a-f0-9]{64}$/.test(hash)) referenced.add(hash);
      }
    } catch {}
  }
  let removed = 0;
  try {
    for (const entry of await fs.readdir(assetStore, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[a-f0-9]{64}$/.test(entry.name) || referenced.has(entry.name)) continue;
      await fs.rm(path.join(assetStore, entry.name), { force: true });
      removed += 1;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return removed;
}

async function createAutoBackup({ directory, data, retentionCount = DEFAULT_SETTINGS.retentionCount, now = new Date(), assetsDirectory = "", assets = [] }) {
  if (!path.isAbsolute(directory || "")) throw new Error("backup-directory-required");
  const directoryStat = await fs.stat(directory);
  if (!directoryStat.isDirectory()) throw new Error("backup-directory-invalid");
  const raw = typeof data === "string" ? data : "";
  const header = raw.slice(0, 1024);
  const validEnvelope = raw.length > 32
    && raw.trimStart().startsWith("{")
    && raw.trimEnd().endsWith("}")
    && /"format"\s*:\s*"chengjing-backup"/.test(header)
    && /"version"\s*:\s*[12](?:\s*[,}])/.test(header)
    && /"data"\s*:/.test(header);
  if (!validEnvelope) throw new Error("backup-payload-invalid");
  const assetResult = await copyIncrementalAssets(directory, assetsDirectory, assets);

  let collisionIndex = 0;
  let filename = backupFilename(now, collisionIndex);
  while (true) {
    try {
      await fs.access(path.join(directory, filename));
      collisionIndex += 1;
      filename = backupFilename(now, collisionIndex);
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
  }

  const destination = path.join(directory, filename);
  const temporary = path.join(directory, `.${filename}.tmp-${process.pid}-${Date.now()}`);
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(raw, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  await handle.close();
  await fs.rename(temporary, destination);

  const directoryEntries = await fs.readdir(directory, { withFileTypes: true });
  const ownedEntries = await Promise.all(directoryEntries
    .filter((entry) => entry.isFile() && isOwnedBackupFilename(entry.name))
    .map(async (entry) => ({ name: entry.name, isFile: true, mtimeMs: (await fs.stat(path.join(directory, entry.name))).mtimeMs })));
  const expired = selectExpiredBackups(ownedEntries, retentionCount);
  await Promise.all(expired.map((entry) => fs.rm(path.join(directory, entry.name), { force: true })));
  await cleanupIncrementalAssets(directory);
  return { filePath: destination, filename, bytes: Buffer.byteLength(raw), removedCount: expired.length, ...assetResult };
}

module.exports = {
  ALLOWED_INTERVALS,
  BACKUP_PATTERN,
  ASSET_DIRECTORY,
  DEFAULT_SETTINGS,
  backupFilename,
  createAutoBackup,
  isOwnedBackupFilename,
  normalizeSettings,
  readSettings,
  selectExpiredBackups,
  settingsPath,
  writeSettings,
};
