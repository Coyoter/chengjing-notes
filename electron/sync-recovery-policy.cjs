"use strict";

const RECOVERY_APP = "chengjing-sync-recovery-v1";
const RECOVERY_SCHEMA = "1";
const DAY_MS = 86_400_000;
const RECENT_UPLOAD_GRACE_MS = DAY_MS;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function utcDay(timestamp) {
  if (!Number.isSafeInteger(timestamp) || Math.abs(timestamp) > 8_640_000_000_000_000) {
    throw new Error("sync-recovery-invalid-time");
  }
  return new Date(timestamp).toISOString().slice(0, 10);
}

function recoveryDays(now = Date.now()) {
  return {
    today: utcDay(now),
    yesterday: utcDay(now - DAY_MS),
    dayBeforeYesterday: utcDay(now - 2 * DAY_MS),
  };
}

function parseTime(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : null;
}

function normalizeRecoverySnapshot(file) {
  const props = file?.appProperties;
  if (file?.trashed || props?.app !== RECOVERY_APP || props?.kind !== "manifest" || props.schemaVersion !== RECOVERY_SCHEMA) return null;
  if (typeof file.id !== "string" || !ID_PATTERN.test(file.id)) return null;
  if (typeof props.contentHash !== "string" || !HASH_PATTERN.test(props.contentHash)) return null;
  const snapshotAt = parseTime(props.snapshotAt);
  const createdAt = parseTime(file.createdTime);
  const size = Number(file.size);
  if (snapshotAt === null || createdAt === null || !Number.isSafeInteger(size) || size <= 0) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(props.day || "") || props.day !== utcDay(snapshotAt)) return null;
  if (snapshotAt > createdAt + MAX_CLOCK_SKEW_MS) return null;
  return { id: file.id, day: props.day, snapshotAt, createdAt, size, contentHash: props.contentHash };
}

function compareSnapshots(left, right) {
  return left.createdAt - right.createdAt || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function publicRecoverySnapshot(snapshot) {
  if (!snapshot) return null;
  const { id, day, snapshotAt, size, contentHash } = snapshot;
  return { id, day, snapshotAt, size, contentHash };
}

function selectRecoverySnapshots(files, now = Date.now()) {
  const days = recoveryDays(now);
  const snapshots = [...new Map((Array.isArray(files) ? files : [])
    .map(normalizeRecoverySnapshot).filter(Boolean).map(item => [item.id, item])).values()]
    .filter(item => item.snapshotAt <= now && item.createdAt <= now + MAX_CLOCK_SKEW_MS)
    .sort(compareSnapshots);
  const firstForDay = day => snapshots.find(item => item.day === day) || null;

  // Dates are exact calendar dates, not aliases for the two most recent files.
  const today = firstForDay(days.today);
  const yesterday = firstForDay(days.yesterday);
  const dayBeforeYesterday = firstForDay(days.dayBeforeYesterday);

  // Concurrent first syncs may publish duplicate candidates. Keep them immutable;
  // all clients show the same first-published candidate for each date.
  const retained = snapshots.filter(item => Object.values(days).includes(item.day));
  const expired = snapshots.filter(item => item.day < days.dayBeforeYesterday);
  return { dayBasis: "UTC", days, today, yesterday, dayBeforeYesterday, retained, expired };
}

function recoveryPruneCandidates(files, now = Date.now(), protectedIds = []) {
  const selected = selectRecoverySnapshots(files, now);
  // A read never authorizes deletion. Callers must verify a complete new snapshot
  // before using this plan. No plan at all without a valid point for today.
  if (!selected.today) return [];
  const protectedSet = new Set(protectedIds);
  return selected.expired.filter(item => !protectedSet.has(item.id)
    && now - item.createdAt >= RECENT_UPLOAD_GRACE_MS);
}

module.exports = {
  RECOVERY_APP, RECOVERY_SCHEMA, DAY_MS, RECENT_UPLOAD_GRACE_MS,
  utcDay, recoveryDays, normalizeRecoverySnapshot, publicRecoverySnapshot,
  selectRecoverySnapshots, recoveryPruneCandidates,
};
