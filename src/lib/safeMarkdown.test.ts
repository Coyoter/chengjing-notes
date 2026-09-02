import { describe, expect, it } from "vitest";
import { renderSafeMarkdown } from "./safeMarkdown";

describe("安全 Markdown 顯示", () => {
  it("轉換標題、粗體、清單、引用與程式碼", () => {
    const html = renderSafeMarkdown("## 今日線索\n\n這是 **重要文字**。\n\n- 第一項\n- 第二項\n\n> 這是仍待確認的假設\n\n`inlineCode`");
    expect(html).toContain("<h2>今日線索</h2>");
    expect(html).toContain("<strong>重要文字</strong>");
    expect(html).toContain("<li>第一項</li>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<code>inlineCode</code>");
  });

  it("移除腳本、事件屬性、追蹤圖片與危險網址", () => {
    const html = renderSafeMarkdown('**安全文字**<script>window.bad = true</script><img src="https://tracker.example/pixel" onerror="alert(1)">[危險連結](javascript:alert(1))');
    expect(html).toContain("<strong>安全文字</strong>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
  });

  it("外部連結在系統瀏覽器安全開啟", () => {
    const html = renderSafeMarkdown("[官方說明](https://example.com/guide)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
