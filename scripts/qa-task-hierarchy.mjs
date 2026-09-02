import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const cdpEndpoint = process.env.CHENGJING_CDP || "";
const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/task-hierarchy");
await fs.mkdir(output, { recursive: true });
const browser = cdpEndpoint ? await chromium.connectOverCDP(cdpEndpoint) : await chromium.launch({ headless: true });
const context = cdpEndpoint ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 1440, height: 920 }, colorScheme: "dark", locale: "zh-TW" });
const page = cdpEndpoint
  ? context.pages().find((candidate) => !candidate.url().includes("quick-capture")) || context.pages()[0]
  : await context.newPage();
page.setDefaultTimeout(15_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
if (cdpEndpoint) await page.locator(".app-shell").waitFor();
else await page.goto(base, { waitUntil: "networkidle" });

async function allTasks() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("chengjing");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const query = request.result.transaction("tasks", "readonly").objectStore("tasks").getAll();
      query.onsuccess = () => resolve(query.result);
      query.onerror = () => reject(query.error);
    };
  }));
}

async function addChild(taskId, title) {
  const row = page.locator(`[data-task-id="${taskId}"]`);
  await row.click({ button: "right" });
  await page.locator('[data-context-menu="task"]').getByRole("menuitem", { name: "新增子項目", exact: true }).click();
  const dialog = page.locator(".task-child-dialog");
  await dialog.locator("input").fill(title);
  await dialog.locator("button.primary-button").click();
  await dialog.waitFor({ state: "detached" });
  await page.locator(".task-groups article").filter({ hasText: title }).first().waitFor();
}

const parentTitle = "完成季度產品提案";
await page.getByRole("button", { name: "待辦", exact: true }).click();
await page.locator(".task-add-main input").fill(parentTitle);
await page.locator(".task-add").getByRole("button", { name: "加入", exact: true }).click();
let tasks = await allTasks();
const parent = tasks.find((task) => task.title === parentTitle);
await addChild(parent.id, "整理使用者研究");
tasks = await allTasks();
let childOne = tasks.find((task) => task.title === "整理使用者研究" && task.parentTaskId === parent.id);
await addChild(parent.id, "完成定價試算");
tasks = await allTasks();
let childTwo = tasks.find((task) => task.title === "完成定價試算" && task.parentTaskId === parent.id);
await addChild(parent.id, "完成定價試算");
await page.locator(".context-action-notice").getByText("相同的未完成子項目已經存在", { exact: true }).waitFor();
tasks = await allTasks();
const directChildren = tasks.filter((task) => task.parentTaskId === parent.id);
const hierarchyCreated = directChildren.length === 2 && directChildren.every((task) => !task.done && task.dueAt === undefined);

let parentRow = page.locator(`[data-task-id="${parent.id}"]`);
let childOneRow = page.locator(`[data-task-id="${childOne.id}"]`);
let childTwoRow = page.locator(`[data-task-id="${childTwo.id}"]`);
await parentRow.getByText("0/2 子項目完成", { exact: true }).waitFor();
const visualDepthWorks = await childOneRow.getAttribute("data-task-depth") === "1" && await childTwoRow.getAttribute("data-task-depth") === "1";

await childOneRow.locator(".task-check").click();
await page.waitForFunction(({ parentId, childId }) => document.querySelector(`[data-task-id="${childId}"]`)?.classList.contains("is-done") && !document.querySelector(`[data-task-id="${parentId}"]`)?.classList.contains("is-done"), { parentId: parent.id, childId: childOne.id });
await parentRow.getByText("1/2 子項目完成", { exact: true }).waitFor();
const parentWaitsForChildren = true;

await childTwoRow.locator(".task-check").click();
await page.waitForFunction((parentId) => document.querySelector(`[data-task-id="${parentId}"]`)?.classList.contains("is-done"), parent.id);
parentRow = page.locator(`[data-task-id="${parent.id}"]`);
const parentCompletesAfterChildren = await parentRow.evaluate((element) => element.classList.contains("is-done"));

childTwoRow = page.locator(`[data-task-id="${childTwo.id}"]`);
await childTwoRow.locator(".task-check").click();
await page.waitForFunction(({ parentId, childId }) => !document.querySelector(`[data-task-id="${parentId}"]`)?.classList.contains("is-done") && !document.querySelector(`[data-task-id="${childId}"]`)?.classList.contains("is-done"), { parentId: parent.id, childId: childTwo.id });
const reopeningChildReopensParent = true;

await addChild(childOne.id, "訪談三位目標使用者");
tasks = await allTasks();
const grandchild = tasks.find((task) => task.title === "訪談三位目標使用者" && task.parentTaskId === childOne.id);
const grandchildRow = page.locator(`[data-task-id="${grandchild.id}"]`);
await grandchildRow.waitFor();
const nestedDepthWorks = await grandchildRow.getAttribute("data-task-depth") === "2";
childOne = tasks.find((task) => task.id === childOne.id);
const addingChildReopensCompletedParent = childOne.done === false;

await grandchildRow.locator(".task-check").click();
await page.waitForFunction((childId) => document.querySelector(`[data-task-id="${childId}"]`)?.classList.contains("is-done"), childOne.id);
parentRow = page.locator(`[data-task-id="${parent.id}"]`);
await parentRow.locator(".task-check").click();
await page.waitForFunction((ids) => ids.every((id) => document.querySelector(`[data-task-id="${id}"]`)?.classList.contains("is-done")), [parent.id, childOne.id, childTwo.id, grandchild.id]);
const completingParentCompletesTree = true;

await page.setViewportSize({ width: 1100, height: 800 });
await page.evaluate(() => document.documentElement.style.setProperty("--font-scale", "1.2"));
const compactMetrics = await page.locator(".task-timeline").evaluate((element) => ({ timeline: element.scrollWidth - element.clientWidth, root: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
const compactHierarchyWorks = compactMetrics.timeline <= 1 && compactMetrics.root <= 1;
await page.screenshot({ path: path.join(output, "01-task-hierarchy.png"), fullPage: true });
await page.setViewportSize({ width: 1440, height: 920 });
await page.evaluate(() => document.documentElement.style.setProperty("--font-scale", "1"));

page.once("dialog", (dialog) => dialog.accept());
await parentRow.click({ button: "right" });
await page.locator('[data-context-menu="task"]').getByRole("menuitem", { name: "刪除待辦", exact: true }).click();
await parentRow.waitFor({ state: "detached" });
tasks = await allTasks();
const deletingParentDeletesTree = !tasks.some((task) => [parent.id, childOne.id, childTwo.id, grandchild.id].includes(task.id));

// 編輯器 Checkbox 作為主項目時，子項目狀態必須同步回原內容。
const editorParent = tasks.find((task) => task.title === "完成第一個可執行版本" && task.sourceTaskId);
await addChild(editorParent.id, "驗證封裝結果");
tasks = await allTasks();
const editorChild = tasks.find((task) => task.title === "驗證封裝結果" && task.parentTaskId === editorParent.id);
let editorChildRow = page.locator(`[data-task-id="${editorChild.id}"]`);
await editorChildRow.locator(".task-check").click();
await page.waitForFunction((parentId) => document.querySelector(`[data-task-id="${parentId}"]`)?.classList.contains("is-done"), editorParent.id);
await page.getByRole("button", { name: "日誌", exact: true }).click();
const editorCheckbox = page.locator('.journal-paper .prose-editor li[data-task-id]').filter({ hasText: "完成第一個可執行版本" }).locator('input[type="checkbox"]');
await editorCheckbox.waitFor();
const editorCheckedAfterChild = await editorCheckbox.isChecked();
await page.getByRole("button", { name: "待辦", exact: true }).click();
editorChildRow = page.locator(`[data-task-id="${editorChild.id}"]`);
await editorChildRow.locator(".task-check").click();
await page.getByRole("button", { name: "日誌", exact: true }).click();
await editorCheckbox.waitFor();
const editorUncheckedAfterReopen = !await editorCheckbox.isChecked();
const editorParentSyncs = editorCheckedAfterChild && editorUncheckedAfterReopen;

const report = { hierarchyCreated, visualDepthWorks, parentWaitsForChildren, parentCompletesAfterChildren, reopeningChildReopensParent, nestedDepthWorks, addingChildReopensCompletedParent, completingParentCompletesTree, compactHierarchyWorks, compactMetrics, deletingParentDeletesTree, editorParentSyncs, errors };
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (cdpEndpoint) await page.evaluate(() => window.chengjing?.app?.quit?.()).catch(() => {});
await browser.close();
if (!hierarchyCreated || !visualDepthWorks || !parentWaitsForChildren || !parentCompletesAfterChildren || !reopeningChildReopensParent || !nestedDepthWorks || !addingChildReopensCompletedParent || !completingParentCompletesTree || !compactHierarchyWorks || !deletingParentDeletesTree || !editorParentSyncs || errors.length) process.exitCode = 1;
