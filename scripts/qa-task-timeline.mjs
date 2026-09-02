import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/task-timeline");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 920 }, colorScheme: "dark", locale: "zh-TW" });
const page = await context.newPage();
page.setDefaultTimeout(12_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });

await page.goto(base, { waitUntil: "networkidle" });
const seeded = await page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open("chengjing");
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const database = request.result;
    const transaction = database.transaction("tasks", "readwrite");
    const store = transaction.objectStore("tasks");
    store.clear();
    const noon = (offset) => { const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() + offset); return date.getTime(); };
    const now = Date.now();
    [
      { id: "qa-today", title: "今天最重要的任務", done: false, dueAt: noon(0), createdAt: now + 1, updatedAt: now + 1 },
      { id: "qa-overdue-old", title: "七天前留下的任務", done: false, dueAt: noon(-7), createdAt: now + 2, updatedAt: now + 2 },
      { id: "qa-overdue-near", title: "昨天到期的任務", done: false, dueAt: noon(-1), createdAt: now + 3, updatedAt: now + 3 },
      { id: "qa-tomorrow", title: "明天要處理的任務", done: false, dueAt: noon(1), createdAt: now + 4, updatedAt: now + 4 },
      { id: "qa-future", title: "五天後的任務", done: false, dueAt: noon(5), createdAt: now + 5, updatedAt: now + 5 },
      { id: "qa-no-date", title: "還沒有排日期", done: false, createdAt: now + 6, updatedAt: now + 6 },
      { id: "qa-completed", title: "已經完成的任務", done: true, dueAt: noon(0), createdAt: now + 7, updatedAt: now + 7 },
    ].forEach((task) => store.put({ ...task, doneKey: task.done ? "done" : "active", scheduleKey: task.dueAt || Number.MAX_SAFE_INTEGER, searchTerms: [task.title] }));
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error);
  };
}));

await page.getByRole("button", { name: "待辦", exact: true }).click();
await page.locator('[data-task-segment="today"]').getByText("今天最重要的任務", { exact: true }).waitFor();
const segmentOrder = await page.locator("[data-task-segment]").evaluateAll((segments) => segments.map((segment) => ({ name: segment.getAttribute("data-task-segment"), y: segment.getBoundingClientRect().y })));
const orderNames = segmentOrder.sort((left, right) => left.y - right.y).map((item) => item.name);
const priorityOrderCorrect = JSON.stringify(orderNames) === JSON.stringify(["today", "overdue", "future", "no-date", "completed"]);
const futureDates = await page.locator('[data-task-segment="future"] [data-task-date]').evaluateAll((segments) => segments.map((segment) => segment.getAttribute("data-task-date")));
const futureNearestFirst = futureDates.length >= 2 && [...futureDates].sort().join("|") === futureDates.join("|");
const overdueDates = await page.locator('[data-task-segment="overdue"] [data-task-date]').evaluateAll((segments) => segments.map((segment) => segment.getAttribute("data-task-date")));
const overdueSegmented = overdueDates.length === 2;
const todayProminence = await page.evaluate(() => {
  const today = document.querySelector('[data-task-segment="today"]');
  const future = document.querySelector('[data-task-segment="future"]');
  if (!today || !future) return false;
  const todayStyle = getComputedStyle(today);
  const futureStyle = getComputedStyle(future);
  return todayStyle.backgroundColor !== futureStyle.backgroundColor && Number.parseFloat(todayStyle.paddingTop) > Number.parseFloat(futureStyle.paddingTop);
});

const pickerTrigger = page.locator(".task-add .task-date-trigger");
const triggerGeometry = await pickerTrigger.evaluate((button) => {
  const children = [...button.children].map((child) => child.getBoundingClientRect());
  return { iconToLabel: children[1].left - children[0].right, labelToChevron: children[2].left - children[1].right, nativeDateInputs: document.querySelectorAll('input[type="date"]').length };
});
await pickerTrigger.click();
const calendar = page.locator(".task-calendar-popover");
await calendar.waitFor();
const calendarVisual = await calendar.evaluate((element) => ({ borderWidth: Number.parseFloat(getComputedStyle(element).borderTopWidth), background: getComputedStyle(element).backgroundColor, width: element.getBoundingClientRect().width }));
const calendarStructure = await calendar.locator(".task-calendar-days button").count() === 42
  && await calendar.locator(".task-calendar-weekdays span").count() === 7
  && await calendar.getByRole("button", { name: "明天", exact: true }).isVisible();
await page.screenshot({ path: path.join(output, "02-date-picker-dark.png"), fullPage: true });
await calendar.getByRole("button", { name: "明天", exact: true }).click();
const selectedDateCompact = await pickerTrigger.evaluate((button) => {
  const children = [...button.children].map((child) => child.getBoundingClientRect());
  return children[2].left - children[1].right <= 10;
});

const newTaskTitle = "月曆新增的明日任務";
await page.locator(".task-add-main input").fill(newTaskTitle);
await page.locator(".task-add").getByRole("button", { name: "加入", exact: true }).click();
await page.locator('[data-task-segment="future"] [data-task-date]').first().getByText(newTaskTitle, { exact: true }).waitFor();
const pickerCreatesFutureTask = true;

const noDateTask = page.locator('[data-task-segment="no-date"] article').filter({ hasText: "還沒有排日期" });
await noDateTask.click({ button: "right" });
await page.locator('[data-context-menu="task"]').getByRole("menuitem", { name: "設定期限…", exact: true }).click();
const dueDialog = page.locator(".task-due-dialog");
await dueDialog.getByRole("button", { name: "目標期限", exact: true }).click();
await dueDialog.getByRole("button", { name: "一週後", exact: true }).click();
await dueDialog.getByRole("button", { name: "儲存期限", exact: true }).click();
await noDateTask.waitFor({ state: "detached" });
await page.locator('[data-task-segment="future"]').getByText("還沒有排日期", { exact: true }).waitFor();
const contextPickerMovesTask = true;

const overflow = await page.evaluate(() => ({ root: document.documentElement.scrollWidth - document.documentElement.clientWidth, timeline: document.querySelector(".task-timeline").scrollWidth - document.querySelector(".task-timeline").clientWidth }));
await page.locator(".tasks-page").evaluate((element) => { element.scrollTop = 0; });
await page.waitForTimeout(180);
await page.screenshot({ path: path.join(output, "01-task-timeline-dark.png"), fullPage: true });

const report = { seeded, priorityOrderCorrect, orderNames, futureNearestFirst, futureDates, overdueSegmented, todayProminence, triggerGeometry, selectedDateCompact, calendarVisual, calendarStructure, pickerCreatesFutureTask, contextPickerMovesTask, overflow, errors };
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();

if (!priorityOrderCorrect || !futureNearestFirst || !overdueSegmented || !todayProminence || triggerGeometry.iconToLabel > 10 || triggerGeometry.labelToChevron > 10 || triggerGeometry.nativeDateInputs !== 0 || !selectedDateCompact || calendarVisual.borderWidth !== 0 || calendarVisual.background === "rgba(0, 0, 0, 0)" || calendarVisual.width < 300 || !calendarStructure || !pickerCreatesFutureTask || !contextPickerMovesTask || overflow.root > 2 || overflow.timeline > 2 || errors.length) process.exitCode = 1;
