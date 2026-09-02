import { describe, expect, it } from "vitest";
import { dayjsLocale, intlLocale, languageOptions, translate } from "./i18n";
import type { AppLanguage } from "./types";

const languages: AppLanguage[] = ["zh-TW", "zh-CN", "en", "ja", "ko"];

describe("五語介面字典", () => {
  it("提供五個固定語言與正確地區代碼", () => {
    expect(languageOptions.map((item) => item.value)).toEqual(languages);
    expect(dayjsLocale).toEqual({ "zh-TW": "zh-tw", "zh-CN": "zh-cn", en: "en", ja: "ja", ko: "ko" });
    expect(intlLocale).toEqual({ "zh-TW": "zh-TW", "zh-CN": "zh-CN", en: "en-US", ja: "ja-JP", ko: "ko-KR" });
  });

  it("核心導覽、AI 回答語言與插值都依介面語言切換", () => {
    expect(translate("zh-TW", "nav.brain")).toBe("第二大腦");
    expect(translate("zh-CN", "nav.inbox")).toBe("收件箱");
    expect(translate("en", "nav.library")).toBe("Card Library");
    expect(translate("ja", "settings.reading")).toBe("読書環境");
    expect(translate("en", "brain.summary", { nodes: 12, edges: 4 })).toBe("12 neurons, 4 editable links");
    expect(translate("en", "ai.system")).toContain("Always respond in natural, accurate English");
    expect(translate("ja", "ai.system")).toContain("常に自然で正確な日本語");
    expect(translate("ko", "ai.system")).toContain("항상 자연스럽고 정확한 한국어");
  });
});
