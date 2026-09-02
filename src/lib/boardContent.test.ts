import { describe, expect, it } from "vitest";
import { boardPreviewBlocks, normalizeBoardPlainText, richHtmlFromPlainText } from "./boardContent";

describe("白板卡片文字整理", () => {
  it("把擠在同一行的 Bullet 拆成可掃讀區塊", () => {
    const value = "• 第一個決策 • 第二個風險 • 第三個下一步";
    expect(normalizeBoardPlainText(value)).toBe("• 第一個決策\n• 第二個風險\n• 第三個下一步");
    expect(boardPreviewBlocks(value, "zh-TW")).toEqual([
      { kind: "bullet", text: "第一個決策" }, { kind: "bullet", text: "第二個風險" }, { kind: "bullet", text: "第三個下一步" },
    ]);
  });

  it("AI 純文字清單會轉成真正的 HTML 清單", () => {
    expect(richHtmlFromPlainText("• 決策一\n• 決策二")).toBe("<ul><li><p>決策一</p></li><li><p>決策二</p></li></ul>");
  });
});
