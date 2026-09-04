const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  clearSecureToken,
  hasSecureToken,
  normalizeCloudSettings,
  readCloudSettings,
  readSecureToken,
  TOKEN_KEY_FILE,
  tokenPath,
  writeCloudSettings,
  writeSecureToken,
} = require("./cloud-backup-settings.cjs");

let safeStorageCalls = 0;
const fakeSafeStorage = {
  async isAsyncEncryptionAvailable() { safeStorageCalls += 1; return true; },
  async encryptStringAsync(value) { safeStorageCalls += 1; return Buffer.from(`encrypted:${Buffer.from(value).toString("base64")}`); },
  async decryptStringAsync(value) {
    safeStorageCalls += 1;
    const raw = value.toString("utf8");
    return { result: Buffer.from(raw.slice("encrypted:".length), "base64").toString("utf8"), shouldReEncrypt: false };
  },
};

test("Google 雲端設定只接受支援的頻率並建立穩定裝置識別", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-cloud-settings-"));
  try {
    assert.equal(normalizeCloudSettings({ intervalMinutes: 17 }).intervalMinutes, 30);
    const first = await writeCloudSettings(directory, { enabled: true, intervalMinutes: 15 });
    const second = await readCloudSettings(directory);
    assert.match(first.deviceId, /^[a-f0-9-]{20,80}$/i);
    assert.equal(second.deviceId, first.deviceId);
    assert.equal(second.intervalMinutes, 15);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("Google refresh token 在 macOS 靜默加密且不呼叫鑰匙圈", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-cloud-token-"));
  const token = { refreshToken: "never-write-this-in-plain-text", accessToken: "short-lived", expiresAt: Date.now() + 60_000 };
  try {
    await writeSecureToken(directory, fakeSafeStorage, token);
    assert.equal(await hasSecureToken(directory), true);
    assert.deepEqual(await readSecureToken(directory, fakeSafeStorage), token);
    assert.equal((await fs.readFile(tokenPath(directory), "utf8")).includes(token.refreshToken), false);
    if (process.platform === "darwin") {
      const envelope = JSON.parse(await fs.readFile(tokenPath(directory), "utf8"));
      assert.equal(envelope.backend, "app-local-aes-256-gcm");
      assert.equal((await fs.stat(path.join(directory, TOKEN_KEY_FILE))).mode & 0o777, 0o600);
      assert.equal(safeStorageCalls, 0);
    }
    await clearSecureToken(directory);
    assert.equal(await hasSecureToken(directory), false);
    await assert.rejects(() => fs.stat(path.join(directory, TOKEN_KEY_FILE)), /ENOENT/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("Google refresh token 在 Windows 使用不跳提示的系統安全儲存", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-cloud-token-windows-"));
  const token = { refreshToken: "windows-dpapi-token", accessToken: "short-lived", expiresAt: Date.now() + 60_000 };
  safeStorageCalls = 0;
  try {
    await writeSecureToken(directory, fakeSafeStorage, token, "win32");
    const envelope = JSON.parse(await fs.readFile(tokenPath(directory), "utf8"));
    assert.equal(envelope.backend, "os-safe-storage");
    assert.equal((await fs.readFile(tokenPath(directory), "utf8")).includes(token.refreshToken), false);
    assert.deepEqual(await readSecureToken(directory, fakeSafeStorage, "win32"), token);
    assert.ok(safeStorageCalls >= 3);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
