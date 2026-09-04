const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { normalizeBaseUrl, providerProfileWithSecret, readProviderSettings, removeProviderProfile, selectProviderProfile, upsertProviderProfile } = require("./provider-settings.cjs");

test("進階 Provider 只允許 HTTPS 遠端或 loopback HTTP", () => {
  assert.equal(normalizeBaseUrl("http://127.0.0.1:11434/v1/", "ollama"), "http://127.0.0.1:11434/v1");
  assert.equal(normalizeBaseUrl("https://gateway.example.com/v1/"), "https://gateway.example.com/v1");
  assert.throws(() => normalizeBaseUrl("http://gateway.example.com/v1"), /provider-insecure-remote-url/);
  assert.throws(() => normalizeBaseUrl("file:///tmp/provider"), /provider-base-url-invalid/);
});

test("Provider API Key 獨立加密且不寫入公開設定", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-provider-test-"));
  try {
    let settings = await upsertProviderProfile(root, { name: "Local Ollama", type: "ollama", apiMode: "responses", baseUrl: "http://localhost:11434/v1", model: "qwen3:8b", apiKey: "private-provider-key" });
    assert.equal(settings.profiles.length, 1);
    assert.equal(settings.profiles[0].keyConfigured, true);
    assert.equal(settings.profiles[0].apiMode, "responses");
    const raw = await fs.readFile(path.join(root, "ai-provider-settings.json"), "utf8");
    assert.equal(raw.includes("private-provider-key"), false);
    assert.equal((await fs.readFile(path.join(root, "ai-provider-secrets.vault.json"))).includes(Buffer.from("private-provider-key")), false);
    const resolved = await providerProfileWithSecret(root, settings.profiles[0].id);
    assert.equal(resolved.apiKey, "private-provider-key");
    settings = await selectProviderProfile(root, settings.profiles[0].id);
    assert.equal(settings.selectedProfileId, settings.profiles[0].id);
    settings = await removeProviderProfile(root, settings.profiles[0].id);
    assert.equal(settings.profiles.length, 0);
    assert.deepEqual(await readProviderSettings(root), { selectedProfileId: "", profiles: [] });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
