import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const endpoint = process.env.CHENGJING_CDP || "http://127.0.0.1:9333";
const expectedVersion = JSON.parse(await fs.readFile(path.resolve("package.json"), "utf8")).version;
const output = path.resolve(`qa-artifacts/installed-v${expectedVersion}`);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.connectOverCDP(endpoint);
const context = browser.contexts()[0];
const page = context.pages().find((candidate) => candidate.url().startsWith("file:") && !candidate.url().includes("quick-capture")) || context.pages().find((candidate) => !candidate.url().includes("quick-capture")) || context.pages()[0];
page.setDefaultTimeout(10_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
await page.locator(".launch-screen").waitFor({ state: "detached" }).catch(() => {});

const userAgent = await page.evaluate(() => navigator.userAgent);
await page.getByRole("button", { name: "白板", exact: true }).click();
if (await page.locator(".board-empty").count()) await page.getByRole("button", { name: "新增白板", exact: true }).click();
await page.locator(".board-canvas").waitFor();
const before = await page.locator(".flow-card").count();
await page.getByRole("button", { name: "新增卡片", exact: true }).click();
await page.waitForFunction((count) => document.querySelectorAll(".flow-card").length > count, before);
const boardStaysInPlace = await page.locator(".card-focus-layer").count() === 0;

await page.getByRole("button", { name: "看板", exact: true }).click();
if (await page.locator(".project-kanban-empty").count()) {
  await page.getByRole("button", { name: "建立第一張看板", exact: true }).click();
  await page.getByPlaceholder("看板名稱").fill("封裝驗收看板");
  await page.getByRole("button", { name: "儲存", exact: true }).click();
}
await page.locator(".project-kanban-board").waitFor();
const firstList = page.locator(".project-kanban-board > section").first();
await firstList.getByRole("button", { name: "新增卡片", exact: true }).click();
await firstList.getByPlaceholder("輸入卡片標題…").fill("封裝驗收卡片");
await firstList.getByRole("button", { name: "新增卡片", exact: true }).click();
const card = firstList.locator("article").filter({ hasText: "封裝驗收卡片" });
await card.waitFor();
const secondList = page.locator(".project-kanban-board > section").nth(1);
await card.dragTo(secondList);
await page.waitForTimeout(300);
const kanbanDragWorks = await secondList.locator("article").filter({ hasText: "封裝驗收卡片" }).last().isVisible();
await page.screenshot({ path: path.join(output, "installed-kanban.png"), fullPage: true });

const report = { version: userAgent.match(/chengjing\/([^ ]+)/)?.[1] || "", boardStaysInPlace, kanbanDragWorks, errors };
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (report.version !== expectedVersion || !boardStaysInPlace || !kanbanDragWorks || errors.length) process.exitCode = 1;
