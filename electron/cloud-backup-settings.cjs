const fs = require("node:fs/promises");
const path = require("node:path");
const { createCipheriv, createDecipheriv, randomBytes, randomUUID } = require("node:crypto");

const SETTINGS_FILE = "google-cloud-backup-settings.json";
const TOKEN_FILE = "google-drive-token.vault";
const TOKEN_KEY_FILE = "google-drive-token.key";
const TOKEN_AAD = Buffer.from("chengjing-google-drive-token-v1", "utf8");
const ALLOWED_INTERVALS = new Set([15, 30, 60, 180]);
const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  intervalMinutes: 30,
  accountName: "",
  accountEmail: "",
  deviceId: "",
  lastAttemptAt: 0,
  lastSuccessAt: 0,
  lastContentHash: "",
  lastKnownManifestId: "",
  lastError: "",
  conflict: false,
});

function finiteTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function safeText(value, maximum = 300) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function normalizeCloudSettings(value = {}) {
  const interval = Number(value.intervalMinutes);
  return {
    enabled: Boolean(value.enabled),
    intervalMinutes: ALLOWED_INTERVALS.has(interval) ? interval : DEFAULT_SETTINGS.intervalMinutes,
    accountName: safeText(value.accountName, 160),
    accountEmail: safeText(value.accountEmail, 254),
    deviceId: /^[a-f0-9-]{20,80}$/i.test(String(value.deviceId || "")) ? String(value.deviceId) : "",
    lastAttemptAt: finiteTimestamp(value.lastAttemptAt),
    lastSuccessAt: finiteTimestamp(value.lastSuccessAt),
    lastContentHash: /^[a-f0-9]{64}$/i.test(String(value.lastContentHash || "")) ? String(value.lastContentHash).toLowerCase() : "",
    lastKnownManifestId: safeText(value.lastKnownManifestId, 240),
    lastError: safeText(value.lastError, 600),
    conflict: Boolean(value.conflict),
  };
}

function settingsPath(userDataDirectory) {
  return path.join(userDataDirectory, SETTINGS_FILE);
}

function tokenPath(userDataDirectory) {
  return path.join(userDataDirectory, TOKEN_FILE);
}

async function writeAtomic(destination, data, mode = 0o600) {
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  const handle = await fs.open(temporary, "wx", mode);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  await handle.close();
  await fs.rename(temporary, destination);
  await fs.chmod(destination, mode).catch(() => {});
}

async function readCloudSettings(userDataDirectory) {
  let parsed = {};
  try {
    parsed = JSON.parse(await fs.readFile(settingsPath(userDataDirectory), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.name !== "SyntaxError") throw error;
  }
  const normalized = normalizeCloudSettings(parsed);
  if (!normalized.deviceId) {
    normalized.deviceId = randomUUID();
    await writeAtomic(settingsPath(userDataDirectory), Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`, "utf8"));
  }
  return normalized;
}

async function writeCloudSettings(userDataDirectory, value) {
  const normalized = normalizeCloudSettings(value);
  if (!normalized.deviceId) normalized.deviceId = randomUUID();
  await writeAtomic(settingsPath(userDataDirectory), Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`, "utf8"));
  return normalized;
}

async function hasSecureToken(userDataDirectory) {
  try {
    const stat = await fs.stat(tokenPath(userDataDirectory));
    return stat.isFile() && stat.size > 0;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readOrCreateTokenKey(userDataDirectory) {
  await fs.mkdir(userDataDirectory, { recursive: true, mode: 0o700 });
  const destination = path.join(userDataDirectory, TOKEN_KEY_FILE);
  try {
    const existing = await fs.readFile(destination);
    if (existing.length !== 32) throw new Error("cloud-token-key-invalid");
    return existing;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const generated = randomBytes(32);
  try {
    await fs.writeFile(destination, generated, { mode: 0o600, flag: "wx" });
    return generated;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await fs.readFile(destination);
    if (existing.length !== 32) throw new Error("cloud-token-key-invalid");
    return existing;
  }
}

async function writeSecureToken(userDataDirectory, safeStorage, value, platform = process.platform) {
  if (platform === "darwin") {
    const key = await readOrCreateTokenKey(userDataDirectory);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(TOKEN_AAD);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    const envelope = {
      version: 1,
      backend: "app-local-aes-256-gcm",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    await writeAtomic(tokenPath(userDataDirectory), Buffer.from(JSON.stringify(envelope), "utf8"));
    return;
  }
  if (!safeStorage || !await safeStorage.isAsyncEncryptionAvailable()) throw new Error("cloud-secure-storage-unavailable");
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(value));
  const envelope = { version: 1, backend: "os-safe-storage", ciphertext: encrypted.toString("base64") };
  await writeAtomic(tokenPath(userDataDirectory), Buffer.from(JSON.stringify(envelope), "utf8"));
}

async function readSecureToken(userDataDirectory, safeStorage, platform = process.platform) {
  let raw;
  try {
    raw = await fs.readFile(tokenPath(userDataDirectory));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  try {
    const envelope = JSON.parse(raw.toString("utf8"));
    if (envelope?.version !== 1) throw new Error("cloud-token-envelope-invalid");
    if (envelope.backend === "app-local-aes-256-gcm") {
      const key = await fs.readFile(path.join(userDataDirectory, TOKEN_KEY_FILE));
      if (key.length !== 32) throw new Error("cloud-token-key-invalid");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
      decipher.setAAD(TOKEN_AAD);
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const decrypted = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
      return JSON.parse(decrypted.toString("utf8"));
    }
    if (envelope.backend !== "os-safe-storage") throw new Error("cloud-token-backend-invalid");
    if (!safeStorage || !await safeStorage.isAsyncEncryptionAvailable()) throw new Error("cloud-secure-storage-unavailable");
    const decrypted = await safeStorage.decryptStringAsync(Buffer.from(envelope.ciphertext, "base64"));
    const value = JSON.parse(decrypted.result);
    if (decrypted.shouldReEncrypt) await writeSecureToken(userDataDirectory, safeStorage, value, platform);
    return value;
  } catch (error) {
    throw new Error("cloud-token-unreadable", { cause: error });
  }
}

async function clearSecureToken(userDataDirectory) {
  await Promise.all([
    fs.rm(tokenPath(userDataDirectory), { force: true }),
    fs.rm(path.join(userDataDirectory, TOKEN_KEY_FILE), { force: true }),
  ]);
}

module.exports = {
  ALLOWED_INTERVALS,
  DEFAULT_SETTINGS,
  SETTINGS_FILE,
  TOKEN_FILE,
  TOKEN_KEY_FILE,
  clearSecureToken,
  hasSecureToken,
  normalizeCloudSettings,
  readCloudSettings,
  readSecureToken,
  settingsPath,
  tokenPath,
  writeCloudSettings,
  writeSecureToken,
};
