import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const cdpEndpoint = process.env.CHENGJING_CDP || "";
const output = path.resolve("qa-artifacts/content-conversions");
await fs.mkdir(output, { recursive: true });
const browser = cdpEndpoint ? await chromium.connectOverCDP(cdpEndpoint) : await chromium.launch({ headless: true });
const context = cdpEndpoint ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 1540, height: 960 }, colorScheme: "dark", locale: "zh-TW" });
const page = cdpEndpoint
  ? context.pages().find((candidate) => !candidate.url().includes("quick-capture")) || context.pages()[0]
  : await context.newPage();
page.setDefaultTimeout(12_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });

async function records(storeName) {
  return page.evaluate((name) => new Promise((resolve, reject) => {
    const request = indexedDB.open("chengjing");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const query = request.result.transaction(name, "readonly").objectStore(name).getAll();
      query.onsuccess = () => resolve(query.result);
      query.onerror = () => reject(query.error);
    };
  }), storeName);
}

async function addFromContext(target, kind) {
  await target.click({ button: "right" });
  const menu = page.locator(`[data-context-menu="${kind}"]`);
  await menu.waitFor();
  await menu.getByRole("menuitem", { name: "新增為待辦 · 未排期", exact: true }).click();
}

if (cdpEndpoint) await page.locator(".app-shell").waitFor();
else await page.goto(base, { waitUntil: "networkidle" });

// 隻言片語 → 未排期待辦；同一來源不重複建立。
const fragmentText = "整理品牌會議的三個決策";
await page.getByRole("button", { name: "隻言片語", exact: true }).click();
await page.locator(".fragment-capture textarea").fill(fragmentText);
await page.locator(".fragment-capture footer button").click();
const fragment = page.locator(".fragment-stream article").filter({ hasText: fragmentText });
await addFromContext(fragment, "fragment");
await page.locator(".context-action-notice").getByText("已加入待辦，尚未排期", { exact: true }).waitFor();
await addFromContext(fragment, "fragment");
await page.locator(".context-action-notice").getByText("這項內容已經在未排期待辦中", { exact: true }).waitFor();
let tasks = await records("tasks");
const fragmentTasks = tasks.filter((task) => task.title === fragmentText);
const fragmentToTaskWorks = fragmentTasks.length === 1
  && fragmentTasks[0].cardId === undefined
  && fragmentTasks[0].dueAt === undefined
  && String(fragmentTasks[0].conversionKey).startsWith("content:fragment:");

await page.getByRole("button", { name: "待辦", exact: true }).click();
await page.locator('[data-task-segment="no-date"]').getByText(fragmentText, { exact: true }).waitFor();
const fragmentTaskUnscheduled = true;

// 卡片庫卡片 → 待辦；保留來源卡片，能從待辦返回。
await page.getByRole("button", { name: "卡片庫", exact: true }).click();
const libraryCard = page.locator(".library-card").filter({ hasText: "Gemma 4 本機模式" });
await addFromContext(libraryCard, "card");
await page.locator(".context-action-notice").getByText("已加入待辦，尚未排期", { exact: true }).waitFor();
await addFromContext(libraryCard, "card");
await page.locator(".context-action-notice").getByText("這項內容已經在未排期待辦中", { exact: true }).waitFor();
const cards = await records("cards");
const sourceCard = cards.find((card) => card.title === "Gemma 4 本機模式");
tasks = await records("tasks");
const cardTasks = tasks.filter((task) => task.title === "Gemma 4 本機模式" && task.cardId === sourceCard.id && !task.sourceTaskId);
const cardToTaskWorks = cardTasks.length === 1 && cardTasks[0].dueAt === undefined && cardTasks[0].conversionKey === `content:card:${sourceCard.id}`;

await page.getByRole("button", { name: "待辦", exact: true }).click();
const cardTaskRow = page.locator('.task-groups article').filter({ hasText: "Gemma 4 本機模式" });
await cardTaskRow.waitFor();
await cardTaskRow.click({ button: "right" });
await page.locator('[data-context-menu="task"]').getByRole("menuitem", { name: "開啟來源卡片", exact: true }).click();
await page.locator(".card-editor-panel .card-title-input").waitFor();
const taskReturnsToSourceCard = await page.locator(".card-editor-panel .card-title-input").inputValue() === "Gemma 4 本機模式";
await page.locator(".card-back-button").click();

// 看板項目 → 待辦；詳情按鈕與右鍵共用同一筆來源，不重複。
const kanbanTitle = "準備跨部門排程";
await page.getByRole("button", { name: "看板", exact: true }).click();
await page.locator(".project-kanban-empty, .project-kanban-layout").first().waitFor();
if (await page.locator(".project-kanban-empty").count()) {
  await page.getByRole("button", { name: "建立第一張看板", exact: true }).click();
  await page.getByPlaceholder("看板名稱").fill("跨內容流動驗收");
  await page.getByRole("button", { name: "儲存", exact: true }).click();
}
const firstList = page.locator(".project-kanban-board > section:not(.project-kanban-add-list)").first();
await firstList.getByRole("button", { name: "新增卡片", exact: true }).click();
await firstList.getByPlaceholder("輸入卡片標題…").fill(kanbanTitle);
await firstList.getByPlaceholder("輸入卡片標題…").press("Enter");
const kanbanCard = firstList.locator("article").filter({ hasText: kanbanTitle });
await kanbanCard.click();
const inspector = page.locator(".project-kanban-inspector");
await inspector.waitFor();
await inspector.locator(".project-kanban-task-conversion").getByRole("button", { name: "新增為待辦 · 未排期", exact: true }).click();
await inspector.locator(".project-kanban-notice").getByText("已加入待辦，尚未排期", { exact: true }).waitFor();
const checklistNotPolluted = await inspector.locator(".project-kanban-checklist").getByText(kanbanTitle, { exact: true }).count() === 0;
await page.setViewportSize({ width: 1100, height: 800 });
await page.evaluate(() => document.documentElement.style.setProperty("--font-scale", "1.2"));
const compactMetrics = await inspector.evaluate((element) => ({ inspector: element.scrollWidth - element.clientWidth, root: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
const compactInspectorWorks = compactMetrics.inspector <= 1 && compactMetrics.root <= 1;
await page.screenshot({ path: path.join(output, "01-kanban-task-action.png"), fullPage: true });
await page.setViewportSize({ width: 1540, height: 960 });
await page.evaluate(() => document.documentElement.style.setProperty("--font-scale", "1"));

await addFromContext(kanbanCard, "card");
await page.locator(".context-action-notice").getByText("這項內容已經在未排期待辦中", { exact: true }).waitFor();
tasks = await records("tasks");
const kanbanSourceCard = (await records("cards")).find((card) => card.title === kanbanTitle);
const kanbanTasks = tasks.filter((task) => task.title === kanbanTitle && task.cardId === kanbanSourceCard.id && !task.sourceTaskId);
const kanbanToTaskWorks = kanbanTasks.length === 1 && kanbanTasks[0].dueAt === undefined && kanbanTasks[0].conversionKey === `content:card:${kanbanSourceCard.id}`;

const report = { fragmentToTaskWorks, fragmentTaskUnscheduled, cardToTaskWorks, taskReturnsToSourceCard, kanbanToTaskWorks, checklistNotPolluted, compactInspectorWorks, compactMetrics, errors };
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (cdpEndpoint) await page.evaluate(() => window.chengjing?.app?.quit?.()).catch(() => {});
await browser.close();
if (!fragmentToTaskWorks || !fragmentTaskUnscheduled || !cardToTaskWorks || !taskReturnsToSourceCard || !kanbanToTaskWorks || !checklistNotPolluted || !compactInspectorWorks || errors.length) process.exitCode = 1;
