import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/update");
await fs.mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, colorScheme: "dark", locale: "zh-TW" });
await context.addInitScript(() => {
  const progressListeners = new Set();
  const checkCount = () => Number(sessionStorage.getItem("qa-update-check-count") || 0);
  window.__qaUpdateFail = false;
  window.chengjing = {
    app: { setLanguage: async (language) => ({ language }), quit: async () => { window.__qaQuitRequested = true; return { quitting: true }; } },
    updates: {
      check: async () => {
        if (window.__qaUpdateFail) throw new Error("更新服務回傳了比目前 App 更舊的版本；澄境已忽略這份過期資料，請稍後再試。");
        sessionStorage.setItem("qa-update-check-count", String(checkCount() + 1));
        return {
          status: "available",
          currentVersion: "0.2.0",
          latestVersion: "9.9.9",
          releaseName: "澄境筆記 9.9.9",
          notes: "## 這次更新\n- 新增每日首次啟動更新檢查\n- 自動下載、驗證並開啟最新版 DMG\n\n## SHA-256\n```text\n26db31a672ac305483111a6f55d79a36f86181b701e4cbc92a1be3924912a84e  ChengJing-9.9.9-arm64.dmg\n```",
          publishedAt: "2026-08-26T00:00:00Z",
          htmlUrl: "https://github.com/Coyoter/chengjing-notes/releases/tag/v9.9.9",
          asset: { name: "ChengJing-9.9.9-arm64.dmg", url: "https://github.com/example.dmg", size: 1000, digest: "sha256:test" },
        };
      },
      onProgress: (callback) => { progressListeners.add(callback); return () => progressListeners.delete(callback); },
      download: async () => new Promise((resolve) => {
        let percent = 0;
        const timer = setInterval(() => {
          percent += 25;
          const value = { state: percent >= 100 ? "completed" : "progressing", received: percent * 10, total: 1000, percent };
          progressListeners.forEach((callback) => callback(value));
          if (percent >= 100) { clearInterval(timer); setTimeout(() => resolve({ opened: true, verified: true, latestVersion: "9.9.9" }), 80); }
        }, 220);
      }),
    },
    platform: "darwin",
    onShortcut: (callback) => { window.__qaMenuShortcut = callback; return () => { if (window.__qaMenuShortcut === callback) delete window.__qaMenuShortcut; }; },
  };
});
const page = await context.newPage();
page.setDefaultTimeout(12_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });

await page.goto(base, { waitUntil: "networkidle" });
await page.getByRole("heading", { name: "澄境筆記 9.9.9 已準備好", exact: true }).waitFor();
const notesVisible = await page.getByText(/新增每日首次啟動更新檢查/).isVisible();
const firstDailyCheckCount = await page.evaluate(() => Number(sessionStorage.getItem("qa-update-check-count") || 0));
const dailyDatePersisted = await page.evaluate(() => /^\d{4}-\d{2}-\d{2}$/.test(localStorage.getItem("chengjing-last-successful-update-check-day") || ""));
const checksumHidden = await page.locator(".update-dialog").getByText(/SHA-256|26db31a6/).count() === 0;
const markdownSyntaxHidden = await page.locator(".update-notes").getByText(/## 這次更新/).count() === 0;
await page.screenshot({ path: path.join(output, "01-update-available.png"), fullPage: true });
await page.getByRole("button", { name: "下載並手動更新", exact: true }).click();
const progressPanel = page.locator(".update-progress");
await progressPanel.waitFor();
const progressVisible = (await progressPanel.innerText()).includes("下載");
await page.getByRole("heading", { name: "最新版 DMG 已開啟", exact: true }).waitFor();
const manualInstructionVisible = await page.getByText(/拖進「應用程式」/).isVisible();
await page.screenshot({ path: path.join(output, "02-update-opened.png"), fullPage: true });
await page.getByRole("button", { name: "關閉澄境並開始取代", exact: true }).click();
const quitRequested = await page.evaluate(() => window.__qaQuitRequested === true);
await page.locator(".update-dialog > header .bare-button").click();
await page.evaluate(() => window.__qaMenuShortcut?.("check-update"));
await page.getByRole("heading", { name: "澄境筆記 9.9.9 已準備好", exact: true }).waitFor();
const menuCheckCount = await page.evaluate(() => Number(sessionStorage.getItem("qa-update-check-count") || 0));
await page.getByRole("button", { name: "稍後", exact: true }).click();
await page.getByRole("heading", { name: "保持澄境最新", exact: true }).waitFor();
await page.locator("#update-settings").evaluate((element) => element.scrollIntoView({ block: "center" }));
await page.waitForTimeout(220);
const settingsVersions = await page.locator(".update-version-grid").innerText();
const settingsVisible = settingsVersions.includes("0.2.0") && settingsVersions.includes("9.9.9") && settingsVersions.includes("有新版可下載");
const dailyCopyVisible = await page.getByText(/每天第一次啟動時自動檢查/).isVisible();
await page.screenshot({ path: path.join(output, "03-update-settings.png"), fullPage: true });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
await page.evaluate(() => { window.__qaUpdateFail = true; });
await page.locator("#update-settings").getByRole("button", { name: "立即檢查", exact: true }).click();
await page.locator(".update-settings-error").getByText(/已忽略這份過期資料/).waitFor();
const staleInfoCleared = (await page.locator(".update-version-grid > div").nth(1).locator("b").innerText()).trim() === "—";
const staleErrorExplained = await page.locator(".update-settings-error").getByText(/比目前 App 更舊/).isVisible();
await page.evaluate(() => { window.__qaUpdateFail = false; });
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1800);
const sameDayReloadDoesNotCheckAgain = await page.evaluate(() => Number(sessionStorage.getItem("qa-update-check-count") || 0)) === menuCheckCount;

const summary = { notesVisible, firstDailyCheckCount, dailyDatePersisted, checksumHidden, markdownSyntaxHidden, progressVisible, manualInstructionVisible, quitRequested, menuCheckCount, settingsVisible, dailyCopyVisible, staleInfoCleared, staleErrorExplained, sameDayReloadDoesNotCheckAgain, overflow, errors };
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(summary, null, 2));
await browser.close();
console.log(JSON.stringify(summary, null, 2));
if (!notesVisible || firstDailyCheckCount !== 1 || !dailyDatePersisted || !checksumHidden || !markdownSyntaxHidden || !progressVisible || !manualInstructionVisible || !quitRequested || menuCheckCount !== 2 || !settingsVisible || !dailyCopyVisible || !staleInfoCleared || !staleErrorExplained || !sameDayReloadDoesNotCheckAgain || overflow > 2 || errors.length) process.exitCode = 1;
