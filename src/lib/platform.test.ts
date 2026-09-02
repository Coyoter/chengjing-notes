import { describe, expect, it } from "vitest";
import { displayDesktopAccelerator, hasPrimaryModifier, primaryShortcut } from "./platform";
import { getQuickCaptureCopy } from "./quickCaptureCopy";

describe("Windows 平台介面", () => {
  it("以 Ctrl／Alt 顯示 Windows 快捷鍵", () => {
    expect(primaryShortcut("N", "win32")).toBe("Ctrl+N");
    expect(displayDesktopAccelerator("CommandOrControl+Alt+J", "win32")).toBe("Ctrl+Alt+J");
    expect(displayDesktopAccelerator("CommandOrControl+Alt+J", "darwin")).toBe("⌘ ⌥ J");
  });

  it("白板等共用操作同時接受 Windows Ctrl 與 macOS Command", () => {
    expect(hasPrimaryModifier({ ctrlKey: true, metaKey: false })).toBe(true);
    expect(hasPrimaryModifier({ ctrlKey: false, metaKey: true })).toBe(true);
    expect(hasPrimaryModifier({ ctrlKey: false, metaKey: false })).toBe(false);
  });

  it("快速記錄會改用 Windows 系統匣與 Alt+Enter 文案", () => {
    const copy = getQuickCaptureCopy("zh-TW", "win32");
    expect(copy.settingsTitle).toBe("系統匣快速記錄");
    expect(copy.settingsDescription).toContain("Windows 系統匣");
    expect(copy.enterHint).toContain("Alt+Enter");
    expect(copy.enterHint).not.toContain("⌥");
  });
});
