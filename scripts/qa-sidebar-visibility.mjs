import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

// A fresh browser context keeps this test entirely separate from installed-app data.
const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/sidebar-visibility");
const defaultOrder = ["today", "fragments", "journal", "boards", "kanban", "brain", "library", "tasks", "highlights"];
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, locale: "zh-TW", reducedMotion: "reduce" });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
const results = [];
let activeMatrix = null;
page.on("pageerror", error => errors.push(error.message));
const menu = page.locator(".sidebar-context-menu");
const nav = id => page.locator(`.primary-nav [data-nav-id="${id}"]`);
const visibleOrder = () => page.locator(".primary-nav [data-nav-id]").evaluateAll(elements => elements.map(element => element.dataset.navId));

async function state(patch) {
  await page.evaluate(async patch => {
    const { useAppStore } = await import("/src/store.ts");
    useAppStore.setState(patch);
  }, patch);
}

async function assertOrder(expected) {
  await page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll(".primary-nav [data-nav-id]")].map(element => element.dataset.navId)) === JSON.stringify(expected), expected);
  assert.deepEqual(await visibleOrder(), expected);
}

async function hiddenItems() {
  return page.evaluate(async () => (await import("/src/store.ts")).useAppStore.getState().sidebarHiddenItems);
}

async function blankMenu({ nearBottom = false } = {}) {
  // Resolve a genuinely blank point from the fresh DOM, never click through controls.
  const point = await page.locator(".sidebar").evaluate((sidebar, nearBottom) => {
    const box = sidebar.getBoundingClientRect();
    const ys = nearBottom ? [box.bottom - 4, box.bottom - 12] : [box.top + box.height * .65, box.top + box.height * .75, box.bottom - 4];
    for (const y of ys) for (const x of [box.left + 4, box.right - 4, box.left + box.width / 2]) {
      const hit = document.elementFromPoint(x, y);
      if (hit && (hit === sidebar || sidebar.contains(hit)) && !hit.closest("button, a, input, .window-drag-region")) return { x, y };
    }
    throw new Error("No verified blank sidebar point found");
  }, nearBottom);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await menu.waitFor();
  assert.equal(await menu.getAttribute("role"), "menu");
}

async function hide(id) {
  await nav(id).click({ button: "right" });
  await menu.waitFor();
  await menu.getByRole("menuitem", { name: "隱藏此功能", exact: true }).click();
  await nav(id).waitFor({ state: "detached" });
  assert.ok((await hiddenItems()).includes(id), `${id} must be persisted as hidden`);
}

async function restoreAll() {
  await blankMenu();
  const all = menu.getByRole("menuitem", { name: "全部顯示", exact: true });
  if (await all.count()) await all.click();
  else await menu.getByRole("menuitem").first().click();
  await menu.waitFor({ state: "detached" });
  assert.deepEqual(await hiddenItems(), []);
}

async function databaseSnapshot() {
  return page.evaluate(async () => {
    const { db } = await import("/src/db.ts");
    const records = await Promise.all([db.boards.toArray(), db.cards.toArray(), db.boardNodes.toArray()]);
    return JSON.stringify(records.map(items => items.sort((a, b) => a.id.localeCompare(b.id))));
  });
}

async function menuGeometry() {
  return menu.evaluate(element => {
    const box = element.getBoundingClientRect();
    const buttons = [...element.querySelectorAll('[role="menuitem"]')];
    return {
      withinViewport: box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1,
      horizontalOverflow: element.scrollWidth - element.clientWidth,
      buttonsFit: buttons.every(button => {
        const item = button.getBoundingClientRect();
        return item.left >= box.left - 1 && item.right <= box.right + 1 && button.scrollWidth <= button.clientWidth + 1;
      }),
      background: getComputedStyle(element).backgroundColor,
    };
  });
}

async function settleMatrixLayout({ language, theme, width, height, scale, collapsed }) {
  // Store updates are synchronous, but App applies document theme/scale in effects.
  // Browser resize events also run during rendering: opening a menu before that
  // event is delivered correctly dismisses it via the app's resize handler.
  await page.waitForFunction(expected => {
    const root = document.documentElement;
    return innerWidth === expected.width && innerHeight === expected.height
      && root.dataset.theme === expected.theme && root.dataset.language === expected.language
      && Number(getComputedStyle(root).getPropertyValue("--font-scale")) === expected.scale
      && document.querySelector(".sidebar")?.classList.contains("is-collapsed") === expected.collapsed;
  }, { language, theme, width, height, scale, collapsed });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator(".sidebar-boards > button").first().waitFor();
  await state({ language: "zh-TW", theme: "dark", fontScale: 1, sidebarCollapsed: false, sidebarHiddenItems: [], sidebarOrder: defaultOrder });
  await assertOrder(defaultOrder);
  const snapshot = await databaseSnapshot();

  const helper = process.env.CHENGJING_TYPESAFE_HELPER;
  if (helper) {
    const { collectBrowserState, executeBrowserAction } = await import(path.join(helper, "src/browser-accelerator.mjs"));
    const { chooseBrowserAction, checkResult } = await import(path.join(helper, "src/decision-engine.mjs"));
    const before = await collectBrowserState(page, { goal: "開啟白板，驗證隱藏左側功能不會關閉正在使用的內容", maxCandidates: 35 });
    const decision = await chooseBrowserAction({ state: { ...before, actions: before.actions.filter(item => item.name === "白板") } });
    if (decision.candidate) await executeBrowserAction(page, decision);
    else await nav("boards").click();
    await page.locator(".workspace.view-boards").waitFor();
    const after = await collectBrowserState(page, { goal: "白板已開啟，正在使用的內容仍然可見" });
    results.push({ test: "typesafe-navigation", result: await checkResult({ state: { goal: "白板已開啟", after } }) });
  } else {
    await nav("boards").click();
    await page.locator(".workspace.view-boards").waitFor();
  }

  await hide("boards");
  await page.locator(".sidebar-boards").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(async () => (await import("/src/store.ts")).useAppStore.getState().view), "boards");
  assert.equal(await databaseSnapshot(), snapshot, "Hiding must not mutate boards or notes");
  await page.screenshot({ path: path.join(output, "hidden-current-whiteboard.png") });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".sidebar").waitFor();
  await assertOrder(defaultOrder.filter(id => id !== "boards"));
  assert.equal(await page.locator(".sidebar-boards").count(), 0);
  await blankMenu();
  assert.ok((await menu.innerText()).includes("顯示隱藏功能"));
  await page.screenshot({ path: path.join(output, "restore-whiteboard-dark.png") });
  await menu.getByRole("menuitem", { name: "顯示 白板", exact: true }).click();
  await assertOrder(defaultOrder);
  await page.locator(".sidebar-boards > button").first().waitFor();
  assert.equal(await databaseSnapshot(), snapshot);
  results.push({ test: "hide-persist-restore-preserves-current-view-and-data", passed: true });

  // A recent board must keep its original content menu, not hide the navigation.
  await page.locator(".sidebar-boards > button").first().click({ button: "right" });
  await page.locator('[data-context-menu="board"]').waitFor();
  assert.equal(await menu.count(), 0);
  await page.keyboard.press("Escape");
  results.push({ test: "recent-board-context-menu-preserved", passed: true });

  // The two menu systems must not remain stacked when keyboard focus stays on
  // navigation while a recent-board menu is already open.
  await nav("boards").focus();
  await page.locator(".sidebar-boards > button").first().click({ button: "right" });
  await page.locator('[data-context-menu="board"]').waitFor();
  await nav("boards").focus();
  assert.ok(await page.locator('[data-context-menu="board"]').isVisible());
  await page.keyboard.press("Shift+F10");
  await menu.waitFor();
  await page.locator('[data-context-menu="board"]').waitFor({ state: "detached" });
  assert.equal(await page.locator(".global-context-menu").count(), 1);
  await page.locator(".sidebar-boards > button").first().click({ button: "right" });
  await page.locator('[data-context-menu="board"]').waitFor();
  await menu.waitFor({ state: "detached" });
  assert.equal(await page.locator(".global-context-menu").count(), 1);
  await page.keyboard.press("Escape");
  results.push({ test: "sidebar-and-board-menus-never-stack", passed: true });

  await nav("kanban").dragTo(nav("today"));
  const reordered = ["kanban", "today", "fragments", "journal", "boards", "brain", "library", "tasks", "highlights"];
  await assertOrder(reordered);
  await hide("boards");
  await blankMenu();
  await menu.getByRole("menuitem", { name: "顯示 白板", exact: true }).click();
  await assertOrder(reordered);
  results.push({ test: "drag-order-survives-hide-and-restore", passed: true });

  await state({ sidebarOrder: defaultOrder });
  await assertOrder(defaultOrder);
  await hide("boards");
  await nav("journal").focus();
  await page.keyboard.press("Alt+ArrowDown");
  await assertOrder(["today", "fragments", "kanban", "journal", "brain", "library", "tasks", "highlights"]);
  await page.keyboard.press("Alt+ArrowUp");
  await assertOrder(defaultOrder.filter(id => id !== "boards"));
  await restoreAll();
  results.push({ test: "keyboard-reorder-skips-hidden-items", passed: true });

  await nav("boards").focus();
  await page.keyboard.press("Shift+F10");
  await menu.waitFor();
  assert.ok(await menu.getByRole("menuitem", { name: "隱藏此功能", exact: true }).isVisible());
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-nav-id") === "boards");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-nav-id")), "boards");
  await nav("boards").click({ button: "right" });
  await menu.waitFor();
  await page.locator(".topbar-title").click();
  await menu.waitFor({ state: "detached" });
  results.push({ test: "keyboard-menu-escape-focus-and-outside-dismiss", passed: true });

  for (const id of defaultOrder) await hide(id);
  await assertOrder([]);
  assert.ok(await page.locator(".sidebar-footer").getByRole("button", { name: "設定", exact: true }).isVisible());
  await blankMenu();
  assert.equal(await menu.getByRole("menuitem").count(), defaultOrder.length + 1);
  await page.screenshot({ path: path.join(output, "all-hidden-recovery.png") });
  await menu.getByRole("menuitem", { name: "全部顯示", exact: true }).click();
  await assertOrder(await page.evaluate(async () => (await import("/src/store.ts")).useAppStore.getState().sidebarOrder));
  results.push({ test: "all-hidden-retains-settings-and-recovery", passed: true });

  await page.locator(".sidebar").focus();
  await page.keyboard.press("Shift+F10");
  await menu.waitFor();
  assert.equal(await menu.getByRole("menuitem").count(), 0);
  assert.ok((await menu.innerText()).includes("顯示隱藏功能"));
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.classList.contains("sidebar"));
  await state({ sidebarHiddenItems: ["boards", "brain"] });
  await page.locator(".sidebar").focus();
  await page.keyboard.press("Shift+F10");
  await menu.waitFor();
  await page.keyboard.press("End");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "全部顯示");
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "顯示 白板");
  await page.keyboard.press("ArrowUp");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "全部顯示");
  await page.keyboard.press("Home");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "顯示 白板");
  await page.keyboard.press("Enter");
  await nav("boards").waitFor();
  assert.deepEqual(await hiddenItems(), ["brain"]);
  await restoreAll();
  results.push({ test: "blank-keyboard-menu-empty-state-and-arrow-navigation", passed: true });

  await state({ sidebarCollapsed: true });
  await page.locator(".sidebar.is-collapsed").waitFor();
  await hide("boards");
  await blankMenu();
  await menu.getByRole("menuitem", { name: "顯示 白板", exact: true }).click();
  await nav("boards").waitFor();
  results.push({ test: "collapsed-sidebar-hide-and-restore", passed: true });

  // Matrix covers menu anchoring, all restore actions, font scaling and translation.
  for (const language of ["zh-TW", "zh-CN", "en", "ja", "ko"]) {
    for (const theme of ["light", "dark", "ink"]) {
      for (const layout of [{ width: 1440, height: 980, scale: 1, collapsed: false }, { width: 960, height: 680, scale: 1.2, collapsed: true }]) {
        activeMatrix = { language, theme, ...layout };
        await page.setViewportSize({ width: layout.width, height: layout.height });
        await state({ language, theme, fontScale: layout.scale, sidebarCollapsed: layout.collapsed, sidebarHiddenItems: defaultOrder });
        await assertOrder([]);
        await settleMatrixLayout(activeMatrix);
        await blankMenu({ nearBottom: true });
        // Wait for the post-measurement positioning pass, then inspect fresh bounds.
        await page.waitForFunction(() => {
          const box = document.querySelector(".sidebar-context-menu")?.getBoundingClientRect();
          return box && box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
        });
        const geometry = await menuGeometry();
        assert.ok(geometry.withinViewport && geometry.buttonsFit && geometry.horizontalOverflow <= 1, JSON.stringify({ language, theme, layout, geometry }));
        assert.notEqual(geometry.background, "rgba(0, 0, 0, 0)", "Menu needs a readable opaque surface");
        results.push({ test: "translated-themed-menu-fit", language, theme, ...layout, ...geometry, passed: true });
        if (language === "en" && layout.collapsed) await page.screenshot({ path: path.join(output, `menu-${theme}-english-compact.png`) });
        await page.keyboard.press("Escape");
        await menu.waitFor({ state: "detached" });
        // Closing restores focus on the next frame; finish it before changing the
        // following fixture's layout, so focus cannot race with its newly open menu.
        await page.waitForFunction(() => document.activeElement === document.querySelector(".sidebar"));
      }
    }
  }
  assert.equal(await databaseSnapshot(), snapshot, "All visibility tests must leave content unchanged");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ cases: results.length, passed: true, errors, output }, null, 2));
} catch (error) {
  process.exitCode = 1;
  const observed = await page.evaluate(() => {
    const root = document.documentElement;
    const element = document.querySelector(".sidebar-context-menu");
    const box = element?.getBoundingClientRect();
    return {
      menuCount: document.querySelectorAll(".sidebar-context-menu").length,
      menuBounds: box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height } : null,
      innerWidth, innerHeight, language: root.dataset.language, theme: root.dataset.theme,
      fontScale: getComputedStyle(root).getPropertyValue("--font-scale").trim(),
      collapsed: document.querySelector(".sidebar")?.classList.contains("is-collapsed"),
    };
  }).catch(() => null);
  results.push({ test: "failure", matrix: activeMatrix, observed, error: error.stack });
  await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  console.error(error);
} finally {
  await fs.writeFile(path.join(output, "result.json"), JSON.stringify({ results, errors, passed: !process.exitCode }, null, 2));
  await browser.close();
}
