"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { RECOVERY_APP, RECOVERY_SCHEMA, DAY_MS } = require("./sync-recovery-policy.cjs");
const { RECOVERY_TABLES, parseRecoveryPayload, digest } = require("./sync-recovery-format.cjs");
const { createSyncRecoveryStore } = require("./sync-recovery-store.cjs");

function harness() {
  let now = Date.parse("2026-09-09T12:00:00Z"), sequence = 0, allowed = true;
  const files = new Map(), calls = [];
  const adapter = {
    now: () => now,
    assertWritable: async () => { if (!allowed) throw new Error("sync-recovery-paused"); },
    async listFiles(kind) { calls.push(["list", kind]); return [...files.values()]; },
    async readText(id) { calls.push(["read", id]); if (!files.has(id)) throw new Error("missing"); return files.get(id).raw; },
    async createManifest(raw, appProperties) {
      calls.push(["create", appProperties.day]);
      const file = { id: `manifest-${++sequence}`, size: String(Buffer.byteLength(raw, "utf8")),
        createdTime: new Date(now).toISOString(), appProperties, raw };
      files.set(file.id, file); return file;
    },
    async uploadAsset(source, appProperties) {
      calls.push(["upload", source.sha256]);
      const file = { id: `asset-${++sequence}`, size: String(source.size), createdTime: new Date(now).toISOString(), appProperties };
      files.set(file.id, file); return file;
    },
    async deleteFile(id) { calls.push(["delete", id]); files.delete(id); },
  };
  const raw = (title = "筆記", timestamp = now, attachments = []) => JSON.stringify({
    format: "chengjing-sync-recovery", version: 1, dayBasis: "UTC", snapshotAt: timestamp,
    data: { ...Object.fromEntries(RECOVERY_TABLES.map(name => [name, []])), cards: [{ id: "card-1", title }], attachments },
  });
  function seed(id, timestamp, title = "older") {
    const data = raw(title, timestamp);
    const file = { id, raw: data, size: String(Buffer.byteLength(data, "utf8")), createdTime: new Date(timestamp).toISOString(),
      appProperties: { app: RECOVERY_APP, kind: "manifest", schemaVersion: RECOVERY_SCHEMA,
        day: new Date(timestamp).toISOString().slice(0, 10), snapshotAt: new Date(timestamp).toISOString(), contentHash: digest(data) } };
    files.set(id, file); return file;
  }
  return { adapter, files, calls, raw, seed, now: () => now, advance: ms => { now += ms; }, pause: () => { allowed = false; }, store: createSyncRecoveryStore(adapter) };
}
const asset = { id: "image-1", sha256: "b".repeat(64), size: 12, name: "image.png" };
const source = { sha256: asset.sha256, size: asset.size, relativePath: "local-image" };
const mutations = h => h.calls.filter(([kind]) => ["create", "upload", "delete"].includes(kind));

test("requires every synchronized table before accepting a recovery payload", () => {
  const h = harness(); const parsed = JSON.parse(h.raw()); delete parsed.data.tasks;
  assert.throws(() => parseRecoveryPayload(JSON.stringify(parsed)), /tables-incomplete/);
  assert.equal(parseRecoveryPayload(h.raw()).parsed.data.cards[0].title, "筆記");
});
test("rejects preferences, account secrets, duplicate rows and local attachment paths", () => {
  const h = harness();
  const cases = [
    value => { value.communityIdentity = { secret: "never-upload" }; },
    value => { value.data.preferences = []; },
    value => { value.data.cards.push(value.data.cards[0]); },
    value => { value.data.attachments = [{ ...asset, relativePath: "/Users/private/file" }]; },
    value => { value.data.attachments = [{ ...asset, blob: "secret-local-blob" }]; },
  ];
  for (const mutate of cases) { const value = JSON.parse(h.raw()); mutate(value); assert.throws(() => parseRecoveryPayload(JSON.stringify(value))); }
});
test("rejects attachment hash/size mismatches before doing any remote mutation", async () => {
  const h = harness();
  await assert.rejects(h.store.createDaily({ data: h.raw("asset", h.now(), [asset]), assets: [{ ...source, size: 11 }] }), /asset-missing/);
  assert.deepEqual(mutations(h), []);
});
test("creates a verified daily point without touching legacy files", async () => {
  const h = harness(); h.files.set("legacy", { id: "legacy", appProperties: { app: "chengjing-cloud-backup-v1", kind: "manifest" } });
  const result = await h.store.createDaily({ data: h.raw(), assets: [] });
  assert.equal(result.skipped, false); assert.equal(result.status.today.id, result.snapshot.id);
  assert.equal(result.status.yesterday, null); assert.equal(h.files.has("legacy"), true);
  assert.equal((await h.store.readSnapshot(result.snapshot.id)).data, h.raw());
});
test("later edits on the same date never overwrite the first daily point", async () => {
  const h = harness(); const first = await h.store.createDaily({ data: h.raw("first") });
  h.advance(60_000); const second = await h.store.createDaily({ data: h.raw("later") });
  assert.equal(second.skipped, true); assert.equal(first.snapshot.id, second.snapshot.id);
  assert.equal(h.calls.filter(([kind]) => kind === "create").length, 1);
  assert.equal(JSON.parse((await h.store.readSnapshot(first.snapshot.id)).data).data.cards[0].title, "first");
});
test("serializes local attempts and remains usable after a failed request", async () => {
  const h = harness(); await assert.rejects(h.store.createDaily({ data: "broken" }));
  const results = await Promise.all([h.store.createDaily({ data: h.raw("A") }), h.store.createDaily({ data: h.raw("B") })]);
  assert.deepEqual(results.map(result => result.skipped), [false, true]);
});
test("uploads only referenced attachment sources before creating a manifest", async () => {
  const h = harness();
  const result = await h.store.createDaily({ data: h.raw("with asset", h.now(), [asset]), assets: [source, { ...source, sha256: "c".repeat(64) }] });
  assert.equal(result.uploadedAssets, 1);
  assert.deepEqual(mutations(h).map(([kind]) => kind), ["upload", "create"]);
  assert.equal((await h.store.readSnapshot(result.snapshot.id)).assets[0].sha256, asset.sha256);
});
test("a failed attachment upload leaves every existing snapshot intact", async () => {
  const h = harness(); h.seed("old", h.now() - 4 * DAY_MS);
  h.adapter.uploadAsset = async () => { throw new Error("offline"); };
  await assert.rejects(h.store.createDaily({ data: h.raw("asset", h.now(), [asset]), assets: [source] }), /offline/);
  assert.equal(h.files.has("old"), true); assert.equal(h.calls.some(([kind]) => kind === "create" || kind === "delete"), false);
});
test("reads and status checks never delete any files", async () => {
  const h = harness(); h.seed("old", h.now() - 4 * DAY_MS); h.seed("yesterday", h.now() - DAY_MS);
  await h.store.status(); await h.store.readSnapshot("yesterday");
  assert.deepEqual(mutations(h), []); assert.equal(h.files.has("old"), true);
});
test("only verified successful publication permits pruning expired owned manifests", async () => {
  const h = harness(); h.seed("old", h.now() - 4 * DAY_MS); h.seed("yesterday", h.now() - DAY_MS); h.seed("before", h.now() - 2 * DAY_MS);
  await h.store.createDaily({ data: h.raw() });
  assert.deepEqual(h.calls.filter(([kind]) => kind === "delete"), [["delete", "old"]]);
  assert.equal(h.files.has("yesterday"), true); assert.equal(h.files.has("before"), true);
});
test("corrupt retained history blocks pruning rather than removing other rescue points", async () => {
  const h = harness(); h.seed("old", h.now() - 4 * DAY_MS); h.seed("yesterday", h.now() - DAY_MS).raw += " ";
  const result = await h.store.createDaily({ data: h.raw() });
  assert.equal(result.cleanupWarning, "sync-recovery-cleanup-deferred"); assert.equal(h.files.has("old"), true);
  await assert.rejects(h.store.readSnapshot("yesterday"), /manifest-corrupt/);
});
test("changed remote bytes are rejected on read", async () => {
  const h = harness(); h.seed("yesterday", h.now() - DAY_MS).raw = h.raw("tampered", h.now() - DAY_MS);
  await assert.rejects(h.store.readSnapshot("yesterday"), /manifest-corrupt/);
});
test("a missing attachment prevents restore from returning partial data", async () => {
  const h = harness(); const result = await h.store.createDaily({ data: h.raw("asset", h.now(), [asset]), assets: [source] });
  for (const [id, file] of h.files) if (file.appProperties.kind === "asset") h.files.delete(id);
  await assert.rejects(h.store.readSnapshot(result.snapshot.id), /asset-missing/);
});
test("rechecks another device's publication after uploading assets", async () => {
  const h = harness(); const upload = h.adapter.uploadAsset;
  h.adapter.uploadAsset = async (...args) => { const result = await upload(...args); h.seed("other-device", h.now() - 60_000, "other"); return result; };
  const result = await h.store.createDaily({ data: h.raw("local", h.now(), [asset]), assets: [source] });
  assert.equal(result.skipped, true); assert.equal(result.snapshot.id, "other-device");
  assert.equal(h.calls.some(([kind]) => kind === "create"), false);
});
test("pause during asset upload prevents publication and cleanup", async () => {
  const h = harness(); const upload = h.adapter.uploadAsset;
  h.adapter.uploadAsset = async (...args) => { const result = await upload(...args); h.pause(); return result; };
  await assert.rejects(h.store.createDaily({ data: h.raw("asset", h.now(), [asset]), assets: [source] }), /paused/);
  assert.equal(h.calls.some(([kind]) => kind === "create" || kind === "delete"), false);
});
test("crossing UTC midnight during upload cannot mislabel yesterday as today", async () => {
  const h = harness(); const upload = h.adapter.uploadAsset;
  h.adapter.uploadAsset = async (...args) => { const result = await upload(...args); h.advance(DAY_MS); return result; };
  await assert.rejects(h.store.createDaily({ data: h.raw("asset", h.now(), [asset]), assets: [source] }), /capture-date-changed/);
  assert.equal(h.calls.some(([kind]) => kind === "create"), false);
});
test("cannot download arbitrary Drive IDs or expired recovery points", async () => {
  const h = harness(); h.seed("expired", h.now() - 4 * DAY_MS);
  for (const id of ["../secret", "unowned-file", "expired"]) await assert.rejects(h.store.readSnapshot(id));
  assert.equal(h.calls.some(([kind]) => kind === "read"), false);
});
