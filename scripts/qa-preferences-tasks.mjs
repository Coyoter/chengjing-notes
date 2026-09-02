import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/preferences-tasks");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });

const languageCases = [
  { locale: "zh-TW", expected: "zh-TW" },
  { locale: "zh-CN", expected: "zh-CN" },
  { locale: "ja-JP", expected: "ja" },
  { locale: "ko-KR", expected: "ko" },
  { locale: "fr-FR", expected: "en" },
];
const languageReports = [];
for (const item of languageCases) {
  const context = await browser.newContext({ viewport: { width: 1180, height: 760 }, colorScheme: "dark", locale: item.locale });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator(`html[lang="${item.expected}"]`).waitFor();
  languageReports.push(await page.evaluate((expected) => ({
    expected,
    actual: document.documentElement.lang,
    theme: document.documentElement.dataset.theme,
    navigatorLanguage: navigator.language,
  }), item.expected));
  await context.close();
}

const context = await browser.newContext({ viewport: { width: 1480, height: 920 }, colorScheme: "dark", locale: "zh-TW" });
const page = await context.newPage();
page.setDefaultTimeout(12_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });

await page.goto(base, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "設定", exact: true }).click();
await page.locator("#support-author").evaluate((element) => element.scrollIntoView({ block: "center" }));
const support = page.locator("#support-author");
await support.getByRole("heading", { name: "打賞作者", exact: true }).waitFor();
const donationCopyVisible = (await support.innerText()).includes("永久保持免費、無廣告") && (await support.innerText()).includes("打賞完全自願");
const ecpay = support.getByRole("link", { name: /綠界/ });
const paypal = support.getByRole("link", { name: /PayPal/ });
const donationLinksCorrect = await ecpay.getAttribute("href") === "https://payment.ecpay.com.tw/Broadcaster/Donate/D599936B2C3A0AF2342FA6448088C9C6"
  && await paypal.getAttribute("href") === "https://paypal.me/techtarian"
  && await ecpay.getAttribute("target") === "_blank"
  && await paypal.getAttribute("target") === "_blank";
const systemThemeDefault = await page.locator(".theme-grid button.is-active").getByText("跟隨系統", { exact: true }).isVisible()
  && await page.evaluate(() => document.documentElement.dataset.theme) === "dark";
await page.screenshot({ path: path.join(output, "01-settings-support.png"), fullPage: true });

await page.getByRole("button", { name: "日誌", exact: true }).click();
await page.locator(".journal-paper").waitFor();
const journalTask = page.locator('.journal-paper .prose-editor ul[data-type="taskList"] li').first();
await journalTask.waitFor();
const journalTaskTitleVisible = (await journalTask.innerText()).includes("完成第一個可執行版本");
const journalTaskIndexed = Boolean(await journalTask.getAttribute("data-task-id"));
const journalCheckbox = journalTask.locator('input[type="checkbox"]');
await journalCheckbox.click();
await page.waitForTimeout(650);

await page.getByRole("button", { name: "待辦", exact: true }).click();
let syncedArticle = page.locator(".task-groups article").filter({ hasText: "完成第一個可執行版本" });
await syncedArticle.waitFor();
const editorToTasksSync = await syncedArticle.evaluate((element) => element.classList.contains("is-done"));
await syncedArticle.getByRole("button", { name: "恢復為未完成", exact: true }).click();
await page.getByRole("button", { name: "日誌", exact: true }).click();
await journalTask.waitFor();
const tasksToEditorSync = !await journalCheckbox.isChecked();

await journalTask.click({ button: "right" });
await page.locator('[data-context-menu="task"]').waitFor();
const editorDueAction = page.getByRole("menuitem", { name: "設定期限…", exact: true });
await editorDueAction.waitFor();
const editorTaskContextMenu = await editorDueAction.isVisible();
await editorDueAction.click();
const dueDialog = page.locator(".task-due-dialog");
await dueDialog.getByRole("button", { name: "目標期限", exact: true }).click();
await dueDialog.getByRole("button", { name: "下一個月", exact: true }).click();
await dueDialog.locator('[data-date="2026-09-18"]').click();
await dueDialog.getByRole("button", { name: "儲存期限", exact: true }).click();

await page.getByRole("button", { name: "待辦", exact: true }).click();
syncedArticle = page.locator(".task-groups article").filter({ hasText: "完成第一個可執行版本" });
await syncedArticle.waitFor();
const editorDueVisible = await page.locator('[data-task-date="2026-09-18"]').filter({ hasText: "完成第一個可執行版本" }).count() === 1;
await syncedArticle.click({ button: "right" });
const dueContext = page.locator('[data-context-menu="task"]');
await dueContext.getByRole("menuitem", { name: "修改期限…", exact: true }).waitFor();
const changeAndRemoveDueVisible = await dueContext.getByRole("menuitem", { name: "修改期限…", exact: true }).isVisible() && await dueContext.getByRole("menuitem", { name: "移除期限", exact: true }).isVisible();
await dueContext.getByRole("menuitem", { name: "移除期限", exact: true }).click();
await page.waitForFunction(() => [...document.querySelectorAll(".task-groups article")].some((article) => article.textContent?.includes("完成第一個可執行版本") && article.textContent?.includes("沒有期限")));
const editorDueRemoved = true;

const directTaskTitle = "直接建立的期限待辦";
await page.locator(".task-add-main input").fill(directTaskTitle);
await page.locator(".task-add .task-date-trigger").click();
await page.locator(".task-add .task-calendar-popover").getByRole("button", { name: "下一個月", exact: true }).click();
await page.locator(".task-add .task-calendar-popover").locator('[data-date="2026-09-22"]').click();
await page.locator(".task-add").getByRole("button", { name: "加入", exact: true }).click();
const directArticle = page.locator(".task-groups article").filter({ hasText: directTaskTitle });
await directArticle.waitFor();
const directDueCreated = await page.locator('[data-task-date="2026-09-22"]').filter({ hasText: directTaskTitle }).count() === 1;
await page.screenshot({ path: path.join(output, "02-task-deadlines.png"), fullPage: true });

await page.getByRole("button", { name: "卡片庫", exact: true }).click();
await page.locator(".library-card").filter({ hasText: "Gemma 4 本機模式" }).click();
const cardEditor = page.locator(".card-editor-panel .prose-editor");
await cardEditor.waitFor();
await cardEditor.locator("h2").first().click();
await page.getByRole("button", { name: "待辦清單", exact: true }).click();
const cardTaskItem = page.locator('.card-editor-panel .prose-editor li[data-task-id]').first();
await cardTaskItem.waitFor();
await page.waitForTimeout(650);
const cardTaskTitle = (await cardTaskItem.locator(":scope > div p").first().innerText()).trim();
const regularCardTaskHasStableId = Boolean(await cardTaskItem.getAttribute("data-task-id"));
await page.getByRole("button", { name: "待辦", exact: true }).click();
const cardTaskArticle = page.locator(".task-groups article").filter({ hasText: cardTaskTitle });
await cardTaskArticle.waitFor();
const regularCardTaskSynced = true;
await cardTaskArticle.click({ button: "right" });
await page.locator('[data-context-menu="task"]').getByRole("menuitem", { name: "刪除待辦", exact: true }).click();
await cardTaskArticle.waitFor({ state: "detached" });
await page.getByRole("button", { name: "卡片庫", exact: true }).click();
await page.locator(".library-card").filter({ hasText: "Gemma 4 本機模式" }).click();
const deletingTaskRemovesEditorItem = await page.locator('.card-editor-panel .prose-editor li[data-task-id]').filter({ hasText: cardTaskTitle }).count() === 0;
await page.screenshot({ path: path.join(output, "03-task-sync.png"), fullPage: true });

const report = {
  languageReports,
  donationCopyVisible,
  donationLinksCorrect,
  systemThemeDefault,
  journalTaskIndexed,
  journalTaskTitleVisible,
  editorToTasksSync,
  tasksToEditorSync,
  editorTaskContextMenu,
  editorDueVisible,
  changeAndRemoveDueVisible,
  editorDueRemoved,
  directDueCreated,
  regularCardTaskHasStableId,
  regularCardTaskSynced,
  deletingTaskRemovesEditorItem,
  errors,
};
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();

if (
  languageReports.some((item) => item.actual !== item.expected || item.theme !== "dark") ||
  !donationCopyVisible || !donationLinksCorrect || !systemThemeDefault || !journalTaskIndexed || !journalTaskTitleVisible ||
  !editorToTasksSync || !tasksToEditorSync || !editorTaskContextMenu || !editorDueVisible ||
  !changeAndRemoveDueVisible || !editorDueRemoved || !directDueCreated || !regularCardTaskHasStableId ||
  !regularCardTaskSynced || !deletingTaskRemovesEditorItem || errors.length
) process.exitCode = 1;
