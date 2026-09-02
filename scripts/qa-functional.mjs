import { chromium } from "playwright";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1360, height: 820 }, colorScheme: "dark", locale: "zh-TW" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });

await page.goto(base, { waitUntil: "networkidle" });
await page.getByText("今天想釐清什麼？").waitFor();
const legacyDemoSeedAbsent = await page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open("chengjing");
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const query = request.result.transaction("cards", "readonly").objectStore("cards").get("card-source");
    query.onerror = () => reject(query.error);
    query.onsuccess = () => resolve(!query.result);
  };
}));

await page.getByRole("button", { name: /快速記錄/ }).click();
await page.getByPlaceholder("卡片標題").fill("功能驗收卡片");
await page.getByPlaceholder("先記下核心想法，之後再慢慢整理…").fill("這張卡片用來驗證新增、編輯、搜尋與持久保存。");
await page.getByRole("button", { name: /直接放進白板/ }).click();
await page.getByRole("button", { name: "建立卡片", exact: true }).click();
await page.locator(".card-editor-panel").waitFor();
await page.locator(".card-title-input").fill("功能驗收卡片（已編輯）");
await page.locator(".prose-editor").fill("這段內容已透過區塊編輯器更新，重新載入後仍應存在。");
await page.waitForTimeout(650);
await page.getByRole("button", { name: "資訊", exact: true }).click();
await page.locator(".version-section button").first().waitFor();
await page.getByRole("button", { name: "返回卡片庫" }).click();

await page.getByRole("button", { name: "卡片庫", exact: true }).click();
await page.locator(".page-intro h2").filter({ hasText: "6 張卡片" }).waitFor();
await page.locator(".library-grid").getByText("功能驗收卡片（已編輯）", { exact: true }).waitFor();
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: "卡片庫", exact: true }).click();
await page.locator(".library-grid").getByText("功能驗收卡片（已編輯）", { exact: true }).waitFor();

await page.getByRole("button", { name: "白板", exact: true }).click();
await page.getByText("產品研究室", { exact: true }).first().waitFor();
await page.waitForFunction(() => document.querySelectorAll(".flow-card").length >= 4);
const before = await page.locator(".mindmap-node").count();
await page.getByRole("button", { name: "新增心智圖", exact: true }).click();
await page.waitForFunction((count) => document.querySelectorAll(".mindmap-node").length >= count + 1, before);
await page.locator(".mindmap-title").last().press("Tab");
await page.waitForFunction((count) => document.querySelectorAll(".mindmap-node").length >= count + 2, before);
await page.locator(".mindmap-title").last().press("Enter");
await page.waitForFunction((count) => document.querySelectorAll(".mindmap-node").length >= count + 3, before);
const after = await page.locator(".mindmap-node").count();

await page.getByRole("button", { name: "資料庫", exact: true }).click();
const row = page.locator(".data-table tbody tr").filter({ hasText: "功能驗收卡片（已編輯）" });
await row.waitFor();
await row.locator("select").selectOption({ label: "進行中" });

await page.locator(".search-trigger").click();
await page.locator(".command-input input").fill("功能驗收");
await page.locator(".command-results").getByText("功能驗收卡片（已編輯）", { exact: true }).waitFor();
await page.keyboard.press("Escape");

const report = { legacyDemoSeedAbsent, createdAndPersisted: true, versionHistory: true, mindmapNodesBefore: before, mindmapNodesAfter: after, mindmapKeyboard: true, databaseUpdated: true, commandSearch: true, errors };
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (!legacyDemoSeedAbsent || errors.length) process.exitCode = 1;
