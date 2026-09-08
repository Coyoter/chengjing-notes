import "fake-indexeddb/auto";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { db } from "../db";
import { disconnectGoogleAccount } from "./googleDisconnect";
import { withPausedSyncWorkspace } from "./syncEngine";
import { getSyncActivity, reportSyncActivity } from "./syncActivity";

beforeAll(() => db.open());
beforeEach(async () => {
  localStorage.clear();
  await db.transaction("rw", db.tables, () => Promise.all(db.tables.map(table => table.clear())));
  await db.fragments.add({ id: "keep", text: "not uploaded", tagIds: [], pinned: false, createdAt: 1, updatedAt: 1 });
  await db.table("syncOutbox").put({ id: "pending", table: "fragments", key: "keep" });
  localStorage.setItem("chengjing-sync-enabled", "true");
});

it("pauses scheduling, waits for an in-flight workspace operation, and preserves content/outbox", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const active = withPausedSyncWorkspace(() => gate);
  localStorage.setItem("chengjing-sync-enabled", "true");
  const disconnect = vi.fn(async () => {});
  const pauseNative = vi.fn(async () => {});
  const suspendRecovery = vi.fn(async () => {});
  reportSyncActivity("idle");
  const result = disconnectGoogleAccount({ disconnect, pauseNative, suspendRecovery });
  expect(localStorage.getItem("chengjing-sync-enabled")).toBeNull();
  await Promise.resolve(); await Promise.resolve();
  expect(disconnect).not.toHaveBeenCalled();
  release(); await active; await result;
  expect(disconnect).toHaveBeenCalledOnce();
  expect(pauseNative).toHaveBeenCalledOnce();
  expect(await db.fragments.count()).toBe(1);
  expect(await db.table("syncOutbox").count()).toBe(1);
  expect(getSyncActivity().lastSuccessAt).toBe(0);
});

it("does not report success or erase pending data when credential removal fails", async () => {
  await expect(disconnectGoogleAccount({ suspendRecovery: async () => {}, disconnect: async () => { throw new Error("storage unavailable"); } })).rejects.toThrow("storage unavailable");
  expect(localStorage.getItem("chengjing-sync-enabled")).toBeNull();
  expect(await db.fragments.count()).toBe(1);
  expect(await db.table("syncOutbox").count()).toBe(1);
});
