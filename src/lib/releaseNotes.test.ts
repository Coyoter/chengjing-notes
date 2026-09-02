import { describe, expect, it } from "vitest";
import { userFacingReleaseNotes } from "./releaseNotes";

describe("應用內更新說明", () => {
  it("保留使用者看得懂的更新內容並移除 SHA-256 區塊", () => {
    const notes = `## 這次更新
- 日誌劃記會同步出現在左側選單

## SHA-256
\`\`\`text
26db31a672ac305483111a6f55d79a36f86181b701e4cbc92a1be3924912a84e  ChengJing-0.2.3-arm64.dmg
ad97197ee53768cedd22e5255985f0f751c03779be82acc5b6ea3ac58fd0c706  ChengJing-0.2.3-source.zip
\`\`\``;

    const visible = userFacingReleaseNotes(notes);
    expect(visible).toContain("日誌劃記會同步出現在左側選單");
    expect(visible).toContain("這次更新");
    expect(visible).not.toContain("##");
    expect(visible).not.toContain("SHA-256");
    expect(visible).not.toContain("26db31a6");
  });

  it("只移除純校驗碼程式區塊，保留一般程式範例", () => {
    const notes = `修正更新流程

\`\`\`text
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  ChengJing.dmg
\`\`\`

\`\`\`js
console.log("保留我");
\`\`\``;

    const visible = userFacingReleaseNotes(notes);
    expect(visible).not.toContain("ChengJing.dmg");
    expect(visible).toContain("console.log");
  });
});
