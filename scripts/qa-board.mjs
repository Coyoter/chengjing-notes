import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/board-v2");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", locale: "zh-TW" });
const page = await context.newPage();
page.setDefaultTimeout(8000);
const errors = [];
let phase = "載入白板";
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error" || (message.type() === "warning" && /React Flow|NaN|ResizeObserver/i.test(message.text()))) errors.push(`${phase} console-${message.type()}: ${message.text()}`); });
await page.goto(base, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "白板", exact: true }).click();
await page.locator(".flow-card").first().waitFor();
await page.waitForTimeout(240);

await page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open("chengjing");
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const transaction = request.result.transaction("cards", "readwrite");
    const store = transaction.objectStore("cards");
    const query = store.get("card-writing");
    query.onsuccess = () => store.put({ ...query.result, plainText: "• 保留關鍵決策 • 明確標示風險 • 列出下一步", updatedAt: Date.now() });
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error);
  };
}));
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: "白板", exact: true }).click();
await page.locator(".flow-card").first().waitFor();
await page.waitForTimeout(350);
const structuredCard = page.locator(".flow-card").filter({ hasText: "安裝教學文章架構" });
await structuredCard.locator(".flow-card-preview .is-bullet").nth(2).waitFor();
const bulletLayout = await structuredCard.locator(".flow-card-preview .is-bullet").evaluateAll((items) => ({ count: items.length, tops: items.map((item) => Math.round(item.getBoundingClientRect().top)), texts: items.map((item) => item.textContent?.trim()) }));
const bulletsUseSeparateLines = bulletLayout.count === 3 && new Set(bulletLayout.tops).size === 3 && bulletLayout.texts.every(Boolean);

const handleMetrics = await page.locator('.easy-handle[data-nodeid="node-welcome"]').first().evaluate((element) => {
  const style = getComputedStyle(element);
  return { width: parseFloat(style.width), height: parseFloat(style.height), opacity: parseFloat(style.opacity) };
});
const handlesPerCard = await page.locator('.easy-handle[data-nodeid="node-welcome"]').count();
const hoverTarget = page.locator('.easy-handle[data-nodeid="node-welcome"][data-handleid="right"]');
const handleBoxBefore = await hoverTarget.boundingBox();
await hoverTarget.hover({ force: true });
await page.waitForTimeout(180);
const handleBoxAfter = await hoverTarget.boundingBox();
const handleCenterShift = handleBoxBefore && handleBoxAfter ? Math.hypot(
  handleBoxBefore.x + handleBoxBefore.width / 2 - handleBoxAfter.x - handleBoxAfter.width / 2,
  handleBoxBefore.y + handleBoxBefore.height / 2 - handleBoxAfter.y - handleBoxAfter.height / 2,
) : Number.POSITIVE_INFINITY;
const handleHoverShadow = await hoverTarget.evaluate((element) => getComputedStyle(element).boxShadow);
await page.locator(".topbar-title").hover();
await page.waitForTimeout(180);
const cardVisual = await page.locator(".flow-card").evaluateAll((cards) => ({
  backgrounds: [...new Set(cards.map((card) => getComputedStyle(card).backgroundColor))],
  borders: [...new Set(cards.map((card) => getComputedStyle(card).borderTopColor))],
  beforeContent: getComputedStyle(cards[0], "::before").content,
}));

const toolbar = await page.locator(".board-toolbar").boundingBox();
await page.locator(".board-switcher-trigger").click();
const boardMenu = await page.locator(".board-switcher-menu").boundingBox();
const toolbarMenuSeparated = Boolean(toolbar && boardMenu && (toolbar.y + toolbar.height < boardMenu.y || boardMenu.y + boardMenu.height < toolbar.y));
await page.locator(".board-switcher-trigger").click();

const tooltipChecks = [];
for (const button of await page.locator(".board-toolbar button").all()) {
  await button.hover();
  await page.waitForTimeout(150);
  tooltipChecks.push(await button.evaluate((element) => ({ label: element.getAttribute("aria-label"), content: getComputedStyle(element, "::after").content, opacity: getComputedStyle(element, "::after").opacity })));
}

phase = "白板搜尋";
await page.getByRole("button", { name: "搜尋目前白板" }).click();
await page.locator(".board-search-panel input").fill("Gemma");
const searchResultVisible = await page.locator(".board-search-panel").getByText("Gemma 4 本機模式", { exact: true }).isVisible();
await page.locator(".board-search-panel").getByText("Gemma 4 本機模式", { exact: true }).click();
await page.locator(".board-search-panel").waitFor({ state: "detached" });
await page.waitForTimeout(520);

phase = "拖曳連線";
let edgeCount = await page.locator(".react-flow__edge").count();
const sourceHandle = page.locator('.easy-handle[data-nodeid="node-welcome"][data-handleid="right"]');
const targetHandle = page.locator('.easy-handle[data-nodeid="node-gemma"][data-handleid="left"]');
const sourceBox = await sourceHandle.boundingBox();
const targetBox = await targetHandle.boundingBox();
if (!sourceBox || !targetBox) throw new Error("找不到關係線拖曳端點");
await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
await page.mouse.down();
await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 16 });
await page.mouse.up();
await page.waitForFunction((count) => document.querySelectorAll(".react-flow__edge").length > count, edgeCount);
await page.locator(".board-status.is-success").waitFor();
const dragConnectionCreated = true;
edgeCount = await page.locator(".react-flow__edge").count();
await page.waitForTimeout(320);
await page.getByRole("button", { name: "上一步", exact: true }).click();
await page.waitForFunction((count) => document.querySelectorAll(".react-flow__edge").length === count - 1, edgeCount);
const undoButtonWorks = true;
await page.getByRole("button", { name: "下一步", exact: true }).click();
await page.waitForFunction((count) => document.querySelectorAll(".react-flow__edge").length === count, edgeCount);
const redoButtonWorks = true;
await page.waitForTimeout(220);
await page.locator(".board-canvas").focus();
await page.keyboard.press("Meta+z");
await page.waitForFunction((count) => document.querySelectorAll(".react-flow__edge").length === count - 1, edgeCount);
await page.keyboard.press("Meta+x");
await page.waitForFunction((count) => document.querySelectorAll(".react-flow__edge").length === count, edgeCount);
const historyShortcutsWork = true;

phase = "點選連線";
await page.getByRole("button", { name: "建立關係線", exact: true }).click();
await page.locator('.react-flow__node[data-id="node-welcome"]').click();
await page.locator('.react-flow__node[data-id="node-writing"]').click();
await page.waitForFunction((count) => document.querySelectorAll(".react-flow__edge").length > count, edgeCount);
await page.locator(".board-status.is-success").waitFor();
const clickConnectionCreated = true;

const pane = page.locator(".react-flow__pane");
const paneBox = await pane.boundingBox();
if (!paneBox) throw new Error("找不到白板畫布");
phase = "右鍵與心智圖";
await page.mouse.click(paneBox.x + paneBox.width * 0.72, paneBox.y + paneBox.height * 0.68, { button: "right" });
await page.getByText("在這裡新增", { exact: true }).waitFor();
const paneContextVisible = await page.locator(".board-context-menu").getByRole("button", { name: /心智圖/ }).isVisible();
await page.screenshot({ path: path.join(output, "01-pane-context-menu.png"), fullPage: true });
const mindmapBefore = await page.locator(".mindmap-node").count();
await page.locator(".board-context-menu").getByRole("button", { name: /心智圖/ }).click();
await page.waitForFunction((count) => document.querySelectorAll(".mindmap-node").length > count, mindmapBefore);
const root = page.locator(".mindmap-node").last();
await root.locator(".mindmap-title").fill("新版心智圖");
const childBefore = await page.locator(".mindmap-node").count();
await root.locator(".mindmap-add-child").click();
await page.waitForFunction((count) => document.querySelectorAll(".mindmap-node").length > count, childBefore);
const mindmapQuickBranch = await page.locator(".mindmap-node").count() === childBefore + 1;

await root.click({ button: "right" });
await page.getByText("心智圖節點", { exact: true }).waitFor();
const nodeContextItems = await page.locator(".board-context-menu > button").allTextContents();
await page.screenshot({ path: path.join(output, "02-mindmap-context-menu.png"), fullPage: true });
await page.keyboard.press("Escape");

phase = "關係線右鍵";
await page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open("chengjing"); request.onerror = () => reject(request.error); request.onsuccess = () => { const transaction = request.result.transaction("boardEdges", "readwrite"); transaction.objectStore("boardEdges").put({ id: "qa-edge-label", boardId: "board-welcome", source: "node-welcome", target: "node-writing" }); transaction.oncomplete = () => resolve(true); transaction.onerror = () => reject(transaction.error); }; }));
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: "白板", exact: true }).click();
await page.locator(".flow-card").first().waitFor();
await page.getByRole("button", { name: "顯示全部內容", exact: true }).click();
await page.waitForTimeout(320);
const lastEdge = page.locator('.react-flow__edge[data-id="qa-edge-label"]');
await lastEdge.dispatchEvent("contextmenu", { button: 2, clientX: 780, clientY: 430, bubbles: true });
await page.getByText("關係線", { exact: true }).waitFor();
const edgeLabelInput = page.locator(".edge-label-form input");
await edgeLabelInput.fill("剪下仍是文字編輯");
await edgeLabelInput.press("Meta+a");
await edgeLabelInput.press("Meta+x");
const commandXPreservesTextCut = await edgeLabelInput.inputValue() === "";
await edgeLabelInput.fill("測試關係");
await page.locator(".edge-label-form button").click();
const smartLabel = page.locator(".smart-edge-label").filter({ hasText: "測試關係" });
await smartLabel.waitFor();
const labelBox = await smartLabel.boundingBox();
const boardPaneBox = await page.locator(".react-flow__pane").boundingBox();
const solidNodeBoxes = await page.locator(".react-flow__node-card, .react-flow__node-text, .react-flow__node-mindmap").evaluateAll((items) => items.filter((item) => getComputedStyle(item).display !== "none").map((item) => { const box = item.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }; }));
const edgeLabelAvoidsContent = Boolean(labelBox) && solidNodeBoxes.every((box) => labelBox.x + labelBox.width <= box.left || labelBox.x >= box.right || labelBox.y + labelBox.height <= box.top || labelBox.y >= box.bottom);
const edgeLabelVisibleOnCanvas = Boolean(labelBox && boardPaneBox) && labelBox.x >= boardPaneBox.x && labelBox.y >= boardPaneBox.y && labelBox.x + labelBox.width <= boardPaneBox.x + boardPaneBox.width && labelBox.y + labelBox.height <= boardPaneBox.y + boardPaneBox.height;
const edgeContextWorks = true;

const failurePage = await context.newPage();
failurePage.setDefaultTimeout(8000);
failurePage.on("pageerror", (error) => errors.push(`failure-page: ${error.message}`));
await failurePage.goto(base, { waitUntil: "networkidle" });
await failurePage.getByRole("button", { name: "白板", exact: true }).click();
await failurePage.locator(".flow-card").first().waitFor();
await failurePage.getByRole("button", { name: "建立關係線", exact: true }).click();
await failurePage.locator('.react-flow__node[data-id="node-welcome"]').click();
await failurePage.locator(".react-flow__pane").click({ position: { x: 26, y: 70 }, force: true });
await failurePage.getByText(/沒有連上/).waitFor();
const failedConnectionFeedback = true;
await failurePage.close();

await page.screenshot({ path: path.join(output, "03-board-final.png"), fullPage: true });
const report = {
  handleMetrics,
  handlesPerCard,
  handleCenterShift,
  handleHoverShadow,
  cardVisual,
  bulletsUseSeparateLines,
  toolbarMenuSeparated,
  tooltipChecks,
  searchResultVisible,
  dragConnectionCreated,
  undoButtonWorks,
  redoButtonWorks,
  historyShortcutsWork,
  commandXPreservesTextCut,
  clickConnectionCreated,
  paneContextVisible,
  mindmapQuickBranch,
  nodeContextItems,
  edgeContextWorks,
  edgeLabelAvoidsContent,
  edgeLabelVisibleOnCanvas,
  failedConnectionFeedback,
  errors,
};
await fs.writeFile(path.join(output, "board-summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();

if (
  handleMetrics.width < 18 || handleMetrics.height < 18 || handlesPerCard !== 4 || handleCenterShift > 0.5 || handleHoverShadow === "none" || cardVisual.backgrounds.length !== 1 || !bulletsUseSeparateLines ||
  !toolbarMenuSeparated || tooltipChecks.some((item) => !item.label || item.content === "none" || item.opacity !== "1") ||
  !searchResultVisible || !dragConnectionCreated || !undoButtonWorks || !redoButtonWorks || !historyShortcutsWork || !commandXPreservesTextCut || !clickConnectionCreated || !paneContextVisible || !mindmapQuickBranch ||
  !nodeContextItems.some((item) => item.includes("新增子節點")) || !edgeContextWorks || !edgeLabelAvoidsContent || !edgeLabelVisibleOnCanvas || !failedConnectionFeedback || errors.length
) process.exitCode = 1;
