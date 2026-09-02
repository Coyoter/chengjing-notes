import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/readability");
await fs.mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", locale: "zh-TW" });
await context.addInitScript(() => {
  window.chengjing = {
    ai: {
      keyStatus: async () => ({ configured: false, encrypted: true }),
      setKey: async () => ({ configured: true }),
      clearKey: async () => ({ configured: false }),
      listModels: async () => [],
      openRouterChat: async () => ({ text: "測試回覆", model: "test/model", usage: null, finishReason: "stop" }),
    },
    web: {
      read: async (url) => ({
        title: "測試網址文章",
        byline: "",
        excerpt: "用來驗證網址收藏流程。",
        content: "<h2>測試網址文章</h2><p>用來驗證網址收藏流程。</p>",
        textContent: "測試網址文章，用來驗證網址收藏流程。",
        siteName: "Example",
        url,
      }),
    },
    files: { save: async () => ({ canceled: true }), open: async () => ({ canceled: true, files: [] }) },
    onShortcut: () => () => {},
    platform: "darwin",
  };
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });

await page.goto(base, { waitUntil: "networkidle" });
await page.getByText("今天想釐清什麼？").waitFor();

const logoVisible = await page.locator(".brand-row > img").evaluate((image) => {
  const rect = image.getBoundingClientRect();
  return rect.width >= 28 && rect.height >= 28 && getComputedStyle(image).opacity === "1";
});

await page.locator(".engine-status").click();
await page.locator("#ai-settings").waitFor();
const openRouterNavigation = await page.getByText("OpenRouter API 金鑰", { exact: true }).isVisible();

await page.locator(".engine-choice-grid > button").nth(1).click();
await page.getByRole("button", { name: "今日", exact: true }).click();
await page.locator(".engine-status").getByText("本機 Gemma", { exact: true }).waitFor();
await page.locator(".engine-status").click();
const gemmaNavigation = await page.getByText("Gemma 4 E2B 本機模型", { exact: true }).isVisible();

await page.getByRole("button", { name: "日誌", exact: true }).click();
await page.locator(".journal-week-days > button").first().click();
await page.getByRole("button", { name: "今天", exact: true }).click();
const todayActive = await page.locator(".journal-today-button.is-active").isVisible();
await page.screenshot({ path: path.join(output, "01-journal-today.png"), fullPage: true });

const collapse = page.getByRole("button", { name: "收合側欄", exact: true });
const brandBox = await page.locator(".brand-row").boundingBox();
const collapseBox = await collapse.boundingBox();
const collapseSeparated = Boolean(brandBox && collapseBox && collapseBox.y > brandBox.y + brandBox.height + 300);
await collapse.click();
await page.locator(".sidebar.is-collapsed").waitFor();
await page.getByRole("button", { name: "展開側欄", exact: true }).click();

await page.getByRole("button", { name: "卡片庫", exact: true }).click();
await page.getByRole("button", { name: "新增卡片", exact: true }).click();
await page.getByText("建立一張新卡片", { exact: true }).waitFor();
const createModalVisible = await page.getByText("建立一張新卡片", { exact: true }).isVisible();
await page.getByRole("button", { name: "關閉", exact: true }).click();

await page.locator(".url-capture-bar input").fill("https://example.com/article");
await page.getByRole("button", { name: "儲存網址", exact: true }).click();
await page.getByText(/網址已儲存/).waitFor();
const webCard = page.getByRole("button", { name: "開啟網頁：測試網址文章", exact: true });
await webCard.waitFor();
const popupPromise = page.waitForEvent("popup");
await webCard.click();
const popup = await popupPromise;
const openedUrl = popup.url();
await popup.close();
await page.screenshot({ path: path.join(output, "02-library-url.png"), fullPage: true });

await page.getByRole("button", { name: /開啟卡片：AI 吵架王/ }).click();
const tagBorder = await page.locator(".tag-picker-wrap .add-tag").evaluate((element) => {
  const style = getComputedStyle(element);
  return { width: style.borderTopWidth, style: style.borderTopStyle, color: style.borderTopColor };
});
await page.getByRole("button", { name: "返回卡片庫" }).click();

await page.getByRole("button", { name: "設定", exact: true }).click();
await page.locator(".font-scale-setting").scrollIntoViewIfNeeded();
await page.locator(".font-scale-setting button").nth(3).click();
const largeScale = await page.evaluate(() => ({ value: getComputedStyle(document.documentElement).getPropertyValue("--font-scale").trim(), navSize: parseFloat(getComputedStyle(document.querySelector(".primary-nav button span")).fontSize) }));
await page.screenshot({ path: path.join(output, "03-font-scale-120.png"), fullPage: true });
await page.locator(".font-scale-setting button").nth(1).click();

const report = {
  logoVisible,
  openRouterNavigation,
  gemmaNavigation,
  todayActive,
  collapseSeparated,
  createModalVisible,
  openedUrl,
  tagBorder,
  largeScale,
  errors,
};
await fs.writeFile(path.join(output, "regression-summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();

if (
  !logoVisible || !openRouterNavigation || !gemmaNavigation || !todayActive || !collapseSeparated ||
  !createModalVisible || openedUrl !== "https://example.com/article" || tagBorder.width !== "0px" ||
  largeScale.value !== "1.2" || largeScale.navSize < 17 || errors.length
) process.exitCode = 1;
