import "fake-indexeddb/auto";
import { beforeAll, beforeEach, afterEach, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { db } from "../db";
import { applySyncPacket, pendingSyncPackets, synchronize, reconcileLatestRecords, initializeSyncBaseline } from "./syncEngine";
beforeAll(() => { Object.defineProperty(crypto, "subtle", { value: webcrypto.subtle }); return db.open(); });
beforeEach(async () => { localStorage.removeItem("chengjing-sync-enabled");localStorage.removeItem("chengjing-sync-tracking"); await db.transaction("rw",db.tables,async()=>{for(const table of db.tables)await table.clear();});localStorage.setItem("chengjing-sync-enabled","true"); });
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
it("升級後修復舊的時間差異衝突，不改變內容或製造回音上傳",async()=>{
  await db.fragments.put(fragment("one","same content"));
  const record=await db.table("syncRecords").get("fragments:one");
  record.heads.push({...record.heads[0],id:"other",clock:{other:1},value:{...record.heads[0].value,createdAt:2,updatedAt:3}});
  await db.table("syncRecords").put(record);
  await reconcileLatestRecords();
  expect((await db.table("syncRecords").get(record.id)).heads).toHaveLength(1);
  expect((await db.fragments.get("one"))?.text).toBe("same content");
  expect(await db.table("syncOutbox").count()).toBe(1);
});
it("首次啟用同步保留原修改時間，雲端較新者勝出且兩邊獨立內容合併", async()=>{
  localStorage.removeItem("chengjing-sync-enabled");
  await db.fragments.bulkPut([fragment("shared","old local"),fragment("local-only")]);
  await initializeSyncBaseline();
  const baseline=await db.table("syncRecords").get("fragments:shared");
  expect(baseline.heads[0].changedAt).toBe(1);
  await applySyncPacket({protocol:"chengjing-sync-v1",id:"first-sync",operations:[
    {id:"cloud-new",table:"fragments",key:"shared",clock:{cloud:1},changedAt:100,value:fragment("shared","new cloud")},
    {id:"cloud-only",table:"fragments",key:"cloud-only",clock:{cloud:2},value:fragment("cloud-only")}
  ]});
  expect(await db.fragments.count()).toBe(3);
  expect((await db.fragments.get("shared"))?.text).toBe("new cloud");
  expect((await db.table("syncRecords").get("fragments:shared")).recovery[0].value.text).toBe("old local");
  await db.fragments.update("shared",{text:"newer local"});
  expect((await db.table("syncRecords").get("fragments:shared")).recovery[0].value.text).toBe("old local");
});
it("舊版已有不同版本時升級自動採用最新，保留較早內容供救援",async()=>{
  const heads=[{id:"old",table:"fragments",key:"one",clock:{a:1},value:{...fragment("one","old"),updatedAt:10}},
    {id:"new",table:"fragments",key:"one",clock:{b:1},value:{...fragment("one","new"),updatedAt:20}}];
  await db.table("syncRecords").put({id:"fragments:one",heads});
  await reconcileLatestRecords();
  expect((await db.fragments.get("one"))?.text).toBe("new");
  expect((await db.table("syncRecords").get("fragments:one")).recovery.map((v:{id:string})=>v.id)).toEqual(["old"]);
});
it("相同附件的較新名稱生效，但裝置自己的檔案位置不被雲端覆寫",async()=>{
  const asset={id:"asset",name:"old.txt",mime:"text/plain",size:3,storage:"file" as const,relativePath:"local-file",sha256:"abc",createdAt:1};
  await db.attachments.put(asset);
  const record=await db.table("syncRecords").get("attachments:asset");
  await applySyncPacket({protocol:"chengjing-sync-v1",id:"asset-name",operations:[{
    ...record.heads[0],id:"rename",clock:{...record.heads[0].clock,remote:1},changedAt:Date.now(),value:{...asset,name:"new.txt",relativePath:"other-device-file"}
  }]});
  expect((await db.attachments.get("asset"))?.name).toBe("new.txt");
  expect((await db.attachments.get("asset"))?.relativePath).toBe("local-file");
});
