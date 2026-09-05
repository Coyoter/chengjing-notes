import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/database-share");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];

const databaseContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", locale: "zh-TW" });
const databasePage = await databaseContext.newPage();
databasePage.setDefaultTimeout(10_000);
databasePage.on("pageerror", (error) => errors.push(`database pageerror: ${error.message}`));
databasePage.on("console", (message) => { if (message.type() === "error") errors.push(`database console: ${message.text()}`); });
await databasePage.goto(base, { waitUntil: "networkidle" });
await databasePage.getByRole("button", { name: "資料庫", exact: true }).click();
const sidebar = databasePage.locator(".database-sidebar");
await sidebar.getByRole("button", { name: /產品/ }).click();
await databasePage.locator(".database-header h2").getByText("產品", { exact: true }).waitFor();
await databasePage.waitForFunction(() => document.querySelectorAll(".data-table tbody tr:not(.database-task-row)").length === 3 && document.querySelectorAll(".data-table tbody tr.database-task-row").length === 2);
const productRows = await databasePage.locator(".data-table tbody tr").filter({ hasNotText: "目前條件沒有符合" }).count();
const productTaskRows = await databasePage.locator(".data-table tbody tr.database-task-row").count();
const productFilterWorks = productRows === 5 && productTaskRows === 2;

await databasePage.getByRole("button", { name: "批次選取", exact: true }).click();
await databasePage.getByRole("button", { name: "選取目前 3 張", exact: true }).click();
await databasePage.getByText("已選 3 張", { exact: true }).waitFor();
const tableSelectedCount = await databasePage.locator(".data-table tbody tr.is-selected").count();
await databasePage.screenshot({ path: path.join(output, "01-database-bulk-selected.png"), fullPage: true });
await databasePage.getByRole("button", { name: "移到垃圾桶", exact: true }).click();
await databasePage.getByText("目前條件沒有符合的內容。", { exact: true }).waitFor();
const bulkTrashWorks = tableSelectedCount === 3;

await sidebar.getByRole("button", { name: /AI/ }).click();
await databasePage.locator(".database-header h2").getByText("AI", { exact: true }).waitFor();
await databasePage.getByRole("button", { name: "批次選取", exact: true }).click();
await databasePage.getByRole("button", { name: "選取目前 1 張", exact: true }).click();
databasePage.once("dialog", (dialog) => dialog.accept());
await databasePage.getByRole("button", { name: /永久刪除/ }).click();
await databasePage.getByText("目前條件沒有符合的內容。", { exact: true }).waitFor();
const bulkPermanentDeleteWorks = true;
await databasePage.screenshot({ path: path.join(output, "02-database-after-delete.png"), fullPage: true });
await databaseContext.close();

const report = {
  productFilterWorks,
  productRows,
  productTaskRows,
  bulkTrashWorks,
  tableSelectedCount,
  bulkPermanentDeleteWorks,
  errors,
};
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();

if (!productFilterWorks || !bulkTrashWorks || !bulkPermanentDeleteWorks || errors.length) process.exitCode = 1;
