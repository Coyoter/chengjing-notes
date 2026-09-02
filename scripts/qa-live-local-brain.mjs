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
const pageErrors = [];
const externalRuntimeRequests = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
context.on("request", (request) => { if (/cdn\.jsdelivr\.net\/npm\/onnxruntime-web/i.test(request.url())) externalRuntimeRequests.push(request.url()); });

await page.getByRole("button", { name: "設定", exact: true }).click();
const initialEngine = (await page.locator(".engine-status").innerText()).trim();
await page.locator(".engine-choice-grid > button").filter({ hasText: "Gemma 4 E2B" }).click();
await page.getByRole("button", { name: "第二大腦", exact: true }).click();
const brain = page.locator(".second-brain-page");
await brain.waitFor();
const brainNodeCount = Number(await brain.getAttribute("data-brain-nodes"));
const beforeLinks = Number(await brain.getAttribute("data-brain-persisted-links"));
const organize = page.getByRole("button", { name: "AI 整理連結", exact: true });
const localHint = await organize.getAttribute("title");
const generationStartedAt = Date.now();
await organize.click();
await page.waitForFunction(() => {
  const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === "AI 整理連結");
  return Boolean(button && !button.disabled);
}, undefined, { timeout: 90_000 });
const elapsedMs = Date.now() - generationStartedAt;
const notice = (await page.locator(".brain-notice span").innerText().catch(() => "")).trim();
const afterLinks = Number(await brain.getAttribute("data-brain-persisted-links"));
const appResponsive = await page.evaluate(() => document.body.innerText.includes("第二大腦"));
const rawRuntimeErrorVisible = /SafeInt|Integer overflow|OrtRun|safeint\.h/i.test(notice);

await page.getByRole("button", { name: "設定", exact: true }).click();
if (/OpenRouter/i.test(initialEngine)) await page.locator(".engine-choice-grid > button").filter({ hasText: "OpenRouter" }).click();
await page.getByRole("button", { name: "今日", exact: true }).click();

const report = {
  initialEngine,
  brainNodeCount,
  selectedNodeLimitExplained: /18/.test(localHint || "") && /OpenRouter/.test(localHint || ""),
  beforeLinks,
  afterLinks,
  createdLinks: Math.max(0, afterLinks - beforeLinks),
  elapsedMs,
  notice,
  appResponsive,
  rawRuntimeErrorVisible,
  externalRuntimeRequests,
  pageErrors,
};
console.log(JSON.stringify(report, null, 2));
await browser.close();

const safelyCompleted = /本機 Gemma 已建立|沒(?:有)?找到足夠明確|本機 Gemma 這次沒有產生完整|超過 60 秒|推論容量/.test(notice);
if (!report.selectedNodeLimitExplained || !safelyCompleted || !appResponsive || rawRuntimeErrorVisible || elapsedMs > 75_000 || externalRuntimeRequests.length || pageErrors.length) process.exitCode = 1;
