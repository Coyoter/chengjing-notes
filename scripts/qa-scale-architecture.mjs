import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/scale-architecture");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1680, height: 1000 }, colorScheme: "dark", locale: "zh-TW" });
await context.addInitScript(() => {
  localStorage.setItem("chengjing-community-discovery-v1", "true");
  localStorage.setItem("chengjing-community-identity-v1", JSON.stringify({ id: "scale-user", displayName: "壓測者", token: `scale-user.${"a".repeat(44)}`, seal: "#718a9a", pattern: 1 }));
});
const remoteItems = Array.from({ length: 20 }, (_, index) => ({
  id: `n-scale-${index}`,
  title: `遠方共享神經元 ${index + 1}`,
  sourceType: "fragment",
  authorName: `遠方作者 ${index + 1}`,
  seal: "#8e8f73",
  authorPattern: index + 2,
  intention: "share",
  commentCount: 0,
  createdAt: Date.now() - index * 1000,
  isOwn: false,
}));
await pageRoute(context, "https://chengjing-wish-pool.coyoter.workers.dev/v1/community/**", async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname.endsWith("/discover")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: remoteItems, refreshAt: Date.now() + 300_000 }) });
  if (url.pathname.endsWith("/notifications")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
  return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not-found" }) });
});

const page = await context.newPage();
page.setDefaultTimeout(20_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
await page.goto(base, { waitUntil: "networkidle" });

const seedMs = await page.evaluate(async () => {
  const { db } = await import("/src/db.ts");
  const recorder = globalThis.__chengjingHistoryRecorder;
  globalThis.__chengjingHistoryRecorder = undefined;
  const startedAt = performance.now();
  const now = Date.now();
  const cards = Array.from({ length: 1_200 }, (_, index) => ({
    id: `scale-card-${index}`,
    title: `壓測神經元 ${index}`,
    contentHtml: `<p>第 ${index} 組長期資料，主題 ${index % 24}，區域 ${Math.floor(index / 50)}</p>`,
    plainText: `第 ${index} 組長期資料，主題 ${index % 24}，區域 ${Math.floor(index / 50)}`,
    kind: "note",
    state: "active",
    createdAt: now - index * 60_000,
    updatedAt: now - index * 30_000,
    tagIds: [],
    favorite: index % 97 === 0,
    color: "slate",
    attachmentIds: [],
    properties: {},
    taskSyncState: "synced",
  }));
  const fragments = Array.from({ length: 400 }, (_, index) => ({ id: `scale-fragment-${index}`, text: `壓測片語 ${index}，區域 ${index % 20}`, pinned: index % 71 === 0, tagIds: [], createdAt: now - index * 20_000, updatedAt: now - index * 10_000 }));
  const tasks = Array.from({ length: 400 }, (_, index) => ({ id: `scale-task-${index}`, title: `壓測待辦 ${index}`, done: index % 5 === 0, dueAt: now + (index % 45) * 86_400_000, createdAt: now - index * 18_000, updatedAt: now - index * 9_000 }));
  const highlights = Array.from({ length: 300 }, (_, index) => ({ id: `scale-highlight-${index}`, cardId: `scale-card-${index}`, text: `壓測劃記 ${index}`, note: "", color: "amber", createdAt: now - index * 12_000 }));
  await db.transaction("rw", [db.cards, db.fragments, db.tasks, db.highlights], async () => {
    await db.cards.bulkPut(cards);
    await db.fragments.bulkPut(fragments);
    await db.tasks.bulkPut(tasks);
    await db.highlights.bulkPut(highlights);
  });
  globalThis.__chengjingHistoryRecorder = recorder;
  return performance.now() - startedAt;
});
await page.evaluate(async () => {
  const { db } = await import("/src/db.ts");
  const now = Date.now();
  await db.fragments.add({ id: "scale-history-single-change", text: "只記錄這一筆差異", pinned: false, tagIds: [], createdAt: now, updatedAt: now });
});
await page.waitForTimeout(650);

const brainStartedAt = Date.now();
await page.getByRole("button", { name: "第二大腦", exact: true }).click();
const brain = page.locator(".second-brain-page");
await brain.waitFor();
await page.waitForFunction(() => Number(document.querySelector(".second-brain-page")?.getAttribute("data-brain-nodes")) >= 2000);
await page.waitForFunction(() => Number(document.querySelector(".second-brain-page")?.getAttribute("data-brain-rendered-nodes")) === 200);
await page.waitForFunction(() => document.querySelectorAll("[data-shared-neuron-id]").length === 20);
const brainReadyMs = Date.now() - brainStartedAt;
const firstKeys = await page.locator("[data-brain-node-key]").evaluateAll((items) => items.map((item) => item.getAttribute("data-brain-node-key")));
const firstFocus = await brain.getAttribute("data-brain-viewport-focus");
await page.screenshot({ path: path.join(output, "brain-private-window-and-20-shared.png"), fullPage: true });

await page.locator(".second-brain-page canvas").click({ position: { x: 40, y: 40 } });
await page.keyboard.down("w");
await page.waitForTimeout(2_000);
await page.keyboard.up("w");
await page.waitForTimeout(600);
const movedKeys = await page.locator("[data-brain-node-key]").evaluateAll((items) => items.map((item) => item.getAttribute("data-brain-node-key")));
const movedFocus = await brain.getAttribute("data-brain-viewport-focus");
const changedPrivateWindow = firstKeys.some((key) => !movedKeys.includes(key));
const privateViewportCount = Number(await brain.getAttribute("data-brain-rendered-nodes"));
const remoteAlwaysVisible = await page.locator("[data-shared-neuron-id]").count() === 20;

const hiddenTarget = Array.from({ length: 1_200 }, (_, index) => `card:scale-card-${index}`).find((key) => !movedKeys.includes(key));
const hiddenIndex = Number(hiddenTarget?.split("-").at(-1));
const searchStartedAt = Date.now();
await page.locator(".brain-toolbar input").fill(`壓測神經元 ${hiddenIndex}`);
await page.waitForFunction((key) => [...document.querySelectorAll("[data-brain-node-key]")].some((item) => item.getAttribute("data-brain-node-key") === key), hiddenTarget);
await page.waitForTimeout(700);
const searchMs = Date.now() - searchStartedAt;
const fullSearchFindsUnloaded = await page.locator(`[data-brain-node-key="${hiddenTarget}"]`).count() === 1;
const searchFocus = await brain.getAttribute("data-brain-viewport-focus");
const searchMovesCamera = searchFocus !== movedFocus;
await page.screenshot({ path: path.join(output, "brain-1200-private-20-shared.png"), fullPage: true });

await page.getByRole("button", { name: "卡片庫", exact: true }).click();
await page.locator(".library-card").first().waitFor();
const libraryInitialRendered = await page.locator(".library-card").count();
await page.locator(".filter-bar input").fill("壓測神經元 1199");
await page.locator(".library-card").filter({ hasText: "壓測神經元 1199" }).waitFor();
const indexedLibrarySearchWorks = await page.locator(".library-card").filter({ hasText: "壓測神經元 1199" }).count() === 1;
await page.getByRole("button", { name: "資料庫", exact: true }).click();
await page.locator(".data-table").waitFor();
const databaseInitialRendered = await page.locator(".data-table tbody tr").count();
await page.getByRole("button", { name: "待辦", exact: true }).click();
await page.locator(".task-groups").waitFor();
const tasksInitialRendered = await page.locator(".task-groups article").count();
await page.getByRole("button", { name: /^隻言片語/ }).click();
await page.locator(".fragment-stream").waitFor();
const fragmentsInitialRendered = await page.locator(".fragment-stream article").count();
await page.getByRole("button", { name: "劃記", exact: true }).click();
await page.locator(".highlight-list").waitFor();
const highlightsInitialRendered = await page.locator(".highlight-card").count();

const history = await page.locator(".global-history-controls").evaluate((element) => ({
  mode: element.getAttribute("data-history-mode"),
  entries: Number(element.getAttribute("data-history-entries")),
  changedRecords: Number(element.getAttribute("data-history-changed-records")),
  hookedTables: Number(element.getAttribute("data-history-hooked-tables")),
}));
const report = {
  syntheticCards: 1_200,
  seedMs: Math.round(seedMs),
  brainReadyMs,
  privateViewportCount,
  changedPrivateWindow,
  firstFocus,
  movedFocus,
  remoteAlwaysVisible,
  fullSearchFindsUnloaded,
  searchMovesCamera,
  searchFocus,
  searchMs,
  listWindows: {
    library: libraryInitialRendered,
    database: databaseInitialRendered,
    tasks: tasksInitialRendered,
    fragments: fragmentsInitialRendered,
    highlights: highlightsInitialRendered,
  },
  indexedLibrarySearchWorks,
  history,
  errors,
};
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (privateViewportCount !== 200 || !changedPrivateWindow || !remoteAlwaysVisible || !fullSearchFindsUnloaded || !searchMovesCamera || !indexedLibrarySearchWorks || libraryInitialRendered > 120 || databaseInitialRendered > 180 || tasksInitialRendered > 240 || fragmentsInitialRendered > 160 || highlightsInitialRendered > 160 || history.mode !== "delta" || history.entries !== 1 || history.changedRecords !== 1 || history.hookedTables < 20 || errors.length) process.exitCode = 1;

async function pageRoute(targetContext, pattern, handler) {
  await targetContext.route(pattern, handler);
}
