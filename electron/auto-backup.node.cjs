const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  backupFilename,
  ASSET_DIRECTORY,
  createAutoBackup,
  isOwnedBackupFilename,
  normalizeSettings,
  readSettings,
  selectExpiredBackups,
  writeSettings,
} = require("./auto-backup.cjs");

test("自動備份設定只接受安全的週期、份數與絕對路徑", () => {
  const settings = normalizeSettings({ enabled: true, intervalDays: 99, retentionCount: 800, directory: "relative/folder", lastError: "x".repeat(900) });
  assert.equal(settings.enabled, true);
  assert.equal(settings.intervalDays, 1);
  assert.equal(settings.retentionCount, 30);
  assert.equal(settings.directory, "");
  assert.equal(settings.lastError.length, 600);
});

test("自動備份檔名固定且只清理澄境擁有的舊檔", () => {
  const filename = backupFilename(new Date(2026, 7, 26, 14, 3, 9));
  assert.equal(filename, "ChengJing-AutoBackup-2026-08-26_140309.json");
  assert.equal(isOwnedBackupFilename(filename), true);
  assert.equal(isOwnedBackupFilename("我的重要資料.json"), false);
  const expired = selectExpiredBackups([
    { name: "ChengJing-AutoBackup-2026-08-26_140309.json", isFile: true, mtimeMs: 4 },
    { name: "ChengJing-AutoBackup-2026-08-25_140309.json", isFile: true, mtimeMs: 3 },
    { name: "ChengJing-AutoBackup-2026-08-24_140309.json", isFile: true, mtimeMs: 2 },
    { name: "ChengJing-AutoBackup-2026-08-23_140309.json", isFile: true, mtimeMs: 1 },
    { name: "不要刪除.json", isFile: true, mtimeMs: 0 },
  ], 3);
  assert.deepEqual(expired.map((entry) => entry.name), ["ChengJing-AutoBackup-2026-08-23_140309.json"]);
});

test("設定與備份採原子寫入，並保留非澄境檔案", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-auto-backup-test-"));
  const target = path.join(root, "backups");
  await fs.mkdir(target);
  try {
    const saved = await writeSettings(root, { enabled: true, intervalDays: 3, retentionCount: 3, directory: target });
    assert.deepEqual(await readSettings(root), saved);
    await fs.writeFile(path.join(target, "不要刪除.json"), "important");
    const payload = JSON.stringify({ format: "chengjing-backup", version: 1, exportedAt: new Date().toISOString(), data: { cards: [] } });
    for (let index = 0; index < 4; index += 1) {
      await createAutoBackup({ directory: target, data: payload, retentionCount: 3, now: new Date(2026, 7, 20 + index, 8, 0, 0) });
    }
    const files = await fs.readdir(target);
    assert.equal(files.filter(isOwnedBackupFilename).length, 3);
    assert.equal(await fs.readFile(path.join(target, "不要刪除.json"), "utf8"), "important");
    assert.equal(files.some((name) => name.includes(".tmp-")), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("不接受缺少澄境格式信封的備份內容", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-auto-backup-invalid-"));
  try {
    await assert.rejects(() => createAutoBackup({ directory, data: JSON.stringify({ cards: [] }) }), /backup-payload-invalid/);
    assert.deepEqual(await fs.readdir(directory), []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("新版自動備份只複製一次相同附件", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-auto-backup-assets-"));
  const target = path.join(root, "backups");
  const attachments = path.join(root, "attachments");
  await fs.mkdir(target);
  await fs.mkdir(attachments);
  const relativePath = "asset-note.pdf";
  const bytes = Buffer.from("stable attachment");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await fs.writeFile(path.join(attachments, relativePath), bytes);
  const payload = JSON.stringify({ format: "chengjing-backup", version: 2, data: { cards: [], attachments: [{ id: "a", relativePath, sha256 }] } });
  try {
    const first = await createAutoBackup({ directory: target, data: payload, assetsDirectory: attachments, assets: [{ relativePath, sha256 }], now: new Date(2026, 7, 26, 8, 0, 0) });
    const second = await createAutoBackup({ directory: target, data: payload, assetsDirectory: attachments, assets: [{ relativePath, sha256 }], now: new Date(2026, 7, 27, 8, 0, 0) });
    assert.equal(first.copiedAssets, 1);
    assert.equal(second.reusedAssets, 1);
    assert.deepEqual(await fs.readFile(path.join(target, ASSET_DIRECTORY, sha256)), bytes);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
