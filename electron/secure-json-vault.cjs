const { createCipheriv, createDecipheriv, randomBytes } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

function safeNamespace(value) {
  const namespace = String(value || "").trim();
  if (!/^[a-z0-9-]{3,48}$/.test(namespace)) throw new Error("secure-vault-namespace-invalid");
  return namespace;
}

function vaultPaths(userDataDirectory, rawNamespace) {
  const namespace = safeNamespace(rawNamespace);
  return {
    key: path.join(userDataDirectory, `${namespace}.key`),
    vault: path.join(userDataDirectory, `${namespace}.vault.json`),
    aad: Buffer.from(`chengjing-${namespace}-v1`, "utf8"),
  };
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

async function readOrCreateKey(userDataDirectory, namespace) {
  const paths = vaultPaths(userDataDirectory, namespace);
  await fs.mkdir(userDataDirectory, { recursive: true, mode: 0o700 });
  await fs.chmod(userDataDirectory, 0o700).catch(() => {});
  try {
    const existing = await fs.readFile(paths.key);
    if (existing.length !== 32) throw new Error("secure-vault-key-invalid");
    return existing;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const generated = randomBytes(32);
  try {
    await fs.writeFile(paths.key, generated, { mode: 0o600, flag: "wx" });
    return generated;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await fs.readFile(paths.key);
    if (existing.length !== 32) throw new Error("secure-vault-key-invalid");
    return existing;
  }
}

async function writeSecureJson(userDataDirectory, namespace, value) {
  const paths = vaultPaths(userDataDirectory, namespace);
  const key = await readOrCreateKey(userDataDirectory, namespace);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(paths.aad);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const envelope = {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  await writeAtomic(paths.vault, Buffer.from(JSON.stringify(envelope), "utf8"));
}

async function readSecureJson(userDataDirectory, namespace, fallback = null) {
  const paths = vaultPaths(userDataDirectory, namespace);
  try {
    const [key, raw] = await Promise.all([fs.readFile(paths.key), fs.readFile(paths.vault, "utf8")]);
    if (key.length !== 32) throw new Error("secure-vault-key-invalid");
    const envelope = JSON.parse(raw);
    if (envelope?.version !== 1 || envelope?.algorithm !== "aes-256-gcm") throw new Error("secure-vault-envelope-invalid");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(paths.aad);
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw new Error("secure-vault-unreadable", { cause: error });
  }
}

async function clearSecureJson(userDataDirectory, namespace) {
  const paths = vaultPaths(userDataDirectory, namespace);
  await Promise.all([fs.rm(paths.vault, { force: true }), fs.rm(paths.key, { force: true })]);
}

module.exports = { clearSecureJson, readSecureJson, vaultPaths, writeAtomic, writeSecureJson };
