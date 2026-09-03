import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const screenshotDir = path.resolve("qa-artifacts/readability");
await fs.mkdir(screenshotDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1100, height: 760 }, colorScheme: "dark", locale: "zh-TW" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
await page.goto(base, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "設定", exact: true }).click();
await page.locator(".font-scale-setting").scrollIntoViewIfNeeded();
await page.locator(".font-scale-setting button").nth(3).click();
await page.getByRole("button", { name: "今日", exact: true }).click();
await page.getByText("今天想釐清什麼？").waitFor();
await page.waitForTimeout(240);
await page.getByRole("button", { name: "詢問 AI", exact: true }).click();
await page.locator(".right-panel").waitFor();
await page.waitForTimeout(240);
const compactTopbar = await readTopbar(page);
await page.screenshot({ path: path.join(screenshotDir, "05-1100px-ai-topbar-compact.png"), fullPage: true });
await page.getByRole("button", { name: "關閉 AI", exact: true }).click();
await page.locator(".right-panel").waitFor({ state: "detached" });
await page.waitForTimeout(240);
const expandedTopbar = await readTopbar(page);
const metrics = await page.evaluate(() => ({
  bodyScrollWidth: document.body.scrollWidth,
  viewportWidth: document.documentElement.clientWidth,
  mainScrollWidth: document.querySelector(".app-main")?.scrollWidth || 0,
  mainClientWidth: document.querySelector(".app-main")?.clientWidth || 0,
  navFontSize: parseFloat(getComputedStyle(document.querySelector(".primary-nav button span")).fontSize),
  titleFontSize: parseFloat(getComputedStyle(document.querySelector(".today-hero h2")).fontSize),
}));
await page.screenshot({ path: path.join(screenshotDir, "04-1100px-font-120.png"), fullPage: true });
console.log(JSON.stringify({ ...metrics, compactTopbar, expandedTopbar, errors }, null, 2));
await browser.close();
if (metrics.bodyScrollWidth > metrics.viewportWidth || metrics.mainScrollWidth > metrics.mainClientWidth + 1 || metrics.navFontSize < 17 || !compactTopbar.fits || compactTopbar.textDisplay !== "none" || compactTopbar.shortcutDisplay !== "none" || compactTopbar.searchWidth > 40 || !compactTopbar.accessibleName.includes("搜尋卡片") || !expandedTopbar.fits || expandedTopbar.textDisplay === "none" || expandedTopbar.shortcutDisplay === "none" || errors.length) process.exitCode = 1;

async function readTopbar(target) {
  return target.locator(".topbar").evaluate((topbar) => {
    const search = topbar.querySelector(".search-trigger");
    const text = search.querySelector("span");
    const shortcut = search.querySelector("kbd");
    const topbarRect = topbar.getBoundingClientRect();
    const searchRect = search.getBoundingClientRect();
    const childrenFit = [...topbar.children].every((child) => {
      const rect = child.getBoundingClientRect();
      return rect.left >= topbarRect.left - 1 && rect.right <= topbarRect.right + 1 && rect.top >= topbarRect.top - 1 && rect.bottom <= topbarRect.bottom + 1;
    });
    return {
      fits: topbar.scrollWidth <= topbar.clientWidth + 1 && search.scrollHeight <= search.clientHeight + 1 && childrenFit,
      topbarWidth: topbarRect.width,
      searchWidth: searchRect.width,
      searchHeight: searchRect.height,
      textDisplay: getComputedStyle(text).display,
      shortcutDisplay: getComputedStyle(shortcut).display,
      accessibleName: search.getAttribute("aria-label") || "",
    };
  });
}
