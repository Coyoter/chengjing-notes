import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/pinned-cards");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1480, height: 920 }, colorScheme: "dark", locale: "zh-TW" });
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });

await page.goto(base, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "卡片庫", exact: true }).click();
const pinnedLibraryButton = page.locator(".library-organizer").getByRole("button", { name: /已置頂/ });
await pinnedLibraryButton.click();
const pinnedSeedCard = page.locator(".library-card").filter({ hasText: "AI 吵架王：產品研究" });
await pinnedSeedCard.waitFor();
const libraryPinnedCollectionWorks = await page.locator('.library-card[data-pinned="true"]').count() === await page.locator(".library-card").count()
  && await pinnedSeedCard.getByText("已置頂", { exact: true }).isVisible();

await pinnedSeedCard.click();
await page.getByRole("button", { name: "取消置頂", exact: true }).click();
await page.getByRole("button", { name: "返回卡片庫", exact: true }).click();
await pinnedLibraryButton.click();
await pinnedSeedCard.waitFor({ state: "detached" });
const unpinRemovesFromCollection = true;

await page.locator(".library-organizer").getByRole("button", { name: /所有卡片/ }).click();
await page.locator(".library-card").filter({ hasText: "AI 吵架王：產品研究" }).click();
await page.getByRole("button", { name: "置頂卡片", exact: true }).click();
await page.getByRole("button", { name: "返回卡片庫", exact: true }).click();
await pinnedLibraryButton.click();
await pinnedSeedCard.waitFor();
const repinRestoresCollection = true;
await page.screenshot({ path: path.join(output, "01-library-pinned.png"), fullPage: true });

await page.getByRole("button", { name: "資料庫", exact: true }).click();
const pinnedDatabaseButton = page.locator(".database-sidebar").getByRole("button", { name: /已置頂/ });
await pinnedDatabaseButton.click();
await page.locator(".data-table tbody tr").filter({ hasText: "AI 吵架王：產品研究" }).waitFor();
const databasePinnedRows = await page.locator(".data-table tbody tr:not(.database-task-row)").evaluateAll((rows) => rows.filter((row) => !row.querySelector(".database-empty-row")).map((row) => row.textContent || ""));
const databasePinnedIds = await page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open("chengjing"); request.onerror = () => reject(request.error); request.onsuccess = () => { const query = request.result.transaction("cards", "readonly").objectStore("cards").getAll(); query.onsuccess = () => resolve(query.result.filter((card) => card.state !== "trash" && card.favorite).map((card) => card.title)); }; }));
const databasePinnedCollectionWorks = databasePinnedRows.length === databasePinnedIds.length && databasePinnedRows.every((row) => databasePinnedIds.some((title) => row.includes(title)));
const pinnedScopeHasNoTasks = await page.locator(".database-task-row").count() === 0;

const databaseCardRow = page.locator(".data-table tbody tr").filter({ hasText: "AI 吵架王：產品研究" });
await databaseCardRow.locator(".card-name-column").click({ button: "right" });
await page.locator('[data-context-menu="card"]').waitFor();
await page.getByRole("menuitem", { name: "取消置頂", exact: true }).waitFor();
const contextUsesPinLanguage = true;
await page.keyboard.press("Escape");
await page.screenshot({ path: path.join(output, "02-database-pinned.png"), fullPage: true });

const report = { libraryPinnedCollectionWorks, unpinRemovesFromCollection, repinRestoresCollection, databasePinnedCollectionWorks, databasePinnedRows, databasePinnedIds, pinnedScopeHasNoTasks, contextUsesPinLanguage, errors };
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (!libraryPinnedCollectionWorks || !unpinRemovesFromCollection || !repinRestoresCollection || !databasePinnedCollectionWorks || !pinnedScopeHasNoTasks || !contextUsesPinLanguage || errors.length) process.exitCode = 1;
