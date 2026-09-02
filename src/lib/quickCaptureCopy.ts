import type { AppLanguage } from "../types";
import { currentDesktopPlatform, displayDesktopAccelerator, isWindows } from "./platform";

const copies = {
  "zh-TW": {
    eyebrow: "隨手留下來", title: "隻言片語", placeholder: "此刻腦中閃過什麼？", submit: "留下來", saved: "已收進隻言片語", enterHint: "Enter 儲存 · ⌥ Enter 換行 · Esc 關閉",
    settingsEyebrow: "隨時可用", settingsTitle: "選單列快速記錄", settingsDescription: "澄境常駐在 macOS 選單列；不必切回主視窗，也能用全域快捷鍵留下一句話。",
    shortcut: "全域快捷鍵", shortcutHint: "即使澄境不在最前面也能開啟。", record: "按下新的組合鍵", recording: "請按下快捷鍵…", reset: "恢復預設", unavailable: "這組快捷鍵已被其他應用使用，請換一組。", invalid: "請同時按下 Command、Control 或 Option 與另一個按鍵。",
    launch: "登入時在背景啟動", launchHint: "不會自動打開主視窗，只會準備選單列按鈕與快捷鍵。", desktopOnly: "請使用澄境桌面版設定選單列工具。",
  },
  "zh-CN": {
    eyebrow: "随手记下来", title: "只言片语", placeholder: "此刻脑中闪过什么？", submit: "留下来", saved: "已收进只言片语", enterHint: "Enter 保存 · Alt+Enter 换行 · Esc 关闭",
    settingsEyebrow: "随时可用", settingsTitle: "菜单栏快速记录", settingsDescription: "澄境常驻在 macOS 菜单栏；无需切回主窗口，也能用全局快捷键留下一句话。",
    shortcut: "全局快捷键", shortcutHint: "即使澄境不在前台也能打开。", record: "按下新的组合键", recording: "请按下快捷键…", reset: "恢复默认", unavailable: "该快捷键已被其他应用占用，请更换。", invalid: "请同时按下 Command、Control 或 Alt 与另一个按键。",
    launch: "登录时在后台启动", launchHint: "不会自动打开主窗口，只准备菜单栏按钮与快捷键。", desktopOnly: "请使用澄境桌面版设置菜单栏工具。",
  },
  en: {
    eyebrow: "Capture in the moment", title: "Fragment", placeholder: "What just crossed your mind?", submit: "Keep it", saved: "Saved to Fragments", enterHint: "Enter to save · Option+Enter for a new line · Esc to close",
    settingsEyebrow: "Always at hand", settingsTitle: "Menu bar quick capture", settingsDescription: "ChengJing stays in the macOS menu bar so you can capture a sentence without returning to the main window.",
    shortcut: "Global shortcut", shortcutHint: "Works even when ChengJing is not in front.", record: "Press a new shortcut", recording: "Press your shortcut…", reset: "Reset default", unavailable: "Another app is using that shortcut. Choose another one.", invalid: "Hold Command, Control, or Option together with another key.",
    launch: "Start quietly at login", launchHint: "The main window stays closed; only the menu bar item and shortcut are prepared.", desktopOnly: "Use the ChengJing desktop app to configure quick capture.",
  },
  ja: {
    eyebrow: "思いついた瞬間に", title: "ひとこと", placeholder: "今、頭をよぎったことは？", submit: "残す", saved: "ひとことに保存しました", enterHint: "Enterで保存 · ⌥ Enterで改行 · Escで閉じる",
    settingsEyebrow: "いつでも使える", settingsTitle: "メニューバー・クイック記録", settingsDescription: "ChengJingをmacOSメニューバーに常駐させ、メイン画面へ戻らず一言を残せます。",
    shortcut: "グローバルショートカット", shortcutHint: "ChengJingが前面になくても開けます。", record: "新しいキーを押す", recording: "ショートカットを押してください…", reset: "初期設定に戻す", unavailable: "そのショートカットは他のアプリが使用中です。", invalid: "Command、Control、Optionのいずれかと別のキーを同時に押してください。",
    launch: "ログイン時にバックグラウンド起動", launchHint: "メイン画面は開かず、メニューバーとショートカットだけを準備します。", desktopOnly: "デスクトップ版ChengJingで設定してください。",
  },
  ko: {
    eyebrow: "떠오른 순간에", title: "짧은 생각", placeholder: "지금 머리를 스친 것은 무엇인가요?", submit: "남기기", saved: "짧은 생각에 저장했습니다", enterHint: "Enter로 저장 · ⌥ Enter로 줄바꿈 · Esc로 닫기",
    settingsEyebrow: "언제든 바로", settingsTitle: "메뉴 막대 빠른 기록", settingsDescription: "ChengJing이 macOS 메뉴 막대에 머물러 메인 창으로 돌아오지 않고도 한 문장을 남길 수 있습니다.",
    shortcut: "전역 단축키", shortcutHint: "ChengJing이 앞에 없어도 열립니다.", record: "새 단축키 누르기", recording: "단축키를 눌러 주세요…", reset: "기본값 복원", unavailable: "다른 앱에서 사용 중인 단축키입니다.", invalid: "Command, Control 또는 Option과 다른 키를 함께 눌러 주세요.",
    launch: "로그인할 때 백그라운드 시작", launchHint: "메인 창은 열지 않고 메뉴 막대와 단축키만 준비합니다.", desktopOnly: "ChengJing 데스크톱 앱에서 설정하세요.",
  },
} as const;

const windowsCopies = {
  "zh-TW": {
    enterHint: "Enter 儲存 · Alt+Enter 換行 · Esc 關閉",
    settingsTitle: "系統匣快速記錄",
    settingsDescription: "澄境常駐在 Windows 系統匣；不必切回主視窗，也能用全域快捷鍵留下一句話。",
    invalid: "請同時按下 Ctrl、Alt 或 Windows 鍵與另一個按鍵。",
    launchHint: "不會自動打開主視窗，只會準備系統匣按鈕與快捷鍵。",
    desktopOnly: "請使用澄境桌面版設定系統匣工具。",
  },
  "zh-CN": {
    enterHint: "Enter 保存 · Alt+Enter 换行 · Esc 关闭",
    settingsTitle: "系统托盘快速记录",
    settingsDescription: "澄境常驻在 Windows 系统托盘；无需切回主窗口，也能用全局快捷键留下一句话。",
    invalid: "请同时按下 Ctrl、Alt 或 Windows 键与另一个按键。",
    launchHint: "不会自动打开主窗口，只准备系统托盘按钮与快捷键。",
    desktopOnly: "请使用澄境桌面版设置系统托盘工具。",
  },
  en: {
    enterHint: "Enter to save · Alt+Enter for a new line · Esc to close",
    settingsTitle: "System tray quick capture",
    settingsDescription: "ChengJing stays in the Windows system tray so you can capture a sentence without returning to the main window.",
    invalid: "Hold Ctrl, Alt, or the Windows key together with another key.",
    launchHint: "The main window stays closed; only the system tray item and shortcut are prepared.",
    desktopOnly: "Use the ChengJing desktop app to configure the system tray tool.",
  },
  ja: {
    enterHint: "Enterで保存 · Alt+Enterで改行 · Escで閉じる",
    settingsTitle: "システムトレイ・クイック記録",
    settingsDescription: "ChengJingをWindowsのシステムトレイに常駐させ、メイン画面へ戻らず一言を残せます。",
    invalid: "Ctrl、Alt、Windowsキーのいずれかと別のキーを同時に押してください。",
    launchHint: "メイン画面は開かず、システムトレイとショートカットだけを準備します。",
    desktopOnly: "デスクトップ版ChengJingでシステムトレイを設定してください。",
  },
  ko: {
    enterHint: "Enter로 저장 · Alt+Enter로 줄바꿈 · Esc로 닫기",
    settingsTitle: "시스템 트레이 빠른 기록",
    settingsDescription: "ChengJing이 Windows 시스템 트레이에 머물러 메인 창으로 돌아오지 않고도 한 문장을 남길 수 있습니다.",
    invalid: "Ctrl, Alt 또는 Windows 키와 다른 키를 함께 눌러 주세요.",
    launchHint: "메인 창은 열지 않고 시스템 트레이와 단축키만 준비합니다.",
    desktopOnly: "ChengJing 데스크톱 앱에서 시스템 트레이 도구를 설정하세요.",
  },
} as const;

export function getQuickCaptureCopy(language: AppLanguage, platform = currentDesktopPlatform()) {
  const base = copies[language] || copies.en;
  return isWindows(platform) ? { ...base, ...(windowsCopies[language] || windowsCopies.en) } : base;
}

export function displayAccelerator(value: string, platform = currentDesktopPlatform()) {
  return displayDesktopAccelerator(value, platform);
}
