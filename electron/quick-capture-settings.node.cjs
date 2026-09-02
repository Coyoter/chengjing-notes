const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DEFAULT_SHORTCUT, normalizeQuickCaptureSettings, readQuickCaptureSettings, writeQuickCaptureSettings } = require("./quick-capture-settings.cjs");

test("快速記錄快捷鍵有安全預設並拒絕無修飾鍵", () => {
  assert.equal(normalizeQuickCaptureSettings({ shortcut: "A" }).shortcut, DEFAULT_SHORTCUT);
  assert.equal(normalizeQuickCaptureSettings({ shortcut: "CommandOrControl+Shift+J" }).shortcut, "CommandOrControl+Shift+J");
});

test("快速記錄快捷鍵可跨次保存", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-quick-capture-"));
  await writeQuickCaptureSettings(directory, { shortcut: "CommandOrControl+Alt+J" });
  assert.equal((await readQuickCaptureSettings(directory)).shortcut, "CommandOrControl+Alt+J");
});
