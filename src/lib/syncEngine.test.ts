import "fake-indexeddb/auto";
import { beforeAll, beforeEach, afterEach, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { db } from "../db";
import { applySyncPacket, pendingSyncPackets, synchronize, reconcileMetadataOnlyConflicts } from "./syncEngine";
beforeAll(() => { Object.defineProperty(crypto, "subtle", { value: webcrypto.subtle }); return db.open(); });
beforeEach(async () => { localStorage.removeItem("chengjing-sync-enabled"); await db.transaction("rw",db.tables,async()=>{for(const table of db.tables)await table.clear();});localStorage.setItem("chengjing-sync-enabled","true"); });
afterEach(() => localStorage.removeItem("chengjing-sync-enabled"));
const fragment = (id:string,text=id) => ({id,text,pinned:false,tagIds:[],createdAt:1,updatedAt:1});
it("內容及同步佇列同交易寫入；失敗一起撤銷", async () => {
  await db.fragments.put(fragment("one"));
  expect(await db.table("syncOutbox").count()).toBe(1);
  await db.transaction("rw",db.fragments,async()=>{await db.fragments.put(fragment("two"));throw new Error("abort");}).catch(()=>{});
  expect(await db.fragments.get("two")).toBeUndefined();
  expect(await db.table("syncOutbox").count()).toBe(1);
});
it("收到遠端不同筆資料會合併而不製造回音上傳", async () => {
  await db.fragments.put(fragment("local"));
  await applySyncPacket({protocol:"chengjing-sync-v1",id:"packet",operations:[{id:"remote-op",table:"fragments",key:"remote",clock:{other:1},value:fragment("remote")}]});
  expect(await db.fragments.count()).toBe(2);
  expect(await db.table("syncOutbox").count()).toBe(1);
});
it("同一筆並發修改保留衝突，批次刪除有墓碑", async () => {
  await db.fragments.put(fragment("one","local"));
  await applySyncPacket({protocol:"chengjing-sync-v1",id:"packet",operations:[{id:"remote-op",table:"fragments",key:"one",clock:{other:1},value:fragment("one","remote")}]});
  expect((await db.table("syncRecords").get("fragments:one")).heads).toHaveLength(2);
  await db.fragments.clear();
  expect((await db.table("syncRecords").get("fragments:one")).heads[0].value).toBe(null);
});
it("背景上傳的收據只清除已成功送出的修改", async () => {
  await db.fragments.put(fragment("one","first"));
  const {value: packet} = await pendingSyncPackets().next();
  await db.fragments.put(fragment("one","later"));
  await applySyncPacket(packet);
  expect((await db.fragments.get("one"))?.text).toBe("later");
  expect(await db.table("syncOutbox").count()).toBe(1);
});
it("重試沿用同一封包名稱，一次同步送完超過 500 筆且保留上傳中新增內容", async () => {
  await db.fragments.bulkPut(Array.from({length:501},(_,i)=>fragment(`f-${i}`)));
  const {value: first} = await pendingSyncPackets().next();
  const {value: retry} = await pendingSyncPackets().next();
  expect(first.id).toBe(retry.id);
  let uploads=0;
  await synchronize({list:async()=>[],get:async()=>"",put:async()=>{uploads++;if(uploads===1)await db.fragments.put(fragment("new-during-upload"));}});
  expect(uploads).toBe(2);
  expect(await db.table("syncOutbox").count()).toBe(1);
});
it("同步讀取期間暫停，不再上傳或私自恢復", async () => {
  await db.fragments.put(fragment("one"));let uploads=0;
  await synchronize({list:async()=>{localStorage.removeItem("chengjing-sync-enabled");return[];},get:async()=>"",put:async()=>{uploads++;}});
  expect(uploads).toBe(0);expect(await db.table("syncOutbox").count()).toBe(1);
});
it("兩台裝置同一天的 AI 反思都保留，不阻塞其他資料同步", async () => {
  const report={date:"2026-09-06",content:"local",model:"test",createdAt:1,updatedAt:1};
  await db.brainReports.put({id:"local-report",...report});
  await applySyncPacket({protocol:"chengjing-sync-v1",id:"reports",operations:[{id:"remote-report",table:"brainReports",key:"other-report",clock:{other:1},value:{id:"other-report",...report,content:"remote"}},{id:"remote-fragment",table:"fragments",key:"two",clock:{other:2},value:fragment("two")}]});
  expect(await db.brainReports.where("date").equals(report.date).count()).toBe(2);
  expect(await db.fragments.get("two")).toBeDefined();
});
it("升級後修復舊的時間差異衝突，不改變內容，且產生可同步的合併",async()=>{
  await db.fragments.put(fragment("one","same content"));
  const record=await db.table("syncRecords").get("fragments:one");
  record.heads.push({...record.heads[0],id:"other",clock:{other:1},value:{...record.heads[0].value,createdAt:2,updatedAt:3}});
  await db.table("syncRecords").put(record);
  await reconcileMetadataOnlyConflicts();
  expect((await db.table("syncRecords").get(record.id)).heads).toHaveLength(1);
  expect((await db.fragments.get("one"))?.text).toBe("same content");
  expect(await db.table("syncOutbox").count()).toBe(2);
});
