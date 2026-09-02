import { describe, expect, it } from "vitest";
import { dueDateInputToTimestamp, editorTaskRecordId, normalizeEditorTaskHtml, timestampToDueDateInput } from "./taskSync";

describe("編輯器待辦同步", () => {
  it("為核取方塊建立穩定 ID，並讀出標題與完成狀態", () => {
    const ids = ["task-a", "task-b"];
    const first = normalizeEditorTaskHtml('<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>第一件事</p></div></li><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>第二件事</p></div></li></ul>', () => ids.shift()!);
    expect(first.tasks).toEqual([
      { sourceTaskId: "task-a", title: "第一件事", done: false },
      { sourceTaskId: "task-b", title: "第二件事", done: true },
    ]);
    const second = normalizeEditorTaskHtml(first.html, () => "不應使用");
    expect(second.html).toBe(first.html);
    expect(editorTaskRecordId("card-1", "task-a")).toBe("editor:card-1:task-a");
  });

  it("同一卡片內重複的來源 ID 會重新分配，避免待辦互相覆蓋", () => {
    const result = normalizeEditorTaskHtml('<ul data-type="taskList"><li data-type="taskItem" data-task-id="same" data-checked="false"><div><p>A</p></div></li><li data-type="taskItem" data-task-id="same" data-checked="false"><div><p>B</p></div></li></ul>', () => "replacement");
    expect(result.tasks.map((task) => task.sourceTaskId)).toEqual(["same", "replacement"]);
  });

  it("ETA 日期以本地中午保存，來回轉換不受時區跨日影響", () => {
    const timestamp = dueDateInputToTimestamp("2026-09-03");
    expect(timestampToDueDateInput(timestamp)).toBe("2026-09-03");
    expect(dueDateInputToTimestamp("not-a-date")).toBeUndefined();
    expect(dueDateInputToTimestamp("2026-02-31")).toBeUndefined();
  });
});
