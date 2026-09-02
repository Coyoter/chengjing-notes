import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const cdpEndpoint = process.env.CHENGJING_CDP || "";
const output = path.resolve("qa-artifacts/content-editing");
await fs.mkdir(output, { recursive: true });
const browser = cdpEndpoint ? await chromium.connectOverCDP(cdpEndpoint) : await chromium.launch({ headless: true });
const context = cdpEndpoint ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 1600, height: 980 }, colorScheme: "dark", locale: "zh-TW" });
const page = cdpEndpoint
  ? context.pages().find((candidate) => !candidate.url().includes("quick-capture")) || context.pages()[0]
  : await context.newPage();
page.setDefaultTimeout(10_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });

async function chooseEdit(kind) {
  const menu = page.locator(`[data-context-menu="${kind}"]`);
  await menu.waitFor();
  await menu.getByRole("menuitem", { name: "編輯", exact: true }).click();
}

if (cdpEndpoint) await page.locator(".app-shell").waitFor();
else await page.goto(base, { waitUntil: "networkidle" });

// 待辦：右鍵直接修改，並同步回畫面。
await page.getByRole("button", { name: "待辦", exact: true }).click();
await page.locator(".task-add-main input").fill("右鍵編輯前的待辦");
await page.locator(".task-add").getByRole("button", { name: "加入", exact: true }).click();
const task = page.locator(".task-groups article").filter({ hasText: "右鍵編輯前的待辦" });
await task.click({ button: "right" });
await chooseEdit("task");
const taskDialog = page.locator('[data-content-edit="task"]');
await taskDialog.locator("input").fill("右鍵已編輯的待辦");
await taskDialog.getByRole("button", { name: "儲存", exact: true }).click();
await page.locator(".task-groups article").filter({ hasText: "右鍵已編輯的待辦" }).waitFor();
const taskEdited = true;
await page.screenshot({ path: path.join(output, "01-task-edited.png"), fullPage: true });

// 隻言片語：保留雙擊，同時讓右鍵編輯成為可發現入口。
await page.getByRole("button", { name: "隻言片語", exact: true }).click();
await page.locator(".fragment-capture textarea").fill("右鍵編輯前的片語");
await page.locator(".fragment-capture footer button").click();
const fragment = page.locator(".fragment-stream article").filter({ hasText: "右鍵編輯前的片語" });
await fragment.click({ button: "right" });
await chooseEdit("fragment");
const fragmentDialog = page.locator('[data-content-edit="fragment"]');
await fragmentDialog.locator("textarea").fill("右鍵已編輯的片語");
await fragmentDialog.screenshot({ path: path.join(output, "02-fragment-edit-dialog-detail.png") });
await page.screenshot({ path: path.join(output, "02-fragment-edit-dialog.png"), fullPage: true });
await fragmentDialog.getByRole("button", { name: "儲存", exact: true }).click();
await page.locator(".fragment-stream article").filter({ hasText: "右鍵已編輯的片語" }).waitFor();
const fragmentEdited = true;

// 劃記：文字與補充想法都可一起修改。
await page.getByRole("button", { name: "劃記", exact: true }).click();
const highlight = page.locator(".highlight-card").first();
await highlight.click({ button: "right" });
await chooseEdit("highlight");
const highlightDialog = page.locator('[data-content-edit="highlight"]');
await highlightDialog.locator("textarea").first().fill("右鍵已編輯的劃記");
await highlightDialog.locator("textarea").nth(1).fill("這是補充想法");
await highlightDialog.getByRole("button", { name: "儲存", exact: true }).click();
await page.locator(".highlight-card").filter({ hasText: "右鍵已編輯的劃記" }).waitFor();
const highlightEdited = await page.locator(".highlight-card").filter({ hasText: "這是補充想法" }).count() === 1;

// 一般卡片：右鍵的第一個動作就是編輯。
await page.getByRole("button", { name: "卡片庫", exact: true }).click();
const libraryCard = page.locator(".library-card").filter({ hasText: "Gemma 4 本機模式" });
await libraryCard.click({ button: "right" });
await chooseEdit("card");
await page.locator(".card-editor-panel").waitFor();
const cardEditOpened = true;
await page.locator(".card-back-button").click();

// 看板卡片：同一個右鍵編輯入口，關閉後仍回到看板。
await page.getByRole("button", { name: "看板", exact: true }).click();
await page.locator(".project-kanban-empty, .project-kanban-layout").first().waitFor();
if (await page.locator(".project-kanban-empty").count()) {
  await page.getByRole("button", { name: "建立第一張看板", exact: true }).click();
  await page.getByPlaceholder("看板名稱").fill("右鍵編輯驗收");
  await page.getByRole("button", { name: "儲存", exact: true }).click();
}
const firstList = page.locator(".project-kanban-board > section:not(.project-kanban-add-list)").first();
await firstList.getByRole("button", { name: "新增卡片", exact: true }).click();
await firstList.getByPlaceholder("輸入卡片標題…").fill("看板右鍵編輯卡片");
await firstList.getByPlaceholder("輸入卡片標題…").press("Enter");
const kanbanCard = firstList.locator("article").filter({ hasText: "看板右鍵編輯卡片" });
await kanbanCard.click({ button: "right" });
await chooseEdit("card");
await page.locator(".card-editor-panel").waitFor();
const kanbanEditOpened = true;
await page.locator(".card-back-button").click();
await page.locator(".project-kanban-board").waitFor();
const kanbanContextPreserved = true;

// 白板文字：右鍵後直接在原處取得焦點，不另開突兀視窗。
await page.getByRole("button", { name: "白板", exact: true }).click();
const boardText = page.locator(".flow-text").first();
await boardText.click({ button: "right" });
const boardMenu = page.locator(".board-context-menu");
await boardMenu.getByRole("button", { name: "編輯", exact: true }).click();
await page.waitForFunction(() => document.activeElement?.getAttribute("contenteditable") === "true");
const boardInlineFocused = await page.evaluate(() => document.activeElement?.getAttribute("contenteditable") === "true");
await page.keyboard.type("右鍵已編輯的白板文字");
await page.locator(".topbar-title").click();
await page.waitForTimeout(220);
const boardInlineEdited = await page.locator(".flow-text").filter({ hasText: "右鍵已編輯的白板文字" }).count() === 1;

// 日誌：瀏覽日期不算建立；真的輸入後才進入卡片庫。
await page.getByLabel("主要功能").getByRole("button", { name: "日誌", exact: true }).click();
await page.locator(".journal-paper").waitFor();
await page.locator(".journal-week-days > button").last().click();
const emptyJournalTitle = await page.locator(".journal-heading-copy h2").innerText();
await page.getByRole("button", { name: "卡片庫", exact: true }).click();
const emptyJournalHidden = await page.locator(".library-card h3").filter({ hasText: emptyJournalTitle }).count() === 0;
await page.getByLabel("主要功能").getByRole("button", { name: "日誌", exact: true }).click();
await page.locator(".journal-paper .prose-editor p").last().fill("這一天真的留下了內容");
await page.waitForTimeout(700);
await page.getByRole("button", { name: "卡片庫", exact: true }).click();
await page.locator(".library-card h3").filter({ hasText: emptyJournalTitle }).waitFor();
const writtenJournalVisible = await page.locator(".library-card").filter({ hasText: "這一天真的留下了內容" }).count() === 1;
await page.screenshot({ path: path.join(output, "03-written-journal-visible.png"), fullPage: true });

const report = {
  taskEdited,
  fragmentEdited,
  highlightEdited,
  cardEditOpened,
  kanbanEditOpened,
  kanbanContextPreserved,
  boardInlineFocused,
  boardInlineEdited,
  emptyJournalHidden,
  writtenJournalVisible,
  errors,
};
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (cdpEndpoint) await page.evaluate(() => window.chengjing?.app?.quit?.()).catch(() => {});
await browser.close();

if (!taskEdited || !fragmentEdited || !highlightEdited || !cardEditOpened || !kanbanEditOpened || !kanbanContextPreserved || !boardInlineFocused || !boardInlineEdited || !emptyJournalHidden || !writtenJournalVisible || errors.length) process.exitCode = 1;
