import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/readability/typography-report.json");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", locale: "zh-TW" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
await page.goto(base, { waitUntil: "networkidle" });

async function audit(label) {
  return page.evaluate((pageLabel) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1; canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    function rgba(color) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    }
    function luminance([r, g, b]) {
      const values = [r, g, b].map((value) => { const channel = value / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; });
      return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
    }
    function ratio(foreground, background) {
      const a = luminance(foreground); const b = luminance(background);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }
    function backgroundFor(element) {
      let node = element;
      while (node) {
        const value = getComputedStyle(node).backgroundColor;
        const parsed = rgba(value);
        if (parsed[3] > 245) return parsed;
        node = node.parentElement;
      }
      return rgba(getComputedStyle(document.documentElement).backgroundColor);
    }
    const elements = [...document.querySelectorAll("body *")].filter((element) => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight || element.closest("[disabled], .brain-access-list")) return false;
      return [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    });
    const samples = elements.map((element) => {
      const style = getComputedStyle(element);
      const text = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent.trim()).join(" ").slice(0, 80);
      const fontSize = parseFloat(style.fontSize);
      const fontWeight = Number(style.fontWeight) || 400;
      const contrast = ratio(rgba(style.color), backgroundFor(element));
      const threshold = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
      return { text, selector: element.className || element.tagName, fontSize, lineHeight: parseFloat(style.lineHeight), fontWeight, contrast: Number(contrast.toFixed(2)), threshold };
    });
    return {
      label: pageLabel,
      samples: samples.length,
      minFontSize: Math.min(...samples.map((item) => item.fontSize)),
      minContrast: Math.min(...samples.map((item) => item.contrast)),
      fontFailures: samples.filter((item) => item.fontSize < 12),
      contrastFailures: samples.filter((item) => item.contrast + 0.02 < item.threshold),
      longTextLineHeightFailures: samples.filter((item) => item.text.length >= 30 && Number.isFinite(item.lineHeight) && item.lineHeight / item.fontSize < 1.5),
    };
  }, label);
}

const reports = [];
reports.push(await audit("今日"));
for (const name of ["日誌", "白板", "卡片庫", "資料庫", "待辦", "劃記", "隻言片語", "第二大腦", "設定"]) {
  await page.getByRole("button", { name, exact: true }).click();
  await page.waitForTimeout(120);
  reports.push(await audit(name));
}
await page.getByRole("button", { name: "墨色", exact: true }).click();
reports.push(await audit("設定・墨色"));
for (const name of ["隻言片語", "第二大腦", "卡片庫"]) {
  await page.getByLabel("主要功能").getByRole("button", { name, exact: true }).click();
  await page.waitForTimeout(name === "第二大腦" ? 450 : 120);
  reports.push(await audit(`${name}・墨色`));
}
await page.getByRole("button", { name: "詢問 AI", exact: true }).click();
await page.locator(".ai-panel").waitFor();
reports.push(await audit("AI 面板"));

const result = { reports, errors };
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(reports.map(({ label, samples, minFontSize, minContrast, fontFailures, contrastFailures, longTextLineHeightFailures }) => ({ label, samples, minFontSize, minContrast, fontFailures: fontFailures.length, contrastFailures: contrastFailures.length, lineHeightFailures: longTextLineHeightFailures.length })), null, 2));
await browser.close();
if (errors.length || reports.some((report) => report.fontFailures.length || report.contrastFailures.length || report.longTextLineHeightFailures.length)) process.exitCode = 1;
