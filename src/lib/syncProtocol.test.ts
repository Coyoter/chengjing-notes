import { expect, it } from "vitest";
import { mergeHeads, mergeSyncRecord, materializedHead, validateSyncPacket, type SyncOperation } from "./syncProtocol";
const edit = (id: string, clock: Record<string, number>, value: Record<string, unknown> | null = { id: "a", title: id }): SyncOperation => ({ id, clock, value, table: "cards", key: "a" });
it("同一筆離線並發編輯保留兩份且抵達順序不影響結果", () => {
  const a=edit("one",{ phone:1 }); const b=edit("two",{ mac:1 });
  expect(mergeHeads([a],[b])).toEqual(mergeHeads([b],[a]));
  expect(mergeHeads([a],[b])).toHaveLength(2);
});
it("因果較新的編輯取代祖先，重複傳送無副作用", () => {
  const a=edit("one",{ phone:1 }); const b=edit("two",{ phone:2 });
  expect(mergeHeads([a],[b,b])).toEqual([b]);
});
it("刪除與編輯衝突保留內容直到明確解決", () => {
  const a=edit("delete",{phone:1},null); const b=edit("edit",{mac:1});
  expect(materializedHead(mergeHeads([a],[b]))).toEqual(b);
  const resolved=edit("resolved",{phone:2,mac:1},null);
  expect(mergeHeads([a,b],[resolved])).toEqual([resolved]);
});
it("相同內容不製造衝突，但使用者自訂欄位仍完整比較",()=>{
  const a=edit("a",{phone:1},{id:"a",title:"same",updatedAt:1});const b=edit("b",{mac:1},{id:"a",title:"same",updatedAt:2});
  expect(mergeHeads([a],[b])).toHaveLength(1);
  const c=edit("c",{phone:1},{id:"a",properties:{updatedAt:"first"}});const d=edit("d",{mac:1},{id:"a",properties:{updatedAt:"second"}});
  expect(mergeHeads([c],[d])).toHaveLength(2);
});
it("離線並發採用真正修改較新的版本，不看截止時間，抵達順序一致",()=>{
  const old={...edit("z-old",{phone:1},{id:"a",title:"old",dueAt:999999}),changedAt:10};
  const latest={...edit("a-new",{mac:1},{id:"a",title:"new",dueAt:1}),changedAt:20};
  for(const pair of [[old,latest],[latest,old]]){
    const record=mergeSyncRecord(mergeSyncRecord(undefined,[pair[0]]),[pair[1]]);
    expect(materializedHead(record.heads).id).toBe("a-new");
    expect(record.recovery?.map(head=>head.id)).toEqual(["z-old"]);
  }
});
it("有時間的刪除與離線編輯依最新修改決定，舊內容可救援",()=>{
  const value={...edit("edit",{mac:1}),changedAt:10};
  const deleted={...edit("delete",{phone:1},null),changedAt:20};
  const record=mergeSyncRecord(mergeSyncRecord(undefined,[value]),[deleted]);
  expect(materializedHead(record.heads).value).toBeNull();
  expect(record.recovery?.[0].value).not.toBeNull();
});
it("時間相同有穩定排序，已看過對方後的修改優先於裝置時鐘",()=>{
  const first={...edit("a",{mac:1}),changedAt:900};
  const later={...edit("b",{mac:1,phone:1}),changedAt:100};
  expect(materializedHead([first,later])).toEqual(later);
  const concurrent={...edit("c",{phone:1}),changedAt:900};
  expect(materializedHead([first,concurrent])).toEqual(materializedHead([concurrent,first]));
});
it("封包拒絕非法修改時間，舊版封包仍可讀取",()=>{
  const packet={protocol:"chengjing-sync-v1",id:"test",operations:[edit("a",{phone:1})]};
  expect(validateSyncPacket(packet)).toBe(packet);
  expect(()=>validateSyncPacket({...packet,operations:[{...packet.operations[0],changedAt:"tomorrow"}]})).toThrow("sync-invalid-time");
});
