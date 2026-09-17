import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
const output = path.resolve("qa-artifacts/fleeting-cards");
await fs.mkdir(output, { recursive: true });
const server = process.env.CHENGJING_URL ? null : await createServer({ server: { host: "127.0.0.1", port: 5199, strictPort: true } });
if (server) await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHENGJING_CHROMIUM || undefined, args: ["--no-sandbox", "--enable-unsafe-swiftshader"] });
const checks = [], errors = [];
let activePage;
async function check(name, work) { await work(); checks.push(name); console.log(`PASS ${name}`); }
async function poll(read, expected) { for (let i = 0; i < 100; i++) { if (JSON.stringify(await read()) === JSON.stringify(expected)) return; await new Promise(r => setTimeout(r, 60)); } assert.deepEqual(await read(), expected); }
async function prepare(platform, viewport) {
  const context = await browser.newContext({ viewport, locale: "zh-TW", colorScheme: "dark", reducedMotion: "reduce" });
  await context.addInitScript(platform => {
    window.chengjing = { platform, app: { getPreferredLanguage: async () => ({ language: "zh-TW" }), setLanguage: async () => {}, quit: async () => {} }, ai: { keyStatus: async () => ({ configured: false, encrypted: true }), listModels: async () => [] }, onShortcut: () => () => {} };
  }, platform);
  const page = await context.newPage(); page.setDefaultTimeout(15_000); activePage = page;
  page.on("pageerror", e => errors.push(`${platform}: ${e.message}`));
  await page.goto(process.env.CHENGJING_URL || "http://127.0.0.1:5199", { waitUntil: "networkidle" });
  await page.locator(".app-shell").waitFor();
  await page.evaluate(async () => {
    const api = await import("/src/db.ts"); const { useAppStore } = await import("/src/store.ts");
    window.__qa = { ...api, store: useAppStore };
    await api.db.transaction("rw", api.db.tables, async () => { for (const table of api.db.tables) await table.clear(); });
    const db = api.db, now = Date.now();
    await db.tags.add({ id: "tag-ai", name: "AI", color: "amber", createdAt: now });
    await db.knowledgeGroups.add({ id: "topic", name: "AI 研究", kind: "topic", order: 0, createdAt: now, updatedAt: now });
    await db.boards.add({ id: "board", title: "研究白板", description: "", tagIds: [], favorite: false, createdAt: now, updatedAt: now });
    await db.kanbanBoards.add({ id: "kanban", title: "研究看板", description: "", favorite: false, createdAt: now, updatedAt: now });
    await db.kanbanLists.add({ id: "list", boardId: "kanban", title: "待處理", order: 0, createdAt: now, updatedAt: now });
    useAppStore.getState().setLanguage("zh-TW"); useAppStore.getState().setView("fragments");
  });
  return { context, page };
}
async function nav(page, view) { await page.evaluate(view => window.__qa.store.getState().setView(view), view); await page.locator(`.view-${view}`).waitFor(); }
const fragmentRow = (page, text) => page.locator(".fragment-stream article").filter({ hasText: text });
const libraryCard = (page, text) => page.locator(".library-card").filter({ hasText: text });
async function organize(page, row, kind, target, list) {
  await row.click({ button: "right" }); await page.locator('[data-menu-action="organize"]').click();
  await page.locator(".organize-card-dialog").waitFor();
  await page.locator('[data-organize="kind"]').selectOption(kind);
  await page.locator(`[data-organize="target"] option[value="${target}"]`).waitFor({ state: "attached" });
  await page.locator('[data-organize="target"]').selectOption(target);
  if (list) { await page.locator(`[data-organize="list"] option[value="${list}"]`).waitFor({ state: "attached" }); await page.locator('[data-organize="list"]').selectOption(list); }
  await page.locator('.organize-card-dialog button[type="submit"]').click();
  await page.locator(".organize-card-dialog").waitFor({ state: "detached" });
}
try {
  const { page, context } = await prepare("darwin", { width: 1440, height: 1000 });
  let cardId;
  await check("Tagged capture is immediately a card, not a separate fragment", async () => {
    await page.locator(".fragment-capture textarea").fill("Fleeting AI tagged thought");
    await page.locator(".fragment-draft-tags .add-tag").click();
    await page.locator(".fragment-draft-tags .tag-picker-options").getByRole("button", { name: "AI", exact: true }).click();
    await page.locator(".fragment-capture footer > button").click();
    await fragmentRow(page, "Fleeting AI tagged thought").waitFor();
    const records = await page.evaluate(async () => ({ cards: await window.__qa.db.cards.toArray(), fragments: await window.__qa.db.fragments.count() }));
    assert.equal(records.cards.length, 1); assert.equal(records.fragments, 0);
    assert.deepEqual(records.cards[0].tagIds, ["tag-ai"]); assert.equal(records.cards[0].state, "inbox"); cardId = records.cards[0].id;
    assert.equal((await page.locator(".fragment-stream > header").innerText()).includes("轉成卡片"), false);
  });
  await check("Library AI filter finds same ID; editor and capture share content", async () => {
    await nav(page, "library"); await page.locator(".library-tag-section > button").filter({ hasText: "AI" }).click();
    const row = libraryCard(page, "Fleeting AI tagged thought"); await row.waitFor(); await row.click();
    await page.locator(".card-focus-layer").waitFor();
    assert.equal(await page.evaluate(() => window.__qa.store.getState().selectedCardId), cardId);
    await page.evaluate(id => window.__qa.updateFleetingText(id, "Fleeting AI edited thought"), cardId);
    await page.locator(".card-back-button").click(); await nav(page, "fragments");
    await fragmentRow(page, "Fleeting AI edited thought").waitFor();
    assert.equal(await page.evaluate(() => window.__qa.db.cards.count()), 1);
    await page.screenshot({ path: path.join(output, "desktop-capture.png"), fullPage: true });
  });
  await check("Organize to topic removes inbox row without removing library card or tags", async () => {
    const row = fragmentRow(page, "Fleeting AI edited thought");
    await organize(page, row, "topic", "topic"); await row.waitFor({ state: "detached" });
    assert.deepEqual(await page.evaluate(async id => { const c = await window.__qa.db.cards.get(id); return [c.id, c.state, c.collectionId, c.tagIds]; }, cardId), [cardId, "active", "topic", ["tag-ai"]]);
    await nav(page, "library"); await libraryCard(page, "Fleeting AI edited thought").waitFor();
  });
  await check("Existing whiteboard and kanban placements reference the original ID", async () => {
    await organize(page, libraryCard(page, "Fleeting AI edited thought"), "board", "board");
    await organize(page, libraryCard(page, "Fleeting AI edited thought"), "kanban", "kanban", "list");
    assert.deepEqual(await page.evaluate(async () => [(await window.__qa.db.boardNodes.toArray()).map(n => n.cardId), (await window.__qa.db.kanbanPlacements.toArray()).map(n => n.cardId), await window.__qa.db.cards.count()]), [[cardId], [cardId], 1]);
    await page.evaluate(() => window.__qa.store.getState().openKanbanBoard("kanban"));
    await page.locator(".project-kanban-cards > article").filter({ hasText: "Fleeting AI edited thought" }).waitFor();
  });
  await check("Add to tasks links one card, retires capture row and keeps tags", async () => {
    await page.evaluate(() => window.__qa.createFleetingCard("Task from capture", ["tag-ai"], "task-source"));
    await nav(page, "fragments"); const row = fragmentRow(page, "Task from capture"); await row.click({ button: "right" });
    assert.equal(await page.locator('[data-menu-action="to-card"]').count(), 0);
    await page.locator('[data-menu-action="to-task"]').click(); await row.waitFor({ state: "detached" });
    const tasks = await page.evaluate(() => window.__qa.db.tasks.toArray()); assert.equal(tasks.length, 1); assert.equal(tasks[0].cardId, "task-source");
    assert.deepEqual((await page.evaluate(() => window.__qa.db.cards.get("task-source"))).tagIds, ["tag-ai"]);
  });
  await check("Finish organizing, archive and trash keep single-card semantics", async () => {
    await page.evaluate(() => window.__qa.createFleetingCard("Inbox cleanup", ["tag-ai"], "cleanup"));
    const row = fragmentRow(page, "Inbox cleanup"); await row.click({ button: "right" }); await page.locator('[data-menu-action="finish-organizing"]').click(); await row.waitFor({ state: "detached" });
    await nav(page, "library"); const card = libraryCard(page, "Inbox cleanup"); await card.click({ button: "right" });
    await page.getByRole("menuitem", { name: "移到封存", exact: true }).click(); await card.waitFor({ state: "detached" });
    await nav(page, "fragments"); assert.equal(await fragmentRow(page, "Inbox cleanup").count(), 0);
    await page.evaluate(() => window.__qa.createFleetingCard("Trash capture", [], "trash-source"));
    const trash = fragmentRow(page, "Trash capture"); await trash.click({ button: "right" }); await page.locator('[data-menu-action="trash"]').click(); await trash.waitFor({ state: "detached" });
    assert.equal((await page.evaluate(() => window.__qa.db.cards.get("trash-source"))).state, "trash");
  });
  await check("Legacy records migrate on reload with tags, pin and timestamp preserved", async () => {
    await page.evaluate(() => window.__qa.db.fragments.add({ id: "legacy-ui", text: "Legacy UI capture", pinned: true, tagIds: ["tag-ai"], createdAt: 123, updatedAt: 456 }));
    await page.reload({ waitUntil: "networkidle" }); await page.locator(".app-shell").waitFor();
    await page.evaluate(async () => { const api = await import("/src/db.ts"); const { useAppStore } = await import("/src/store.ts"); window.__qa = { ...api, store: useAppStore }; useAppStore.getState().setView("fragments"); });
    await fragmentRow(page, "Legacy UI capture").waitFor();
    assert.deepEqual(await page.evaluate(async () => { const c = await window.__qa.db.cards.get("legacy-ui"); return [c.id, c.favorite, c.createdAt, c.updatedAt, c.tagIds, await window.__qa.db.fragments.count()]; }), ["legacy-ui", true, 123, 456, ["tag-ai"], 0]);
  });
  await context.close();
  const mobile = await prepare("android", { width: 390, height: 844 });
  await check("Android capture tags use the same card library", async () => {
    const p = mobile.page; await p.locator(".mobile-capture-composer textarea").fill("Mobile AI thought");
    await p.locator(".mobile-draft-tags .add-tag").click(); await p.locator(".mobile-draft-tags .tag-picker-options").getByRole("button", { name: "AI", exact: true }).click();
    await p.locator(".mobile-capture-composer footer button").click(); await p.locator(".mobile-thought-stream article").filter({ hasText: "Mobile AI thought" }).waitFor();
    assert.equal(await p.evaluate(() => window.__qa.db.fragments.count()), 0);
    await nav(p, "library"); await p.locator(".mobile-section-picker").click(); await p.locator(".library-tag-section > button").filter({ hasText: "AI" }).click();
    await libraryCard(p, "Mobile AI thought").waitFor();
    await p.screenshot({ path: path.join(output, "mobile-tag-library.png"), fullPage: true });
  });
  await check("Mobile organization dialog stays inside viewport; cancel is non-destructive", async () => {
    const p = mobile.page; await libraryCard(p, "Mobile AI thought").click({ button: "right" }); await p.locator('[data-menu-action="organize"]').click();
    const dialog = p.locator(".organize-card-dialog"); await dialog.waitFor();
    const box = await dialog.boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= 391 && box.y >= 0 && box.y + box.height <= 845);
    assert.equal(await p.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1), true);
    await p.screenshot({ path: path.join(output, "mobile-organize.png"), fullPage: true });
    await dialog.getByRole("button", { name: "取消", exact: true }).click(); await dialog.waitFor({ state: "detached" });
    assert.equal((await p.evaluate(() => window.__qa.db.cards.toArray()))[0].state, "inbox");
  });
  await mobile.context.close(); assert.deepEqual(errors, []);
} catch (error) {
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
  throw error;
} finally {
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
  await browser.close(); if (server) await server.close();
}
console.log(JSON.stringify({ passed: checks.length, errors }));
