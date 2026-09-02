import { describe, expect, it } from "vitest";
import { dataUrlToBlob, formatBytes, friendlyErrorMessage, stripHtml, truncate } from "./utils";

describe("文字與檔案工具", () => {
  it("能把 HTML 轉回乾淨的純文字", () => {
    expect(stripHtml("<h2>標題</h2><p>第一段 <strong>重點</strong></p>")).toBe("標題第一段 重點");
  });

  it("只在內容超過長度時加入省略號", () => {
    expect(truncate("短內容", 10)).toBe("短內容");
    expect(truncate("這是一段比較長的內容", 6)).toBe("這是一段比較…");
  });

  it("能顯示一般人看得懂的檔案大小", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(3.2 * 1024 ** 3)).toBe("3.2 GB");
  });

  it("能將資料網址還原成 Blob", async () => {
    const blob = dataUrlToBlob("data:text/plain;base64,5r6E5aKD");
    expect(blob.type).toBe("text/plain");
    expect(await blob.text()).toBe("澄境");
  });

  it("移除 Electron IPC 包裝後只顯示真正錯誤", () => {
    expect(friendlyErrorMessage(new Error("Error invoking remote method 'ai:openrouter-chat': Error: OpenRouter API 金鑰無效。"))).toBe("OpenRouter API 金鑰無效。");
  });
});
