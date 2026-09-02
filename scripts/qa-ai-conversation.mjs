import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/ai-conversation");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1560, height: 960 }, colorScheme: "dark", locale: "zh-TW" });
await context.addInitScript(() => {
  const calls = [];
  window.__aiConversationQa = calls;
  window.chengjing = {
    app: { getPreferredLanguage: async () => ({ language: "zh-TW", preferredLanguages: ["zh-Hant-TW"] }), setLanguage: async (language) => ({ language }) },
    updates: { check: async () => ({ status: "current", currentVersion: "0.3.5", latestVersion: "0.3.5", releaseName: "澄境筆記 0.3.5", notes: "", publishedAt: "", htmlUrl: "", asset: null }), download: async () => ({ opened: false, status: "current" }), onProgress: () => () => {} },
    ai: {
      keyStatus: async () => ({ configured: true, encrypted: true, storage: "app-local-aes-256-gcm" }),
      setKey: async () => ({ configured: true, encrypted: true, storage: "app-local-aes-256-gcm" }),
      clearKey: async () => ({ configured: false, encrypted: true, storage: "app-local-aes-256-gcm" }),
      testOpenRouter: async () => ({ ok: true, label: "QA", limitRemaining: null, usage: null }),
      listModels: async () => [],
      openRouterChat: async (request) => {
        calls.push(request);
        await new Promise((resolve) => setTimeout(resolve, 35));
        return { text: `這是第 ${calls.length} 次回答。`, model: request.model, usage: null, finishReason: "stop" };
      },
    },
    files: { save: async () => ({ canceled: true }), open: async () => ({ canceled: true, files: [] }) },
    web: { read: async () => { throw new Error("unused"); } },
    onShortcut: () => () => {}, platform: "darwin",
  };
});

const page = await context.newPage();
page.setDefaultTimeout(20_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error" && !message.text().includes('unique "key" prop')) errors.push(`console: ${message.text()}`); });
await page.goto(base, { waitUntil: "networkidle" });

const knowledgeNavigationRemoved = await page.getByRole("button", { name: "知識問答", exact: true }).count() === 0;
await page.getByRole("button", { name: "詢問 AI", exact: true }).click();
let panel = page.locator(".ai-panel");
await panel.waitFor();
const composer = panel.locator(".ai-composer textarea");
const spaceSearchToggle = panel.locator(".ai-space-search-toggle");
const spaceSearchInitiallyOn = await spaceSearchToggle.getAttribute("aria-pressed") === "true";
const spaceSearchOnExplained = (await spaceSearchToggle.getAttribute("title"))?.includes("回答會加入其他本機卡片") === true;
await spaceSearchToggle.click();
const spaceSearchTurnsOff = await spaceSearchToggle.getAttribute("aria-pressed") === "false" && (await spaceSearchToggle.getAttribute("title"))?.includes("只使用目前選定的內容") === true;

await composer.fill("第一次對話需要正確清空");
await composer.dispatchEvent("compositionstart");
await composer.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229, which: 229, isComposing: true });
await page.waitForTimeout(60);
const imeCommitDoesNotSend = await panel.locator(".ai-message.is-user").count() === 0 && await composer.inputValue() === "第一次對話需要正確清空";
await composer.dispatchEvent("compositionend", { data: "第一次對話需要正確清空" });
await composer.press("Enter");
await panel.locator(".ai-message.is-assistant").filter({ hasText: "這是第 1 次回答" }).waitFor();
const firstSubmitClearsComposer = await composer.inputValue() === "";

await panel.getByRole("button", { name: "關閉 AI", exact: true }).click();
await page.getByRole("button", { name: "詢問 AI", exact: true }).click();
panel = page.locator(".ai-panel");
await panel.locator(".ai-message.is-user").filter({ hasText: "第一次對話需要正確清空" }).waitFor();
const firstConversationRestored = await panel.locator(".ai-message").count() === 2;

await panel.locator(".ai-space-search-toggle").click();
await panel.locator(".ai-composer textarea").fill("第二次對話也要延續");
await panel.locator(".ai-composer textarea").press("Enter");
const secondSubmitClearsComposer = await panel.locator(".ai-composer textarea").inputValue() === "";
await panel.locator(".ai-message.is-assistant").filter({ hasText: "這是第 2 次回答" }).waitFor();
const scopeChangesRequest = await page.evaluate(() => {
  const calls = window.__aiConversationQa || [];
  const first = calls[0]?.messages?.at(-1)?.content || "";
  const second = calls[1]?.messages?.at(-1)?.content || "";
  return !first.includes("<reference_material") && second.includes("<reference_material");
});
await panel.getByRole("button", { name: "關閉 AI", exact: true }).click();
await page.getByRole("button", { name: "詢問 AI", exact: true }).click();
panel = page.locator(".ai-panel");
await panel.locator(".ai-message.is-assistant").filter({ hasText: "這是第 2 次回答" }).waitFor();
const continuedConversationRestored = await panel.locator(".ai-message").count() === 4;

await panel.getByRole("button", { name: "開啟新對話", exact: true }).click();
await panel.locator(".ai-empty").waitFor();
const newConversationStartsEmpty = await panel.locator(".ai-message").count() === 0;
await panel.getByRole("button", { name: "關閉 AI", exact: true }).click();
await page.getByRole("button", { name: "詢問 AI", exact: true }).click();
panel = page.locator(".ai-panel");
await panel.locator(".ai-empty").waitFor();
const emptyConversationRestored = await panel.locator(".ai-message").count() === 0;
const storedConversationState = await page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open("chengjing");
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    const threads = db.transaction("chatThreads", "readonly").objectStore("chatThreads").getAll();
    const messages = db.transaction("chatMessages", "readonly").objectStore("chatMessages").getAll();
    Promise.all([
      new Promise((done) => { threads.onsuccess = () => done(threads.result); }),
      new Promise((done) => { messages.onsuccess = () => done(messages.result); }),
    ]).then(([threadRows, messageRows]) => resolve({ threads: threadRows.length, messages: messageRows.length }));
  };
}));

await panel.getByRole("button", { name: "關閉 AI", exact: true }).click();
await page.getByRole("button", { name: "卡片庫", exact: true }).click();
const targetCard = page.locator(".library-card").filter({ hasText: "Gemma 4 本機模式" });
await targetCard.click();
const cardLayer = page.locator(".card-focus-layer");
await cardLayer.waitFor();
await page.waitForTimeout(220);
const backButtonMetrics = await cardLayer.getByRole("button", { name: "返回卡片庫", exact: true }).evaluate((element) => ({ top: element.getBoundingClientRect().top, buttonRegion: getComputedStyle(element).webkitAppRegion, layerRegion: getComputedStyle(element.closest(".card-focus-layer")).webkitAppRegion, layerPaddingTop: getComputedStyle(element.closest(".card-focus-layer")).paddingTop }));
const backButtonNoDrag = backButtonMetrics.buttonRegion === "no-drag" && backButtonMetrics.layerRegion === "no-drag" && backButtonMetrics.top >= 42 && backButtonMetrics.layerPaddingTop === "42px";
const cardFocusMetrics = await cardLayer.evaluate((element) => {
  const layer = element.getBoundingClientRect();
  const main = document.querySelector(".app-main").getBoundingClientRect();
  return { fillsMain: Math.abs(layer.left - main.left) <= 1 && Math.abs(layer.top - main.top) <= 1 && Math.abs(layer.right - main.right) <= 1 && Math.abs(layer.bottom - main.bottom) <= 1 };
});
await cardLayer.getByRole("button", { name: "AI 動作", exact: true }).click();
panel = page.locator(".ai-panel");
await panel.waitFor();
const cardAIStartsBlank = await panel.locator(".ai-composer textarea").inputValue() === "";
const recommendedPromptButton = panel.getByRole("button", { name: "摘要這張卡片", exact: true });
const recommendedPromptButtonVisible = await recommendedPromptButton.isVisible();
const referenceBar = panel.locator(".ai-context-bar .is-card-reference");
const explicitCardReference = await referenceBar.getByText("參考卡片", { exact: true }).isVisible() && (await referenceBar.innerText()).includes("Gemma 4 本機模式");
const cardAndAIVisibleTogether = await cardLayer.isVisible() && await panel.isVisible();
const twoPaneGeometry = await page.evaluate(() => {
  const card = document.querySelector(".card-focus-layer")?.getBoundingClientRect();
  const ai = document.querySelector(".right-panel")?.getBoundingClientRect();
  return Boolean(card && ai && card.right <= ai.left + 1 && card.width >= 520 && ai.width >= 350);
});
await page.screenshot({ path: path.join(output, "01-card-and-ai.png"), fullPage: true });
await recommendedPromptButton.click();
const recommendedPromptFillsOnDemand = await panel.locator(".ai-composer textarea").inputValue() === "請摘要目前卡片，列出三個核心觀點與一個下一步。";
await panel.locator(".ai-composer textarea").fill("");
await panel.getByRole("button", { name: "關閉 AI", exact: true }).click();
const cardRemainsAfterAIClose = await cardLayer.isVisible();
await cardLayer.getByRole("button", { name: "返回卡片庫", exact: true }).click();
await cardLayer.waitFor({ state: "detached" });
const backReturnsToLibrary = await page.locator(".library-grid").isVisible();

const inboxNavigationRemoved = await page.getByRole("button", { name: /收件匣/ }).count() === 0;

const report = {
  knowledgeNavigationRemoved,
  spaceSearchInitiallyOn,
  spaceSearchOnExplained,
  spaceSearchTurnsOff,
  scopeChangesRequest,
  imeCommitDoesNotSend,
  firstSubmitClearsComposer,
  firstConversationRestored,
  secondSubmitClearsComposer,
  continuedConversationRestored,
  newConversationStartsEmpty,
  emptyConversationRestored,
  storedConversationState,
  backButtonNoDrag,
  backButtonMetrics,
  cardFocusMetrics,
  cardAIStartsBlank,
  recommendedPromptButtonVisible,
  recommendedPromptFillsOnDemand,
  explicitCardReference,
  cardAndAIVisibleTogether,
  twoPaneGeometry,
  cardRemainsAfterAIClose,
  backReturnsToLibrary,
  inboxNavigationRemoved,
  errors,
};
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (!knowledgeNavigationRemoved || !spaceSearchInitiallyOn || !spaceSearchOnExplained || !spaceSearchTurnsOff || !scopeChangesRequest || !imeCommitDoesNotSend || !firstSubmitClearsComposer || !firstConversationRestored || !secondSubmitClearsComposer || !continuedConversationRestored || !newConversationStartsEmpty || !emptyConversationRestored || storedConversationState.threads !== 2 || storedConversationState.messages !== 4 || !backButtonNoDrag || !cardFocusMetrics.fillsMain || !cardAIStartsBlank || !recommendedPromptButtonVisible || !recommendedPromptFillsOnDemand || !explicitCardReference || !cardAndAIVisibleTogether || !twoPaneGeometry || !cardRemainsAfterAIClose || !backReturnsToLibrary || !inboxNavigationRemoved || errors.length) process.exitCode = 1;
