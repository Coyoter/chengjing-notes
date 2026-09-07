"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  RECOVERY_APP, RECOVERY_SCHEMA, DAY_MS, recoveryDays,
  normalizeRecoverySnapshot, selectRecoverySnapshots, recoveryPruneCandidates,
} = require("./sync-recovery-policy.cjs");

const now = Date.parse("2026-09-09T23:50:00Z");
function manifest(id, day, time = "08:00:00", overrides = {}) {
  const timestamp = `${day}T${time}Z`;
  return {
    id, size: "2048", createdTime: timestamp,
    appProperties: {
      app: RECOVERY_APP, kind: "manifest", schemaVersion: RECOVERY_SCHEMA,
      snapshotAt: timestamp, day, contentHash: "a".repeat(64),
    }, ...overrides,
  };
}

function history() {
  return [manifest("today", "2026-09-09"), manifest("yesterday", "2026-09-08"),
    manifest("before", "2026-09-07", "00:01:00"), manifest("old", "2026-09-06")];
}

test("UTC calendar dates remain consistent across month and leap-day boundaries", () => {
  assert.deepEqual(recoveryDays(Date.parse("2028-03-01T00:00:01Z")), {
    today: "2028-03-01", yesterday: "2028-02-29", dayBeforeYesterday: "2028-02-28",
  });
  assert.throws(() => recoveryDays(NaN), /invalid-time/);
});

test("selects today, yesterday and the day before yesterday by exact date", () => {
  const result = selectRecoverySnapshots(history(), now);
  assert.equal(result.today.id, "today");
  assert.equal(result.yesterday.id, "yesterday");
  assert.equal(result.dayBeforeYesterday.id, "before");
  assert.deepEqual(result.expired.map(item => item.id), ["old"]);
});

test("does not pretend an older snapshot belongs to a missing date", () => {
  const result = selectRecoverySnapshots([manifest("older", "2026-09-07")], now);
  assert.equal(result.today, null);
  assert.equal(result.yesterday, null);
  assert.equal(result.dayBeforeYesterday.id, "older");
});

test("keeps the whole day before yesterday, even when more than 48 hours old", () => {
  const file = history()[2];
  assert.ok(now - Date.parse(file.createdTime) > 2 * DAY_MS);
  assert.equal(selectRecoverySnapshots([file], now).dayBeforeYesterday.id, "before");
});

test("concurrent daily snapshots choose the same first-published candidate", () => {
  const first = manifest("first", "2026-09-08", "08:00:00");
  const later = manifest("later", "2026-09-08", "09:00:00");
  for (const files of [[first, later], [later, first]]) {
    const result = selectRecoverySnapshots(files, now);
    assert.equal(result.yesterday.id, "first");
    assert.equal(result.retained.length, 2);
  }
});

test("ties use file ID rather than network listing order", () => {
  const files = [manifest("b", "2026-09-08"), manifest("a", "2026-09-08")];
  assert.equal(selectRecoverySnapshots(files, now).yesterday.id, "a");
  assert.equal(selectRecoverySnapshots(files.reverse(), now).yesterday.id, "a");
});

test("legacy snapshots, sync packets and assets never become recovery cleanup targets", () => {
  const unrelated = ["chengjing-cloud-backup-v1", "chengjing-sync-v1"].map(app => {
    const file = manifest(`foreign-${app}`, "2026-09-01");
    file.appProperties.app = app;
    return file;
  });
  const asset = manifest("recovery-asset", "2026-09-01");
  asset.appProperties.kind = "asset";
  const all = [...history(), ...unrelated, asset];
  assert.deepEqual(recoveryPruneCandidates(all, now).map(item => item.id), ["old"]);
});

test("rejects malformed metadata instead of inventing a date or accepting arbitrary IDs", () => {
  const cases = [
    file => { file.id = "../another-file"; },
    file => { file.appProperties.contentHash = "invalid"; },
    file => { file.appProperties.day = "2026-09-07"; },
    file => { file.createdTime = "invalid"; },
    file => { file.size = "NaN"; },
    file => { file.appProperties.schemaVersion = "99"; },
    file => { file.trashed = true; },
  ];
  for (const mutate of cases) {
    const file = manifest("valid", "2026-09-08");
    mutate(file);
    assert.equal(normalizeRecoverySnapshot(file), null);
  }
});

test("future-dated snapshots are neither shown nor proposed for deletion", () => {
  const future = manifest("future", "2026-09-10");
  const result = selectRecoverySnapshots([future], now);
  assert.equal(result.today, null);
  assert.equal(result.retained.length, 0);
  assert.equal(result.expired.length, 0);
});

test("cleanup is withheld until a valid point for today exists", () => {
  assert.deepEqual(recoveryPruneCandidates(history().slice(1), now), []);
  assert.deepEqual(recoveryPruneCandidates(history(), now).map(item => item.id), ["old"]);
});

test("cleanup preserves protected restore selections and recently uploaded old data", () => {
  const recent = manifest("recent", "2026-09-01", "08:00:00", {
    createdTime: new Date(now - 60_000).toISOString(),
  });
  assert.deepEqual(recoveryPruneCandidates([...history(), recent], now, ["old"]), []);
});

test("selection is read-only and never edits the supplied Drive metadata", () => {
  const files = history();
  const before = JSON.stringify(files);
  selectRecoverySnapshots(files, now);
  recoveryPruneCandidates(files, now);
  assert.equal(JSON.stringify(files), before);
});
