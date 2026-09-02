import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AIMarkdown } from "./AIMarkdown";

describe("AI 回答 Markdown", () => {
  it("顯示標題、粗體、清單與分隔線，而不是原始符號", () => {
    const html = renderToStaticMarkup(<AIMarkdown content={"### 工作盤點\n\n1. **核心職責**\n   - 數據分析\n\n---"} />);
    expect(html).toContain("<h3>工作盤點</h3>");
    expect(html).toContain("<strong>核心職責</strong>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<hr>");
    expect(html).not.toContain("### 工作盤點");
  });

  it("移除模型輸出的腳本與追蹤圖片", () => {
    const html = renderToStaticMarkup(<AIMarkdown content={'**安全**<script>window.bad=true</script><img src="https://tracker.example/pixel">'} />);
    expect(html).toContain("<strong>安全</strong>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
  });
});
