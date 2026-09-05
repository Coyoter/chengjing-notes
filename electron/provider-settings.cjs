const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { clearSecureJson, readSecureJson, writeAtomic, writeSecureJson } = require("./secure-json-vault.cjs");

const SETTINGS_FILE = "ai-provider-settings.json";
const VAULT_NAMESPACE = "ai-provider-secrets";
const PROFILE_LIMIT = 12;
const TYPES = new Set(["openai-compatible", "ollama"]);
const API_MODES = new Set(["chat-completions", "responses"]);
const writeQueues = new Map();

function serializeSettings(operation) {
  return (directory, ...args) => {
    const pending = (writeQueues.get(directory) || Promise.resolve()).then(() => operation(directory, ...args));
    const settled = pending.catch(() => {});
    writeQueues.set(directory, settled);
    void settled.then(() => { if (writeQueues.get(directory) === settled) writeQueues.delete(directory); });
    return pending;
  };
}

function safeText(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function isLoopbackHostname(hostname) {
  return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(String(hostname || "").toLowerCase());
}

function normalizeBaseUrl(value, type = "openai-compatible") {
  const fallback = type === "ollama" ? "http://127.0.0.1:11434/v1" : "";
  const raw = safeText(value, 1_000) || fallback;
  let url;
  try { url = new URL(raw); }
  catch { throw new Error("provider-base-url-invalid"); }
  if (url.username || url.password || url.search || url.hash) throw new Error("provider-base-url-invalid");
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) throw new Error("provider-insecure-remote-url");
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("provider-base-url-invalid");
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

function normalizeProfile(value = {}, previous = null, preserveTimestamps = false) {
  const type = TYPES.has(value.type) ? value.type : previous?.type || "openai-compatible";
  const apiMode = API_MODES.has(value.apiMode) ? value.apiMode : API_MODES.has(previous?.apiMode) ? previous.apiMode : "chat-completions";
  const now = Date.now();
  const id = /^[a-zA-Z0-9_-]{8,80}$/.test(String(value.id || "")) ? String(value.id) : previous?.id || randomUUID();
  const name = safeText(value.name, 80) || previous?.name || (type === "ollama" ? "Ollama" : "Custom Gateway");
  const model = safeText(value.model, 240);
  if (!model) throw new Error("provider-model-required");
  return {
    id,
    name,
    type,
    apiMode,
    baseUrl: normalizeBaseUrl(value.baseUrl || previous?.baseUrl, type),
    model,
    createdAt: Number(previous?.createdAt) > 0 ? Number(previous.createdAt) : now,
    updatedAt: preserveTimestamps && Number(value.updatedAt) > 0 ? Number(value.updatedAt) : now,
  };
}

function settingsPath(userDataDirectory) {
  return path.join(userDataDirectory, SETTINGS_FILE);
}

async function readRawSettings(userDataDirectory) {
  try { return JSON.parse(await fs.readFile(settingsPath(userDataDirectory), "utf8")); }
  catch (error) {
    if (error?.code === "ENOENT" || error?.name === "SyntaxError") return {};
    throw error;
  }
}

async function readProviderSettings(userDataDirectory) {
  const raw = await readRawSettings(userDataDirectory);
  const profiles = Array.isArray(raw.profiles) ? raw.profiles.slice(0, PROFILE_LIMIT).flatMap((profile) => {
    try { return [normalizeProfile(profile, profile, true)]; } catch { return []; }
  }) : [];
  const secrets = await readSecureJson(userDataDirectory, VAULT_NAMESPACE, {});
  return {
    selectedProfileId: profiles.some((profile) => profile.id === raw.selectedProfileId) ? raw.selectedProfileId : profiles[0]?.id || "",
    profiles: profiles.map((profile) => ({ ...profile, keyConfigured: Boolean(secrets?.[profile.id]) })),
  };
}

async function writePublicSettings(userDataDirectory, selectedProfileId, profiles) {
  const payload = { version: 1, selectedProfileId, profiles: profiles.map(({ keyConfigured: _keyConfigured, ...profile }) => profile) };
  await writeAtomic(settingsPath(userDataDirectory), Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8"));
}

async function upsertProviderProfile(userDataDirectory, input = {}) {
  const current = await readProviderSettings(userDataDirectory);
  const existing = current.profiles.find((profile) => profile.id === input.id) || null;
  const profile = normalizeProfile(input, existing);
  const profiles = existing ? current.profiles.map((item) => item.id === profile.id ? { ...profile, keyConfigured: item.keyConfigured } : item) : [...current.profiles, { ...profile, keyConfigured: false }];
  if (profiles.length > PROFILE_LIMIT) throw new Error("provider-profile-limit");
  const secrets = await readSecureJson(userDataDirectory, VAULT_NAMESPACE, {});
  if (typeof input.apiKey === "string") {
    const apiKey = input.apiKey.trim();
    if (apiKey) secrets[profile.id] = apiKey;
    else delete secrets[profile.id];
    await writeSecureJson(userDataDirectory, VAULT_NAMESPACE, secrets);
  }
  const selectedProfileId = input.select === false ? current.selectedProfileId : profile.id;
  await writePublicSettings(userDataDirectory, selectedProfileId, profiles);
  return readProviderSettings(userDataDirectory);
}

async function selectProviderProfile(userDataDirectory, id) {
  const current = await readProviderSettings(userDataDirectory);
  if (!current.profiles.some((profile) => profile.id === id)) throw new Error("provider-profile-not-found");
  await writePublicSettings(userDataDirectory, id, current.profiles);
  return readProviderSettings(userDataDirectory);
}

async function removeProviderProfile(userDataDirectory, id) {
  const current = await readProviderSettings(userDataDirectory);
  const profiles = current.profiles.filter((profile) => profile.id !== id);
  if (profiles.length === current.profiles.length) throw new Error("provider-profile-not-found");
  const secrets = await readSecureJson(userDataDirectory, VAULT_NAMESPACE, {});
  delete secrets[id];
  if (Object.keys(secrets).length) await writeSecureJson(userDataDirectory, VAULT_NAMESPACE, secrets);
  else await clearSecureJson(userDataDirectory, VAULT_NAMESPACE);
  const selectedProfileId = current.selectedProfileId === id ? profiles[0]?.id || "" : current.selectedProfileId;
  await writePublicSettings(userDataDirectory, selectedProfileId, profiles);
  return readProviderSettings(userDataDirectory);
}

async function providerProfileWithSecret(userDataDirectory, id) {
  const current = await readProviderSettings(userDataDirectory);
  const profile = current.profiles.find((item) => item.id === (id || current.selectedProfileId));
  if (!profile) throw new Error("provider-profile-not-found");
  const secrets = await readSecureJson(userDataDirectory, VAULT_NAMESPACE, {});
  return { ...profile, apiKey: safeText(secrets?.[profile.id], 8_000) };
}

module.exports = {
  API_MODES,
  PROFILE_LIMIT,
  SETTINGS_FILE,
  VAULT_NAMESPACE,
  isLoopbackHostname,
  normalizeBaseUrl,
  normalizeProfile,
  providerProfileWithSecret,
  readProviderSettings,
  removeProviderProfile: serializeSettings(removeProviderProfile),
  selectProviderProfile: serializeSettings(selectProviderProfile),
  settingsPath,
  upsertProviderProfile: serializeSettings(upsertProviderProfile),
};
