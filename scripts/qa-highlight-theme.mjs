import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/highlight-theme");
await fs.mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1540, height: 960 },
  colorScheme: "dark",
  locale: "zh-TW",
});
const page = await context.newPage();
page.setDefaultTimeout(10_000);

const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

await page.goto(base, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "日誌", exact: true }).click();
await page.locator(".journal-paper .prose-editor").waitFor();

const targetText = "把新的筆記應用做成真正能長期使用的工具";
const selectedText = await page.locator(".journal-paper .prose-editor").evaluate((editor, text) => {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const index = node.textContent?.indexOf(text) ?? -1;
    if (index < 0) continue;
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + text.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return selection?.toString() || "";
  }
  return "";
}, targetText);

await page.getByRole("button", { name: "重點標示並建立劃記", exact: true }).click();
const mark = page.locator(".journal-paper .prose-editor mark").filter({ hasText: targetText });
await mark.waitFor();
const futureMarkupUsesThemeToken = await mark.evaluate((element) =>
  !element.getAttribute("style") && !element.getAttribute("data-color")
);
await page.evaluate(() => {
  window.getSelection()?.removeAllRanges();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
});

// 模擬舊版已存入 HTML 的亮黃色，確認新主題樣式仍能接手修正。
await mark.evaluate((element) => {
  element.setAttribute("style", "background-color: #f4d483");
  element.setAttribute("data-color", "#f4d483");
});

const expected = {
  light: { background: "rgb(219, 201, 133)", color: "rgb(48, 43, 29)" },
  dark: { background: "rgb(113, 90, 49)", color: "rgb(244, 239, 228)" },
  ink: { background: "rgb(98, 84, 58)", color: "rgb(242, 236, 223)" },
};

const reports = [];
for (const theme of ["light", "dark", "ink"]) {
  await page.evaluate((nextTheme) => {
    document.documentElement.dataset.theme = nextTheme;
  }, theme);
  await page.waitForTimeout(80);
  const metrics = await mark.evaluate((element) => {
    const style = getComputedStyle(element);
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const rgba = (value) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    };
    const luminance = ([r, g, b]) => [r, g, b]
      .map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const foreground = rgba(style.color);
    const background = rgba(style.backgroundColor);
    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    return {
      background: style.backgroundColor,
      color: style.color,
      contrast: Number(((Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
        / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)).toFixed(2)),
      legacyInlineBackgroundOverridden: style.backgroundColor !== "rgb(244, 212, 131)",
    };
  });
  reports.push({ theme, ...metrics });
  await page.screenshot({ path: path.join(output, `01-journal-highlight-${theme}.png`), fullPage: true });
}

const result = {
  selectedText,
  futureMarkupUsesThemeToken,
  reports,
  errors,
};
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();

const failed = selectedText !== targetText
  || !futureMarkupUsesThemeToken
  || errors.length > 0
  || reports.some((report) => report.contrast < 4.5
    || !report.legacyInlineBackgroundOverridden
    || report.background !== expected[report.theme].background
    || report.color !== expected[report.theme].color);
if (failed) process.exitCode = 1;
