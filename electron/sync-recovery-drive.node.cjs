"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { RECOVERY_APP, RECOVERY_SCHEMA, DAY_MS } = require("./sync-recovery-policy.cjs");
const { RECOVERY_TABLES, digest } = require("./sync-recovery-format.cjs");
const { createSyncRecoveryDrive } = require("./sync-recovery-drive.cjs");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-recovery-adapter-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const attachmentsDirectory = path.join(root, "attachments"), userDataDirectory = path.join(root, "profile");
  await fs.mkdir(attachmentsDirectory);
  const files = new Map(), calls = [], bytes = Buffer.from("復原圖片測試");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const source = { relativePath: "source.bin", sha256: hash, size: bytes.length };
  await fs.writeFile(path.join(attachmentsDirectory, source.relativePath), bytes);
  let now = Date.parse("2026-09-09T12:00:00Z"), sequence = 0;
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

  function insert(metadata, content) {
    const file = { id: `file-${++sequence}`, ...metadata, createdTime: new Date(now).toISOString(),
      size: String(Buffer.byteLength(content)), content };
    files.set(file.id, file); return file;
  }
  const hooks = {};
  const drive = createSyncRecoveryDrive({
    userDataDirectory, attachmentsDirectory, now: () => now,
    async authenticatedFetch(raw, init = {}) {
      const url = new URL(raw), method = init.method || "GET";
      calls.push([method, url]);
      if (url.pathname === "/drive/v3/files") {
        if (hooks.list) return hooks.list(url);
        return json({ files: [...files.values()] });
      }
      const id = decodeURIComponent(url.pathname.split("/").pop());
      if (method === "DELETE") { files.delete(id); return new Response(null, { status: 204 }); }
      const file = files.get(id);
      return file ? json(hooks.metadata ? hooks.metadata(file) : file) : json({}, 404);
    },
    async downloadText(id) { calls.push(["read", id]); return String(files.get(id).content); },
    async createBufferFile(metadata, raw) { calls.push(["manifest", metadata]); return insert(metadata, raw); },
    async createStreamFile(metadata, filename, size) {
      calls.push(["asset", metadata, filename]);
      if (hooks.upload) await hooks.upload(filename);
      const content = await fs.readFile(filename); assert.equal(content.length, size);
      return insert(metadata, content);
    },
    async streamDownload(id, filename) {
      calls.push(["download", id]);
      await fs.writeFile(filename, hooks.corrupt ? "corrupt" : files.get(id).content, { flag: "wx", mode: 0o600 });
    },
  });
  function payload(withAsset = false, timestamp = now) {
    const data = Object.fromEntries(RECOVERY_TABLES.map(name => [name, []]));
    data.cards = [{ id: "card", title: "測試筆記" }];
    if (withAsset) data.attachments = [{ id: "asset", name: "image", sha256: hash, size: bytes.length }];
    return {
      data: JSON.stringify({ format: "chengjing-sync-recovery", version: 1, dayBasis: "UTC", snapshotAt: timestamp, data }),
      assets: withAsset ? [source] : [],
    };
  }
  function seedOld() {
    const timestamp = now - 4 * DAY_MS, raw = payload(false, timestamp).data;
    const file = insert({ appProperties: {
      app: RECOVERY_APP, kind: "manifest", schemaVersion: RECOVERY_SCHEMA,
      day: new Date(timestamp).toISOString().slice(0, 10),
      snapshotAt: new Date(timestamp).toISOString(), contentHash: digest(raw),
    } }, raw);
    file.createdTime = new Date(timestamp).toISOString(); return file;
  }
  const stages = async () => fs.readdir(path.join(userDataDirectory, "sync-recovery-staging"))
    .catch(error => { if (error.code === "ENOENT") return []; throw error; });
  return { root, drive, files, calls, hooks, payload, source, bytes, attachmentsDirectory, stages, json, seedOld };
}

test("desktop recovery is disarmed until the sync manager explicitly enables it", async t => {
  const h = await fixture(t);
  await assert.rejects(h.drive.createDaily(h.payload()), /paused/);
  assert.equal(h.calls.length, 0);
});
test("publishes only into the isolated recovery namespace and uses restricted Drive queries", async t => {
  const h = await fixture(t); h.drive.setEnabled(true);
  const result = await h.drive.createDaily(h.payload());
  assert.equal(result.skipped, false);
  assert.equal((await h.drive.getStatus()).today.id, result.snapshot.id);
  for (const file of h.files.values()) assert.equal(file.appProperties.app, RECOVERY_APP);
  for (const [method, url] of h.calls) if (method === "GET" && url.pathname === "/drive/v3/files") {
    assert.equal(url.searchParams.get("spaces"), "appDataFolder");
    assert.ok(url.searchParams.get("q").includes(RECOVERY_APP));
    assert.ok(url.searchParams.get("fields").includes("createdTime"));
  }
});
test("reads all pages and rejects incomplete or looping listings", async t => {
  const h = await fixture(t); h.drive.setEnabled(true);
  const created = await h.drive.createDaily(h.payload());
  h.hooks.list = url => h.json(url.searchParams.has("pageToken")
    ? { files: [...h.files.values()] } : { files: [], nextPageToken: "page2" });
  assert.equal((await h.drive.getStatus()).today.id, created.snapshot.id);
  h.hooks.list = () => h.json({ files: [], incompleteSearch: true });
  await assert.rejects(h.drive.getStatus(), /list-incomplete/);
  h.hooks.list = () => h.json({ files: [], nextPageToken: "repeat" });
  await assert.rejects(h.drive.getStatus(), /pagination-invalid/);
});
test("uploads a verified private copy, not the live original attachment", async t => {
  const h = await fixture(t); h.drive.setEnabled(true);
  h.hooks.upload = async staged => {
    assert.notEqual(staged, path.join(h.attachmentsDirectory, h.source.relativePath));
    await fs.writeFile(path.join(h.attachmentsDirectory, h.source.relativePath), "new local content");
    assert.deepEqual(await fs.readFile(staged), h.bytes);
  };
  const result = await h.drive.createDaily(h.payload(true));
  assert.equal(result.uploadedAssets, 1); assert.deepEqual(await h.stages(), []);
  assert.equal(await fs.readFile(path.join(h.attachmentsDirectory, h.source.relativePath), "utf8"), "new local content");
});
test("path traversal, absolute paths and escaping symlinks cannot be uploaded", async t => {
  const h = await fixture(t); h.drive.setEnabled(true);
  const outside = path.join(h.root, "outside.bin"); await fs.writeFile(outside, h.bytes);
  await fs.symlink(outside, path.join(h.attachmentsDirectory, "link.bin"));
  for (const relativePath of ["../outside.bin", outside, "link.bin", "C:\\secret", "a/../source.bin"]) {
    const request = h.payload(true); request.assets[0] = { ...h.source, relativePath };
    await assert.rejects(h.drive.createDaily(request), /path-invalid/);
  }
  assert.equal(h.calls.some(([kind]) => kind === "asset" || kind === "manifest"), false);
  assert.deepEqual(await fs.readFile(outside), h.bytes);
});
test("invalid bytes fail checksum verification before any file upload", async t => {
  const h = await fixture(t); h.drive.setEnabled(true);
  await fs.writeFile(path.join(h.attachmentsDirectory, h.source.relativePath), "changed");
  await assert.rejects(h.drive.createDaily(h.payload(true)), /attachment-corrupt/);
  assert.equal(h.calls.some(([kind]) => kind === "asset" || kind === "manifest"), false);
  assert.deepEqual(await h.stages(), []);
});
test("upload failure removes only private staging and leaves the original untouched", async t => {
  const h = await fixture(t); h.drive.setEnabled(true);
  h.hooks.upload = async () => { throw new Error("network unavailable"); };
  await assert.rejects(h.drive.createDaily(h.payload(true)), /network unavailable/);
  assert.deepEqual(await h.stages(), []);
  assert.deepEqual(await fs.readFile(path.join(h.attachmentsDirectory, h.source.relativePath)), h.bytes);
});
test("downloads are fully verified and separate restore sessions cannot erase each other", async t => {
  const h = await fixture(t); h.drive.setEnabled(true);
  const created = await h.drive.createDaily(h.payload(true));
  const a = await h.drive.download(created.snapshot.id), b = await h.drive.download(created.snapshot.id);
  assert.notEqual(a.restoreId, b.restoreId); assert.notEqual(a.backupFilePath, b.backupFilePath);
  assert.equal(await fs.readFile(a.backupFilePath, "utf8"), a.data);
  assert.deepEqual(await fs.readFile(path.join(path.dirname(a.backupFilePath),
    "ChengJing-AutoBackup-Assets", h.source.sha256)), h.bytes);
  await h.drive.releaseDownload(a.restoreId); await h.drive.releaseDownload(a.restoreId);
  assert.equal(await fs.readFile(b.backupFilePath, "utf8"), b.data);
  await assert.rejects(fs.stat(a.backupFilePath), { code: "ENOENT" });
  await h.drive.releaseDownload(b.restoreId); assert.deepEqual(await h.stages(), []);
});
test("corrupt media downloads return no partial recovery and clean their temporary files", async t => {
  const h = await fixture(t); h.drive.setEnabled(true);
  const created = await h.drive.createDaily(h.payload(true)); h.hooks.corrupt = true;
  await assert.rejects(h.drive.download(created.snapshot.id), /attachment-corrupt/);
  assert.deepEqual(await h.stages(), []);
  assert.deepEqual(await fs.readFile(path.join(h.attachmentsDirectory, h.source.relativePath)), h.bytes);
});
test("pause followed by resume still cancels a previously started publication", async t => {
  const h = await fixture(t); h.drive.setEnabled(true);
  h.hooks.upload = async () => { h.drive.setEnabled(false); h.drive.setEnabled(true); };
  await assert.rejects(h.drive.createDaily(h.payload(true)), /paused/);
  assert.equal(h.calls.some(([kind]) => kind === "manifest"), false);
  delete h.hooks.upload;
  assert.equal((await h.drive.createDaily(h.payload(true))).skipped, false);
});
test("cleanup revalidates ownership before deleting an expired manifest", async t => {
  const h = await fixture(t); const old = h.seedOld(); h.drive.setEnabled(true);
  h.hooks.metadata = file => file.id === old.id
    ? { ...file, appProperties: { ...file.appProperties, app: "chengjing-cloud-backup-v1" } } : file;
  const result = await h.drive.createDaily(h.payload());
  assert.equal(result.cleanupWarning, "sync-recovery-cleanup-deferred");
  assert.equal(h.calls.some(([kind]) => kind === "DELETE"), false);
  assert.equal(h.files.has(old.id), true);
});
test("confirmed expired recovery manifests can be removed without deleting attachment blobs", async t => {
  const h = await fixture(t); const old = h.seedOld(); h.drive.setEnabled(true);
  await h.drive.createDaily(h.payload(true));
  assert.equal(h.files.has(old.id), false);
  assert.equal(h.calls.filter(([kind]) => kind === "DELETE").length, 1);
  assert.equal([...h.files.values()].filter(file => file.appProperties.kind === "asset").length, 1);
});
test("session cleanup never accepts a filesystem path or an arbitrary Drive ID", async t => {
  const h = await fixture(t);
  for (const id of [h.root, "../attachments", "file-1", ""]) {
    await assert.rejects(h.drive.releaseDownload(id), /restore-id-invalid/);
  }
  assert.deepEqual(await fs.readFile(path.join(h.attachmentsDirectory, h.source.relativePath)), h.bytes);
});
