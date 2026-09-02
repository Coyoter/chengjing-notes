import { describe, expect, it } from "vitest";
import { segmentReflection } from "./reflection";

describe("今日反思分段", () => {
  it("把模型回傳的中文長段落整理成短段落", () => {
    const source = "你最近似乎一直在趕進度，白天反覆調整提案，到了晚上也沒有真的放下。工作突然改變方向可能讓你覺得失去掌控，但這仍只是值得確認的線索。你同時留下了幾則睡不好的記錄，也許兩者共享同一段壓力脈絡。當然，作息或其他沒有寫下來的事情也可能有影響。你似乎很快就把注意力放回解決問題，卻很少替自己留一點喘息。下次再遇到變動時，也許可以先停一下，看看此刻真正需要的是休息、協助，還是重新安排優先順序。";
    const result = segmentReflection(source, "zh-TW");
    expect(result.split("\n\n").length).toBeGreaterThanOrEqual(2);
    expect(result.replaceAll("\n", "")).toBe(source);
  });

  it("保留模型原本已經清楚分好的短段落", () => {
    const source = "第一段已經完整。\n\n第二段也很清楚。";
    expect(segmentReflection(source, "zh-TW")).toBe(source);
  });
});
