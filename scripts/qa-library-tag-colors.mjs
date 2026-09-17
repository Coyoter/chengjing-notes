import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const palette = ["jade", "sky", "violet", "rose", "amber", "slate", "unknown-legacy-color"];
const output = path.resolve(process.env.CHENGJING_TAG_COLOR_QA_OUTPUT || "qa-artifacts/library-tag-colors");
const checks = [];
const errors = [];
let browser;
let activePage;
let failure;
await fs.mkdir(output, { recursive: true });
const server = await createServer({ server: { host: "127.0.0.1", port: 5203, strictPort: true } });

async function navigate(page, view) {
  await page.evaluate(async (view) => {
    const { useAppStore } = await import("/src/store.ts");
    useAppStore.getState().setView(view);
  }, view);
  await page.locator(`.view-${view}`).waitFor();
}
async function dots(locator) {
  return locator.evaluateAll((elements) => Object.fromEntries(elements.map((element) => [
    [...element.classList].find((name) => name.startsWith("tone-")).slice(5),
    getComputedStyle(element).backgroundColor,
  ])));
}
async function openOrganizer(page, mobile) {
  if (mobile && !(await page.locator(".library-organizer.is-open").count())) {
    await page.locator(".mobile-section-picker").click();
  }
  await page.locator(".library-tag-section > button").first().waitFor({ state: "visible" });
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const { db } = await import("/src/db.ts");
    // Startup reconciliation may settle the internal task sync marker on reload.
    // Compare every user-data field, but not this derived worker bookkeeping flag.
    const cards = (await db.cards.orderBy("id").toArray()).map(({ taskSyncState, ...card }) => card);
    return { tags: await db.tags.orderBy("id").toArray(), cards };
  });
}

try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHENGJING_CHROMIUM || undefined, args: ["--no-sandbox", "--enable-unsafe-swiftshader"] });
  for (const mobile of [false, true]) {
    const platform = mobile ? "android" : "darwin";
    const context = await browser.newContext({ viewport: mobile ? { width: 412, height: 915 } : { width: 1440, height: 1000 }, locale: "zh-TW", reducedMotion: "reduce", colorScheme: "light", isMobile: mobile, hasTouch: mobile });
    await context.addInitScript((platform) => {
      window.chengjing = { platform, app: { getPreferredLanguage: async () => ({ language: "zh-TW" }), setLanguage: async () => {}, quit: async () => {} }, ai: { keyStatus: async () => ({ configured: false, encrypted: true }), listModels: async () => [] }, onShortcut: () => () => {}, quickCapture: { hide: async () => {}, onFocus: () => () => {}, onNativeSubmit: () => () => {}, nativeSubmitResult: async () => {} } };
    }, platform);
    const page = await context.newPage();
    activePage = page;
    page.setDefaultTimeout(15_000);
    page.on("pageerror", (error) => errors.push(`${platform}: ${error.message}`));
    await page.goto("http://127.0.0.1:5203", { waitUntil: "networkidle" });
    await page.locator(".app-shell").waitFor();
    const captureId = await page.evaluate(async (palette) => {
      const { db, createFragment } = await import("/src/db.ts");
      const { useAppStore } = await import("/src/store.ts");
      useAppStore.getState().setLanguage("zh-TW");
      useAppStore.getState().setView("fragments");
      await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
      const now = Date.now();
      await db.tags.bulkAdd(palette.map((color) => ({ id: `qa-${color}`, name: `QA ${color}`, color, group: "custom", createdAt: now })));
      return (await createFragment("標籤顏色一致性測試", palette.map((color) => `qa-${color}`))).id;
    }, palette);
    await page.locator(`[data-capture-card-id="${captureId}"]`).waitFor();
    const original = await snapshot(page);

    for (const theme of ["light", "dark", "ink"]) {
      await page.evaluate(async (theme) => {
        const { useAppStore } = await import("/src/store.ts");
        useAppStore.getState().setTheme(theme);
      }, theme);
      await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, theme);
      await navigate(page, "fragments");
      const captureDots = page.locator(`[data-capture-card-id="${captureId}"] .shared-tag-picker > button > i`);
      await page.waitForFunction((count) => document.querySelectorAll(".fragment-stream .shared-tag-picker > button > i").length === count, palette.length);
      const expected = await dots(captureDots);
      assert.equal(Object.keys(expected).length, palette.length);
      assert.equal(new Set(palette.slice(0, 6).map((tone) => expected[tone])).size, 6, "The six supported tones must stay distinct");
      assert.equal(expected["unknown-legacy-color"], expected.jade, "Legacy fallback must match the shared picker");
      await page.screenshot({ path: path.join(output, `${platform}-${theme}-captures.png`), fullPage: true });

      const draft = page.locator(".fragment-draft-tags");
      await draft.locator(".add-tag").click();
      await draft.locator(".tag-picker-options button > i").first().waitFor();
      assert.deepEqual(await dots(draft.locator(".tag-picker-options button > i")), expected, "Shared picker options must match capture chips");
      await draft.locator(".add-tag").click();

      await navigate(page, "library");
      await openOrganizer(page, mobile);
      const libraryDots = page.locator(".library-tag-section > button > i");
      await page.waitForFunction((count) => document.querySelectorAll(".library-tag-section > button > i").length === count, palette.length);
      assert.deepEqual(await dots(libraryDots), expected, `TAG_COLOR_MISMATCH ${platform}/${theme}: library dots must match capture and picker dots`);

      for (const tone of palette) {
        await openOrganizer(page, mobile);
        const button = page.locator(".library-tag-section > button").filter({ has: page.locator(`i.tone-${tone}`) });
        const color = () => button.locator("i").evaluate((element) => getComputedStyle(element).backgroundColor);
        await button.hover();
        assert.equal(await color(), expected[tone], `Hover changed ${tone}`);
        await button.click();
        await page.waitForFunction((tone) => document.querySelector(`.library-tag-section > button[aria-pressed="true"] > i.tone-${tone}`), tone);
        await page.locator(".library-card").filter({ hasText: "標籤顏色一致性測試" }).waitFor();
        assert.equal(await page.locator(".library-card").count(), 1, "Tag filtering must still find the same capture card");
        await openOrganizer(page, mobile);
        await button.focus();
        assert.equal(await color(), expected[tone], `Selection/focus changed ${tone}`);
      }
      await page.screenshot({ path: path.join(output, `${platform}-${theme}-library.png`), fullPage: true });
      assert.deepEqual(await snapshot(page), original, "Theme, tag selection and navigation must not rewrite user data");
      checks.push({ platform, theme, colors: expected, states: ["normal", "hover", "selected", "focus"], tagFilters: palette.length });
      console.log(`PASS ${platform}/${theme}: shared colors, all tag filters, hover/selection/focus and unchanged data`);
    }
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".app-shell").waitFor();
    await navigate(page, "library");
    await openOrganizer(page, mobile);
    assert.deepEqual(await dots(page.locator(".library-tag-section > button > i")), checks.at(-1).colors, "Colors must survive reload with the saved theme");
    assert.deepEqual(await snapshot(page), original, "Reload must retain tag and card data");
    console.log(`PASS ${platform}: reload preserves colors and data`);
    await context.close();
    activePage = undefined;
  }
  assert.deepEqual(errors, [], "Unexpected browser errors");
  console.log(`PASS ${checks.length} platform/theme combinations; ${palette.length} tones (including legacy fallback); 2 reload checks`);
} catch (error) {
  failure = error.stack || String(error);
  if (activePage) await activePage.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify({ passed: !failure, checks, errors, failure }, null, 2));
  await browser?.close();
  await server.close();
}
