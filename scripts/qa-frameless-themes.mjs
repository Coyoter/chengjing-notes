import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/frameless-themes");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1480, height: 920 }, colorScheme: "dark", locale: "zh-TW" });
const page = await context.newPage();
page.setDefaultTimeout(10_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
await page.goto(base, { waitUntil: "networkidle" });

async function themeMetrics(theme) {
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const label = theme === "dark" ? "深色" : theme === "light" ? "淺色" : "墨色";
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.waitForTimeout(220);
  const settings = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const canvas = document.createElement("canvas");
    canvas.width = 1; canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const rgba = (color) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
    const luminance = ([r, g, b]) => [r, g, b].map((value) => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const ratio = (a, b) => { const x = luminance(rgba(a)), y = luminance(rgba(b)); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
    const element = (selector) => { const style = getComputedStyle(document.querySelector(selector)); return { borderWidth: parseFloat(style.borderTopWidth), borderColor: style.borderTopColor, shadow: style.boxShadow, background: style.backgroundColor }; };
    const colors = {
      canvas: root.getPropertyValue("--canvas").trim(),
      surface1: root.getPropertyValue("--surface-1").trim(),
      surface2: root.getPropertyValue("--surface-2").trim(),
      text1: root.getPropertyValue("--text-1").trim(),
      text2: root.getPropertyValue("--text-2").trim(),
      muted: root.getPropertyValue("--text-muted").trim(),
    };
    return {
      theme: document.documentElement.dataset.theme,
      colors,
      canvasToSurface1: Number(ratio(colors.canvas, colors.surface1).toFixed(2)),
      surface1ToSurface2: Number(ratio(colors.surface1, colors.surface2).toFixed(2)),
      textOnSurface1: Number(ratio(colors.text1, colors.surface1).toFixed(2)),
      sidebar: element(".sidebar"),
      topbar: element(".topbar"),
      settingsSection: element(".settings-section"),
      settingsCard: element(".settings-card"),
      themeButton: element(".theme-grid button"),
    };
  });
  await page.screenshot({ path: path.join(output, `01-settings-${theme}.png`), fullPage: true });
  await page.getByRole("button", { name: "卡片庫", exact: true }).click();
  await page.waitForTimeout(220);
  const library = await page.locator(".library-card").first().evaluate((card) => {
    const style = getComputedStyle(card);
    return { borderWidth: parseFloat(style.borderTopWidth), shadow: style.boxShadow, background: style.backgroundColor };
  });
  await page.screenshot({ path: path.join(output, `02-library-${theme}.png`), fullPage: true });
  let inkClarity = null;
  if (theme === "ink") {
    await page.getByRole("button", { name: "白板", exact: true }).click();
    await page.locator(".board-toolbar").waitFor();
    inkClarity = await page.locator(".board-toolbar").evaluate((toolbar) => ({ backdrop: getComputedStyle(toolbar).backdropFilter, background: getComputedStyle(toolbar).backgroundColor, shadow: getComputedStyle(toolbar).boxShadow }));
  }
  return { ...settings, library, inkClarity };
}

const reports = [];
for (const theme of ["light", "dark", "ink"]) reports.push(await themeMetrics(theme));
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify({ reports, errors }, null, 2));
console.log(JSON.stringify(reports, null, 2));
await browser.close();

const failed = reports.some((report) =>
  report.canvasToSurface1 < 1.08 ||
  report.surface1ToSurface2 < 1.08 ||
  report.textOnSurface1 < 7 ||
  report.sidebar.borderWidth !== 0 ||
  report.topbar.borderWidth !== 0 ||
  report.settingsSection.borderWidth !== 0 ||
  report.settingsCard.borderWidth !== 0 ||
  report.themeButton.borderWidth !== 0 ||
  report.library.borderWidth !== 0 ||
  report.library.shadow !== "none" ||
  (report.theme === "ink" && (report.inkClarity?.backdrop !== "none" || report.inkClarity?.shadow !== "none"))
);
if (failed || errors.length) process.exitCode = 1;
