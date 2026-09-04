import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/auto-backup");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, colorScheme: "dark", locale: "zh-TW" });
await context.addInitScript(() => {
  const actualNow = Date.now.bind(Date);
  let artificialOffset = 0;
  Date.now = () => actualNow() + artificialOffset;
  const localDefaults = { enabled: false, intervalDays: 1, retentionCount: 10, directory: "", lastAttemptAt: 0, lastSuccessAt: 0, lastFilePath: "", lastError: "" };
  const cloudDefaults = {
    configured: true,
    connected: false,
    settings: { enabled: false, intervalMinutes: 30, accountName: "", accountEmail: "", deviceId: "qa-device-12345678901234567890", lastAttemptAt: 0, lastSuccessAt: 0, lastContentHash: "", lastKnownManifestId: "", lastError: "", conflict: false },
    current: null,
    previous: null,
    needsDecision: false,
  };
  const readLocal = () => ({ ...localDefaults, ...JSON.parse(localStorage.getItem("qa-local-backup") || "{}") });
  const saveLocal = (value) => { localStorage.setItem("qa-local-backup", JSON.stringify(value)); return value; };
  const readCloud = () => ({ ...cloudDefaults, ...JSON.parse(localStorage.getItem("qa-cloud-backup") || "{}") });
  const saveCloud = (value) => { localStorage.setItem("qa-cloud-backup", JSON.stringify(value)); return value; };
  window.__backupQa = { writes: [], advance: (milliseconds) => { artificialOffset += milliseconds; } };
  window.chengjing = {
    platform: "darwin",
    backups: {
      getSettings: async () => readLocal(),
      chooseFolder: async () => ({ canceled: false, settings: saveLocal({ ...readLocal(), enabled: true, directory: "/Users/qa/Documents/澄境本地備份", lastError: "" }) }),
      updateSettings: async (patch) => saveLocal({ ...readLocal(), ...patch }),
      write: async ({ data, reason, assets = [] }) => {
        const parsed = JSON.parse(data);
        const settings = saveLocal({ ...readLocal(), lastAttemptAt: Date.now(), lastSuccessAt: Date.now(), lastFilePath: "/Users/qa/Documents/澄境本地備份/ChengJing-AutoBackup-QA.json", lastError: "" });
        window.__backupQa.writes.push({ target: "local", reason, format: parsed.format, version: parsed.version, assets: assets.length });
        return { filePath: settings.lastFilePath, filename: "ChengJing-AutoBackup-QA.json", bytes: data.length, removedCount: 0, settings };
      },
      writeSafety: async ({ data }) => ({ filePath: "/Users/qa/Library/Application Support/ChengJing/Restore Safety/QA.json", filename: "QA.json", bytes: data.length }),
    },
    cloudBackups: {
      getLocalStatus: async () => readCloud(),
      getStatus: async () => readCloud(),
      connect: async () => saveCloud({ ...readCloud(), connected: true, settings: { ...readCloud().settings, enabled: true, accountName: "QA User", accountEmail: "qa@example.com" } }),
      disconnect: async () => saveCloud({ ...cloudDefaults }),
      updateSettings: async (patch) => {
        const status = readCloud();
        const settings = { ...status.settings, ...patch };
        saveCloud({ ...status, settings });
        return settings;
      },
      write: async ({ data, reason, assets = [], force = false }) => {
        const parsed = JSON.parse(data);
        const now = Date.now();
        const settings = { ...readCloud().settings, enabled: true, lastAttemptAt: now, lastSuccessAt: now, lastKnownManifestId: "cloud-current", lastContentHash: "a".repeat(64), lastError: "", conflict: false };
        const result = {
          skipped: false,
          uploadedAssets: assets.length,
          reusedAssets: 0,
          settings,
          current: { id: "cloud-current", snapshotAt: now, size: data.length, day: new Date(now).toISOString().slice(0, 10) },
          previous: { id: "cloud-previous", snapshotAt: now - 86_400_000, size: data.length, day: new Date(now - 86_400_000).toISOString().slice(0, 10) },
        };
        saveCloud({ configured: true, connected: true, settings, current: result.current, previous: result.previous, needsDecision: false });
        window.__backupQa.writes.push({ target: "cloud", reason, force, format: parsed.format, version: parsed.version, assets: assets.length });
        return result;
      },
      download: async () => { throw new Error("restore is not invoked in this visual QA"); },
      completeRestore: async () => readCloud().settings,
      cancelRestore: async () => ({ cleaned: true }),
      adoptCurrentForOverwrite: async () => readCloud().settings,
    },
  };
});
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });

await page.goto(base, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "設定", exact: true }).click();
const panel = page.locator(".backup-hub");
await panel.evaluate((element) => element.scrollIntoView({ block: "center" }));
await panel.getByRole("heading", { name: "備份與復原", exact: true }).waitFor();
const twoMethodsVisible = await panel.getByRole("heading", { name: "Google 雲端", exact: true }).isVisible()
  && await panel.getByRole("heading", { name: "本地", exact: true }).isVisible();
const privacyBoundaryVisible = (await panel.innerText()).includes("無法讀取你 Google Drive 裡的其他檔案")
  && (await panel.innerText()).includes("本機 AI 模型不會上傳");
const emergencyInitiallyCollapsed = !await panel.locator(".emergency-restore").evaluate((element) => element.hasAttribute("open")).catch(() => false);

await panel.getByRole("button", { name: "連結 Google 帳號", exact: true }).click();
await panel.getByText("Google 雲端備份已完成。", { exact: true }).waitFor();
const cloudConnected = await panel.getByRole("checkbox", { name: "自動雲端備份", exact: true }).isChecked()
  && (await panel.innerText()).includes("qa@example.com")
  && (await panel.innerText()).includes("目前雲端備份");
const recommendedFrequency = await panel.locator(".backup-frequency-row select").inputValue() === "30"
  && (await panel.locator(".backup-frequency-row").innerText()).includes("建議");

await panel.locator(".emergency-restore > summary").click();
const emergencySeparated = await panel.getByText(/錯誤內容已同步到雲端時的救援方案/).isVisible()
  && await panel.getByRole("button", { name: "緊急復原前一天", exact: true }).isEnabled()
  && (await panel.locator(".emergency-restore").evaluate((element) => getComputedStyle(element).borderTopWidth)) !== "0px";

await panel.getByRole("button", { name: "選擇資料夾", exact: true }).click();
await panel.getByText(/澄境本地備份/).waitFor();
await panel.getByRole("button", { name: "每 3 天", exact: true }).click();
await panel.getByRole("button", { name: "立即備份到本地", exact: true }).click();
await panel.getByText("本地完整備份已安全寫入。", { exact: true }).waitFor();
const bothEnabled = await panel.getByRole("checkbox", { name: "自動雲端備份", exact: true }).isChecked()
  && await panel.getByRole("checkbox", { name: "自動本地備份", exact: true }).isChecked();
const manualWrites = await page.evaluate(() => window.__backupQa.writes);
const completePayloads = manualWrites.some((item) => item.target === "cloud" && item.reason === "manual" && item.format === "chengjing-backup" && item.version === 2)
  && manualWrites.some((item) => item.target === "local" && item.reason === "manual" && item.format === "chengjing-backup" && item.version === 2);

await page.evaluate(() => {
  const local = JSON.parse(localStorage.getItem("qa-local-backup") || "{}");
  localStorage.setItem("qa-local-backup", JSON.stringify({ ...local, enabled: true, lastSuccessAt: 0 }));
  const cloud = JSON.parse(localStorage.getItem("qa-cloud-backup") || "{}");
  localStorage.setItem("qa-cloud-backup", JSON.stringify({ ...cloud, settings: { ...cloud.settings, enabled: true, lastSuccessAt: 0 } }));
  window.__backupQa.advance(31_000);
  window.dispatchEvent(new Event("chengjing:auto-backup-settings-changed"));
});
await page.waitForFunction(() => window.__backupQa.writes.some((item) => item.target === "local" && item.reason === "scheduled") && window.__backupQa.writes.some((item) => item.target === "cloud" && item.reason === "scheduled"));
const bothScheduled = await page.evaluate(() => window.__backupQa.writes.some((item) => item.target === "local" && item.reason === "scheduled") && window.__backupQa.writes.some((item) => item.target === "cloud" && item.reason === "scheduled"));
await page.screenshot({ path: path.join(output, "01-cloud-local-backup-dark.png"), fullPage: true });

const languageCases = [
  { picker: "简体中文", heading: "备份与恢复", cloud: "Google 云端", local: "本地" },
  { picker: "English", heading: "Backup and restore", cloud: "Google Cloud", local: "Local" },
  { picker: "日本語", heading: "バックアップと復元", cloud: "Google クラウド", local: "ローカル" },
  { picker: "한국어", heading: "백업 및 복원", cloud: "Google 클라우드", local: "로컬" },
];
const localized = [];
for (const item of languageCases) {
  await page.locator(".language-grid button").filter({ hasText: item.picker }).click();
  await panel.getByRole("heading", { name: item.heading, exact: true }).waitFor();
  localized.push({
    language: item.picker,
    heading: await panel.getByRole("heading", { name: item.heading, exact: true }).isVisible(),
    cloud: await panel.getByRole("heading", { name: item.cloud, exact: true }).isVisible(),
    local: await panel.getByRole("heading", { name: item.local, exact: true }).isVisible(),
  });
}

await page.setViewportSize({ width: 1040, height: 900 });
await panel.evaluate((element) => element.scrollIntoView({ block: "start" }));
const responsive = await page.evaluate(() => {
  const root = document.documentElement;
  const grid = document.querySelector(".backup-method-grid");
  const cards = [...document.querySelectorAll(".backup-method-card")];
  return {
    rootOverflow: root.scrollWidth - root.clientWidth,
    panelOverflow: document.querySelector(".backup-hub").scrollWidth - document.querySelector(".backup-hub").clientWidth,
    cardsFit: cards.length === 2 && cards.every((card) => card.getBoundingClientRect().right <= document.querySelector(".backup-hub").getBoundingClientRect().right + 2),
    columns: grid ? getComputedStyle(grid).gridTemplateColumns : "",
  };
});
await page.screenshot({ path: path.join(output, "02-cloud-local-backup-responsive.png"), fullPage: true });

const report = {
  twoMethodsVisible,
  privacyBoundaryVisible,
  emergencyInitiallyCollapsed,
  cloudConnected,
  recommendedFrequency,
  emergencySeparated,
  bothEnabled,
  completePayloads,
  bothScheduled,
  localized,
  responsive,
  errors,
};
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();

if (!twoMethodsVisible || !privacyBoundaryVisible || !emergencyInitiallyCollapsed || !cloudConnected || !recommendedFrequency || !emergencySeparated || !bothEnabled || !completePayloads || !bothScheduled || localized.some((item) => !item.heading || !item.cloud || !item.local) || responsive.rootOverflow > 2 || responsive.panelOverflow > 2 || !responsive.cardsFit || errors.length) process.exitCode = 1;
