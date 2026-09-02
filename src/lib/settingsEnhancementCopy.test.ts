import { describe, expect, it } from "vitest";
import { languageOptions } from "../i18n";
import { getSettingsEnhancementCopy } from "./settingsEnhancementCopy";
import { getTaskEnhancementCopy } from "./taskEnhancementCopy";

describe("設定與待辦新增文案", () => {
  it("五種介面語言都有打賞與 ETA 文案", () => {
    for (const { value } of languageOptions) {
      const support = getSettingsEnhancementCopy(value);
      const tasks = getTaskEnhancementCopy(value);
      expect(support.title).toBeTruthy();
      expect(support.description).toBeTruthy();
      expect(tasks.dueDate).toBeTruthy();
      expect(tasks.dialogTitle("Test")).toContain("Test");
      expect(tasks.calendarLabel).toBeTruthy();
      expect(tasks.todayTitle).toBeTruthy();
      expect(tasks.overdueTitle).toBeTruthy();
      expect(tasks.futureTitle).toBeTruthy();
      expect(tasks.noDateTitle).toBeTruthy();
      expect(tasks.taskCount(2)).toContain("2");
      expect(tasks.overdueDays(3)).toContain("3");
    }
  });
});
