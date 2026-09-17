import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const output = path.resolve("qa-artifacts/archive-library");
await fs.mkdir(output, { recursive: true });
const server = process.env.CHENGJING_URL ? null : await createServer({ server: { host: "127.0.0.1", port: 5198, strictPort: true } });
if (server) await server.listen();
const base = process.env.CHENGJING_URL || "http://127.0.0.1:5198";
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHENGJING_CHROMIUM || undefined, args: ["--no-sandbox", "--enable-unsafe-swiftshader"] });
const checks = []; const errors = [];
async function check(name, action) { await action(); checks.push(name); console.log(`PASS ${name}`); }
async function poll(read, expected, message) { for (let i = 0; i < 80; i++) { const value = await read(); if (JSON.stringify(value) === JSON.stringify(expected)) return; await new Promise((resolve) => setTimeout(resolve, 75)); } assert.deepEqual(await read(), expected, message); }
async function prepare(platform, viewport) {
  const context = await browser.newContext({ viewport, locale: "zh-TW", colorScheme: "dark", reducedMotion: "reduce" });
  await context.addInitScript((platform) => {
    window.chengjing = { platform, app: { getPreferredLanguage: async () => ({ language: "zh-TW" }), setLanguage: async () => {}, quit: async () => {} }, ai: { keyStatus: async () => ({ configured: false, encrypted: true }), listModels: async () => [] }, onShortcut: () => () => {} };
  }, platform);
  const page = await context.newPage(); page.setDefaultTimeout(15_000);
  page.on("pageerror", (error) => errors.push(`${platform}: ${error.message}`));
  page.on("dialog", (dialog) => dialog.dismiss());
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator(".app-shell").waitFor();
  await page.evaluate(async () => {
    const { db } = await import("/src/db.ts"); const { useAppStore } = await import("/src/store.ts"); const { translate } = await import("/src/i18n.ts");
    window.__qa = { db, store: useAppStore, t: (key) => translate("zh-TW", key) };
    useAppStore.getState().setView("today"); useAppStore.getState().setLanguage("zh-TW");
    await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
    const now = Date.now();
    const card = (id, title, tagIds) => ({ id, title, plainText: `${title} content`, contentHtml: `<p>${title} content</p>`, kind: "note", state: "active", createdAt: now, updatedAt: now, tagIds, collectionId: "topic", favorite: false, color: "slate", attachmentIds: [], properties: { 階段: "自訂階段", budget: 42 } });
    await db.cards.bulkAdd([card("probe", "ArchiveProbe", ["tag"]), card("control", "ActiveControl", ["other-tag"])]);
    await db.tags.bulkAdd([{ id: "tag", name: "研究標籤", color: "amber", createdAt: now }, { id: "other-tag", name: "其他標籤", color: "blue", createdAt: now }]);
    await db.knowledgeGroups.bulkAdd([{ id: "area", name: "研究領域", kind: "area", order: 0, createdAt: now, updatedAt: now }, { id: "topic", parentId: "area", name: "專題分類", kind: "topic", order: 0, createdAt: now, updatedAt: now }]);
    await db.kanbanBoards.add({ id: "kanban", title: "QA Project", description: "", favorite: false, createdAt: now, updatedAt: now });
    await db.kanbanLists.add({ id: "list", boardId: "kanban", title: "待處理", order: 0, createdAt: now, updatedAt: now });
    await db.kanbanPlacements.bulkAdd(["probe", "control"].map((cardId, order) => ({ id: `placement-${cardId}`, boardId: "kanban", listId: "list", cardId, order, createdAt: now, updatedAt: now })));
    await db.boards.add({ id: "board", title: "QA Whiteboard", description: "", favorite: false, tagIds: [], createdAt: now, updatedAt: now });
    await db.boardNodes.bulkAdd(["probe", "control"].map((cardId, index) => ({ id: `node-${cardId}`, boardId: "board", kind: "card", cardId, x: 100 + index * 400, y: 100, width: 280, height: 200 })));
    await db.boardEdges.add({ id: "edge", boardId: "board", source: "node-probe", target: "node-control" });
    await db.tasks.bulkAdd([{ id: "parent", title: "ArchiveProbe task", cardId: "probe", dueAt: now, done: false, createdAt: now, updatedAt: now }, { id: "child", title: "ArchiveProbe child", parentTaskId: "parent", done: false, createdAt: now, updatedAt: now }, { id: "independent", title: "IndependentTask", done: false, createdAt: now, updatedAt: now }]);
    await db.highlights.bulkAdd([{ id: "h-probe", cardId: "probe", text: "ArchiveProbe excerpt", note: "", color: "amber", createdAt: now }, { id: "h-control", cardId: "control", text: "ActiveExcerpt", note: "", color: "amber", createdAt: now }]);
  });
  return { page, context };
}
async function navigate(page, view) { await page.evaluate((view) => window.__qa.store.getState().setView(view), view); await page.locator(`.view-${view}`).waitFor(); }
const label = (page, key) => page.evaluate((key) => window.__qa.t(key), key);
const byTag = (page, name) => page.locator(".library-tag-section > button").filter({ hasText: name });
let activePage;
try {
  const { page, context } = await prepare("darwin", { width: 1440, height: 1000 }); activePage = page;
  await check("Kanban right-click archive removes card and inspector immediately", async () => {
    await page.evaluate(() => window.__qa.store.getState().openKanbanBoard("kanban"));
    const probe = page.locator(".project-kanban-cards > article").filter({ hasText: "ArchiveProbe" });
    await probe.waitFor(); await probe.click(); await page.locator(".project-kanban-inspector").waitFor(); await probe.click({ button: "right" });
    await page.getByRole("menuitem", { name: await label(page, "context.moveArchive"), exact: true }).click();
    await probe.waitFor({ state: "detached" });
    await page.locator(".project-kanban-inspector").waitFor({ state: "detached" });
    assert.equal(await page.locator(".project-kanban-cards > article").count(), 1);
    assert.equal(await page.evaluate(() => window.__qa.db.kanbanPlacements.count()), 2);
  });
  await check("Today/tasks/highlights/library/search exclude archived content", async () => {
    for (const [view, control] of [["today", "ActiveControl"], ["tasks", "IndependentTask"], ["highlights", "ActiveExcerpt"], ["library", "ActiveControl"]]) {
      await navigate(page, view); await page.locator(".workspace").getByText(control, { exact: true }).first().waitFor();
      assert.equal((await page.locator(".workspace").innerText()).includes("ArchiveProbe"), false, view);
    }
    await page.evaluate(() => window.__qa.store.getState().setCommandOpen(true));
    await page.locator(".command-input input").fill("ArchiveProbe"); await page.locator(".command-empty").waitFor();
    assert.equal(await page.locator(".command-results > button").count(), 0);
    await page.locator(".command-input input").press("Escape");
  });
  await check("Whiteboard hides archived node and attached edge, retaining underlying records", async () => {
    await page.evaluate(() => window.__qa.store.getState().openBoard("board"));
    await page.locator('.react-flow__node[data-id="node-control"]').waitFor();
    assert.equal(await page.locator('.react-flow__node[data-id="node-probe"]').count(), 0);
    assert.equal(await page.locator(".react-flow__edge").count(), 0);
    assert.equal(await page.evaluate(() => window.__qa.db.boardEdges.count()), 1);
  });
  await check("Archive resets stale filters, opens archived card, restores original placement", async () => {
    await navigate(page, "library"); await byTag(page, "其他標籤").click();
    await page.locator(".collection-tabs").getByRole("button", { name: await label(page, "library.archive"), exact: true }).click();
    const probe = page.locator(".library-card").filter({ hasText: "ArchiveProbe" }); await probe.waitFor(); await probe.click();
    await page.locator(".card-focus-layer").waitFor();
    assert.equal(await page.evaluate(() => window.__qa.store.getState().inactiveCardAccessId), "probe");
    await page.locator(".card-back-button").click();
    await probe.click({ button: "right" }); await page.getByRole("menuitem", { name: await label(page, "context.restoreLibrary"), exact: true }).click();
    await probe.waitFor({ state: "detached" });
    await page.evaluate(() => window.__qa.store.getState().openKanbanBoard("kanban"));
    await page.locator(".project-kanban-cards > article").filter({ hasText: "ArchiveProbe" }).waitFor();
    assert.deepEqual(await page.evaluate(async () => { const p = await window.__qa.db.kanbanPlacements.get("placement-probe"); return [p.listId, p.order]; }), ["list", 0]);
  });
  await check("Unified library preserves tags, folders, tables, custom stages, task tags and deadlines", async () => {
    await navigate(page, "library"); assert.equal(await page.getByRole("button", { name: "資料庫", exact: true }).count(), 0);
    await byTag(page, "研究標籤").click(); await page.locator(".library-card").filter({ hasText: "ArchiveProbe" }).waitFor();
    await page.locator(".library-card").filter({ hasText: "ActiveControl" }).waitFor({ state: "detached" });
    await page.getByRole("button", { name: await label(page, "database.table"), exact: true }).click();
    const row = page.locator(".data-table tbody tr").filter({ hasText: "ArchiveProbe" });
    await row.waitFor(); assert.equal(await row.locator("select").inputValue(), "自訂階段");
    await row.locator("select").selectOption("研究中");
    await poll(() => page.evaluate(async () => (await window.__qa.db.cards.get("probe")).properties), { 階段: "研究中", budget: 42 });
    await page.locator(".library-unified-tools select").selectOption("all");
    await page.locator(".database-task-row").filter({ hasText: "ArchiveProbe task" }).waitFor();
    assert.match(await page.locator(".database-task-row").innerText(), /研究標籤/);
    assert.equal(await page.locator(".database-task-row .task-due-chip").count(), 1);
    await page.getByRole("button", { name: "階段看板", exact: true }).click();
    await page.locator(".kanban-board").getByText("ArchiveProbe", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, "desktop-stage-board.png"), fullPage: true });
  });
  await check("Tag creation respects IME and global rename remains available", async () => {
    await page.getByRole("button", { name: await label(page, "database.addTag"), exact: true }).click();
    const input = page.locator(".library-tag-section input");
    await input.dispatchEvent("compositionstart"); await input.fill("ceshi"); await input.press("Enter");
    assert.equal(await page.evaluate(() => window.__qa.db.tags.where("name").equals("ceshi").count()), 0);
    await input.fill("整合測試標籤"); await input.dispatchEvent("compositionend", { data: "整合測試標籤" }); await input.press("Enter");
    await byTag(page, "整合測試標籤").waitFor(); await byTag(page, "整合測試標籤").click({ button: "right" });
    await page.getByRole("menuitem", { name: "重新命名標籤", exact: true }).click();
    const rename = page.getByRole("textbox", { name: "標籤名稱", exact: true }); await rename.fill("重新命名標籤"); await rename.press("Enter");
    await byTag(page, "重新命名標籤").waitFor();
  });
  await check("Batch actions only affect selected cards and permanent-delete cancellation is safe", async () => {
    await byTag(page, "重新命名標籤").click();
    await page.locator(".library-unified-tools select").selectOption("cards");
    await page.getByRole("button", { name: await label(page, "database.table"), exact: true }).click();
    await page.getByRole("button", { name: await label(page, "database.batch"), exact: true }).click();
    const control = page.locator(".data-table tbody tr").filter({ hasText: "ActiveControl" }); await control.locator(".selection-column button").click();
    await page.locator(".database-bulk-bar").getByRole("button", { name: await label(page, "database.deleteForever"), exact: true }).click();
    assert.equal((await page.evaluate(() => window.__qa.db.cards.get("control"))).state, "active");
    await page.locator(".database-bulk-bar").getByRole("button", { name: await label(page, "database.moveTrash"), exact: true }).click();
    await control.waitFor({ state: "detached" });
    assert.equal((await page.evaluate(() => window.__qa.db.cards.get("probe"))).state, "active");
  });
  await check("An already-open active editor closes after external archive", async () => {
    await page.evaluate(() => window.__qa.store.getState().openCard("probe")); await page.locator(".card-focus-layer").waitFor();
    await page.evaluate(() => window.__qa.db.cards.update("probe", { state: "archived" }));
    await page.locator(".card-focus-layer").waitFor({ state: "detached" });
  });
  await context.close();
  const mobile = await prepare("android", { width: 390, height: 844 }); activePage = mobile.page;
  await check("Mobile navigation/tag organizer and table viewport remain usable", async () => {
    const page = mobile.page; await navigate(page, "library");
    await page.locator(".mobile-section-picker").click(); await byTag(page, "研究標籤").click();
    await page.locator(".library-organizer.is-open").waitFor({ state: "detached" });
    await page.locator(".library-card").filter({ hasText: "ArchiveProbe" }).waitFor();
    await page.screenshot({ path: path.join(output, "mobile-library.png"), fullPage: true });
    await page.getByRole("button", { name: await label(page, "database.table"), exact: true }).click();
    await page.locator(".data-table").waitFor();
    const fits = await page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1);
    assert.equal(fits, true, "Mobile must not gain page-level horizontal overflow");
    await page.screenshot({ path: path.join(output, "mobile-table.png"), fullPage: true });
  });
  await mobile.context.close(); assert.deepEqual(errors, []);
} catch (error) {
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
  throw error;
} finally {
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ checks, errors }, null, 2));
  await browser.close(); if (server) await server.close();
}
console.log(JSON.stringify({ passed: checks.length, errors }));
