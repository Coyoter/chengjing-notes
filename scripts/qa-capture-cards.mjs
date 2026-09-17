import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const output = path.resolve("qa-artifacts/capture-cards");
await fs.mkdir(output, { recursive: true });
const server = await createServer({ server: { host: "127.0.0.1", port: 5199, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHENGJING_CHROMIUM || undefined, args: ["--no-sandbox", "--enable-unsafe-swiftshader"] });
const checks = []; const errors = []; let activePage;
async function check(name, action) { await action(); checks.push(name); console.log(`PASS ${name}`); }
async function poll(read, expected) {
  for (let i = 0; i < 100; i++) { if (JSON.stringify(await read()) === JSON.stringify(expected)) return; await new Promise((resolve) => setTimeout(resolve, 75)); }
  assert.deepEqual(await read(), expected);
}
async function prepare(platform = "darwin", viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport, locale: "zh-TW", reducedMotion: "reduce", colorScheme: "dark" });
  await context.addInitScript((platform) => {
    window.chengjing = { platform, app: { getPreferredLanguage: async () => ({ language: "zh-TW" }), setLanguage: async () => {}, quit: async () => {} }, ai: { keyStatus: async () => ({ configured: false, encrypted: true }), listModels: async () => [] }, onShortcut: () => () => {}, quickCapture: { hide: async () => {}, onFocus: () => () => {}, onNativeSubmit: (callback) => { window.__nativeCapture = callback; return () => {}; }, nativeSubmitResult: async (ok) => { window.__nativeResult = ok; } } };
  }, platform);
  const page = await context.newPage(); page.setDefaultTimeout(15_000);
  page.on("pageerror", (error) => errors.push(`${platform}: ${error.message}`));
  await page.goto("http://127.0.0.1:5199", { waitUntil: "networkidle" }); await page.locator(".app-shell").waitFor();
  await page.evaluate(async () => {
    const { db, createFragment } = await import("/src/db.ts"); const { useAppStore } = await import("/src/store.ts"); const { translate } = await import("/src/i18n.ts");
    const { captureInboxCount } = await import("/src/lib/captureCards.ts");
    window.__qa = { db, store: useAppStore, createFragment, captureInboxCount, t: (key) => translate("zh-TW", key) };
    useAppStore.getState().setLanguage("zh-TW"); useAppStore.getState().setView("fragments");
    await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
    const now = Date.now();
    await db.tags.add({ id: "AI", name: "AI", color: "violet", group: "custom", createdAt: now });
    await db.knowledgeGroups.add({ id: "topic", name: "研究分類", kind: "topic", order: 0, createdAt: now, updatedAt: now });
    await db.kanbanBoards.add({ id: "kanban", title: "指定的看板", description: "", favorite: false, createdAt: now, updatedAt: now });
    await db.kanbanLists.bulkAdd([{ id: "list-a", title: "待處理", boardId: "kanban", order: 0, createdAt: now, updatedAt: now }, { id: "list-b", title: "進行中", boardId: "kanban", order: 1, createdAt: now, updatedAt: now }]);
  });
  return { page, context };
}
async function navigate(page, view) { await page.evaluate((view) => window.__qa.store.getState().setView(view), view); await page.locator(`.view-${view}`).waitFor(); }
const label = (page, key) => page.evaluate((key) => window.__qa.t(key), key);
const item = (page, id) => page.locator(`[data-capture-card-id="${id}"]`);
async function add(page, text) { return page.evaluate((text) => window.__qa.createFragment(text, ["AI"]).then((item) => item.id), text); }
async function addTag(picker) { await picker.locator(".add-tag").click(); await picker.getByRole("button", { name: "AI", exact: true }).click(); }
try {
  const { page, context } = await prepare(); activePage = page;
  let probe;
  await check("Typing a tagged thought immediately creates one library card, not a fragment copy", async () => {
    await page.locator(".fragment-capture textarea").fill("CaptureProbe 第一行\n第二行");
    await addTag(page.locator(".fragment-draft-tags"));
    await page.locator(".fragment-capture footer > button").click();
    await page.locator(".fragment-stream > article").filter({ hasText: "CaptureProbe" }).waitFor();
    probe = await page.evaluate(async () => (await window.__qa.db.cards.toArray())[0].id);
    assert.equal(await page.evaluate(() => window.__qa.db.fragments.count()), 0);
    assert.equal(await page.evaluate(() => window.__qa.db.cards.count()), 1);
    await navigate(page, "library");
    await page.locator(".library-tag-section > button").filter({ hasText: "AI" }).click();
    await page.locator(".library-card").filter({ hasText: "CaptureProbe" }).waitFor();
    assert.equal(await page.locator(".library-card").count(), 1);
    await page.screenshot({ path: path.join(output, "library-ai-tag.png"), fullPage: true });
  });
  await check("Editing the card updates the capture; pinning does not mark it organized", async () => {
    await navigate(page, "fragments"); await item(page, probe).dblclick();
    await page.locator(".card-focus-layer").waitFor();
    await page.locator(".card-title-input").fill("CaptureProbe 自訂標題");
    await page.locator(".card-title-input").press("Tab");
    const editor = page.locator('.card-focus-layer [contenteditable="true"]').first();
    await editor.fill("CaptureProbe edited content"); await editor.press("Tab");
    await poll(() => page.evaluate(async (id) => (await window.__qa.db.cards.get(id)).plainText.trim(), probe), "CaptureProbe edited content");
    await page.locator(".card-back-button").click();
    await item(page, probe).getByText("CaptureProbe edited content", { exact: true }).waitFor();
    await item(page, probe).click({ button: "right" });
    await page.getByRole("menuitem", { name: await label(page, "context.pinCard"), exact: true }).click();
    await poll(() => page.evaluate(async (id) => (await window.__qa.db.cards.get(id)).favorite, probe), true);
    assert.equal(await page.evaluate(() => window.__qa.captureInboxCount()), 1);
  });
  await check("Right-click task keeps the original card and its AI tag, without conversion", async () => {
    await item(page, probe).click({ button: "right" });
    assert.equal(await page.getByRole("menuitem", { name: "轉成卡片", exact: true }).count(), 0);
    await page.locator('[data-menu-action="to-task"]').click();
    await item(page, probe).waitFor({ state: "detached" });
    assert.deepEqual(await page.evaluate(async () => (await window.__qa.db.tasks.toArray()).map((task) => task.cardId)), [probe]);
    assert.equal(await page.evaluate(() => window.__qa.db.cards.count()), 1);
    await navigate(page, "library"); await page.locator(".library-tag-section > button").filter({ hasText: "AI" }).click();
    await page.locator(".library-card").filter({ hasText: "CaptureProbe" }).waitFor();
  });
  await check("Kanban destination and list are selected explicitly and reference the same card", async () => {
    await navigate(page, "fragments"); const id = await add(page, "KanbanCapture");
    await item(page, id).click({ button: "right" }); await page.locator('[data-menu-action="to-kanban"]').click();
    const dialog = page.getByRole("dialog", { name: "加入看板…" }); await dialog.waitFor();
    await dialog.getByLabel("選擇目的地").selectOption("kanban");
    await dialog.getByLabel("看板列表").selectOption("list-b");
    await dialog.getByRole("button", { name: "儲存", exact: true }).click();
    await page.locator(".project-kanban-cards > article").filter({ hasText: "KanbanCapture" }).waitFor();
    assert.deepEqual(await page.evaluate(async (id) => (await window.__qa.db.kanbanPlacements.where("cardId").equals(id).toArray()).map((row) => [row.cardId, row.listId]), id), [[id, "list-b"]]);
    assert.equal(await page.evaluate(() => window.__qa.db.cards.count()), 2);
    await navigate(page, "fragments"); assert.equal(await item(page, id).count(), 0);
  });
  await check("New whiteboard and topic filing keep content in the library, while cancel makes no change", async () => {
    const id = await add(page, "WhiteboardCapture");
    await item(page, id).click({ button: "right" }); await page.locator('[data-menu-action="to-whiteboard"]').click();
    let dialog = page.getByRole("dialog", { name: "加入白板…" });
    await dialog.getByLabel("選擇目的地").selectOption("__new__"); await dialog.getByLabel("名稱", { exact: true }).fill("新白板");
    await dialog.getByRole("button", { name: "儲存", exact: true }).click();
    await poll(() => page.evaluate(async (id) => window.__qa.db.boardNodes.where("cardId").equals(id).count(), id), 1);
    await navigate(page, "fragments"); const topicId = await add(page, "TopicCapture");
    await item(page, topicId).click({ button: "right" }); await page.locator('[data-menu-action="categorize"]').click();
    dialog = page.getByRole("dialog", { name: "歸入分類…" }); await dialog.getByLabel("選擇目的地").selectOption("topic");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await item(page, topicId).waitFor(); assert.equal(await page.evaluate(async (id) => (await window.__qa.db.cards.get(id)).collectionId || "", topicId), "");
    await item(page, topicId).click({ button: "right" }); await page.locator('[data-menu-action="categorize"]').click();
    dialog = page.getByRole("dialog", { name: "歸入分類…" }); await dialog.getByLabel("選擇目的地").selectOption("topic");
    await dialog.getByRole("button", { name: "儲存", exact: true }).click();
    await item(page, topicId).waitFor({ state: "detached" });
    assert.equal(await page.evaluate(async (id) => (await window.__qa.db.cards.get(id)).collectionId, topicId), "topic");
    assert.equal(await page.evaluate(() => window.__qa.db.cards.count()), 4);
  });
  await check("Archive and trash remove capture from the inbox; restore retains original ID and tags", async () => {
    const id = await add(page, "LifecycleCapture");
    await item(page, id).click({ button: "right" }); await page.getByRole("menuitem", { name: await label(page, "context.moveArchive"), exact: true }).click();
    await item(page, id).waitFor({ state: "detached" });
    await navigate(page, "library"); await page.locator(".collection-tabs").getByRole("button", { name: await label(page, "library.archive"), exact: true }).click();
    const archived = page.locator(".library-card").filter({ hasText: "LifecycleCapture" });
    await archived.click({ button: "right" }); await page.getByRole("menuitem", { name: await label(page, "context.restoreLibrary"), exact: true }).click();
    await navigate(page, "fragments"); await item(page, id).click({ button: "right" }); await page.locator('[data-menu-action="trash"]').click();
    await item(page, id).waitFor({ state: "detached" });
    await page.evaluate(async (id) => { const { restoreCardFromTrash } = await import("/src/db.ts"); await restoreCardFromTrash(id); }, id);
    await item(page, id).waitFor();
    assert.deepEqual(await page.evaluate(async (id) => (await window.__qa.db.cards.get(id)).tagIds, id), ["AI"]);
    await item(page, id).click({ button: "right" }); await page.locator('[data-menu-action="file-capture"]').click();
    await item(page, id).waitFor({ state: "detached" });
    assert.equal(await page.evaluate(async (id) => (await window.__qa.db.cards.get(id)).state, id), "active");
  });
  await check("Old fragments arriving while the app is open migrate automatically with tags and original time", async () => {
    await page.evaluate(() => window.__qa.db.fragments.add({ id: "legacy-ui", text: "LegacyCapture", tagIds: ["AI"], pinned: true, createdAt: 100, updatedAt: 200 }));
    await item(page, "legacy-ui").waitFor();
    assert.deepEqual(await page.evaluate(async () => { const c = await window.__qa.db.cards.get("legacy-ui"); return [c.tagIds, c.favorite, c.createdAt, c.updatedAt]; }), [["AI"], true, 100, 200]);
    assert.equal(await page.evaluate(() => window.__qa.db.fragments.count()), 0);
    await page.screenshot({ path: path.join(output, "desktop-capture-inbox.png"), fullPage: true });
  });
  await check("IME Enter does not save an unfinished composition", async () => {
    const before = await page.evaluate(() => window.__qa.db.cards.count());
    const input = page.locator(".fragment-capture textarea"); await input.fill("組字中");
    await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", ctrlKey: true, isComposing: true });
    assert.equal(await page.evaluate(() => window.__qa.db.cards.count()), before);
    await input.press("Control+Enter"); await poll(() => page.evaluate(() => window.__qa.db.cards.count()), before + 1);
  });
  await check("Menu-bar quick capture writes the same card store including native submit", async () => {
    const quick = await context.newPage(); quick.on("pageerror", (error) => errors.push(`quick: ${error.message}`));
    await quick.goto("http://127.0.0.1:5199/?quick-capture=1", { waitUntil: "networkidle" });
    await quick.locator(".quick-capture-shell textarea").fill("QuickCaptureProbe"); await quick.locator(".quick-capture-shell textarea").press("Enter");
    await poll(() => page.evaluate(() => window.__qa.db.cards.filter((card) => card.plainText === "QuickCaptureProbe").count()), 1);
    await quick.evaluate(() => window.__nativeCapture("NativeCaptureProbe"));
    await poll(() => page.evaluate(() => window.__qa.db.cards.filter((card) => card.plainText === "NativeCaptureProbe").count()), 1);
    assert.equal(await quick.evaluate(() => window.__nativeResult), true);
    await quick.close(); assert.equal(await page.evaluate(() => window.__qa.db.fragments.count()), 0);
  });
  await context.close();
  const mobile = await prepare("android", { width: 390, height: 844 }); activePage = mobile.page;
  await check("Android shared UI saves and tags the same card, with working filing dialog and no overflow", async () => {
    const page = mobile.page; await page.getByRole("textbox", { name: "快速記錄", exact: true }).fill("AndroidCapture");
    await addTag(page.locator(".fragment-draft-tags")); await page.getByRole("button", { name: "留下來", exact: true }).click();
    const thought = page.locator(".mobile-thought-stream article").filter({ hasText: "AndroidCapture" }); await thought.waitFor();
    assert.equal(await page.evaluate(() => window.__qa.db.cards.count()), 1); assert.equal(await page.evaluate(() => window.__qa.db.fragments.count()), 0);
    await thought.getByRole("button", { name: "更多操作", exact: true }).click(); await page.locator('[data-menu-action="to-kanban"]').click();
    const dialog = page.getByRole("dialog", { name: "加入看板…" }); await dialog.getByLabel("選擇目的地").selectOption("kanban");
    await dialog.getByLabel("看板列表").selectOption("list-b");
    const bounds = await dialog.boundingBox(); assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391);
    await page.screenshot({ path: path.join(output, "android-filing-dialog.png"), fullPage: true });
    await dialog.getByRole("button", { name: "儲存", exact: true }).click();
    await poll(() => page.evaluate(() => window.__qa.db.kanbanPlacements.count()), 1);
    await navigate(page, "library"); await page.locator(".mobile-section-picker").click();
    await page.locator(".library-tag-section > button").filter({ hasText: "AI" }).click();
    await page.locator(".library-organizer.is-open").waitFor({ state: "detached" });
    await page.locator(".library-card").filter({ hasText: "AndroidCapture" }).waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    await page.screenshot({ path: path.join(output, "android-library-tag.png"), fullPage: true });
  });
  await mobile.context.close(); assert.deepEqual(errors, []);
} catch (error) {
  if (activePage && !activePage.isClosed()) { await activePage.screenshot({ path: path.join(output, "failure.png"), fullPage: true }); await fs.writeFile(path.join(output, "failure.txt"), await activePage.locator("body").innerText()); }
  throw error;
} finally {
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ checks, errors }, null, 2));
  await browser.close(); await server.close();
}
console.log(JSON.stringify({ passed: checks.length, errors }));
