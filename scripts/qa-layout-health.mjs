import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
const baseline = process.argv.includes("--baseline");
const output = path.resolve("qa-artifacts/health-20260922");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: "zh-TW", reducedMotion: "reduce" });
const errors = []; const reports = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(process.env.CHENGJING_URL || "http://127.0.0.1:5173", { waitUntil: "networkidle" });
  const helper = process.env.CHENGJING_TYPESAFE_HELPER;
  if (helper) {
    const { collectBrowserState, executeBrowserAction } = await import(path.join(helper, "src/browser-accelerator.mjs"));
    const { chooseBrowserAction, checkResult } = await import(path.join(helper, "src/decision-engine.mjs"));
    const before = await collectBrowserState(page, { goal: "開啟第二大腦檢查版面", maxCandidates: 35 });
    const decision = await chooseBrowserAction({ state: { ...before, actions: before.actions.filter((item) => item.name === "第二大腦") } });
    if (decision.candidate) await executeBrowserAction(page, decision);
    else await page.getByRole("button", { name: "第二大腦", exact: true }).click();
    await page.locator(".second-brain-page").waitFor();
    const after = await collectBrowserState(page, { goal: "確認第二大腦已開啟" });
    console.log(JSON.stringify({ typesafe: await checkResult({ state: { goal: "確認第二大腦已開啟", after } }) }));
  }
  const views = [["today", ".today-page"], ["fragments", ".fragments-page"], ["library", ".library-layout"], ["tasks", ".tasks-page"], ["settings", ".settings-page"], ["brain", ".second-brain-page"]];
  for (const width of [1440, 1100, 960]) for (const scale of [1, 1.2]) {
    await page.setViewportSize({ width, height: 960 });
    for (const [view] of views) {
      // Deterministic test fixture; all views come from the declared route list.
      await page.evaluate(async ({ view, scale }) => {
        const { useAppStore } = await import("/src/store.ts");
        useAppStore.setState({ view, fontScale: scale, rightPanel: "none" });
      }, { view, scale });
      await page.locator(`.workspace.view-${view}`).waitFor();
      await page.waitForFunction(() => !document.querySelector(".workspace-lazy-placeholder") && Number(getComputedStyle(document.querySelector(".workspace")).opacity) > 0.99);
      if (view === "brain") await page.waitForFunction(() => Number(document.querySelector(".second-brain-page")?.getAttribute("data-brain-nodes")) > 0);
      const metrics = await page.evaluate(() => {
        const root = document.querySelector(".workspace");
        const collision = (a, b) => {
          const left = document.querySelector(a)?.getBoundingClientRect(); const right = document.querySelector(b)?.getBoundingClientRect();
          return Boolean(left?.width && right?.width && Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1 && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1);
        };
        return { rootOverflow: document.documentElement.scrollWidth - innerWidth, workspaceOverflow: root.scrollWidth - root.clientWidth,
          titleToolbarOverlap: collision(".brain-heading h2", ".brain-toolbar"), pagingToolbarOverlap: collision(".brain-batch-nav", ".brain-toolbar") };
      });
      reports.push({ view, width, scale, ...metrics });
      if (view === "brain" && scale === 1.2) await page.screenshot({ path: path.join(output, `${baseline ? "before" : "after"}-brain-${width}.png`) });
    }
  }
  for (const width of [1440, 1100, 960]) {
    await page.setViewportSize({ width, height: 820 });
    await page.evaluate(async () => { const { useAppStore } = await import("/src/store.ts"); useAppStore.setState({ view: "brain", fontScale: 1.2, rightPanel: "ai" }); });
    await page.locator(".ai-panel, .ai-side-panel, .right-panel").first().waitFor();
    await page.waitForTimeout(250);
    const reportControlsFit = await page.locator(".brain-report").evaluate((element) => {
      const boundary = element.getBoundingClientRect();
      return [...element.querySelectorAll("header button")].every((button) => { const box = button.getBoundingClientRect(); return box.left >= boundary.left && box.right <= boundary.right; });
    });
    reports.push({ view: "brain-with-ai", width, scale: 1.2, reportControlsFit });
    await page.screenshot({ path: path.join(output, `${baseline ? "before" : "after"}-brain-ai-${width}.png`) });
  }
  await page.evaluate(async () => {
    const { db } = await import("/src/db.ts");
    await db.brainReports.put({ id: "layout-report", date: new Date().toLocaleDateString("en-CA"), content: "保留清楚的段落與完整操作。\n\n".repeat(30), model: "layout-fixture", createdAt: Date.now(), updatedAt: Date.now() });
  });
  for (const language of ["zh-TW", "zh-CN", "en", "ja", "ko"]) for (const theme of ["light", "dark", "ink"]) {
    await page.evaluate(async ({ language, theme }) => { const { useAppStore } = await import("/src/store.ts"); useAppStore.setState({ language, theme }); }, { language, theme });
    await page.waitForTimeout(100);
    const fit = await page.locator(".brain-report").evaluate((element) => {
      const parent = element.getBoundingClientRect();
      return [...element.querySelectorAll("header button")].every((button) => { const child = button.getBoundingClientRect(); return child.left >= parent.left && child.right <= parent.right; });
    });
    const canvasThemeMatches = await page.evaluate(() => document.querySelector(".brain-canvas")?.getAttribute("data-canvas-color") === getComputedStyle(document.documentElement).getPropertyValue("--brain-canvas").trim());
    reports.push({ view: "brain-report-translated", language, theme, reportControlsFit: fit, canvasThemeMatches });
    if (language === "en" && theme !== "light") await page.screenshot({ path: path.join(output, `report-${theme}-english.png`) });
  }
  console.log(JSON.stringify({ baseline, cases: reports.length, failures: reports.filter((item) => item.rootOverflow > 1 || item.workspaceOverflow > 1 || item.titleToolbarOverlap || item.pagingToolbarOverlap || item.reportControlsFit === false || item.canvasThemeMatches === false), errors }, null, 2));
  await fs.writeFile(path.join(output, `${baseline ? "before" : "after"}-layout.json`), JSON.stringify({ reports, errors }, null, 2));
  if (!baseline && (errors.length || reports.some((item) => item.rootOverflow > 1 || item.workspaceOverflow > 1 || item.titleToolbarOverlap || item.pagingToolbarOverlap || item.reportControlsFit === false || item.canvasThemeMatches === false))) process.exitCode = 1;
} finally { await browser.close(); }
