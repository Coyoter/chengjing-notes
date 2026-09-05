const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { restoreAttachmentFile, createAttachmentRemovalQueue } = require("./attachment-recovery.cjs");
const { providerHttpError } = require("./provider-errors.cjs");

test("備份附件驗證失敗不覆寫原檔，成功時使用獨立檔案", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-restore-safe-"));
  try {
    const directory = path.join(root, "attachments"); const assets = path.join(root, "ChengJing-AutoBackup-Assets");
    await fs.mkdir(directory); await fs.mkdir(assets);
    const original = path.join(directory, "same-note.txt"); await fs.writeFile(original, "original");
    const hash = createHash("sha256").update("backup").digest("hex");
    const source = path.join(assets, hash); await fs.writeFile(source, "corrupt");
    const request = { id: "same", name: "note.txt", mime: "text/plain", sha256: hash, backupFilePath: path.join(root, "backup.json") };
    await assert.rejects(restoreAttachmentFile(directory, request), /hash-mismatch/);
    assert.equal(await fs.readFile(original, "utf8"), "original");
    assert.deepEqual(await fs.readdir(directory), ["same-note.txt"]);
    await fs.writeFile(source, "backup");
    const restored = await restoreAttachmentFile(directory, request);
    assert.equal(restored.id, "same");
    assert.equal(await fs.readFile(path.join(directory, restored.relativePath), "utf8"), "backup");
    assert.equal(await fs.readFile(original, "utf8"), "original");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("附件刪除保留 Undo 的檔案；下次只清除未恢復的附件", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-attachment-undo-"));
  try {
    const directory = path.join(root, "attachments"); await fs.mkdir(directory);
    for (const name of ["removed.txt", "restored.txt", "unrelated.txt"]) await fs.writeFile(path.join(directory, name), name);
    const queue = createAttachmentRemovalQueue(directory, root);
    await Promise.all([queue.defer("removed.txt"), queue.defer("restored.txt")]);
    assert.equal((await fs.readdir(directory)).length, 3);
    await createAttachmentRemovalQueue(directory, root).sweep(["restored.txt"]);
    assert.deepEqual((await fs.readdir(directory)).sort(), ["restored.txt", "unrelated.txt"]);
    await assert.rejects(queue.defer("../outside"), /invalid-attachment-path/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("Provider 拒絕、額度與服務錯誤都保留正確原因", () => {
  assert.match(providerHttpError("provider-http-400:Unsupported parameter", "zh-TW"), /已收到請求/);
  assert.match(providerHttpError("provider-http-401", "zh-TW"), /授權/);
  assert.match(providerHttpError("provider-http-429", "zh-TW"), /額度/);
  assert.match(providerHttpError("provider-http-503", "zh-TW"), /服務發生錯誤/);
  for (const language of ["zh-TW", "zh-CN", "en", "ja", "ko"]) assert.equal(typeof providerHttpError("provider-http-404", language), "string");
});
