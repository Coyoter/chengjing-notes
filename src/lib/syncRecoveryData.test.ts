import "fake-indexeddb/auto";
import { beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { createRequire } from "node:module";
import { db } from "../db";
import { applySyncPacket } from "./syncEngine";
import { SYNC_TABLES, dominates, type SyncRecord } from "./syncProtocol";
import {
  captureSyncRecoveryPayload, parseSyncRecoveryPayload, readRecoveryBaseline,
  recoveryHash, recoveryUtcDay, restoreRecoverySnapshot, verifyRecoveryDownload,
  type RecoveryPayload, type RecoveryRestoreEffects, type RecoveryRow,
} from "./syncRecoveryData";
import type { SyncRecoveryDownloadResult } from "../types";

const native = createRequire(import.meta.url)("../../electron/sync-recovery-format.cjs");

beforeAll(async () => {
  Object.defineProperty(crypto, "subtle", { value: webcrypto.subtle, configurable: true });
  await db.open();
});
beforeEach(async () => {
  localStorage.clear();
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
  localStorage.setItem("chengjing-sync-enabled", "true");
});
afterEach(() => {
  localStorage.clear();
  delete window.chengjing;
  vi.restoreAllMocks();
});

const fragment = (id: string, text = id) => ({
  id, text, pinned: false, tagIds: [], createdAt: 1, updatedAt: 1,
});
const attachment = {
  id: "asset", name: "image.png", mime: "image/png",
  sha256: "b".repeat(64), size: 12, createdAt: 1,
};
function payload(overrides: Partial<RecoveryPayload["data"]> = {}): RecoveryPayload {
  return {
    format: "chengjing-sync-recovery", version: 1, dayBasis: "UTC",
    snapshotAt: Date.now() - 86_400_000,
    data: { ...Object.fromEntries(SYNC_TABLES.map(name => [name, []])), ...overrides } as RecoveryPayload["data"],
  };
}
async function downloaded(value = payload()): Promise<SyncRecoveryDownloadResult> {
  const data = JSON.stringify(value);
  return {
    restoreId: "00000000-0000-4000-8000-000000000000",
    backupFilePath: "/isolated-test/SyncRecovery.json", data,
    snapshot: {
      id: "snapshot-test", day: recoveryUtcDay(value.snapshotAt), snapshotAt: value.snapshotAt,
      size: new TextEncoder().encode(data).byteLength, contentHash: await recoveryHash(data),
    },
  };
}
function effects(patch: Partial<RecoveryRestoreEffects> = {}) {
  return {
    assertAllowed: vi.fn(() => {}),
    restoreAttachment: vi.fn(async (row: RecoveryRow, _path: string) => ({
      ...row, storage: "file", relativePath: `restored-${row.id}`,
    })),
    writeSafety: vi.fn(async () => ({ filePath: "/isolated-test/safety.json", bytes: 1024 })),
    ...patch,
  };
}

it("renderer and native code agree on the complete synchronized table set and payload hash", async () => {
  expect([...native.RECOVERY_TABLES].sort()).toEqual([...SYNC_TABLES].sort());
  const data = JSON.stringify(payload({ fragments: [fragment("one", "中文內容")] }));
  expect(native.parseRecoveryPayload(data).parsed).toEqual(parseSyncRecoveryPayload(data));
  expect(native.parseRecoveryPayload(data).contentHash).toBe(await recoveryHash(data));
});

it("rejects missing tables, private root fields, duplicate rows and local attachment paths", () => {
  const candidates = [
    (value: any) => { delete value.data.tasks; },
    (value: any) => { value.communityIdentity = { secret: "never-upload" }; },
    (value: any) => { value.data.preferences = []; },
    (value: any) => { value.data.fragments = [fragment("one"), fragment("one")]; },
    (value: any) => { value.data.attachments = [{ ...attachment, relativePath: "/Users/private" }]; },
    (value: any) => { value.data.attachments = [{ ...attachment, blob: "private blob" }]; },
    (value: any) => { value.data.attachments = [{ ...attachment, sha256: "invalid" }]; },
  ];
  for (const mutate of candidates) {
    const value = payload(); mutate(value);
    expect(() => parseSyncRecoveryPayload(JSON.stringify(value))).toThrow();
    expect(() => native.parseRecoveryPayload(JSON.stringify(value))).toThrow();
  }
});

it("does not capture while sync is paused or local changes remain unsent", async () => {
  localStorage.removeItem("chengjing-sync-enabled");
  await expect(captureSyncRecoveryPayload()).rejects.toThrow("paused");
  localStorage.setItem("chengjing-sync-enabled", "true");
  await db.fragments.put(fragment("one"));
  await expect(captureSyncRecoveryPayload()).rejects.toThrow("pending-changes");
});

it("captures synchronized content but excludes preferences, account state and sync journals", async () => {
  await db.fragments.put(fragment("one", "正文"));
  await db.table("preferences").put({ key: "private", value: "private-setting-token" });
  localStorage.setItem("community-identity", "private-account-token");
  await db.table("syncOutbox").clear();
  const result = await captureSyncRecoveryPayload();
  const parsed = parseSyncRecoveryPayload(result.data);
  expect(parsed.data.fragments[0].text).toBe("正文");
  expect(parsed.data.fragments[0]).not.toHaveProperty("searchTerms");
  expect(Object.keys(parsed.data).sort()).toEqual([...SYNC_TABLES].sort());
  expect(result.data).not.toContain("private-setting-token");
  expect(result.data).not.toContain("private-account-token");
  expect(result.data).not.toContain('"syncRecords"');
  expect(result.assets).toEqual([]);
  expect(await db.table("syncRecords").count()).toBe(1);
});

it("keeps attachment source paths out of the cloud manifest", async () => {
  await db.attachments.put({ ...attachment, storage: "file", relativePath: "private-local-file" });
  await db.table("syncOutbox").clear();
  const result = await captureSyncRecoveryPayload();
  expect(result.data).not.toContain("private-local-file");
  expect(result.assets).toEqual([{
    relativePath: "private-local-file", sha256: attachment.sha256, size: attachment.size,
  }]);
  expect(native.parseRecoveryPayload(result.data).assets).toHaveLength(1);
});

it("checks the selected immutable snapshot before accepting downloaded bytes", async () => {
  const value = await downloaded(payload({ fragments: [fragment("one")] }));
  expect(await verifyRecoveryDownload(value, value.snapshot)).toHaveProperty("data.fragments");
  await expect(verifyRecoveryDownload(value, { ...value.snapshot, id: "different" }))
    .rejects.toThrow("selection-changed");
  await expect(verifyRecoveryDownload({ ...value, data: value.data + " " }, value.snapshot))
    .rejects.toThrow("manifest-corrupt");
});

it("saves a safety copy before restoring content and queues changes as new sync edits", async () => {
  await db.fragments.bulkPut([fragment("one", "newer"), fragment("today-only")]);
  await db.table("preferences").put({ key: "theme", value: "dark" });
  await db.table("syncInbox").put({ id: "existing-receipt" });
  const old = await db.table<SyncRecord>("syncRecords").get("fragments:one");
  const value = await downloaded(payload({ fragments: [fragment("one", "yesterday"), fragment("recovered")] }));
  const env = effects({
    writeSafety: vi.fn(async () => {
      expect((await db.fragments.get("one"))?.text).toBe("newer");
      expect(await db.fragments.get("today-only")).toBeDefined();
      return { filePath: "/isolated-test/safety.json", bytes: 1024 };
    }),
  });
  const result = await restoreRecoverySnapshot(value, value.snapshot, env);
  expect(result).toEqual({
    restoredItems: 2, deletedItems: 1, safetyCopyPath: "/isolated-test/safety.json",
  });
  expect((await db.fragments.get("one"))?.text).toBe("yesterday");
  expect(await db.fragments.get("today-only")).toBeUndefined();
  expect(await db.fragments.get("recovered")).toBeDefined();
  expect(await db.table("preferences").get("theme")).toEqual({ key: "theme", value: "dark" });
  expect(await db.table("syncInbox").get("existing-receipt")).toBeDefined();
  const record = await db.table<SyncRecord>("syncRecords").get("fragments:one");
  expect(record!.recovery!.some(head => head.id === old!.heads[0].id)).toBe(true);
  expect(dominates(record!.heads[0].clock, old!.heads[0].clock)).toBe(true);
  const tombstone = await db.table<SyncRecord>("syncRecords").get("fragments:today-only");
  expect(tombstone!.heads[0].value).toBe(null);
  expect(await db.table("syncOutbox").get(record!.heads[0].id)).toBeDefined();
  expect(await db.table("syncOutbox").get(tombstone!.heads[0].id)).toBeDefined();
});

it("restoration causally dominates both local and remote versions, even with a future remote clock", async () => {
  await db.fragments.put(fragment("one", "local"));
  const remote = {
    id: "remote-old", table: "fragments" as const, key: "one", clock: { other: 10 },
    changedAt: Date.now() + 86_400_000, value: fragment("one", "remote"),
  };
  await applySyncPacket({ protocol: "chengjing-sync-v1", id: "remote-receipt", operations: [remote] });
  const previous = await db.table<SyncRecord>("syncRecords").get("fragments:one");
  const value = await downloaded(payload({ fragments: [fragment("one", "restored")] }));
  await restoreRecoverySnapshot(value, value.snapshot, effects());
  const record = await db.table<SyncRecord>("syncRecords").get("fragments:one");
  for (const head of previous!.heads) expect(dominates(record!.heads[0].clock, head.clock)).toBe(true);
  await applySyncPacket({ protocol: "chengjing-sync-v1", id: "replayed-old-packet", operations: [remote] });
  expect((await db.fragments.get("one"))?.text).toBe("restored");
});

it("safety-copy failure leaves the database and outgoing queue untouched", async () => {
  await db.fragments.put(fragment("one", "current"));
  const before = await readRecoveryBaseline();
  const value = await downloaded(payload({ fragments: [fragment("one", "old")] }));
  await expect(restoreRecoverySnapshot(value, value.snapshot, effects({
    writeSafety: async () => { throw new Error("disk unavailable"); },
  }))).rejects.toThrow("disk unavailable");
  expect(await readRecoveryBaseline()).toBe(before);
});

it("an empty safety receipt is not accepted as a successful safety backup", async () => {
  await db.fragments.put(fragment("one"));
  const before = await readRecoveryBaseline(), value = await downloaded();
  await expect(restoreRecoverySnapshot(value, value.snapshot, effects({
    writeSafety: async () => ({ filePath: "", bytes: 0 }),
  }))).rejects.toThrow("safety-copy-required");
  expect(await readRecoveryBaseline()).toBe(before);
});

it("invalid manifest bytes stop before creating a safety copy or changing content", async () => {
  await db.fragments.put(fragment("one"));
  const before = await readRecoveryBaseline(), value = await downloaded(), env = effects();
  await expect(restoreRecoverySnapshot({ ...value, data: value.data + " " }, value.snapshot, env))
    .rejects.toThrow("manifest-corrupt");
  expect(env.writeSafety).not.toHaveBeenCalled();
  expect(await readRecoveryBaseline()).toBe(before);
});

it("missing or corrupt restored attachments stop before any database writes", async () => {
  await db.fragments.put(fragment("one"));
  const value = await downloaded(payload({ attachments: [attachment] }));
  const before = await readRecoveryBaseline();
  for (const restoreAttachment of [
    async () => { throw new Error("attachment missing"); },
    async (row: RecoveryRow) => ({ ...row, storage: "file", relativePath: "new", sha256: "c".repeat(64) }),
  ]) {
    const env = effects({ restoreAttachment });
    await expect(restoreRecoverySnapshot(value, value.snapshot, env)).rejects.toThrow();
    expect(env.writeSafety).not.toHaveBeenCalled();
    expect(await readRecoveryBaseline()).toBe(before);
  }
});

it("restores verified attachments with new local paths while preserving portable metadata", async () => {
  const value = await downloaded(payload({ attachments: [attachment] }));
  const env = effects();
  await restoreRecoverySnapshot(value, value.snapshot, env);
  expect(await db.attachments.get("asset")).toMatchObject({
    ...attachment, storage: "file", relativePath: "restored-asset",
  });
  expect(env.restoreAttachment).toHaveBeenCalledWith(attachment, value.backupFilePath);
});

it("a local edit during safety-copy writing aborts restoration without erasing that edit", async () => {
  await db.fragments.put(fragment("one", "current"));
  const value = await downloaded(payload({ fragments: [fragment("one", "old")] }));
  await expect(restoreRecoverySnapshot(value, value.snapshot, effects({
    writeSafety: async () => {
      await db.fragments.put(fragment("one", "edited-during-backup"));
      return { filePath: "/isolated-test/safety.json", bytes: 1024 };
    },
  }))).rejects.toThrow("content-changed");
  expect((await db.fragments.get("one"))?.text).toBe("edited-during-backup");
});

it("a remote update during safety-copy writing is also detected", async () => {
  await db.fragments.put(fragment("one", "current"));
  const value = await downloaded(payload({ fragments: [fragment("one", "old")] }));
  await expect(restoreRecoverySnapshot(value, value.snapshot, effects({
    writeSafety: async () => {
      await applySyncPacket({
        protocol: "chengjing-sync-v1", id: "during-safety", operations: [{
          id: "new-remote", table: "fragments", key: "remote-only",
          clock: { other: 1 }, value: fragment("remote-only"),
        }],
      });
      return { filePath: "/isolated-test/safety.json", bytes: 1024 };
    },
  }))).rejects.toThrow("content-changed");
  expect(await db.fragments.get("remote-only")).toBeDefined();
  expect((await db.fragments.get("one"))?.text).toBe("current");
});

it("a write failure rolls back earlier table writes and all generated sync operations", async () => {
  await db.fragments.put(fragment("one", "current"));
  const before = await readRecoveryBaseline();
  const value = await downloaded(payload({
    tags: [{ id: "new-tag", name: "restored", color: "jade" }],
    fragments: [fragment("one", "old")],
  }));
  const fail = () => { throw new Error("simulated-write-failure"); };
  db.fragments.hook("updating", fail);
  try {
    await expect(restoreRecoverySnapshot(value, value.snapshot, effects()))
      .rejects.toThrow("simulated-write-failure");
  } finally {
    db.fragments.hook("updating").unsubscribe(fail);
  }
  expect(await readRecoveryBaseline()).toBe(before);
  expect(await db.tags.get("new-tag")).toBeUndefined();
});

it("pausing during safety-copy writing cancels the restore and never resumes sync silently", async () => {
  await db.fragments.put(fragment("one", "current"));
  const before = await readRecoveryBaseline(), value = await downloaded();
  await expect(restoreRecoverySnapshot(value, value.snapshot, effects({
    writeSafety: async () => {
      localStorage.removeItem("chengjing-sync-enabled");
      return { filePath: "/isolated-test/safety.json", bytes: 1024 };
    },
  }))).rejects.toThrow("paused");
  expect(await readRecoveryBaseline()).toBe(before);
  expect(localStorage.getItem("chengjing-sync-enabled")).toBeNull();
});
