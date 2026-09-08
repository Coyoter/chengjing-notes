// Only a new, isolated browser profile. No installed-app or cloud data.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const out = "qa-artifacts/workspace-wishes";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, locale: "zh-TW", colorScheme: "dark" });
  const page = await context.newPage(); page.setDefaultTimeout(15000); const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(process.env.CHENGJING_URL || "http://127.0.0.1:5199", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const { db, createCard } = await import("/src/db.ts");
    const { useAppStore } = await import("/src/store.ts");
    useAppStore.getState().setLanguage("zh-TW");
    await createCard({ title: "QA archived", state: "archived" });
    await createCard({ title: "QA active", state: "active" });
    for (let i = 0; i < 205; i++) await createCard({ title: `QA trash ${i}`, state: "trash" });
    const now = Date.now(); const day = 86400000;
    await db.tasks.bulkAdd([
      { id: "qa-recent", title: "QA 剛完成", done: true, completedAt: now, createdAt: now, updatedAt: now },
      { id: "qa-fading", title: "QA 完成一天半", done: true, completedAt: now - 1.5 * day, createdAt: now, updatedAt: now },
      { id: "qa-expired", title: "QA 完成超過三天", done: true, completedAt: now - 3 * day - 1000, createdAt: now, updatedAt: now },
    ]);
  });
  const nav = page.locator(".primary-nav");
  await nav.getByRole("button", { name: "資料庫", exact: true }).click();
  console.log("QA: database scopes");
  const sidebar = page.locator(".database-sidebar");
  await sidebar.getByRole("button", { name: /封存/ }).click();
  await page.locator(".data-table").getByText("QA archived", { exact: true }).waitFor();
  assert.equal(await page.locator(".data-table").getByText("QA active", { exact: true }).count(), 0);
  await sidebar.getByRole("button", { name: /垃圾桶/ }).click();
  await page.locator(".data-table tr").filter({ hasText: "QA trash" }).first().waitFor();
  assert.equal(await page.locator(".data-table tr").filter({ hasText: "QA trash" }).count(), 180);
  await page.screenshot({ path: `${out}/database-trash.png` });
  page.once("dialog", async dialog => { assert.match(dialog.message(), /205/); await dialog.dismiss(); });
  await page.getByRole("button", { name: "永久清空垃圾桶", exact: true }).click();
  assert.equal(await page.evaluate(async () => (await import("/src/db.ts")).db.cards.where("state").equals("trash").count()), 205);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "永久清空垃圾桶", exact: true }).click();
  await page.waitForFunction(async () => await (await import("/src/db.ts")).db.cards.where("state").equals("trash").count() === 0);
  assert.equal(await page.evaluate(async () => (await import("/src/db.ts")).db.cards.filter(card => card.title === "QA archived" || card.title === "QA active").count()), 2);
  await nav.getByRole("button", { name: "卡片庫", exact: true }).click();
  console.log("QA: library trash and sidebar order");
  await page.locator(".collection-tabs").getByRole("button", { name: "垃圾桶", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "永久清空垃圾桶", exact: true }).isDisabled(), true);
  await nav.locator('[data-nav-id="tasks"]').dragTo(nav.locator('[data-nav-id="today"]'));
  console.log("QA: drag result", await nav.locator("button").evaluateAll(buttons => buttons.map(button => button.getAttribute("data-nav-id"))));
  await page.waitForFunction(() => document.querySelector(".primary-nav > button")?.getAttribute("data-nav-id") === "tasks");
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await nav.locator("button").first().getAttribute("data-nav-id"), "tasks");
  await nav.locator('[data-nav-id="tasks"]').focus();
  await page.keyboard.press("Alt+ArrowDown");
  assert.equal(await nav.locator("button").first().getAttribute("data-nav-id"), "today");
  await nav.getByRole("button", { name: "第二大腦", exact: true }).click();
  console.log("QA: task fade");
  await page.locator(".second-brain-page canvas").waitFor();
  const fades = await page.evaluate(async () => {
    const { db } = await import("/src/db.ts"); const { buildBrainGraph } = await import("/src/lib/brain.ts");
    const tasks = await db.tasks.toArray();
    const graph = buildBrainGraph({ cards: [], boards: [], fragments: [], tasks, boardNodes: [], tags: [], storedEdges: [] });
    return { recent: graph.nodes.find(node => node.id === "qa-recent")?.opacity, fading: graph.nodes.find(node => node.id === "qa-fading")?.opacity, expiredHidden: !graph.nodes.some(node => node.id === "qa-expired"), retained: Boolean(await db.tasks.get("qa-expired")) };
  });
  assert.ok(fades.recent > .99 && fades.fading > .49 && fades.fading < .51 && fades.expiredHidden && fades.retained);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/task-fading.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    window.chengjing = { platform: "android", onShortcut: () => () => {} };
    document.documentElement.dataset.platform = "android";
    document.querySelector('.primary-nav [data-nav-id="database"]').click();
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/mobile-before-picker.png` });
  await page.locator(".mobile-section-picker").click();
  await sidebar.getByRole("button", { name: /垃圾桶/ }).click();
  await page.waitForTimeout(400);
  await page.waitForTimeout(400);
  const geometry = await page.locator(".empty-trash-button").evaluate(button => { const r = button.getBoundingClientRect(); return { fits: r.left >= 0 && r.right <= innerWidth, height: r.height }; });
  assert.ok(geometry.fits && geometry.height >= 44);
  assert.equal(await nav.locator("button").first().getAttribute("draggable"), "false");
  await page.screenshot({ path: `${out}/mobile-database-trash.png` });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ archiveScope: true, trash205BeyondPage: true, cancelPreservesData: true, activeAndArchivedPreserved: true, libraryTrashAction: true, desktopDragPersistent: true, keyboardReorder: true, mobileUnchanged: true, fades, geometry }));
} finally { await browser.close(); }
