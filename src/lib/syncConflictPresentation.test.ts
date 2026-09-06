import { expect, it } from "vitest";
import { mergeHeads, type SyncOperation, type SyncRecord } from "./syncProtocol";
import { syncRecordLabel, syncVersionText } from "./syncConflictPresentation";
const head=(id:string,value:Record<string,unknown>):SyncOperation=>({id,table:"tags",key:"tag-ai",clock:{[id]:1},value:{id:"tag-ai",...value}});
it("相同內容只差建立時間會合併，保留最初建立與最後修改時間",()=>{
  const heads=mergeHeads([head("phone",{name:"AI",createdAt:20,updatedAt:50})],[head("desktop",{name:"AI",createdAt:10,updatedAt:30})]);
  expect(heads).toHaveLength(1);expect(heads[0].value).toMatchObject({createdAt:10,updatedAt:50,name:"AI"});
});
it("截止日期或自訂欄位不同仍保留雙方，不為簡化介面而吞資料",()=>{
  expect(mergeHeads([head("phone",{name:"AI",dueAt:20})],[head("desktop",{name:"AI",dueAt:30})])).toHaveLength(2);
  expect(mergeHeads([head("phone",{properties:{createdAt:"A"}})],[head("desktop",{properties:{createdAt:"B"}})])).toHaveLength(2);
});
it("衝突名稱顯示標籤名稱，缺少名稱也不洩露內部代號或 JSON",()=>{
  const named:SyncRecord={id:"tags:tag-ai",heads:[head("a",{name:"AI"})]};
  expect(syncRecordLabel(named,true)).toEqual({kind:"標籤",name:"AI"});
  const unnamed={...named,heads:[head("a",{})]};
  expect(syncRecordLabel(unnamed,true).name).toBe("標籤");
  expect(syncVersionText(unnamed.heads[0],true)).not.toContain("tag-ai");
});
