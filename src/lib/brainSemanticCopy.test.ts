import { describe, expect, it } from "vitest";
import { languageOptions } from "../i18n";
import { getBrainSemanticCopy } from "./brainSemanticCopy";

describe("第二大腦語意推理契約", () => {
  it("五種語言都要求語意、時間、不確定性與雙端證據", () => {
    for (const { value } of languageOptions) {
      const copy = getBrainSemanticCopy(value);
      expect(copy.organizePrompt).toContain("candidate_pairs");
      expect(copy.organizePrompt).toContain("relationType");
      expect(copy.organizePrompt).toContain("evidence");
      expect(copy.organizePrompt).toContain("0.62");
      expect(copy.reportPrompt.length).toBeGreaterThan(180);
      expect(copy.expandReflection).toBeTruthy();
      expect(copy.collapseReflection).toBeTruthy();
      expect(Object.values(copy.relationLabels).every(Boolean)).toBe(true);
    }
  });

  it("使用可泛化的語意與時間推理規則", () => {
    const prompt = getBrainSemanticCopy("zh-TW").organizePrompt;
    expect(prompt).toContain("沒有相同詞仍可連結");
    expect(prompt).toContain("時間接近只能提高脈絡可能性");
    expect(prompt).toContain("事件與狀態");
    expect(prompt).toContain("替代解釋");
  });

  it("今日反思只輸出像朋友般的溫暖 insight，不使用報告格式", () => {
    const prompt = getBrainSemanticCopy("zh-TW").reportPrompt;
    expect(prompt).toContain("長期關心使用者");
    expect(prompt).toContain("直接用「你」對話");
    expect(prompt).toContain("不要使用標題、條列、編號、表格");
    expect(prompt).toContain("不假裝比本人更了解本人");
    expect(prompt).toContain("時間接近不能被寫成已證實的因果");
  });
});
