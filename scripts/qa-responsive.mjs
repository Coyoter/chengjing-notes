import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
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
const metrics = await page.evaluate(() => ({
  bodyScrollWidth: document.body.scrollWidth,
  viewportWidth: document.documentElement.clientWidth,
  mainScrollWidth: document.querySelector(".app-main")?.scrollWidth || 0,
  mainClientWidth: document.querySelector(".app-main")?.clientWidth || 0,
  navFontSize: parseFloat(getComputedStyle(document.querySelector(".primary-nav button span")).fontSize),
  titleFontSize: parseFloat(getComputedStyle(document.querySelector(".today-hero h2")).fontSize),
}));
const screenshotDir = path.resolve("qa-artifacts/readability");
await fs.mkdir(screenshotDir, { recursive: true });
await page.screenshot({ path: path.join(screenshotDir, "04-1100px-font-120.png"), fullPage: true });
console.log(JSON.stringify({ ...metrics, errors }, null, 2));
await browser.close();
if (metrics.bodyScrollWidth > metrics.viewportWidth || metrics.mainScrollWidth > metrics.mainClientWidth + 1 || metrics.navFontSize < 17 || errors.length) process.exitCode = 1;
