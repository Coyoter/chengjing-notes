import { expect, it } from "vitest";
import { syncStatusKind } from "./syncActivity";
it("同步中即使沒有本機待上傳內容，也不能提前顯示完成",()=>{
  expect(syncStatusKind(true,true,"",0,100)).toBe("working");
  expect(syncStatusKind(true,false,"",0,100)).toBe("ready");
});
it("失敗、待傳送與第一次尚未完成，各有明確狀態",()=>{
  expect(syncStatusKind(true,false,"network error",0,100)).toBe("error");
  expect(syncStatusKind(true,false,"",3,100)).toBe("pending");
  expect(syncStatusKind(true,false,"",0,0)).toBe("waiting");
  expect(syncStatusKind(false,false,"",0,100)).toBe("paused");
});
