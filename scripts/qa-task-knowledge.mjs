import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/task-knowledge");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", locale: "zh-TW" });
const page = await context.newPage();
page.setDefaultTimeout(20_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
await page.goto(base, { waitUntil: "networkidle" });

await page.getByRole("button", { name: "待辦", exact: true }).click();
await page.getByPlaceholder("新增待辦事項…").fill("直接建立的神經元待辦");
await page.locator(".task-add").getByRole("button", { name: "加入", exact: true }).click();
await page.getByText("直接建立的神經元待辦", { exact: true }).waitFor();
const directTaskId = await page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open("chengjing"); request.onerror = () => reject(request.error); request.onsuccess = () => { const query = request.result.transaction("tasks", "readonly").objectStore("tasks").getAll(); query.onsuccess = () => resolve(query.result.find((task) => task.title === "直接建立的神經元待辦")?.id); }; }));
await page.evaluate((taskId) => new Promise((resolve, reject) => { const request = indexedDB.open("chengjing"); request.onerror = () => reject(request.error); request.onsuccess = () => { const transaction = request.result.transaction("brainEdges", "readwrite"); transaction.objectStore("brainEdges").put({ id: "qa-task-brain-edge", sourceType: "task", sourceId: taskId, targetType: "card", targetId: "card-welcome", origin: "manual", reason: "QA 待辦連線", createdAt: Date.now() }); transaction.oncomplete = () => resolve(true); transaction.onerror = () => reject(transaction.error); }; }), directTaskId);

await page.getByRole("button", { name: "第二大腦", exact: true }).click();
const directNeuron = page.locator(`[data-brain-node-key="task:${directTaskId}"]`);
const editorNeuron = page.locator('[data-brain-node-key^="task:editor:journal-today:"]');
await directNeuron.waitFor({ state: "attached" });
await editorNeuron.waitFor({ state: "attached" });
await directNeuron.dispatchEvent("click");
const taskInspectorVisible = await page.locator(".brain-inspector").getByText("待辦", { exact: true }).isVisible() && await page.locator(".brain-inspector").getByText("直接建立的神經元待辦", { exact: true }).isVisible();
const taskNeuronCount = await page.locator('[data-brain-node-key^="task:"]').count();
await page.screenshot({ path: path.join(output, "01-task-neurons.png"), fullPage: true });

await page.getByRole("button", { name: "資料庫", exact: true }).click();
const sidebar = page.locator(".database-sidebar");
await sidebar.getByRole("button", { name: /待辦/ }).click();
await page.locator(".database-header h2").getByText("待辦", { exact: true }).waitFor();
const directRow = page.locator(".database-task-row").filter({ hasText: "直接建立的神經元待辦" });
const editorRow = page.locator(".database-task-row").filter({ hasText: "完成第一個可執行版本" });
await directRow.waitFor();
await editorRow.waitFor();
const standaloneAndEditorTasksVisible = await directRow.isVisible() && await editorRow.isVisible();
await page.locator(".database-tools input").fill("直接建立的神經元待辦");
await page.waitForFunction(() => document.querySelectorAll(".database-task-row").length === 1);
const taskSearchWorks = await page.locator(".database-task-row").count() === 1 && await directRow.isVisible();
await directRow.locator(".database-task-state").click();
await directRow.getByText("已完成", { exact: true }).waitFor();
const statusWritesBack = await page.evaluate((taskId) => new Promise((resolve) => { const request = indexedDB.open("chengjing"); request.onsuccess = () => { const query = request.result.transaction("tasks", "readonly").objectStore("tasks").get(taskId); query.onsuccess = () => resolve(query.result?.done === true); }; }), directTaskId);
await page.screenshot({ path: path.join(output, "02-task-database.png"), fullPage: true });

await directRow.click({ button: "right" });
await page.locator(".global-context-menu").getByRole("menuitem", { name: "刪除待辦", exact: true }).click();
await directRow.waitFor({ state: "detached" });
const deletionCleansNeuronLinks = await page.evaluate((taskId) => new Promise((resolve, reject) => { const request = indexedDB.open("chengjing"); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const taskQuery = db.transaction("tasks", "readonly").objectStore("tasks").get(taskId); const edgeQuery = db.transaction("brainEdges", "readonly").objectStore("brainEdges").get("qa-task-brain-edge"); Promise.all([new Promise((done) => { taskQuery.onsuccess = () => done(taskQuery.result); }), new Promise((done) => { edgeQuery.onsuccess = () => done(edgeQuery.result); })]).then(([task, edge]) => resolve(!task && !edge)); }; }), directTaskId);

const report = { directTaskId: Boolean(directTaskId), taskNeuronCount, taskInspectorVisible, standaloneAndEditorTasksVisible, taskSearchWorks, statusWritesBack, deletionCleansNeuronLinks, errors };
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (!directTaskId || taskNeuronCount < 5 || !taskInspectorVisible || !standaloneAndEditorTasksVisible || !taskSearchWorks || !statusWritesBack || !deletionCleansNeuronLinks || errors.length) process.exitCode = 1;
