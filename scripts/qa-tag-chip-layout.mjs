import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const before = process.env.CHENGJING_TAG_LAYOUT_BEFORE === "1";
const output = path.resolve(process.env.CHENGJING_TAG_LAYOUT_OUTPUT || "qa-artifacts/tag-chip-layout");
const marker = "標籤排版回歸測試";
const tags = [
  { id: "layout-ai", name: "AI", color: "jade" },
  { id: "layout-notes", name: "澄境筆記", color: "sky" },
  { id: "layout-browser", name: "澄境瀏覽器", color: "violet" },
  { id: "layout-long", name: "非常長的中文標籤名稱需要保持單行並以省略號結尾".repeat(4), color: "rose" },
  { id: "layout-ascii", name: "VeryLongUnbrokenEnglishTagName".repeat(8), color: "amber" },
  { id: "layout-one", name: "研究與開發", color: "slate" },
  { id: "layout-two", name: "產品設計", color: "jade" },
  { id: "layout-extra", name: "待加入的標籤", color: "sky" },
];
const selected = tags.slice(0, -1);
const checks = [];
const errors = [];
let activePage;
let failure;
await fs.mkdir(output, { recursive: true });
const server = await createServer({ server: { host: "127.0.0.1", port: 5204, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHENGJING_CHROMIUM || undefined, args: ["--no-sandbox", "--enable-unsafe-swiftshader"] });

async function navigate(page, view) {
  await page.evaluate(async (view) => (await import("/src/store.ts")).useAppStore.getState().setView(view), view);
  await page.locator(`.view-${view}`).waitFor();
}
async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const { db } = await import("/src/db.ts");
    return { tags: await db.tags.orderBy("id").toArray(), cards: (await db.cards.orderBy("id").toArray()).map(({ taskSyncState, ...card }) => card) };
  });
}
async function geometry(locator) {
  return locator.evaluateAll((buttons) => buttons.map((button) => {
    const rect = (element) => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
    const label = button.querySelector(".tag-chip-label") || button;
    const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
    const lines = [];
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(walker.currentNode);
      for (const r of range.getClientRects()) if (r.width && r.height) lines.push(Math.round(r.y));
    }
    return { name: label.textContent.trim(), box: rect(button), display: getComputedStyle(button).display,
      lineCount: new Set(lines).size, label: rect(label), ellipsis: getComputedStyle(label).textOverflow,
      clipped: label.scrollWidth > label.clientWidth + 1,
      children: [...button.children].map(rect), parent: rect(button.parentElement),
      color: button.querySelector("i") ? getComputedStyle(button.querySelector("i")).backgroundColor : null,
      title: button.title };
  }));
}
async function verifyPicker(root, { truncate = true, natural = true } = {}) {
  await root.locator(":scope > button").first().waitFor();
  const rows = await geometry(root.locator(":scope > button"));
  for (const row of rows) {
    assert.ok(["flex", "inline-flex"].includes(row.display), `TAG_CHIP_LAYOUT ${row.name}: ${row.display} instead of horizontal flex`);
    assert.equal(row.lineCount, 1, `TAG_CHIP_LAYOUT ${row.name}: wrapped label`);
    assert.ok(row.box.width <= row.parent.width + 1, `TAG_CHIP_LAYOUT ${row.name}: chip exceeds its row`);
    for (const child of row.children) {
      assert.ok(child.x >= row.box.x - 1 && child.right <= row.box.right + 1 && child.y >= row.box.y - 1 && child.bottom <= row.box.bottom + 1,
        `TAG_CHIP_LAYOUT ${row.name}: contents escape the background`);
    }
  }
  if (natural) {
    const short = rows.find((row) => row.name === "AI");
    const medium = rows.find((row) => row.name === "澄境筆記");
    assert.ok(medium.box.width > short.box.width + 8, "TAG_CHIP_LAYOUT backgrounds must grow with the name");
  }
  if (truncate) {
    for (const tag of tags.slice(3, 5)) {
      const row = rows.find((item) => item.name === tag.name);
      assert.ok(row && row.clipped && row.ellipsis === "ellipsis", "TAG_CHIP_LAYOUT long names must truncate without changing stored text");
      assert.ok(row.title.includes(tag.name), "The full tag name must remain available");
    }
  }
  const [add] = await geometry(root.locator(".add-tag"));
  assert.ok(add && ["flex", "inline-flex"].includes(add.display) && add.lineCount === 1, "TAG_CHIP_LAYOUT add-tag button must be horizontal and single-line");
  for (const child of add.children) assert.ok(child.x >= add.box.x - 1 && child.right <= add.box.right + 1 && child.bottom <= add.box.bottom + 1, "TAG_CHIP_LAYOUT add icon escapes button");
  return rows;
}
async function prepare(platform) {
  const mobile = platform === "android";
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 915 } : { width: 1440, height: 1000 }, locale: "zh-TW", reducedMotion: "reduce", isMobile: mobile, hasTouch: mobile });
  await context.addInitScript((platform) => {
    window.chengjing = { platform, app: { getPreferredLanguage: async () => ({ language: "zh-TW" }), setLanguage: async () => {}, quit: async () => {} }, ai: { keyStatus: async () => ({ configured: false, encrypted: true }), listModels: async () => [] }, onShortcut: () => () => {}, quickCapture: { hide: async () => {}, onFocus: () => () => {}, onNativeSubmit: () => () => {}, nativeSubmitResult: async () => {} } };
  }, platform);
  const page = await context.newPage(); activePage = page; page.setDefaultTimeout(15_000);
  page.on("pageerror", (error) => errors.push(`${platform}: ${error.message}`));
  await page.goto("http://127.0.0.1:5204", { waitUntil: "networkidle" });
  await page.locator(".app-shell").waitFor();
  const id = await page.evaluate(async ({ tags, marker }) => {
    const { db, createFragment } = await import("/src/db.ts");
    const { useAppStore } = await import("/src/store.ts");
    useAppStore.getState().setLanguage("zh-TW"); useAppStore.getState().setView("fragments");
    await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
    await db.tags.bulkAdd(tags.map((tag) => ({ ...tag, group: "custom", createdAt: Date.now() })));
    return (await createFragment(marker, tags.slice(0, -1).map((tag) => tag.id))).id;
  }, { tags, marker });
  const capture = page.locator(mobile ? ".mobile-thought-stream > article" : `[data-capture-card-id="${id}"]`).filter({ hasText: marker });
  await capture.waitFor(); await capture.locator(".shared-tag-picker > button").nth(selected.length - 1).waitFor();
  return { context, page, capture, id, mobile };
}
try {
  for (const platform of before ? ["android"] : ["android", "darwin"]) {
    const { context, page, capture, id, mobile } = await prepare(platform);
    const original = await snapshot(page);
    const widths = before ? [390] : mobile ? [320, 390, 412, 768] : [960, 1440];
    for (const width of widths) for (const theme of before ? ["dark"] : ["light", "dark", "ink"]) for (const scale of before ? [1] : [1, 1.3]) {
      await page.setViewportSize({ width, height: mobile ? 915 : 1000 });
      await page.evaluate(async ({ theme, scale }) => (await import("/src/store.ts")).useAppStore.setState({ theme, fontScale: scale }), { theme, scale });
      await page.waitForFunction((theme) => document.documentElement.dataset.theme === theme, theme); await settle(page);
      if (before || (width === 390 || width === 1440) && theme === "dark" && scale === 1) await page.screenshot({ path: path.join(output, `${platform}-${width}-${theme}.png`), fullPage: true });
      const rows = await verifyPicker(capture.locator(".shared-tag-picker"));
      if (mobile) {
        assert.ok(new Set(rows.map((row) => Math.round(row.box.y))).size > 1, "Whole chips should wrap onto subsequent rows");
        const bottom = await capture.evaluate((el) => el.getBoundingClientRect().bottom);
        assert.ok(rows.every((row) => row.box.bottom <= bottom + 1), "Tag chips must not overlap the next thought");
      }
      checks.push({ platform, width, theme, scale, chips: rows.length });
    }
    await page.setViewportSize({ width: mobile ? 390 : 1440, height: mobile ? 915 : 1000 });
    for (const language of ["zh-TW", "zh-CN", "en", "ja", "ko"]) {
      await page.evaluate(async (language) => (await import("/src/store.ts")).useAppStore.setState({ language, fontScale: 1, theme: "dark" }), language);
      await settle(page); await verifyPicker(capture.locator(".shared-tag-picker"));
      const [add] = await geometry(page.locator(".fragment-draft-tags .add-tag"));
      assert.equal(add.lineCount, 1, `Draft add-tag wraps in ${language}`);
      checks.push({ platform, language, draftAndSaved: true });
    }
    assert.deepEqual(await snapshot(page), original, "Layout, language and theme changes must not modify cards or tags");
    await page.evaluate(async () => (await import("/src/store.ts")).useAppStore.getState().setLanguage("zh-TW"));
    const picker = capture.locator(".shared-tag-picker");
    await picker.locator(".add-tag").click();
    await picker.locator(".tag-picker-options > button").filter({ hasText: tags.at(-1).name }).click();
    const added = picker.locator(":scope > button").filter({ hasText: tags.at(-1).name }); await added.waitFor();
    await verifyPicker(picker); await added.click(); await added.waitFor({ state: "detached" });
    const current = await snapshot(page);
    assert.deepEqual(current.tags, original.tags, "Removing a chip must not delete or recolor its tag");
    assert.deepEqual(current.cards.map((card) => card.tagIds), original.cards.map((card) => card.tagIds));
    const draft = page.locator(".fragment-draft-tags");
    await draft.locator(".add-tag").click();
    const option = draft.locator(".tag-picker-options > button").filter({ hasText: tags[3].name }); await option.waitFor();
    const [optionRow] = await geometry(option);
    assert.ok(optionRow.lineCount === 1 && optionRow.clipped && optionRow.ellipsis === "ellipsis", "Long dropdown options must also truncate");
    await option.click(); await verifyPicker(draft, { truncate: false, natural: false });
    await draft.locator(":scope > button").click();
    await page.reload({ waitUntil: "networkidle" }); await navigate(page, "fragments");
    await capture.waitFor(); await picker.locator(":scope > button").nth(selected.length - 1).waitFor(); await verifyPicker(picker);
    await navigate(page, "library");
    if (mobile) await page.locator(".mobile-section-picker").click();
    await page.locator(".library-tag-section > button").filter({ hasText: "AI" }).click();
    const libraryCard = page.locator(".library-card").filter({ hasText: marker }); await libraryCard.waitFor();
    await libraryCard.click(); await page.locator(".card-focus-layer").waitFor();
    await verifyPicker(page.locator(".card-meta-line .shared-tag-picker"));
    await page.screenshot({ path: path.join(output, `${platform}-card-editor.png`), fullPage: true });
    assert.equal(await page.evaluate(async (id) => (await (await import("/src/db.ts")).db.cards.get(id)).plainText, id), marker);
    checks.push({ platform, addRemove: true, draft: true, dropdown: true, reload: true, libraryFilter: true, cardEditor: true });
    console.log(`PASS ${platform}: responsive geometry, languages, ellipsis, draft/saved/editor, add/remove, filtering and reload`);
    await context.close(); activePage = undefined;
  }
  assert.deepEqual(errors, []);
  console.log(`PASS ${checks.length} tag-chip layout scenarios`);
} catch (error) {
  failure = error.stack || String(error);
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
    await fs.writeFile(path.join(output, "failure.txt"), await activePage.locator("body").innerText()).catch(() => {});
  }
  throw error;
} finally {
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify({ passed: !failure, checks, errors, failure }, null, 2));
  await browser.close(); await server.close();
}
