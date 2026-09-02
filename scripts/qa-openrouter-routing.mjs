import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/openrouter-routing");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1180, height: 900 }, colorScheme: "dark", locale: "zh-TW" });
await context.addInitScript(() => {
  const calls = [];
  window.__openRouterRoutingCalls = calls;
  window.chengjing = {
    ai: {
      keyStatus: async () => ({ configured: true, encrypted: true, storage: "app-local-aes-256-gcm" }),
      setKey: async () => ({ configured: true, encrypted: true, storage: "app-local-aes-256-gcm" }),
      clearKey: async () => ({ configured: false, encrypted: true, storage: "app-local-aes-256-gcm" }),
      testOpenRouter: async () => ({ ok: true, label: "QA", limitRemaining: null, usage: null }),
      listModels: async () => [],
      openRouterChat: async (request) => {
        calls.push(request);
        const planner = (request.messages?.[0]?.content || "").includes("安全動作規劃器");
        return planner
          ? { text: JSON.stringify({ summary: "建立路由測試卡片", actions: [{ type: "create_card", description: "建立測試卡片", title: "路由測試", content: "驗證省錢模式。" }] }), model: request.model, usage: null, finishReason: "stop" }
          : { text: "路由模式測試完成。", model: request.model, usage: null, finishReason: "stop" };
      },
    },
    files: { save: async () => ({ canceled: true }), open: async () => ({ canceled: true, files: [] }) },
    web: { read: async () => { throw new Error("unused"); } },
    onShortcut: () => () => {},
    platform: "darwin",
  };
});

const page = await context.newPage();
page.setDefaultTimeout(15_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
await page.goto(base, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "設定", exact: true }).click();
const routing = page.locator(".routing-mode-setting");
await routing.waitFor();
const balanced = routing.getByRole("button").filter({ hasText: "平衡" });
const speed = routing.getByRole("button").filter({ hasText: "極速" });
const economy = routing.getByRole("button").filter({ hasText: "省錢" });
const defaultBalanced = await balanced.getAttribute("aria-pressed") === "true" && await routing.getByText("預設", { exact: true }).isVisible();
const threeModesExplained = await routing.getByText(/45 tokens\/s/).isVisible() && await routing.getByText(/Nitro/).isVisible() && await routing.getByText(/最低價格/).isVisible();

await speed.click();
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: "設定", exact: true }).click();
const speedPersisted = await page.locator(".routing-mode-setting").getByRole("button").filter({ hasText: "極速" }).getAttribute("aria-pressed") === "true";
await page.getByRole("button", { name: "AI 助理", exact: true }).click();
const aiPanel = page.locator(".ai-panel");
await aiPanel.locator("textarea").fill("請回覆路由模式測試");
await aiPanel.getByRole("button", { name: "送出", exact: true }).click();
await aiPanel.getByText("路由模式測試完成。", { exact: true }).waitFor();
const normalChatUsesSpeed = await page.evaluate(() => window.__openRouterRoutingCalls.at(-1)?.routingMode === "speed");
await page.getByRole("button", { name: "關閉 AI", exact: true }).click();

await page.getByRole("button", { name: "設定", exact: true }).click();
await page.locator(".routing-mode-setting").getByRole("button").filter({ hasText: "省錢" }).click();
await page.getByRole("button", { name: "AI 助理", exact: true }).click();
await aiPanel.locator("textarea").fill("請新增一張路由測試卡片");
await aiPanel.getByRole("button", { name: "送出", exact: true }).click();
await aiPanel.locator(".ai-action-plan").waitFor();
const actionPlannerUsesEconomy = await page.evaluate(() => window.__openRouterRoutingCalls.at(-1)?.routingMode === "economy");
await aiPanel.getByRole("button", { name: "取消計畫", exact: true }).click();
await page.getByRole("button", { name: "關閉 AI", exact: true }).click();

await page.getByRole("button", { name: "設定", exact: true }).click();
await page.locator(".routing-mode-setting").getByRole("button").filter({ hasText: "平衡" }).click();
await page.locator(".font-scale-setting button").nth(3).click();
await page.setViewportSize({ width: 1040, height: 900 });
await page.locator(".routing-mode-setting").scrollIntoViewIfNeeded();
const responsive = await page.locator(".routing-mode-setting").evaluate((element) => ({ overflow: element.scrollWidth - element.clientWidth, columns: getComputedStyle(element.querySelector(".routing-mode-grid")).gridTemplateColumns.split(" ").length }));
await page.screenshot({ path: path.join(output, "01-routing-modes.png"), fullPage: true });
const balancedRestored = await page.locator(".routing-mode-setting").getByRole("button").filter({ hasText: "平衡" }).getAttribute("aria-pressed") === "true";
const localizedModes = [];
for (const item of [
  { picker: "简体中文", lang: "zh-CN", labels: ["平衡", "极速", "省钱"] },
  { picker: "English", lang: "en", labels: ["Balanced", "Max speed", "Economy"] },
  { picker: "日本語", lang: "ja", labels: ["バランス", "最速", "節約"] },
  { picker: "한국어", lang: "ko", labels: ["균형", "최고 속도", "절약"] },
]) {
  await page.locator(".language-grid button").filter({ hasText: item.picker }).click();
  await page.locator(`html[lang="${item.lang}"]`).waitFor();
  const text = await page.locator(".routing-mode-setting").innerText();
  const overflow = await page.locator(".routing-mode-setting").evaluate((element) => element.scrollWidth - element.clientWidth);
  localizedModes.push({ language: item.lang, complete: item.labels.every((label) => text.includes(label)), overflow });
}
await page.locator(".language-grid button").filter({ hasText: "繁體中文" }).click();

const report = { defaultBalanced, threeModesExplained, speedPersisted, normalChatUsesSpeed, actionPlannerUsesEconomy, balancedRestored, responsive, localizedModes, errors };
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (!defaultBalanced || !threeModesExplained || !speedPersisted || !normalChatUsesSpeed || !actionPlannerUsesEconomy || !balancedRestored || responsive.overflow > 2 || responsive.columns !== 3 || localizedModes.some((item) => !item.complete || item.overflow > 2) || errors.length) process.exitCode = 1;
