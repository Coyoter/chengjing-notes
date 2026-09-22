import { describe, expect, it } from "vitest";
import { checklistProgress } from "./kanban";

describe("看板卡片摘要", () => {
  it("計算 Checklist 完成數量", () => {
    const html = '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"></li><li data-type="taskItem" data-checked="false"></li></ul>';
    expect(checklistProgress(html)).toEqual({ done: 1, total: 2 });
  });

  it("一般卡片沒有 Checklist 時回傳零", () => {
    expect(checklistProgress("<p>一般內容</p>")).toEqual({ done: 0, total: 0 });
  });

  it("匯入或重新儲存改變 HTML 屬性順序，完成數仍相同", () => {
    const html = '<ul data-type="taskList"><li data-checked="true" data-task-id="a" data-type="taskItem"></li><li data-type="taskItem" data-checked="false"></li></ul>';
    expect(checklistProgress(html)).toEqual({ done: 1, total: 2 });
  });
});
