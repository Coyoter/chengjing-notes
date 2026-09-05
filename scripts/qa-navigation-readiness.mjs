import { chromium } from "playwright";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "zh-TW" });
const errors = [];
let brainModuleRequested = false;
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
page.on("request", (request) => { if (request.url().includes("/src/views/SecondBrainView.tsx")) brainModuleRequested = true; });

await page.goto(base, { waitUntil: "networkidle" });
await page.evaluate(() => {
  window.__workspaceFallbackReport = { seen: false, startedAt: 0, endedAt: 0 };
  new MutationObserver(() => {
    const report = window.__workspaceFallbackReport;
    const visible = Boolean(document.querySelector(".workspace-lazy-placeholder"));
    if (visible && !report.startedAt) { report.seen = true; report.startedAt = performance.now(); }
    if (!visible && report.startedAt && !report.endedAt) report.endedAt = performance.now();
  }).observe(document.body, { childList: true, subtree: true });
});

const brainButton = page.getByRole("button", { name: "第二大腦", exact: true });
await brainButton.hover();
await page.waitForTimeout(180);
const brainMountedBeforeClick = await page.locator(".second-brain-page").count() > 0;
const startedAt = performance.now();
await brainButton.click();
await page.locator(".second-brain-page").waitFor();
const navigationMs = Math.round(performance.now() - startedAt);
const fallback = await page.evaluate(() => window.__workspaceFallbackReport);
const fallbackMs = fallback.endedAt && fallback.startedAt ? Math.round(fallback.endedAt - fallback.startedAt) : 0;
await page.locator(".engine-status").click();
await page.locator("#ai-settings").waitFor();
await page.waitForFunction(() => {
  const target = document.getElementById("ai-settings")?.getBoundingClientRect();
  const workspace = document.querySelector(".settings-page")?.getBoundingClientRect();
  return Boolean(target && workspace && target.top >= workspace.top - 4 && target.top < workspace.bottom);
});
const delayedSettingsAnchorWorks = true;
const report = { brainModuleRequested, brainMountedBeforeClick, navigationMs, fullPageFallbackSeen: fallback.seen, fallbackMs, delayedSettingsAnchorWorks, errors };
console.log(JSON.stringify(report, null, 2));
await browser.close();

if (!brainModuleRequested || brainMountedBeforeClick || fallback.seen || errors.length) process.exitCode = 1;
