const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const MASTER_KEY_FILE = "chengjing-local-vault.key";
const SECRET_FILE = "openrouter-key.vault.json";
const AAD = Buffer.from("chengjing-openrouter-key-v1", "utf8");

function vaultPaths(userDataPath) {
  return {
    masterKey: path.join(userDataPath, MASTER_KEY_FILE),
    secret: path.join(userDataPath, SECRET_FILE),
  };
}

async function prepareDirectory(userDataPath) {
  await fs.mkdir(userDataPath, { recursive: true, mode: 0o700 });
  await fs.chmod(userDataPath, 0o700).catch(() => {});
}

async function readOrCreateMasterKey(userDataPath) {
  await prepareDirectory(userDataPath);
  const { masterKey } = vaultPaths(userDataPath);
  try {
    const existing = await fs.readFile(masterKey);
    if (existing.length !== 32) throw new Error("澄境的本機加密密鑰格式不正確。");
    return existing;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const generated = crypto.randomBytes(32);
  try {
    await fs.writeFile(masterKey, generated, { mode: 0o600, flag: "wx" });
    return generated;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await fs.readFile(masterKey);
    if (existing.length !== 32) throw new Error("澄境的本機加密密鑰格式不正確。");
    return existing;
  }
}

async function writeSecret(userDataPath, value) {
  const key = await readOrCreateMasterKey(userDataPath);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const payload = JSON.stringify({
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: encrypted.toString("base64"),
    updatedAt: new Date().toISOString(),
  });
  const { secret } = vaultPaths(userDataPath);
  const temporary = `${secret}.${process.pid}.tmp`;
  await fs.writeFile(temporary, payload, { mode: 0o600 });
  await fs.rename(temporary, secret);
  await fs.chmod(secret, 0o600).catch(() => {});
}

async function readSecret(userDataPath) {
  const { masterKey, secret } = vaultPaths(userDataPath);
  try {
    const [key, raw] = await Promise.all([fs.readFile(masterKey), fs.readFile(secret, "utf8")]);
    if (key.length !== 32) throw new Error("本機加密密鑰格式不正確。");
    const payload = JSON.parse(raw);
    if (payload?.version !== 1 || payload?.algorithm !== "aes-256-gcm") throw new Error("加密金鑰檔格式不支援。");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw new Error("無法解開澄境保存的 OpenRouter 金鑰；請在設定中重新輸入一次。", { cause: error });
  }
}

async function clearSecret(userDataPath) {
  const { masterKey, secret } = vaultPaths(userDataPath);
  await Promise.all([fs.rm(secret, { force: true }), fs.rm(masterKey, { force: true })]);
}

async function secretStatus(userDataPath) {
  try {
    return { configured: Boolean(await readSecret(userDataPath)), encrypted: true, storage: "app-local-aes-256-gcm" };
  } catch (error) {
    return { configured: false, encrypted: true, storage: "app-local-aes-256-gcm", error: error.message };
  }
}

module.exports = { clearSecret, readSecret, secretStatus, vaultPaths, writeSecret };
