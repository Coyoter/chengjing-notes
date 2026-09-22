import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { db } from "../db";
import type { CardRecord } from "../types";
import { SharedBrainSyncManager } from "./SharedBrainSyncManager";

const { updateNeuron, deleteNeuron, identity } = vi.hoisted(() => ({
  updateNeuron: vi.fn(), deleteNeuron: vi.fn(), identity: { id: "test-author" },
}));
vi.mock("../lib/community", () => ({
  getCommunityIdentity: () => identity,
  communityApi: { updateNeuron, deleteNeuron },
}));

let root: Root;
const card = (text: string, updatedAt: number): CardRecord => ({
  id: "shared-card", title: "Shared card", plainText: text, contentHtml: `<p>${text}</p>`,
  kind: "note", state: "active", createdAt: 1, updatedAt, tagIds: [], favorite: false,
  color: "", attachmentIds: [], properties: {},
});
beforeAll(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); return db.open(); });
afterAll(() => vi.unstubAllGlobals());
beforeEach(async () => {
  localStorage.clear();
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
  updateNeuron.mockReset().mockResolvedValue(undefined);
  deleteNeuron.mockReset().mockResolvedValue(undefined);
  await db.cards.put(card("First edit", 2));
  await db.brainShares.put({ id: "card:shared-card", localType: "card", localId: "shared-card",
    remoteId: "remote-card", status: "shared", sharedAt: 1, updatedAt: 1 });
  root = createRoot(document.createElement("div"));
});
afterEach(async () => { await act(async () => root.unmount()); });

async function settleUntil(assertion: () => void) {
  for (let attempt = 0; attempt < 200; attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    try { assertion(); return; } catch (error) { if (attempt === 199) throw error; }
  }
}

it("上傳期間的新編輯會再次同步，只確認已送出的版本", async () => {
  let finish!: () => void;
  updateNeuron.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await act(async () => root.render(<SharedBrainSyncManager />));
  await settleUntil(() => expect(updateNeuron).toHaveBeenCalledOnce());
  await act(async () => { await db.cards.put(card("Final edit", 3)); });
  await act(async () => { finish(); });
  await settleUntil(() => expect(updateNeuron).toHaveBeenCalledTimes(2));
  await settleUntil(() => expect(updateNeuron.mock.calls[1][2].body).toBe("Final edit"));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
  expect((await db.brainShares.get("card:shared-card"))?.updatedAt).toBe(3);
  expect(updateNeuron).toHaveBeenCalledTimes(2);
});

it("沒有新編輯時只同步一次，失敗也不會形成無限重試", async () => {
  updateNeuron.mockRejectedValueOnce(new Error("offline"));
  await act(async () => root.render(<SharedBrainSyncManager />));
  await settleUntil(() => expect(updateNeuron).toHaveBeenCalledOnce());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
  expect(updateNeuron).toHaveBeenCalledOnce();
  expect((await db.brainShares.get("card:shared-card"))?.updatedAt).toBe(1);
  await act(async () => { await db.cards.put(card("Try the next edit", 3)); });
  await settleUntil(() => expect(updateNeuron).toHaveBeenCalledTimes(2));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
  expect(updateNeuron).toHaveBeenCalledTimes(2);
  expect((await db.brainShares.get("card:shared-card"))?.updatedAt).toBe(3);
});

it("來源刪除後只刪除遠端一次，不因完成通知重複呼叫", async () => {
  await db.cards.delete("shared-card");
  await act(async () => root.render(<SharedBrainSyncManager />));
  await settleUntil(() => expect(deleteNeuron).toHaveBeenCalledOnce());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
  expect(deleteNeuron).toHaveBeenCalledOnce();
  expect((await db.brainShares.get("card:shared-card"))?.status).toBe("deleted");
});
