const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { writeCloudSettings, writeSecureToken } = require("./cloud-backup-settings.cjs");
const {
  APP_PROPERTY,
  PREVIOUS_MAX_AGE_MS,
  contentHash,
  createGoogleDriveBackupService,
  parseBackupPayload,
  selectCloudSnapshots,
  shouldPromoteToPrevious,
} = require("./google-drive-backup.cjs");

const fakeSafeStorage = {
  async isAsyncEncryptionAvailable() { return true; },
  async encryptStringAsync(value) { return Buffer.from(value, "utf8"); },
  async decryptStringAsync(value) { return { result: value.toString("utf8"), shouldReEncrypt: false }; },
};

function fakeDrive() {
  const files = new Map();
  const sessions = new Map();
  let sequence = 0;
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
  return {
    files,
    request(options) {
      const request = new EventEmitter();
      const headers = new Map();
      const chunks = [];
      request.chunkedEncoding = false;
      request.setHeader = (name, value) => headers.set(String(name).toLowerCase(), String(value));
      request.write = (chunk, _encoding, callback) => {
        chunks.push(Buffer.from(chunk));
        queueMicrotask(() => callback?.());
      };
      request.abort = () => request.emit("abort");
      request.end = () => {
        queueMicrotask(() => {
          if (String(options.method || "GET").toUpperCase() === "GET") {
            const requestUrl = new URL(String(options.url));
            const match = requestUrl.pathname.match(/\/drive\/v3\/files\/([^/]+)$/);
            const file = match ? files.get(decodeURIComponent(match[1])) : null;
            const response = Readable.from(file ? [Buffer.from(file.content)] : [Buffer.from('{"error":"not found"}')]);
            response.statusCode = file ? 200 : 404;
            request.emit("response", response);
            return;
          }
          const session = sessions.get(String(options.url));
          if (!session) {
            const response = Readable.from([Buffer.from('{"error":"missing session"}')]);
            response.statusCode = 404;
            request.emit("response", response);
            return;
          }
          const content = Buffer.concat(chunks);
          const id = `file-${++sequence}`;
          const file = { id, ...session.metadata, size: String(content.length), createdTime: new Date(Date.now()).toISOString(), modifiedTime: new Date(Date.now()).toISOString(), content };
          files.set(id, file);
          const { content: _content, ...publicFile } = file;
          const response = Readable.from([Buffer.from(JSON.stringify(publicFile))]);
          response.statusCode = 200;
          request.emit("response", response);
        });
        return request;
      };
      return request;
    },
    async fetch(rawUrl, init = {}) {
      const url = new URL(rawUrl);
      const method = String(init.method || "GET").toUpperCase();
      if (url.hostname === "www.googleapis.com" && url.pathname === "/drive/v3/files" && method === "GET") {
        return json({ files: [...files.values()].map(({ content: _content, ...file }) => file) });
      }
      if (url.hostname === "www.googleapis.com" && /\/upload\/drive\/v3\/files$/.test(url.pathname) && method === "POST") {
        if (url.searchParams.get("uploadType") === "resumable") {
          const location = `https://upload.test/session-${sessions.size + 1}`;
          sessions.set(location, { metadata: JSON.parse(String(init.body || "{}")) });
          return new Response(null, { status: 200, headers: { location } });
        }
        const body = Buffer.from(init.body).toString("utf8");
        const firstStart = body.indexOf("\r\n\r\n") + 4;
        const firstEnd = body.indexOf("\r\n--", firstStart);
        const metadata = JSON.parse(body.slice(firstStart, firstEnd));
        const secondStart = body.indexOf("\r\n\r\n", firstEnd + 4) + 4;
        const secondEnd = body.lastIndexOf("\r\n--");
        const content = body.slice(secondStart, secondEnd);
        const id = `file-${++sequence}`;
        const file = { id, ...metadata, size: String(Buffer.byteLength(content)), createdTime: new Date(Date.now()).toISOString(), modifiedTime: new Date(Date.now()).toISOString(), content };
        files.set(id, file);
        const { content: _content, ...publicFile } = file;
        return json(publicFile);
      }
      const match = url.pathname.match(/\/drive\/v3\/files\/([^/]+)$/);
      if (url.hostname === "www.googleapis.com" && match) {
        const id = decodeURIComponent(match[1]);
        const file = files.get(id);
        if (!file) return json({ error: "not found" }, 404);
        if (method === "GET" && url.searchParams.get("alt") === "media") return new Response(file.content, { status: 200 });
        if (method === "PATCH") {
          const patch = JSON.parse(String(init.body || "{}"));
          Object.assign(file, patch, { modifiedTime: new Date(Date.now()).toISOString() });
          const { content: _content, ...publicFile } = file;
          return json(publicFile);
        }
        if (method === "DELETE") {
          files.delete(id);
          return new Response(null, { status: 204 });
        }
      }
      return json({ error: `unexpected ${method} ${rawUrl}` }, 500);
    },
  };
}

function payload(title, exportedAt) {
  return JSON.stringify({
    format: "chengjing-backup",
    version: 2,
    attachmentMode: "content-addressed",
    exportedAt,
    data: { cards: [{ id: "card", title }], attachments: [] },
  });
}

function manifest(id, slot, snapshotAt) {
  return {
    id,
    name: `${id}.json`,
    size: "120",
    appProperties: {
      app: APP_PROPERTY,
      kind: "manifest",
      slot,
      snapshotAt: new Date(snapshotAt).toISOString(),
      day: new Date(snapshotAt).toISOString().slice(0, 10),
      contentHash: "a".repeat(64),
      deviceId: "device-12345678901234567890",
    },
  };
}

test("雲端只顯示最新目前快照與兩天內的前一天快照", () => {
  const now = Date.UTC(2026, 8, 4, 8);
  const files = [
    manifest("current-old", "current", now - 4 * 60 * 60_000),
    manifest("current-new", "current", now - 60 * 60_000),
    manifest("previous-expired", "previous", now - PREVIOUS_MAX_AGE_MS - 1),
  ];
  const selected = selectCloudSnapshots(files, now);
  assert.equal(selected.current.id, "current-new");
  assert.equal(selected.previous, null);
});

test("跨日但未超過兩天的目前快照才會晉升為前一天救援點", () => {
  const now = Date.UTC(2026, 8, 4, 1);
  assert.equal(shouldPromoteToPrevious({ snapshotAt: Date.UTC(2026, 8, 3, 23) }, now), true);
  assert.equal(shouldPromoteToPrevious({ snapshotAt: Date.UTC(2026, 8, 4, 0) }, now), false);
  assert.equal(shouldPromoteToPrevious({ snapshotAt: now - PREVIOUS_MAX_AGE_MS - 1 }, now), false);
});

test("內容雜湊忽略匯出時間，沒有變更就不重複上傳", () => {
  const first = JSON.stringify({ format: "chengjing-backup", version: 2, attachmentMode: "content-addressed", exportedAt: "2026-09-04T00:00:00Z", data: { cards: [{ id: "a" }], attachments: [] } });
  const second = JSON.stringify({ format: "chengjing-backup", version: 2, attachmentMode: "content-addressed", exportedAt: "2026-09-04T00:30:00Z", data: { cards: [{ id: "a" }], attachments: [] } });
  assert.equal(contentHash(first), contentHash(second));
  assert.equal(parseBackupPayload(first).hashes.size, 0);
});

test("雲端拒絕不是增量格式或附件雜湊異常的內容", () => {
  assert.throws(() => parseBackupPayload(JSON.stringify({ format: "chengjing-backup", version: 1, data: {} })), /payload-invalid/);
  assert.throws(() => parseBackupPayload(JSON.stringify({ format: "chengjing-backup", version: 2, attachmentMode: "content-addressed", data: { attachments: [{ sha256: "nope" }] } })), /asset-invalid/);
});

test("實際 Drive 流程只保留目前與前一天，兩天後清除救援點", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-cloud-drive-"));
  const attachments = path.join(root, "attachments");
  const drive = fakeDrive();
  const originalNow = Date.now;
  let now = Date.UTC(2026, 8, 3, 10);
  Date.now = () => now;
  try {
    await fs.mkdir(attachments);
    await writeCloudSettings(root, { enabled: true, intervalMinutes: 30, deviceId: "device-12345678901234567890" });
    await writeSecureToken(root, fakeSafeStorage, { accessToken: "access", refreshToken: "refresh", expiresAt: now + 10 * PREVIOUS_MAX_AGE_MS });
    const service = createGoogleDriveBackupService({
      net: drive,
      safeStorage: fakeSafeStorage,
      shell: { openExternal: async () => {} },
      userDataDirectory: root,
      attachmentsDirectory: attachments,
      clientId: "desktop-client-id",
      clientSecret: "desktop-client-secret",
    });
    const first = await service.write({ data: payload("第一天", new Date(now).toISOString()), assets: [] });
    assert.equal(first.current.id, "file-1");
    assert.equal(first.previous, null);

    now += 25 * 60 * 60_000;
    const second = await service.write({ data: payload("第二天", new Date(now).toISOString()), assets: [] });
    assert.notEqual(second.current.id, first.current.id);
    assert.equal(second.previous.id, first.current.id);
    assert.equal((await service.getStatus()).previous.id, first.current.id);

    now += PREVIOUS_MAX_AGE_MS + 1;
    const expired = await service.getStatus();
    assert.equal(expired.previous, null);
    assert.equal([...drive.files.values()].filter((file) => file.appProperties?.kind === "manifest").length, 1);
  } finally {
    Date.now = originalNow;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("雲端被另一台裝置更新時會停止覆寫", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-cloud-conflict-"));
  const attachments = path.join(root, "attachments");
  const drive = fakeDrive();
  try {
    await fs.mkdir(attachments);
    await writeCloudSettings(root, { enabled: true, intervalMinutes: 30, deviceId: "device-12345678901234567890" });
    await writeSecureToken(root, fakeSafeStorage, { accessToken: "access", refreshToken: "refresh", expiresAt: Date.now() + PREVIOUS_MAX_AGE_MS });
    const service = createGoogleDriveBackupService({
      net: drive,
      safeStorage: fakeSafeStorage,
      shell: { openExternal: async () => {} },
      userDataDirectory: root,
      attachmentsDirectory: attachments,
      clientId: "desktop-client-id",
      clientSecret: "desktop-client-secret",
    });
    await service.write({ data: payload("本機", new Date().toISOString()), assets: [] });
    drive.files.set("other-device", {
      ...manifest("other-device", "current", Date.now() + 1_000),
      content: payload("另一台裝置", new Date().toISOString()),
    });
    await assert.rejects(() => service.write({ data: payload("準備覆寫", new Date().toISOString()), assets: [] }), /cloud-backup-conflict/);
    const local = await service.getLocalStatus();
    assert.equal(local.settings.enabled, false);
    assert.equal(local.settings.conflict, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("長時間上傳之後再次檢查雲端世代，衝突時保留兩邊的備份", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-cloud-publish-conflict-"));
  const attachments = path.join(root, "attachments"); const drive = fakeDrive();
  try {
    await fs.mkdir(attachments);
    await writeCloudSettings(root, { enabled: true, deviceId: "device-12345678901234567890" });
    await writeSecureToken(root, fakeSafeStorage, { accessToken: "access", refreshToken: "refresh", expiresAt: Date.now() + PREVIOUS_MAX_AGE_MS });
    const service = createGoogleDriveBackupService({ net: drive, safeStorage: fakeSafeStorage, shell: { openExternal: async () => {} }, userDataDirectory: root, attachmentsDirectory: attachments, clientId: "id", clientSecret: "secret" });
    const original = await service.write({ data: payload("原資料", new Date().toISOString()), assets: [] });
    const fetch = drive.fetch; let lists = 0;
    drive.fetch = async (url, init) => {
      if (new URL(url).pathname === "/drive/v3/files" && ++lists === 2) drive.files.set("concurrent-device", { ...manifest("concurrent-device", "current", Date.now() + 1000), content: payload("其他裝置", new Date().toISOString()) });
      return fetch(url, init);
    };
    await assert.rejects(service.write({ data: payload("新資料", new Date().toISOString()), assets: [] }), /cloud-backup-conflict/);
    await service.getStatus();
    assert.equal(drive.files.has(original.current.id), true);
    assert.equal(drive.files.has("concurrent-device"), true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("附件以內容雜湊串流上傳且同一份不重複傳送", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-cloud-asset-"));
  const attachments = path.join(root, "attachments");
  const drive = fakeDrive();
  try {
    await fs.mkdir(attachments);
    const relativePath = "2026/asset.txt";
    const filePath = path.join(attachments, relativePath);
    const bytes = Buffer.from("streamed attachment");
    const hash = createHash("sha256").update(bytes).digest("hex");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, bytes);
    await writeCloudSettings(root, { enabled: true, intervalMinutes: 30, deviceId: "device-12345678901234567890" });
    await writeSecureToken(root, fakeSafeStorage, { accessToken: "access", refreshToken: "refresh", expiresAt: Date.now() + PREVIOUS_MAX_AGE_MS });
    const service = createGoogleDriveBackupService({
      net: drive,
      safeStorage: fakeSafeStorage,
      shell: { openExternal: async () => {} },
      userDataDirectory: root,
      attachmentsDirectory: attachments,
      clientId: "desktop-client-id",
      clientSecret: "desktop-client-secret",
    });
    const data = JSON.stringify({
      format: "chengjing-backup",
      version: 2,
      attachmentMode: "content-addressed",
      exportedAt: new Date().toISOString(),
      data: { cards: [], attachments: [{ id: "asset", relativePath, sha256: hash, size: bytes.length, storage: "file" }] },
    });
    const first = await service.write({ data, assets: [{ relativePath, sha256: hash, size: bytes.length }] });
    assert.equal(first.uploadedAssets, 1);
    const uploaded = [...drive.files.values()].find((file) => file.appProperties?.kind === "asset");
    assert.deepEqual(uploaded.content, bytes);
    const downloaded = await service.downloadBackup("current");
    assert.equal(downloaded.data, data);
    assert.deepEqual(await fs.readFile(path.join(path.dirname(downloaded.backupFilePath), "ChengJing-AutoBackup-Assets", hash)), bytes);
    await service.completeRestore({ baselineManifestId: downloaded.baselineManifestId, contentHash: downloaded.contentHash });
    await service.cancelRestore();
    await assert.rejects(() => fs.stat(downloaded.backupFilePath), /ENOENT/);
    const second = await service.write({ data: JSON.stringify({ ...JSON.parse(data), exportedAt: new Date(Date.now() + 60_000).toISOString() }), assets: [{ relativePath, sha256: hash, size: bytes.length }] });
    assert.equal(second.skipped, true);
    assert.equal([...drive.files.values()].filter((file) => file.appProperties?.kind === "asset").length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
