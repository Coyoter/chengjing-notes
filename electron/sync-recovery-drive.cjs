"use strict";
const { createHash, randomUUID } = require("node:crypto");
const { createReadStream, constants } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { RECOVERY_APP, normalizeRecoverySnapshot, selectRecoverySnapshots } = require("./sync-recovery-policy.cjs");
const { createSyncRecoveryStore } = require("./sync-recovery-store.cjs");

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const validId = id => typeof id === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(id);

async function verifyFile(filename, expected) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(filename)) { hash.update(chunk); size += chunk.length; }
  if (size !== expected.size || hash.digest("hex") !== expected.sha256) {
    throw new Error("sync-recovery-attachment-corrupt");
  }
}

/** Shares the existing OAuth transport, never the legacy snapshot namespace. */
function createSyncRecoveryDrive(options) {
  const { userDataDirectory, attachmentsDirectory, authenticatedFetch, downloadText,
    createBufferFile, createStreamFile, streamDownload } = options;
  const now = options.now || (() => Date.now());
  for (const fn of [authenticatedFetch, downloadText, createBufferFile, createStreamFile, streamDownload]) {
    if (typeof fn !== "function") throw new Error("sync-recovery-transport-required");
  }
  if (typeof userDataDirectory !== "string" || typeof attachmentsDirectory !== "string") {
    throw new Error("sync-recovery-directories-required");
  }
  const stagingRoot = path.join(userDataDirectory, "sync-recovery-staging");
  const downloads = new Map();
  let enabled = false, epoch = 0, writeEpoch = null, writes = Promise.resolve();

  function setEnabled(value) {
    if (typeof value !== "boolean") throw new Error("sync-recovery-enabled-invalid");
    if (value !== enabled) { enabled = value; epoch++; }
    return { enabled };
  }
  async function assertWritable() {
    if (!enabled || writeEpoch !== epoch) throw new Error("sync-recovery-paused");
  }
  async function request(url, init) {
    const response = await authenticatedFetch(url, init);
    if (!response.ok) throw new Error(`sync-recovery-drive-http-${response.status}`);
    return response;
  }
  async function listFiles(kind) {
    if (!["manifest", "asset"].includes(kind)) throw new Error("sync-recovery-kind-invalid");
    const files = [], cursors = new Set();
    let cursor = "";
    do {
      const query = new URLSearchParams({
        spaces: "appDataFolder", pageSize: "1000",
        q: `trashed=false and appProperties has { key='app' and value='${RECOVERY_APP}' } and appProperties has { key='kind' and value='${kind}' }`,
        fields: "nextPageToken,incompleteSearch,files(id,name,size,createdTime,trashed,appProperties)",
      });
      if (cursor) query.set("pageToken", cursor);
      const result = await (await request(`${DRIVE_API}/files?${query}`)).json();
      if (!result || result.incompleteSearch || (result.files !== undefined && !Array.isArray(result.files))) {
        throw new Error("sync-recovery-list-incomplete");
      }
      files.push(...(result.files || []));
      cursor = result.nextPageToken || "";
      if (typeof cursor !== "string" || (cursor && cursors.has(cursor))) {
        throw new Error("sync-recovery-pagination-invalid");
      }
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return files;
  }
  async function tempDirectory(prefix) {
    await fs.mkdir(stagingRoot, { recursive: true, mode: 0o700 });
    return fs.mkdtemp(path.join(stagingRoot, prefix));
  }
  async function sourcePath(relativePath) {
    if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\0")) {
      throw new Error("sync-recovery-path-invalid");
    }
    const normalized = relativePath.replaceAll("\\", "/");
    if (path.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)
      || normalized.split("/").some(part => !part || part === "." || part === "..")) {
      throw new Error("sync-recovery-path-invalid");
    }
    const root = await fs.realpath(attachmentsDirectory);
    const real = await fs.realpath(path.join(root, normalized));
    const relative = path.relative(root, real);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("sync-recovery-path-invalid");
    }
    if (!(await fs.stat(real)).isFile()) throw new Error("sync-recovery-path-invalid");
    return real;
  }

  const store = createSyncRecoveryStore({
    now, assertWritable, listFiles,
    readText: downloadText,
    async createManifest(raw, appProperties) {
      await assertWritable();
      return createBufferFile({
        name: `ChengJing-Sync-Recovery-${appProperties.day}-${randomUUID()}.json`,
        parents: ["appDataFolder"], appProperties,
      }, raw);
    },
    async uploadAsset(source, appProperties) {
      await assertWritable();
      const original = await sourcePath(source.relativePath);
      const directory = await tempDirectory("upload-");
      try {
        const staged = path.join(directory, "asset");
        await fs.copyFile(original, staged, constants.COPYFILE_EXCL);
        await fs.chmod(staged, 0o600);
        await verifyFile(staged, source);
        await assertWritable();
        return await createStreamFile({
          name: `ChengJing-Sync-Recovery-Asset-${appProperties.day}-${source.sha256}`,
          parents: ["appDataFolder"], appProperties,
        }, staged, source.size);
      } finally {
        await fs.rm(directory, { recursive: true, force: true });
      }
    },
    async deleteFile(id) {
      await assertWritable();
      if (!validId(id)) throw new Error("sync-recovery-invalid-id");
      if ([...downloads.values()].some(item => item.snapshotId === id)) {
        throw new Error("sync-recovery-restore-in-progress");
      }
      const response = await authenticatedFetch(
        `${DRIVE_API}/files/${encodeURIComponent(id)}?fields=id,size,createdTime,trashed,appProperties`
      );
      if (response.status === 404) return;
      if (!response.ok) throw new Error(`sync-recovery-drive-http-${response.status}`);
      const file = await response.json();
      const snapshot = normalizeRecoverySnapshot(file);
      if (!snapshot || !selectRecoverySnapshots([file], now()).expired.some(item => item.id === id)) {
        throw new Error("sync-recovery-delete-not-owned-or-expired");
      }
      await assertWritable();
      const removed = await authenticatedFetch(`${DRIVE_API}/files/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!removed.ok && removed.status !== 404) {
        throw new Error(`sync-recovery-drive-http-${removed.status}`);
      }
    },
  });

  function createDaily(request) {
    const requestedEpoch = epoch;
    const result = writes.then(async () => {
      writeEpoch = requestedEpoch;
      try { await assertWritable(); return await store.createDaily(request); }
      finally { writeEpoch = null; }
    });
    writes = result.catch(() => {});
    return result;
  }
  async function download(id) {
    if (!validId(id)) throw new Error("sync-recovery-invalid-id");
    const restoreId = randomUUID();
    const directory = await tempDirectory("download-");
    downloads.set(restoreId, { directory, snapshotId: id });
    try {
      const result = await store.readSnapshot(id);
      const assetRoot = path.join(directory, "ChengJing-AutoBackup-Assets");
      await fs.mkdir(assetRoot, { mode: 0o700 });
      for (const asset of result.assets) {
        const destination = path.join(assetRoot, asset.sha256);
        await streamDownload(asset.fileId, destination);
        await verifyFile(destination, asset);
      }
      const backupFilePath = path.join(directory, "SyncRecovery.json");
      await fs.writeFile(backupFilePath, result.data, { flag: "wx", mode: 0o600 });
      return { restoreId, data: result.data, backupFilePath, snapshot: result.snapshot };
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
      downloads.delete(restoreId);
      throw error;
    }
  }
  async function releaseDownload(restoreId) {
    if (typeof restoreId !== "string" || !/^[a-f0-9-]{36}$/.test(restoreId)) {
      throw new Error("sync-recovery-restore-id-invalid");
    }
    const pending = downloads.get(restoreId);
    if (!pending) return { cleaned: true };
    await fs.rm(pending.directory, { recursive: true, force: true });
    downloads.delete(restoreId);
    return { cleaned: true };
  }
  return { setEnabled, getStatus: store.status, createDaily, download, releaseDownload };
}
module.exports = { createSyncRecoveryDrive };
