const fs = require("node:fs/promises");
const path = require("node:path");
const { createReadStream } = require("node:fs");
const { createHash, randomUUID } = require("node:crypto");
const { writeAtomic } = require("./secure-json-vault.cjs");

async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function restoreAttachmentFile(directory, request) {
  const hash = String(request.sha256 || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("invalid-backup-attachment");
  const name = String(request.name || "attachment").replace(/[\u0000-\u001f<>:"/\\|?*]/g, "-").slice(0, 160);
  const source = path.join(path.dirname(path.resolve(String(request.backupFilePath || ""))), "ChengJing-AutoBackup-Assets", hash);
  const relativePath = `restored-${randomUUID()}-${name}`;
  const destination = path.join(directory, relativePath);
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.copyFile(source, destination);
    if (await hashFile(destination) !== hash) throw new Error("backup-asset-hash-mismatch");
    const stat = await fs.stat(destination);
    return { id: request.id, name, mime: request.mime || "application/octet-stream", size: stat.size, storage: "file", relativePath, sha256: hash, createdAt: request.createdAt || Date.now() };
  } catch (error) {
    await fs.rm(destination, { force: true }).catch(() => {});
    throw error;
  }
}

/** Files remain readable by Undo until the next workspace launch. */
function createAttachmentRemovalQueue(directory, userDataDirectory) {
  const manifest = path.join(userDataDirectory, "pending-attachment-removals.json");
  let chain = Promise.resolve();
  const serialized = (operation) => {
    const result = chain.then(operation);
    chain = result.catch(() => {});
    return result;
  };
  const read = async () => {
    try { const data = JSON.parse(await fs.readFile(manifest, "utf8")); return new Set(Array.isArray(data) ? data.filter((name) => typeof name === "string" && path.basename(name) === name && !/[\\/]/.test(name) && name !== "." && name !== "..") : []); }
    catch (error) { if (error.code === "ENOENT") return new Set(); throw error; }
  };
  return {
    pendingPaths() { return serialized(async () => [...await read()]); },
    defer(relativePath) {
      return serialized(async () => {
        if (typeof relativePath !== "string" || path.basename(relativePath) !== relativePath || /[\\/]/.test(relativePath) || [".", ".."].includes(relativePath)) throw new Error("invalid-attachment-path");
        const pending = await read(); pending.add(relativePath);
        await writeAtomic(manifest, Buffer.from(JSON.stringify([...pending])));
        return { removed: true };
      });
    },
    sweep(keepPaths) {
      return serialized(async () => {
        const keep = new Set(keepPaths);
        let removed = 0;
        for (const name of await read()) if (!keep.has(name)) { await fs.rm(path.join(directory, name), { force: true }); removed++; }
        await fs.rm(manifest, { force: true });
        return { removed };
      });
    },
  };
}

module.exports = { restoreAttachmentFile, createAttachmentRemovalQueue };
