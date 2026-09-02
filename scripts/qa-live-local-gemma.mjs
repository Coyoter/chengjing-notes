import { chromium } from "playwright";

const port = Number(process.env.CHENGJING_DEBUG_PORT || 9338);
const endpoint = `http://127.0.0.1:${port}`;
const startedAt = Date.now();
while (true) {
  try { if ((await fetch(`${endpoint}/json/version`)).ok) break; } catch {}
  if (Date.now() - startedAt > 15_000) throw new Error("ChengJing debugging endpoint timed out");
  await new Promise((resolve) => setTimeout(resolve, 150));
}

const browser = await chromium.connectOverCDP(endpoint);
const context = browser.contexts()[0];
let page = context.pages().find((candidate) => !candidate.url().includes("quick-capture"));
if (!page) {
  const quick = context.pages()[0] || await context.waitForEvent("page");
  await quick.evaluate(() => window.chengjing.quickCapture.showMain());
  page = context.pages().find((candidate) => !candidate.url().includes("quick-capture")) || await context.waitForEvent("page");
}
page.setDefaultTimeout(20_000);
const externalRuntimeRequests = [];
const pageErrors = [];
context.on("request", (request) => { if (/cdn\.jsdelivr\.net\/npm\/onnxruntime-web/i.test(request.url())) externalRuntimeRequests.push(request.url()); });
page.on("pageerror", (error) => pageErrors.push(error.message));

await page.getByText(/今天想釐清什麼/).waitFor();
const initialEngine = (await page.locator(".engine-status").innerText()).trim();
await page.getByRole("button", { name: "設定", exact: true }).click();
const localEngine = page.locator(".engine-choice-grid > button").filter({ hasText: "Gemma 4 E2B" });
await localEngine.click();
const localStatus = (await page.locator(".local-model-card").innerText()).trim();
await page.locator(".sidebar-footer").getByRole("button", { name: "AI 助理", exact: true }).click();
const aiPanel = page.locator(".ai-panel");
await aiPanel.waitFor();
const newConversation = aiPanel.getByRole("button", { name: "開啟新對話", exact: true });
if (await newConversation.isEnabled().catch(() => false)) {
  await newConversation.click();
  await page.waitForFunction(() => document.querySelectorAll(".ai-message").length === 0);
}
const before = await aiPanel.locator(".ai-message.is-assistant").count();
await aiPanel.locator(".ai-composer textarea").fill("請用一句繁體中文回覆：本機 Gemma 4 測試成功。");
await aiPanel.getByRole("button", { name: "送出", exact: true }).click();
await aiPanel.locator(".ai-message.is-loading").waitFor({ state: "visible" });
await aiPanel.locator(".ai-message.is-loading").waitFor({ state: "detached", timeout: 300_000 });
await page.waitForFunction((count) => document.querySelectorAll(".ai-message.is-assistant:not(.is-loading)").length > count || Boolean(document.querySelector(".ai-error")), before, { timeout: 20_000 });
const error = await aiPanel.locator(".ai-error").textContent().catch(() => "");
const response = (await aiPanel.locator(".ai-message.is-assistant").last().innerText().catch(() => "")).trim();
const modelLine = (await aiPanel.locator(".ai-message.is-assistant").last().locator("header").innerText().catch(() => "")).trim();

await page.getByRole("button", { name: "設定", exact: true }).click();
if (/OpenRouter/i.test(initialEngine)) await page.locator(".engine-choice-grid > button").filter({ hasText: "OpenRouter" }).click();
await page.getByRole("button", { name: "今日", exact: true }).click();

const report = {
  initialEngine,
  localModelCached: /已下載|離線使用|loaded|downloaded/i.test(localStatus),
  response,
  modelLine,
  backendError: error || "",
  externalRuntimeRequests,
  pageErrors,
};
console.log(JSON.stringify(report, null, 2));
await browser.close();

if (!response || error || !/gemma/i.test(modelLine) || externalRuntimeRequests.length || pageErrors.some((item) => /no available backend|jsdelivr/i.test(item))) process.exitCode = 1;
