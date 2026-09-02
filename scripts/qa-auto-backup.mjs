import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/auto-backup");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 920 }, colorScheme: "dark", locale: "zh-TW" });
await context.addInitScript(() => {
  const actualNow = Date.now.bind(Date);
  let artificialOffset = 0;
  Date.now = () => actualNow() + artificialOffset;
  const defaults = { enabled: false, intervalDays: 1, retentionCount: 10, directory: "", lastAttemptAt: 0, lastSuccessAt: 0, lastFilePath: "", lastError: "" };
  const read = () => ({ ...defaults, ...JSON.parse(localStorage.getItem("qa-auto-backup-settings") || "{}") });
  const save = (value) => { localStorage.setItem("qa-auto-backup-settings", JSON.stringify(value)); return value; };
  window.__autoBackupQa = { writes: JSON.parse(localStorage.getItem("qa-auto-backup-writes") || "[]"), advance: (milliseconds) => { artificialOffset += milliseconds; } };
  window.chengjing = {
    platform: "darwin",
    backups: {
      getSettings: async () => read(),
      chooseFolder: async () => ({ canceled: false, settings: save({ ...read(), enabled: true, directory: "/Users/coyoter/Library/CloudStorage/GoogleDrive/澄境備份", lastError: "" }) }),
      updateSettings: async (patch) => save({ ...read(), ...patch }),
      write: async ({ data, reason, assets = [] }) => {
        const parsed = JSON.parse(data);
        const settings = save({ ...read(), lastAttemptAt: Date.now(), lastSuccessAt: Date.now(), lastFilePath: "/Users/coyoter/Library/CloudStorage/GoogleDrive/澄境備份/ChengJing-AutoBackup-QA.json", lastError: "" });
        window.__autoBackupQa.writes.push({ reason, format: parsed.format, version: parsed.version, tables: Object.keys(parsed.data), size: data.length, assets: assets.length });
        localStorage.setItem("qa-auto-backup-writes", JSON.stringify(window.__autoBackupQa.writes));
        return { filePath: settings.lastFilePath, filename: "ChengJing-AutoBackup-QA.json", bytes: data.length, removedCount: 0, settings };
      },
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
const panel = page.locator(".auto-backup-panel");
await panel.evaluate((element) => element.scrollIntoView({ block: "center" }));
await panel.getByRole("heading", { name: "自動備份", exact: true }).waitFor();
const initiallyDisabled = !await panel.getByRole("checkbox", { name: "定時自動備份", exact: true }).isChecked() && (await panel.innerText()).includes("尚未選擇資料夾");
const lowLoadCopyVisible = (await panel.innerText()).includes("不會在背景常駐喚醒電腦") && (await panel.innerText()).includes("進入空閒時");
const cloudCopyAccurate = (await panel.innerText()).includes("Google Drive") && (await panel.innerText()).includes("該雲端服務會自行同步") && (await panel.innerText()).includes("不會登入或上傳你的雲端帳號");

await panel.getByRole("button", { name: "選擇資料夾", exact: true }).click();
await panel.getByText(/GoogleDrive\/澄境備份/).waitFor();
const folderSelectionEnables = await panel.getByRole("checkbox", { name: "定時自動備份", exact: true }).isChecked();
await panel.getByRole("button", { name: "每 3 天", exact: true }).click();
const intervalUpdated = await panel.getByRole("button", { name: "每 3 天", exact: true }).evaluate((element) => element.classList.contains("is-active"));
await panel.getByRole("button", { name: "立即備份", exact: true }).click();
await panel.getByText("完整備份已安全寫入。", { exact: true }).waitFor();
const backupResult = await page.evaluate(() => ({ settings: JSON.parse(localStorage.getItem("qa-auto-backup-settings") || "{}"), writes: window.__autoBackupQa.writes }));
const completePayloadWritten = backupResult.writes.length === 1
  && backupResult.writes[0].reason === "manual"
  && backupResult.writes[0].format === "chengjing-backup"
  && backupResult.writes[0].version === 2
  && backupResult.writes[0].tables.includes("cards")
  && backupResult.writes[0].tables.includes("attachments")
  && backupResult.writes[0].size > 100;
await page.evaluate(() => {
  const settings = JSON.parse(localStorage.getItem("qa-auto-backup-settings") || "{}");
  localStorage.setItem("qa-auto-backup-settings", JSON.stringify({ ...settings, enabled: true, lastSuccessAt: 0 }));
  window.__autoBackupQa.advance(31_000);
  window.dispatchEvent(new Event("chengjing:auto-backup-settings-changed"));
});
await page.waitForFunction(() => window.__autoBackupQa.writes.some((item) => item.reason === "scheduled"));
const scheduledDueWritten = await page.evaluate(() => window.__autoBackupQa.writes.some((item) => item.reason === "scheduled" && item.format === "chengjing-backup"));
await page.screenshot({ path: path.join(output, "01-automatic-backup-dark.png"), fullPage: true });

await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: "設定", exact: true }).click();
const reloadedPanel = page.locator(".auto-backup-panel");
await reloadedPanel.evaluate((element) => element.scrollIntoView({ block: "center" }));
await reloadedPanel.getByText(/GoogleDrive\/澄境備份/).waitFor();
const persistedAfterReload = await reloadedPanel.getByRole("checkbox", { name: "定時自動備份", exact: true }).isChecked()
  && await reloadedPanel.getByRole("button", { name: "每 3 天", exact: true }).evaluate((element) => element.classList.contains("is-active"))
  && (await reloadedPanel.innerText()).includes("上次完成");

const languageCases = [
  { picker: "简体中文", heading: "自动备份", cloud: "同步文件夹＝多一份云端备份" },
  { picker: "English", heading: "Automatic backup", cloud: "A synced folder adds a cloud copy" },
  { picker: "日本語", heading: "自動バックアップ", cloud: "同期フォルダならクラウドにも1部" },
  { picker: "한국어", heading: "자동 백업", cloud: "동기화 폴더라면 클라우드 사본도 생성" },
];
const localized = [];
for (const item of languageCases) {
  await page.locator(".language-grid button").filter({ hasText: item.picker }).click();
  await panel.getByRole("heading", { name: item.heading, exact: true }).waitFor();
  localized.push({ language: item.picker, heading: await panel.getByRole("heading", { name: item.heading, exact: true }).isVisible(), cloud: (await panel.innerText()).includes(item.cloud) });
}
await page.setViewportSize({ width: 1040, height: 820 });
await panel.evaluate((element) => element.scrollIntoView({ block: "start" }));
const responsiveOverflow = await page.evaluate(() => ({ root: document.documentElement.scrollWidth - document.documentElement.clientWidth, panel: document.querySelector(".auto-backup-panel").scrollWidth - document.querySelector(".auto-backup-panel").clientWidth }));
await page.screenshot({ path: path.join(output, "02-automatic-backup-responsive.png"), fullPage: true });

const report = { initiallyDisabled, lowLoadCopyVisible, cloudCopyAccurate, folderSelectionEnables, intervalUpdated, completePayloadWritten, scheduledDueWritten, persistedAfterReload, localized, responsiveOverflow, errors };
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();

if (!initiallyDisabled || !lowLoadCopyVisible || !cloudCopyAccurate || !folderSelectionEnables || !intervalUpdated || !completePayloadWritten || !scheduledDueWritten || !persistedAfterReload || localized.some((item) => !item.heading || !item.cloud) || responsiveOverflow.root > 2 || responsiveOverflow.panel > 2 || errors.length) process.exitCode = 1;
