"use strict";
const {
  RECOVERY_APP, RECOVERY_SCHEMA, utcDay, normalizeRecoverySnapshot,
  publicRecoverySnapshot, selectRecoverySnapshots, recoveryPruneCandidates,
} = require("./sync-recovery-policy.cjs");
const { parseRecoveryPayload, validateRecoverySources } = require("./sync-recovery-format.cjs");

function matchingAsset(file, expected, day) {
  const props = file?.appProperties;
  return !file?.trashed && typeof file?.id === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(file.id)
    && props?.app === RECOVERY_APP && props.kind === "asset" && props.day === day
    && props.sha256 === expected.sha256 && Number(file.size) === expected.size;
}

/** Adapter owns authenticated I/O and streaming asset verification. No legacy API calls. */
function createSyncRecoveryStore(adapter) {
  for (const method of ["listFiles", "readText", "createManifest", "uploadAsset", "deleteFile"]) {
    if (typeof adapter?.[method] !== "function") throw new Error(`sync-recovery-adapter-${method}`);
  }
  const now = adapter.now || Date.now;
  const assertWritable = adapter.assertWritable || (async () => {});
  let queue = Promise.resolve();
  function serialize(operation) {
    const result = queue.then(operation, operation);
    queue = result.catch(() => {});
    return result;
  }
  async function inventory(kind) {
    const files = await adapter.listFiles(kind);
    if (!Array.isArray(files)) throw new Error("sync-recovery-list-invalid");
    // Validate ownership even when the server-side query already filters it.
    return files.filter(file => !file?.trashed && file?.appProperties?.app === RECOVERY_APP
      && file.appProperties.kind === kind);
  }
  function publicStatus(selected) {
    return { dayBasis: "UTC", today: publicRecoverySnapshot(selected.today),
      yesterday: publicRecoverySnapshot(selected.yesterday),
      dayBeforeYesterday: publicRecoverySnapshot(selected.dayBeforeYesterday) };
  }
  async function status() {
    return publicStatus(selectRecoverySnapshots(await inventory("manifest"), now()));
  }
  async function verifiedRead(snapshot) {
    const data = await adapter.readText(snapshot.id);
    const payload = parseRecoveryPayload(data);
    if (payload.contentHash !== snapshot.contentHash || payload.parsed.snapshotAt !== snapshot.snapshotAt
      || payload.day !== snapshot.day || Buffer.byteLength(data, "utf8") !== snapshot.size) {
      throw new Error("sync-recovery-manifest-corrupt");
    }
    const files = payload.assets.length ? await inventory("asset") : [];
    const assets = payload.assets.map(expected => {
      const file = files.filter(item => matchingAsset(item, expected, payload.day))
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)[0];
      if (!file) throw new Error("sync-recovery-asset-missing");
      return { ...expected, fileId: file.id };
    });
    return { data, snapshot: publicRecoverySnapshot(snapshot), assets };
  }
  async function readSnapshot(id) {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new Error("sync-recovery-invalid-id");
    const selected = selectRecoverySnapshots(await inventory("manifest"), now());
    const snapshot = selected.retained.find(item => item.id === id);
    if (!snapshot) throw new Error("sync-recovery-point-unavailable");
    return verifiedRead(snapshot);
  }
  async function cleanupAfterPublish() {
    const files = await inventory("manifest");
    const selected = selectRecoverySnapshots(files, now());
    if (!selected.today) return 0;
    // Fail closed: check every retained manifest and all asset references before deletion.
    for (const snapshot of selected.retained) await verifiedRead(snapshot);
    let removed = 0;
    for (const candidate of recoveryPruneCandidates(files, now())) {
      await assertWritable();
      await adapter.deleteFile(candidate.id);
      removed++;
    }
    // Asset garbage collection is intentionally not performed here: downloads and
    // multi-device publishers need a separate pin/lease-aware cleanup protocol.
    return removed;
  }
  function createDaily(request) {
    return serialize(async () => {
      await assertWritable();
      const payload = parseRecoveryPayload(request?.data);
      const capturedAt = payload.parsed.snapshotAt;
      const startedAt = now();
      if (capturedAt > startedAt || payload.day !== utcDay(startedAt)) throw new Error("sync-recovery-capture-date-changed");
      const sources = validateRecoverySources(payload.assets, request.assets || []);
      const first = selectRecoverySnapshots(await inventory("manifest"), startedAt);
      if (first.today) {
        await verifiedRead(first.today);
        return { skipped: true, uploadedAssets: 0, snapshot: publicRecoverySnapshot(first.today), status: publicStatus(first) };
      }
      let uploadedAssets = 0;
      const existingAssets = payload.assets.length ? await inventory("asset") : [];
      for (const source of sources) {
        await assertWritable();
        if (existingAssets.some(file => matchingAsset(file, source, payload.day))) continue;
        const file = await adapter.uploadAsset(source, {
          app: RECOVERY_APP, kind: "asset", day: payload.day, sha256: source.sha256,
        });
        if (!matchingAsset(file, source, payload.day)) throw new Error("sync-recovery-asset-upload-invalid");
        existingAssets.push(file);
        uploadedAssets++;
      }
      // An upload may take minutes. Do not overwrite a daily point another device published.
      const beforePublish = selectRecoverySnapshots(await inventory("manifest"), now());
      const winner = beforePublish.retained.find(item => item.day === payload.day);
      if (winner) {
        await verifiedRead(winner);
        return { skipped: true, uploadedAssets, snapshot: publicRecoverySnapshot(winner), status: publicStatus(beforePublish) };
      }
      if (payload.day !== utcDay(now())) throw new Error("sync-recovery-capture-date-changed");
      await assertWritable();
      const file = await adapter.createManifest(request.data, {
        app: RECOVERY_APP, kind: "manifest", schemaVersion: RECOVERY_SCHEMA,
        day: payload.day, snapshotAt: new Date(capturedAt).toISOString(), contentHash: payload.contentHash,
      });
      const snapshot = normalizeRecoverySnapshot(file);
      if (!snapshot || snapshot.contentHash !== payload.contentHash || snapshot.snapshotAt !== capturedAt) {
        throw new Error("sync-recovery-manifest-upload-invalid");
      }
      await verifiedRead(snapshot);
      let cleanupWarning = "";
      try { await cleanupAfterPublish(); }
      catch { cleanupWarning = "sync-recovery-cleanup-deferred"; }
      return { skipped: false, uploadedAssets, snapshot: publicRecoverySnapshot(snapshot),
        status: await status(), cleanupWarning };
    });
  }
  return { status, createDaily, readSnapshot };
}
module.exports = { createSyncRecoveryStore, matchingAsset };
