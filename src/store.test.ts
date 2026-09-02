import { beforeEach, describe, expect, it } from "vitest";
import { languageFromPreferences, useAppStore } from "./store";

describe("介面狀態", () => {
  beforeEach(() => {
    useAppStore.setState({ view: "today", selectedCardId: null, rightPanel: "none", aiDraft: "" });
  });

  it("開啟卡片時會顯示中央工作面", () => {
    useAppStore.getState().openCard("card-1");
    expect(useAppStore.getState().selectedCardId).toBe("card-1");
    expect(useAppStore.getState().rightPanel).toBe("none");
  });

  it("卡片與 AI 可以同時保持開啟", () => {
    useAppStore.getState().openCard("card-1");
    useAppStore.getState().openAI();
    expect(useAppStore.getState().selectedCardId).toBe("card-1");
    expect(useAppStore.getState().rightPanel).toBe("ai");
    useAppStore.getState().closeRightPanel();
    expect(useAppStore.getState().selectedCardId).toBe("card-1");
    expect(useAppStore.getState().rightPanel).toBe("none");
  });

  it("AI 快捷動作會保留使用者可以檢查的草稿", () => {
    useAppStore.getState().openAIWithPrompt("請摘要卡片");
    expect(useAppStore.getState().rightPanel).toBe("ai");
    expect(useAppStore.getState().aiDraft).toBe("請摘要卡片");
  });

  it("一般開啟 AI 不會沿用快捷 Prompt", () => {
    useAppStore.setState({ aiDraft: "舊的推薦 Prompt" });
    useAppStore.getState().openAI();
    expect(useAppStore.getState().rightPanel).toBe("ai");
    expect(useAppStore.getState().aiDraft).toBe("");
  });

  it("介面文字比例會保存為全域設定", () => {
    useAppStore.getState().setFontScale(1.2);
    expect(useAppStore.getState().fontScale).toBe(1.2);
    useAppStore.getState().setFontScale(1);
  });

  it("OpenRouter 路由模式預設平衡且可切換", () => {
    useAppStore.getState().setOpenRouterRoutingMode("balanced");
    expect(useAppStore.getState().openRouterRoutingMode).toBe("balanced");
    useAppStore.getState().setOpenRouterRoutingMode("speed");
    expect(useAppStore.getState().openRouterRoutingMode).toBe("speed");
    useAppStore.getState().setOpenRouterRoutingMode("balanced");
  });

  it("介面語言可以在五種語言之間切換", () => {
    useAppStore.getState().setLanguage("ja");
    expect(useAppStore.getState().language).toBe("ja");
    useAppStore.getState().setLanguage("zh-TW");
  });

  it("首次啟動會依 macOS 第一偏好語言選擇五語介面", () => {
    expect(languageFromPreferences(["zh-Hant-TW", "en-US"])).toBe("zh-TW");
    expect(languageFromPreferences(["zh-Hans-CN", "en-US"])).toBe("zh-CN");
    expect(languageFromPreferences(["ja-JP"])).toBe("ja");
    expect(languageFromPreferences(["ko-KR"])).toBe("ko");
    expect(languageFromPreferences(["fr-FR", "zh-Hant-TW"])).toBe("en");
  });

  it("新安裝的外觀預設為跟隨系統", () => {
    useAppStore.getState().setTheme("system");
    expect(useAppStore.getState().theme).toBe("system");
  });
});
