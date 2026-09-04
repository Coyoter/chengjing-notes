const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { readSecureJson, writeAtomic, writeSecureJson } = require("./secure-json-vault.cjs");

const SETTINGS_FILE = "mcp-settings.json";
const AUDIT_FILE = "mcp-audit.json";
const VAULT_NAMESPACE = "mcp-access-token";
const DEFAULT_PORT = 47831;
const MODES = new Set(["read-only", "ask", "allow"]);

function settingsPath(userDataDirectory) { return path.join(userDataDirectory, SETTINGS_FILE); }
function auditPath(userDataDirectory) { return path.join(userDataDirectory, AUDIT_FILE); }

function normalizeMcpSettings(value = {}) {
  const port = Number(value.port);
  return {
    enabled: Boolean(value.enabled),
    accessMode: MODES.has(value.accessMode) ? value.accessMode : "read-only",
    port: Number.isInteger(port) && port >= 10_240 && port <= 65_535 ? port : DEFAULT_PORT,
  };
}

async function readMcpSettings(userDataDirectory) {
  try { return normalizeMcpSettings(JSON.parse(await fs.readFile(settingsPath(userDataDirectory), "utf8"))); }
  catch (error) {
    if (error?.code === "ENOENT" || error?.name === "SyntaxError") return normalizeMcpSettings();
    throw error;
  }
}

async function writeMcpSettings(userDataDirectory, value) {
  const settings = normalizeMcpSettings(value);
  await writeAtomic(settingsPath(userDataDirectory), Buffer.from(`${JSON.stringify({ version: 1, ...settings }, null, 2)}\n`, "utf8"));
  return settings;
}

async function readOrCreateMcpToken(userDataDirectory) {
  const stored = await readSecureJson(userDataDirectory, VAULT_NAMESPACE, null);
  if (typeof stored?.token === "string" && stored.token.length >= 32) return stored.token;
  const token = randomBytes(32).toString("base64url");
  await writeSecureJson(userDataDirectory, VAULT_NAMESPACE, { token });
  return token;
}

async function regenerateMcpToken(userDataDirectory) {
  const token = randomBytes(32).toString("base64url");
  await writeSecureJson(userDataDirectory, VAULT_NAMESPACE, { token });
  return token;
}

async function readMcpAudit(userDataDirectory) {
  try {
    const value = JSON.parse(await fs.readFile(auditPath(userDataDirectory), "utf8"));
    return Array.isArray(value) ? value.slice(0, 40) : [];
  } catch (error) {
    if (error?.code === "ENOENT" || error?.name === "SyntaxError") return [];
    throw error;
  }
}

async function appendMcpAudit(userDataDirectory, event = {}) {
  const current = await readMcpAudit(userDataDirectory);
  const next = [{
    id: randomBytes(9).toString("base64url"),
    tool: String(event.tool || "unknown").slice(0, 120),
    summary: String(event.summary || "").slice(0, 300),
    outcome: ["success", "denied", "error"].includes(event.outcome) ? event.outcome : "error",
    createdAt: Date.now(),
  }, ...current].slice(0, 40);
  await writeAtomic(auditPath(userDataDirectory), Buffer.from(`${JSON.stringify(next, null, 2)}\n`, "utf8"));
  return next;
}

module.exports = {
  AUDIT_FILE,
  DEFAULT_PORT,
  MODES,
  SETTINGS_FILE,
  appendMcpAudit,
  auditPath,
  normalizeMcpSettings,
  readMcpAudit,
  readMcpSettings,
  readOrCreateMcpToken,
  regenerateMcpToken,
  settingsPath,
  writeMcpSettings,
};
