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
const source = "在資訊密集的工作日裡，真正耗費注意力的往往不是單一任務，而是不斷切換脈絡。會議留下決策，通訊軟體出現補充，文件又保存另一組版本；如果沒有一個可靠的位置把來源、結論、待辦與疑問放在一起，人很快就會忘記當初為何做出某個判斷。好的筆記工具不只是收藏文字，也應幫助使用者保留脈絡、看見關係，並在需要時快速回到原始資料。這種整理不必一次完成，可以先記下片段，再逐步補上標籤、連線與下一步。當資料量增加時，搜尋與視覺化必須維持流暢，人工連結的關係也不能被自動分析覆蓋。對私人內容而言，本機推論提供了另一種選擇：資料不必離開電腦，但仍要誠實面對裝置效能、模型容量與等待時間。系統若遇到限制，應清楚說明原因，而不是讓畫面長時間沒有回應。使用者也應能隨時取消工作、縮小分析範圍或改用雲端模型。最重要的是，任何 AI 產生的摘要與關聯都只能當成協助理解的線索，重要結論仍需回到原文確認。為了讓知識可以長期使用，系統還要保存版本歷史、附件來源與資料去向，讓每次整理都有跡可循。即使 AI 提供建議，使用者仍應保有最後決定權，能選擇採用、調整或完全忽略。跨平台版本也必須維持一致的資料模型，避免同一份筆記在不同電腦上產生無法理解的差異。當這些基礎都可靠，工具才能真正降低整理負擔，而不是增加新的維護工作。";
const prompt = `請將以下內容整理成一段簡明繁體中文摘要，不要逐句重述：\n\n${source}`;
await aiPanel.locator(".ai-composer textarea").fill(prompt);
const generationStartedAt = Date.now();
await aiPanel.getByRole("button", { name: "送出", exact: true }).click();
await aiPanel.locator(".ai-message.is-loading").waitFor({ state: "visible" });
await aiPanel.locator(".ai-message.is-loading").waitFor({ state: "detached", timeout: 300_000 });
await page.waitForFunction((count) => document.querySelectorAll(".ai-message.is-assistant:not(.is-loading)").length > count || Boolean(document.querySelector(".ai-error")), before, { timeout: 20_000 });
const error = await aiPanel.locator(".ai-error").textContent().catch(() => "");
const response = (await aiPanel.locator(".ai-message.is-assistant").last().innerText().catch(() => "")).trim();
const modelLine = (await aiPanel.locator(".ai-message.is-assistant").last().locator("header").innerText().catch(() => "")).trim();
const elapsedMs = Date.now() - generationStartedAt;

await page.getByRole("button", { name: "設定", exact: true }).click();
if (/OpenRouter/i.test(initialEngine)) await page.locator(".engine-choice-grid > button").filter({ hasText: "OpenRouter" }).click();
await page.getByRole("button", { name: "今日", exact: true }).click();

const report = {
  initialEngine,
  localModelCached: /已下載|離線使用|loaded|downloaded/i.test(localStatus),
  response,
  modelLine,
  promptCharacters: prompt.length,
  elapsedMs,
  backendError: error || "",
  externalRuntimeRequests,
  pageErrors,
};
console.log(JSON.stringify(report, null, 2));
await browser.close();

if (!response || error || elapsedMs >= 60_000 || !/gemma/i.test(modelLine) || externalRuntimeRequests.length || pageErrors.some((item) => /no available backend|jsdelivr/i.test(item))) process.exitCode = 1;
