import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/global-capture");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1500, height: 920 }, colorScheme: "dark", locale: "zh-TW" });
await context.addInitScript(() => {
  window.__quickCaptureQa = { clipboard: { text: "", payload: null }, hidden: 0, shortcuts: [], openAtLogin: false };
  window.chengjing = {
    app: { getPreferredLanguage: async () => ({ language: "zh-TW", preferredLanguages: ["zh-Hant-TW"] }), setLanguage: async (language) => ({ language }), getWindowState: async () => ({ fullscreen: false, maximized: false }), onWindowState: () => () => {}, getMenuSnapshot: async () => [], getSystemVersion: async () => ({ platform: "darwin", version: "27.0" }), quit: async () => ({ quitting: false }) },
    clipboard: { write: async ({ text, payload }) => { window.__quickCaptureQa.clipboard = { text, payload }; return { written: true }; }, read: async () => window.__quickCaptureQa.clipboard },
    quickCapture: { getSettings: async () => ({ shortcut: "CommandOrControl+\\", defaultShortcut: "CommandOrControl+\\", registered: true, openAtLogin: window.__quickCaptureQa.openAtLogin }), setShortcut: async (shortcut) => { window.__quickCaptureQa.shortcuts.push(shortcut); return { shortcut, registered: true }; }, setRecording: async (recording) => ({ suspended: recording }), setOpenAtLogin: async (enabled) => { window.__quickCaptureQa.openAtLogin = enabled; return { openAtLogin: enabled }; }, hide: async () => { window.__quickCaptureQa.hidden += 1; return { hidden: true }; }, showMain: async () => ({ shown: true }), onFocus: () => () => {} },
    ai: { keyStatus: async () => ({ configured: false, encrypted: true, storage: "app-local-aes-256-gcm" }), listModels: async () => [], openRouterChat: async () => ({ text: "測試", model: "test/model" }) },
    files: { open: async () => ({ canceled: true, files: [] }), save: async () => ({ canceled: true }) },
    onShortcut: () => () => {}, platform: "darwin",
  };
});
const page = await context.newPage();
page.setDefaultTimeout(10_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error" && !/ResizeObserver loop/i.test(message.text())) errors.push(`console: ${message.text()}`); });
await page.goto(base, { waitUntil: "networkidle" });

const inboxRemoved = await page.getByRole("button", { name: "收件匣", exact: true }).count() === 0;
const fragmentBadgeRemoved = await page.getByRole("button", { name: "隻言片語", exact: true }).locator(".nav-badge").count() === 0;
await page.getByRole("button", { name: /快速記錄/ }).click();
await page.getByPlaceholder("卡片標題").fill("突然想到的產品方向");
await page.getByPlaceholder("先記下核心想法，之後再慢慢整理…").fill("先做低干擾的快速入口");
const fragmentDestinationDefault = await page.getByRole("button", { name: /放到隻言片語/ }).getAttribute("class").then((value) => value?.includes("is-active"));
await page.getByRole("button", { name: "留下來", exact: true }).click();
await page.getByRole("button", { name: /^隻言片語/ }).click();
const fragment = page.locator(".fragment-stream article").filter({ hasText: "突然想到的產品方向" });
await fragment.waitFor();
await page.waitForTimeout(700);
const undo = page.locator(".global-history-controls button").first();
const redo = page.locator(".global-history-controls button").nth(1);
await undo.click();
await fragment.waitFor({ state: "detached" });
const globalUndoWorks = true;
await redo.click();
await page.locator(".fragment-stream article").filter({ hasText: "突然想到的產品方向" }).waitFor();
const globalRedoWorks = true;

const restoredFragment = page.locator(".fragment-stream article").filter({ hasText: "突然想到的產品方向" });
await restoredFragment.click({ button: "right" });
await page.getByRole("menuitem", { name: "轉成卡片", exact: true }).waitFor();
const fragmentMenuText = await page.locator('.global-context-menu[data-context-menu="fragment"]').innerText();
const fragmentActionsComplete = fragmentMenuText.includes("送到白板") && fragmentMenuText.includes("加入看板") && !fragmentMenuText.includes("貼上為新片語");
await page.getByRole("menuitem", { name: "複製文字", exact: true }).click();
const fragmentCopyWorks = await page.evaluate(() => window.__quickCaptureQa.clipboard.text.includes("突然想到的產品方向"));
const fragmentCountBeforeDirectAdd = await page.locator(".fragment-stream article").count();
await page.locator(".fragment-capture textarea").fill("從上方輸入區新增的第二則片語");
await page.locator(".fragment-capture").getByRole("button", { name: "留下來", exact: true }).click();
await page.waitForFunction((count) => document.querySelectorAll(".fragment-stream article").length === count + 1, fragmentCountBeforeDirectAdd);
await page.waitForTimeout(700);
await page.locator(".fragments-heading").click();
await page.keyboard.press("Meta+z");
await page.waitForFunction((count) => document.querySelectorAll(".fragment-stream article").length === count, fragmentCountBeforeDirectAdd);
const commandZGlobalWorks = true;
await page.keyboard.press("Meta+x");
await page.waitForFunction((count) => document.querySelectorAll(".fragment-stream article").length === count + 1, fragmentCountBeforeDirectAdd);
const commandXGlobalWorks = true;

await page.evaluate(() => document.documentElement.style.setProperty("--window-controls-safe-x", "80px"));
await page.waitForTimeout(280);
const topBarBox = await page.locator(".topbar").boundingBox();
const brandBox = await page.locator(".brand-row").boundingBox();
const logoWindowedX = (await page.locator(".brand-row > img").boundingBox())?.x || 0;
const topAlignedWindowed = Boolean(topBarBox && brandBox && Math.abs(topBarBox.y - brandBox.y) <= 0.5 && Math.abs(topBarBox.height - brandBox.height) <= 0.5 && logoWindowedX >= 90);
await page.evaluate(() => { document.documentElement.dataset.windowFullscreen = "true"; document.documentElement.style.setProperty("--window-controls-safe-x", "0px"); });
await page.waitForTimeout(120);
const logoTransitionMidX = (await page.locator(".brand-row > img").boundingBox())?.x || 0;
await page.waitForTimeout(160);
const logoFullscreenX = (await page.locator(".brand-row > img").boundingBox())?.x || 0;
const fullscreenLogoReturnsLeft = logoFullscreenX < logoWindowedX - 30;
const fullscreenLogoAnimates = logoTransitionMidX < logoWindowedX - 2 && logoTransitionMidX > logoFullscreenX + 2;

await page.getByRole("button", { name: "看板", exact: true }).click();
await page.getByRole("button", { name: "建立第一張看板", exact: true }).click();
await page.getByPlaceholder("看板名稱").fill("全域互動驗收");
await page.getByRole("button", { name: "儲存", exact: true }).click();
const firstList = page.locator(".project-kanban-board > section").first();
await firstList.getByRole("button", { name: "新增卡片", exact: true }).click();
const cardDraft = firstList.getByPlaceholder("輸入卡片標題…");
await cardDraft.fill("第一行");
await cardDraft.press("Alt+Enter");
const optionDraftValue = await cardDraft.inputValue();
const cardsAfterOption = await firstList.locator("article").count();
const optionEnterKeepsDraft = optionDraftValue.includes("\n") && cardsAfterOption === 0;
await cardDraft.press("Enter");
await page.waitForTimeout(220);
const cardsAfterEnter = await firstList.locator("article").count();
const kanbanEnterAdds = cardsAfterEnter === 1;
const kanbanCard = firstList.locator("article").first();
await kanbanCard.click();
const selectedBefore = await kanbanCard.boundingBox();
await kanbanCard.hover();
const selectedAfter = await kanbanCard.boundingBox();
const selectedCardDoesNotJump = Boolean(selectedBefore && selectedAfter && Math.abs(selectedBefore.y - selectedAfter.y) <= 0.01);
const organizerEdgeRemoved = await page.locator(".project-kanban-sidebar").evaluate((element) => getComputedStyle(element).boxShadow === "none");
const filterSpacing = await page.locator(".project-kanban-tools > div").first().evaluate((element) => { const style = getComputedStyle(element); return { gap: parseFloat(style.gap), left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight) }; });
const filterControlsComfortable = filterSpacing.gap >= 8 && filterSpacing.left >= 12 && filterSpacing.right >= 8;

await page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open("chengjing"); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const tx = db.transaction(["cards", "tasks"], "readwrite"); let cardId = ""; const cards = tx.objectStore("cards").getAll(); cards.onsuccess = () => { const card = cards.result.find((item) => String(item.title).includes("第一行")); if (!card) { tx.abort(); reject(new Error("card-missing")); return; } cardId = card.id; card.contentHtml = '<ul data-type="taskList"><li data-type="taskItem" data-task-id="qa-check" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>確認首頁內容</p></div></li></ul>'; card.plainText = "確認首頁內容"; card.updatedAt = Date.now(); tx.objectStore("cards").put(card); tx.objectStore("tasks").put({ id: `editor:${card.id}:qa-check`, title: "確認首頁內容", done: false, cardId: card.id, sourceTaskId: "qa-check", createdAt: Date.now(), updatedAt: Date.now() }); }; tx.oncomplete = () => resolve(cardId); tx.onerror = () => reject(tx.error); }; }));
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: "看板", exact: true }).click();
await page.locator(".project-kanban-cards article").filter({ hasText: "第一行" }).click();
const checklistButton = page.locator(".project-kanban-checklist button").filter({ hasText: "確認首頁內容" });
await checklistButton.waitFor();
await checklistButton.click();
await page.waitForFunction(() => document.querySelector(".project-kanban-checklist button")?.classList.contains("is-done"));
const checklistDirectToggle = true;

const cardCountBeforePaste = await page.locator(".project-kanban-cards article").count();
await page.keyboard.press("Meta+c");
await page.keyboard.press("Meta+v");
await page.waitForFunction((count) => document.querySelectorAll(".project-kanban-cards article").length > count, cardCountBeforePaste);
const kanbanCardCopyPasteWorks = true;
const listCountBeforePaste = await page.locator(".project-kanban-board > section:not(.project-kanban-add-list)").count();
await page.locator(".project-kanban-board > section").first().locator(":scope > header").click();
await page.keyboard.press("Meta+c");
await page.keyboard.press("Meta+v");
await page.waitForFunction((count) => document.querySelectorAll(".project-kanban-board > section:not(.project-kanban-add-list)").length > count, listCountBeforePaste);
const kanbanListCopyPasteWorks = true;

await page.screenshot({ path: path.join(output, "01-global-kanban.png"), fullPage: true });
await page.getByRole("button", { name: "設定", exact: true }).click();
await page.locator("#quick-capture-settings").scrollIntoViewIfNeeded();
const shortcutRecorderBefore = page.locator(".shortcut-recorder");
const shortcutCommandSymbolSingle = (await shortcutRecorderBefore.innerText()).split("⌘").length - 1 === 1 && await shortcutRecorderBefore.locator(".lucide-command").count() === 0;
await page.locator(".shortcut-recorder").click();
await page.keyboard.press("Meta+Shift+J");
await page.waitForTimeout(100);
const shortcutRecorded = await page.evaluate(() => window.__quickCaptureQa.shortcuts.at(-1) === "CommandOrControl+Shift+J");
await page.locator(".quick-capture-login-row input").check({ force: true });
const quietLoginConfigured = await page.evaluate(() => window.__quickCaptureQa.openAtLogin === true);

const quickPage = await context.newPage();
await quickPage.goto(`${base}/?quick-capture=1`, { waitUntil: "networkidle" });
const quickInput = quickPage.locator("textarea");
await quickInput.fill("選單列快速片語");
await quickInput.press("Enter");
await quickPage.waitForTimeout(450);
const quickWindowSavesAndHides = await quickPage.evaluate(() => window.__quickCaptureQa.hidden > 0);
await quickPage.screenshot({ path: path.join(output, "02-quick-capture.png"), fullPage: true });

const report = { inboxRemoved, fragmentBadgeRemoved, fragmentDestinationDefault, globalUndoWorks, globalRedoWorks, fragmentActionsComplete, fragmentMenuText, fragmentCopyWorks, commandZGlobalWorks, commandXGlobalWorks, topAlignedWindowed, fullscreenLogoReturnsLeft, fullscreenLogoAnimates, logoWindowedX, logoTransitionMidX, logoFullscreenX, kanbanEnterAdds, optionEnterKeepsDraft, optionDraftValue, cardsAfterOption, cardsAfterEnter, selectedCardDoesNotJump, organizerEdgeRemoved, filterControlsComfortable, checklistDirectToggle, kanbanCardCopyPasteWorks, kanbanListCopyPasteWorks, shortcutCommandSymbolSingle, shortcutRecorded, quietLoginConfigured, quickWindowSavesAndHides, errors };
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
if ([inboxRemoved, fragmentBadgeRemoved, fragmentDestinationDefault, globalUndoWorks, globalRedoWorks, fragmentActionsComplete, fragmentCopyWorks, commandZGlobalWorks, commandXGlobalWorks, topAlignedWindowed, fullscreenLogoReturnsLeft, fullscreenLogoAnimates, kanbanEnterAdds, optionEnterKeepsDraft, selectedCardDoesNotJump, organizerEdgeRemoved, filterControlsComfortable, checklistDirectToggle, kanbanCardCopyPasteWorks, kanbanListCopyPasteWorks, shortcutCommandSymbolSingle, shortcutRecorded, quietLoginConfigured, quickWindowSavesAndHides].some((value) => value !== true) || errors.length) process.exitCode = 1;
