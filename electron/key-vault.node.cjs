const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { clearSecret, readSecret, secretStatus, vaultPaths, writeSecret } = require("./key-vault.cjs");

test("AES-GCM 金鑰保存不含明碼且可跨次讀回", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-vault-test-"));
  const value = "test-openrouter-local-vault-secret";
  try {
    await writeSecret(directory, value);
    assert.equal(await readSecret(directory), value);
    const paths = vaultPaths(directory);
    const raw = await fs.readFile(paths.secret, "utf8");
    assert.equal(raw.includes(value), false);
    assert.equal((await fs.stat(paths.secret)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(paths.masterKey)).mode & 0o777, 0o600);
    assert.deepEqual(await secretStatus(directory), { configured: true, encrypted: true, storage: "app-local-aes-256-gcm" });
    await clearSecret(directory);
    assert.equal(await readSecret(directory), "");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
