const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_SHORTCUT = "CommandOrControl+\\";
const SETTINGS_FILE = "quick-capture-settings.json";

function normalizeQuickCaptureSettings(value = {}) {
  const shortcut = typeof value.shortcut === "string" && value.shortcut.length <= 80 && /^(?=.*(?:Command|Control|Alt|Shift|Super|Meta))[^\r\n]+$/.test(value.shortcut)
    ? value.shortcut
    : DEFAULT_SHORTCUT;
  return { shortcut };
}

async function readQuickCaptureSettings(userDataPath) {
  try { return normalizeQuickCaptureSettings(JSON.parse(await fs.readFile(path.join(userDataPath, SETTINGS_FILE), "utf8"))); }
  catch { return normalizeQuickCaptureSettings(); }
}

async function writeQuickCaptureSettings(userDataPath, value) {
  const settings = normalizeQuickCaptureSettings(value);
  await fs.mkdir(userDataPath, { recursive: true });
  const target = path.join(userDataPath, SETTINGS_FILE);
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(settings, null, 2), { mode: 0o600 });
  await fs.rename(temporary, target);
  return settings;
}

module.exports = { DEFAULT_SHORTCUT, normalizeQuickCaptureSettings, readQuickCaptureSettings, writeQuickCaptureSettings };
