import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/board-kanban");
await fs.mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 980 }, colorScheme: "dark", locale: "zh-TW" });
await context.addInitScript(() => {
  window.chengjing = {
    app: { getPreferredLanguage: async () => ({ language: "zh-TW" }), setLanguage: async () => {}, quit: async () => {} },
    ai: { keyStatus: async () => ({ configured: false, encrypted: true }), listModels: async () => [], openRouterChat: async () => ({ text: "測試", model: "test/model" }) },
    files: {
      open: async () => ({ canceled: false, files: [{ name: "白板測試圖片.png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZfXQAAAAASUVORK5CYII=" }] }),
      save: async () => ({ canceled: true }),
    },
    onShortcut: () => () => {},
    platform: "darwin",
  };
});

const page = await context.newPage();
page.setDefaultTimeout(9000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });

await page.goto(base, { waitUntil: "networkidle" });

// 白板：原地新增、不跳全畫面、可調整尺寸、檔案直接落在畫布。
await page.getByRole("button", { name: "白板", exact: true }).click();
await page.locator(".flow-card").first().waitFor();
const cardCountBefore = await page.locator(".flow-card").count();
await page.getByRole("button", { name: "新增卡片", exact: true }).click();
await page.waitForFunction((count) => document.querySelectorAll(".flow-card").length === count + 1, cardCountBefore);
const directCard = page.locator(".flow-card").filter({ hasText: "新的想法" }).last();
const directNode = directCard.locator("xpath=ancestor::*[contains(@class, 'react-flow__node-card')][1]");
const noFullscreenOnCreate = await page.locator(".card-focus-layer").count() === 0;
await directNode.click({ position: { x: 28, y: 28 } });
const resizeHandle = directNode.locator(".react-flow__resize-control.handle.bottom.right");
await resizeHandle.waitFor();
const beforeResize = await directCard.boundingBox();
const handleBox = await resizeHandle.boundingBox();
if (!beforeResize || !handleBox) throw new Error("找不到白板卡片縮放控制點");
await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
await page.mouse.down();
await page.mouse.move(handleBox.x + 105, handleBox.y + 70, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(260);
const afterResize = await directCard.boundingBox();
const cardResized = Boolean(afterResize && afterResize.width > beforeResize.width + 60 && afterResize.height > beforeResize.height + 35);
await directCard.locator(".board-card-title").fill("白板原地編輯卡片");
await page.locator(".topbar-title").click();
await page.waitForTimeout(180);

const sectionsBefore = await page.locator(".flow-section").count();
await page.getByRole("button", { name: "新增區段", exact: true }).click();
await page.waitForFunction((count) => document.querySelectorAll(".flow-section").length === count + 1, sectionsBefore);
const newSection = page.locator(".flow-section").filter({ hasText: "新的區段" }).last();
const sectionNode = newSection.locator("xpath=ancestor::*[contains(@class, 'react-flow__node-section')][1]");
await sectionNode.click({ position: { x: 40, y: 40 } });
const sectionHandle = sectionNode.locator(".react-flow__resize-control.handle.bottom.right");
const sectionBefore = await newSection.boundingBox();
const sectionHandleBox = await sectionHandle.boundingBox();
if (!sectionBefore || !sectionHandleBox) throw new Error("找不到區段縮放控制點");
await page.mouse.move(sectionHandleBox.x + sectionHandleBox.width / 2, sectionHandleBox.y + sectionHandleBox.height / 2);
await page.mouse.down(); await page.mouse.move(sectionHandleBox.x + 90, sectionHandleBox.y + 64, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(220);
const sectionAfter = await newSection.boundingBox();
const sectionResized = Boolean(sectionAfter && sectionAfter.width > sectionBefore.width + 50 && sectionAfter.height > sectionBefore.height + 30);

const mindmapsBefore = await page.locator(".mindmap-node").count();
await page.getByRole("button", { name: "新增心智圖", exact: true }).click();
await page.waitForFunction((count) => document.querySelectorAll(".mindmap-node").length === count + 1, mindmapsBefore);
await page.locator(".topbar-title").click(); await page.waitForTimeout(650);
const newMindmap = page.locator(".mindmap-node").filter({ hasText: "核心主題" }).last();
const mindmapNode = newMindmap.locator("xpath=ancestor::*[contains(@class, 'react-flow__node-mindmap')][1]");
await mindmapNode.click({ position: { x: 18, y: 18 } });
const mindmapHandle = mindmapNode.locator(".react-flow__resize-control.handle.bottom.right");
await mindmapHandle.waitFor();
const mindmapBefore = await newMindmap.boundingBox();
const mindmapHandleBox = await mindmapHandle.boundingBox();
if (!mindmapBefore || !mindmapHandleBox) throw new Error("找不到心智圖縮放控制點");
await page.mouse.move(mindmapHandleBox.x + mindmapHandleBox.width / 2, mindmapHandleBox.y + mindmapHandleBox.height / 2);
await page.mouse.down(); await page.mouse.move(mindmapHandleBox.x + 86, mindmapHandleBox.y + 54, { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(220);
const mindmapAfter = await newMindmap.boundingBox();
const mindmapResized = Boolean(mindmapAfter && mindmapAfter.width > mindmapBefore.width + 45 && mindmapAfter.height > mindmapBefore.height + 25);

const fileCardsBefore = await page.locator(".flow-card").count();
await page.getByRole("button", { name: "匯入檔案", exact: true }).click();
await page.waitForFunction((count) => document.querySelectorAll(".flow-card").length === count + 1, fileCardsBefore);
await page.locator(".flow-card-media img").last().waitFor();
await page.waitForTimeout(850);
const fileAppearsOnCanvas = true;
const noFullscreenOnImport = await page.locator(".card-focus-layer").count() === 0;
await page.screenshot({ path: path.join(output, "01-whiteboard-direct-edit.png"), fullPage: true });

// 看板：建立、原地新增、詳情、日期、標籤、附件、搜尋與跨列表拖曳。
await page.getByRole("button", { name: "看板", exact: true }).click();
await page.getByRole("button", { name: "建立第一張看板", exact: true }).click();
await page.getByPlaceholder("看板名稱").fill("網站改版專案");
await page.getByRole("button", { name: "儲存", exact: true }).click();
await page.getByText("網站改版專案", { exact: true }).first().waitFor();
const defaultListsCreated = await page.locator(".project-kanban-board > section:not(.project-kanban-add-list)").count() === 3;

const firstList = page.locator(".project-kanban-board > section").filter({ hasText: "待處理" }).first();
await firstList.getByRole("button", { name: "新增卡片", exact: true }).click();
await firstList.getByPlaceholder("輸入卡片標題…").fill("確認首頁資訊架構");
await firstList.getByRole("button", { name: "新增卡片", exact: true }).click();
const taskCard = firstList.locator("article").filter({ hasText: "確認首頁資訊架構" });
await taskCard.waitFor();
await taskCard.click();
await page.locator(".project-kanban-inspector").waitFor();

await page.getByRole("button", { name: "截止日期", exact: true }).click();
await page.locator(".task-date-presets").getByRole("button").nth(1).click();
await page.locator(".project-kanban-inspector .task-date-trigger.has-value").waitFor();
const dueDateSet = true;

await page.locator(".project-kanban-inspector .add-tag").click();
const firstAvailableTag = page.locator(".project-kanban-inspector .tag-picker-options button").first();
if (await firstAvailableTag.count()) await firstAvailableTag.click();
await page.locator(".project-kanban-inspector .tag-strip > button").first().waitFor();
const tagApplied = true;

await page.getByRole("button", { name: "加入附件", exact: true }).click();
await page.getByText("白板測試圖片.png", { exact: true }).waitFor();
const attachmentAdded = true;

await page.locator(".project-kanban-inspector > header button").click();
await page.locator(".project-kanban-tools input").fill("首頁資訊");
const searchWorks = await taskCard.isVisible();
await page.locator(".project-kanban-tools input").fill("");

const secondList = page.locator(".project-kanban-board > section").filter({ hasText: "進行中" }).first();
await taskCard.dragTo(secondList);
await page.waitForTimeout(320);
const cardMoved = await secondList.locator("article").filter({ hasText: "確認首頁資訊架構" }).isVisible();

await page.locator(".project-kanban-actions button").first().click();
await page.locator(".project-kanban-actions button.is-active").waitFor();
const boardFavorited = true;
await page.screenshot({ path: path.join(output, "02-kanban-project-flow.png"), fullPage: true });

const kanbanThemeColors = {};
for (const theme of ["dark", "ink", "light"]) {
  await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
  await page.waitForTimeout(120);
  kanbanThemeColors[theme] = await page.evaluate(() => ({ token: getComputedStyle(document.documentElement).getPropertyValue("--kanban-column").trim(), rendered: getComputedStyle(document.querySelector(".project-kanban-board > section")).backgroundColor }));
  if (theme !== "dark") await page.screenshot({ path: path.join(output, `03-kanban-${theme}.png`), fullPage: true });
}
await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });

const report = {
  whiteboard: { noFullscreenOnCreate, cardResized, sectionResized, mindmapResized, fileAppearsOnCanvas, noFullscreenOnImport },
  kanban: { defaultListsCreated, dueDateSet, tagApplied, attachmentAdded, searchWorks, cardMoved, boardFavorited, kanbanThemeColors },
  errors,
};
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();

if (!noFullscreenOnCreate || !cardResized || !sectionResized || !mindmapResized || !fileAppearsOnCanvas || !noFullscreenOnImport || !defaultListsCreated || !dueDateSet || !tagApplied || !attachmentAdded || !searchWorks || !cardMoved || !boardFavorited || kanbanThemeColors.dark.token !== "#17211d" || kanbanThemeColors.ink.token !== "#191a16" || kanbanThemeColors.light.token !== "#e5e1d7" || errors.length) process.exitCode = 1;
