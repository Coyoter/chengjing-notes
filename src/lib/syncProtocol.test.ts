import { expect, it } from "vitest";
import { mergeHeads, materializedHead, type SyncOperation } from "./syncProtocol";
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
