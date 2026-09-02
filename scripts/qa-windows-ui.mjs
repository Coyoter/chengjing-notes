import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/windows-ui");
await fs.mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1480, height: 920 }, colorScheme: "dark", locale: "zh-TW" });
await context.addInitScript(() => {
  const backupSettings = { enabled: false, intervalDays: 1, retentionCount: 10, directory: "", lastAttemptAt: 0, lastSuccessAt: 0, lastFilePath: "", lastError: "" };
  window.__windowsQa = { clipboard: null };
  window.chengjing = {
    app: {
      getPreferredLanguage: async () => ({ language: "zh-TW", preferredLanguages: ["zh-Hant-TW"] }),
      setLanguage: async (language) => ({ language }),
      getMenuSnapshot: async () => [],
      getSystemVersion: async () => ({ platform: "win32", arch: "arm64", version: "10.0.26100" }),
      getWindowState: async () => ({ fullscreen: false, maximized: false }),
      onWindowState: () => () => {},
      closeMain: async () => ({ closed: true }),
      quit: async () => ({ quitting: true }),
    },
    updates: {
      check: async () => ({ status: "current", currentVersion: "0.7.5", latestVersion: "0.7.5", releaseName: "澄境 0.7.5", notes: "", publishedAt: "", htmlUrl: "", asset: null }),
      download: async () => ({ opened: false, status: "current", currentVersion: "0.7.5" }),
      onProgress: () => () => {},
    },
    backups: {
      getSettings: async () => backupSettings,
      chooseFolder: async () => ({ canceled: true, settings: backupSettings }),
      updateSettings: async () => backupSettings,
      write: async () => ({ filePath: "", fileName: "", removed: [], settings: backupSettings }),
    },
    ai: {
      keyStatus: async () => ({ configured: false, encrypted: true, storage: "app-local-aes-256-gcm" }),
      setKey: async () => ({ configured: true, encrypted: true, storage: "app-local-aes-256-gcm" }),
      clearKey: async () => ({ configured: false, encrypted: true, storage: "app-local-aes-256-gcm" }),
      testOpenRouter: async () => ({ ok: true, label: "QA", limitRemaining: null, usage: null }),
      listModels: async () => [],
      openRouterChat: async () => ({ text: "QA", model: "qa/model", usage: null, finishReason: "stop" }),
    },
    web: { read: async () => { throw new Error("unused"); } },
    files: { save: async () => ({ canceled: true }), open: async () => ({ canceled: true, files: [] }) },
    attachments: {
      importPath: async () => { throw new Error("unused"); }, importData: async () => { throw new Error("unused"); }, remove: async () => ({ removed: true }), stats: async () => ({ bytes: 0, count: 0 }), readData: async () => "", cleanup: async () => ({ removed: 0 }), restoreFromBackup: async () => { throw new Error("unused"); },
    },
    clipboard: {
      write: async (request) => { window.__windowsQa.clipboard = request; return { written: true }; },
      read: async () => window.__windowsQa.clipboard || { text: "", payload: null },
    },
    quickCapture: {
      getSettings: async () => ({ shortcut: "CommandOrControl+\\", defaultShortcut: "CommandOrControl+\\", registered: true, shortcutBackend: "electron", inputBackend: "electron-textarea", openAtLogin: false }),
      setShortcut: async (shortcut) => ({ shortcut, registered: true, shortcutBackend: "electron" }),
      setRecording: async (recording) => ({ suspended: recording, registered: !recording }),
      setOpenAtLogin: async (enabled) => ({ openAtLogin: enabled }),
      hide: async () => ({ hidden: true }), show: async () => ({ shown: true }), showMain: async () => ({ shown: true }), nativeSubmitResult: async () => ({ acknowledged: false }), onNativeSubmit: () => () => {}, onFocus: () => () => {},
    },
    onShortcut: () => () => {},
    platform: "win32",
  };
});

const page = await context.newPage();
page.setDefaultTimeout(12_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror:${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console:${message.text()}`); });
await page.goto(base, { waitUntil: "networkidle" });
await page.getByText("今天想釐清什麼？").waitFor();

const shell = await page.evaluate(() => ({
  platform: document.documentElement.dataset.platform,
  brandLeading: getComputedStyle(document.documentElement).getPropertyValue("--brand-leading").trim(),
  dragDisplay: getComputedStyle(document.querySelector(".window-drag-region")).display,
  fontFamily: getComputedStyle(document.documentElement).fontFamily,
  quickCreate: document.querySelector(".quick-create kbd")?.textContent,
  searchShortcut: document.querySelector(".search-trigger kbd")?.textContent?.replace(/\s+/g, " ").trim(),
}));

await page.getByRole("button", { name: "收合側欄", exact: true }).click();
await page.waitForFunction(() => document.querySelector(".sidebar.is-collapsed")?.getBoundingClientRect().width <= 73);
const collapsedWidth = await page.locator(".sidebar.is-collapsed").evaluate((element) => element.getBoundingClientRect().width);
await page.getByRole("button", { name: "展開側欄", exact: true }).click();

await page.keyboard.press("Control+k");
await page.locator(".command-palette").waitFor();
const commandShortcut = await page.locator(".command-palette footer").innerText();
await page.keyboard.press("Escape");

const cardFocusPaddingTop = await page.evaluate(() => {
  const layer = document.createElement("section");
  layer.className = "card-focus-layer";
  document.querySelector(".app-main")?.append(layer);
  const value = getComputedStyle(layer).paddingTop;
  layer.remove();
  return value;
});

await page.getByRole("button", { name: "設定", exact: true }).click();
await page.locator("#quick-capture-settings").scrollIntoViewIfNeeded();
const settings = await page.evaluate(() => ({
  quickTitle: document.querySelector("#quick-capture-settings h2")?.textContent,
  quickDescription: document.querySelector("#quick-capture-settings header p")?.textContent,
  shortcut: document.querySelector(".shortcut-recorder span")?.textContent,
  updateDescription: document.querySelector("#update-settings header p")?.textContent,
  keyBoundary: document.querySelector(".local-key-boundary")?.textContent,
}));
await page.screenshot({ path: path.join(output, "windows-settings.png"), fullPage: true });

const report = {
  shell,
  collapsedWidth,
  commandShortcut,
  cardFocusPaddingTop,
  settings,
  errors,
};
await fs.writeFile(path.join(output, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
await browser.close();

const passed = shell.platform === "win32"
  && shell.brandLeading === "17px"
  && shell.dragDisplay === "none"
  && shell.fontFamily.includes("Segoe UI")
  && shell.quickCreate === "Ctrl+N"
  && shell.searchShortcut === "Ctrl K"
  && Math.abs(collapsedWidth - 72) <= 1
  && commandShortcut.includes("Ctrl+K")
  && cardFocusPaddingTop === "0px"
  && settings.quickTitle === "系統匣快速記錄"
  && settings.quickDescription?.includes("Windows 系統匣")
  && settings.shortcut === "Ctrl+\\"
  && settings.updateDescription?.includes("Windows 安裝程式")
  && settings.keyBoundary?.includes("Windows 認證管理員")
  && errors.length === 0;

console.log(JSON.stringify({ passed, ...report }, null, 2));
if (!passed) process.exitCode = 1;
