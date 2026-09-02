import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/employee-workday");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1540, height: 960 }, colorScheme: "dark", locale: "zh-TW" });
await context.addInitScript(() => {
  const aiCalls = [];
  const savedFiles = [];
  window.__employeeQa = { aiCalls, savedFiles };
  const encode = (value) => btoa(unescape(encodeURIComponent(value)));
  const backupSettings = { enabled: false, folderPath: "", intervalDays: 3, retentionCount: 5, lastSuccessAt: 0, lastAttemptAt: 0, nextRunAt: 0, lastFilePath: "", lastError: "" };
  window.chengjing = {
    app: { getPreferredLanguage: async () => ({ language: "zh-TW", preferredLanguages: ["zh-Hant-TW"] }), setLanguage: async (language) => ({ language }), getMenuSnapshot: async () => [], getSystemVersion: async () => ({ platform: "darwin", version: "27.0" }), quit: async () => ({ quitting: false }) },
    updates: { check: async () => ({ status: "current", currentVersion: "0.3.17", latestVersion: "0.3.17", releaseName: "澄境筆記 0.3.17", notes: "員工旅程 QA", publishedAt: "2026-08-27T00:00:00Z", htmlUrl: "https://github.com/Coyoter/chengjing-notes", asset: null }), download: async () => ({ opened: false, status: "current" }), onProgress: () => () => {} },
    backups: { getSettings: async () => backupSettings, chooseFolder: async () => ({ canceled: true, settings: backupSettings }), updateSettings: async (patch) => Object.assign(backupSettings, patch), write: async () => ({ filePath: "/tmp/employee-backup.json", filename: "employee-backup.json", writtenAt: Date.now(), settings: backupSettings }) },
    ai: {
      keyStatus: async () => ({ configured: true, encrypted: true, storage: "app-local-aes-256-gcm" }), setKey: async () => ({ configured: true, encrypted: true, storage: "app-local-aes-256-gcm" }), clearKey: async () => ({ configured: false, encrypted: true, storage: "app-local-aes-256-gcm" }), testOpenRouter: async () => ({ ok: true, label: "員工 QA", limitRemaining: null, usage: null }), listModels: async () => [],
      openRouterChat: async (request) => {
        aiCalls.push(request);
        const name = request.responseFormat?.json_schema?.name || "";
        const prompt = request.messages?.at(-1)?.content || "";
        if (name === "chengjing_action_plan") {
          const conversion = prompt.includes("全新的白板") || prompt.includes("重新拆解");
          const plan = conversion ? { summary: "把上線協調卡片拆成可執行白板", actions: [
            { type: "create_board", description: "建立 Q3 上線作戰白板", tempId: "work-board", title: "Q3 上線作戰白板", content: "產品營運的跨部門上線計畫。" },
            { type: "create_board_section", description: "建立會議決策區", tempId: "decision-section", boardRef: "work-board", title: "會議決策", x: 80, y: 80, width: 900, height: 430 },
            { type: "create_board_card", description: "建立上線範圍卡片", tempId: "scope", boardRef: "work-board", title: "上線範圍", content: "• 先開放 20% 使用者\n• 觀察登入完成率與客服回報", x: 130, y: 160 },
            { type: "create_board_card", description: "建立負責人卡片", tempId: "owner", boardRef: "work-board", title: "負責人與時程", content: "林予安負責跨部門追蹤；週五前完成風險清單。", x: 460, y: 160 },
            { type: "create_board_edge", description: "連結範圍與負責人", boardRef: "work-board", sourceRef: "scope", targetRef: "owner", label: "交付" },
          ] } : { summary: "把討論結論寫回工作空間", actions: [
            { type: "create_task", description: "新增檢查數據待辦", title: "檢查 Q3 上線後的登入完成率", dueDate: "2026-08-28" },
            { type: "append_journal", description: "追加今日決議", date: "2026-08-27", text: "AI 整理：Q3 上線先採 20% 灰度，週五檢查登入完成率。" },
            { type: "create_fragment", description: "留下風險提醒", text: "客服話術需要和灰度上線節奏同步。" },
          ] };
          return { text: JSON.stringify(plan), model: request.model, usage: null, finishReason: "stop" };
        }
        if (name) return { text: JSON.stringify({ connections: [] }), model: request.model, usage: null, finishReason: "stop" };
        return { text: "## 今日工作摘要\n\n你已經把 **Q3 上線** 拆成清楚的負責人、時程與風險。\n\n- 先做 20% 灰度\n- 追蹤登入完成率\n- 同步客服話術", model: request.model, usage: null, finishReason: "stop" };
      },
    },
    web: { read: async (url) => ({ title: "競品上線檢查清單", byline: "產品營運部", excerpt: "灰度、監控與客服協作。", content: "<h2>競品上線檢查清單</h2><p>灰度、監控與客服協作。</p>", textContent: "競品上線檢查清單：灰度、監控與客服協作。", siteName: "Example", url }) },
    files: {
      save: async (options) => { savedFiles.push({ title: options.title, defaultPath: options.defaultPath, bytes: String(options.data || "").length }); return { canceled: false, filePath: `/tmp/${options.defaultPath || "employee-export"}` }; },
      open: async (options) => options.filters?.some((item) => item.extensions?.includes("json")) ? { canceled: true, files: [] } : { canceled: false, files: [{ name: "客服回報.md", path: "/tmp/客服回報.md", data: encode("# 客服回報\n\n登入流程步驟過多，建議灰度期間觀察完成率。") }] },
    },
    onShortcut: () => () => {},
    platform: "darwin",
  };
});

const page = await context.newPage();
page.setDefaultTimeout(20_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });

async function createTag(picker, name) {
  await picker.locator(".add-tag").click();
  await picker.getByRole("button", { name: "新增標籤", exact: true }).click();
  const input = picker.getByRole("textbox", { name: "標籤名稱", exact: true });
  await input.fill(name);
  await input.press("Enter");
  await picker.getByText(name, { exact: true }).waitFor();
}

await page.goto(base, { waitUntil: "networkidle" });

// 指令搜尋與三個快捷入口
await page.locator(".search-trigger").click();
const commandShortcuts = await page.locator(".quick-command-row button").count() === 3;
await page.keyboard.press("Escape");

// 以真實工作內容建立卡片並整理
await page.getByRole("button", { name: /快速記錄/ }).click();
await page.locator(".create-card-title").fill("Q3 新功能上線協調");
await page.locator(".create-card-fields textarea").fill("09:30 與行銷、客服開會。\n先開放 20% 使用者，再追蹤登入完成率。\n週五前完成風險清單與客服話術。");
await page.getByRole("button", { name: /直接放進白板/ }).click();
await page.getByRole("button", { name: "建立卡片", exact: true }).click();
const cardPanel = page.locator(".card-editor-panel");
await cardPanel.waitFor();
await createTag(cardPanel.locator(".card-meta-line [data-tag-picker]"), "Q3 上線");
await cardPanel.getByRole("button", { name: "置頂卡片", exact: true }).click();

// 真實選字建立劃記
const highlightText = "先開放 20% 使用者";
await cardPanel.locator(".prose-editor").evaluate((editor, text) => { const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT); let node; while ((node = walker.nextNode())) { const index = node.textContent?.indexOf(text) ?? -1; if (index < 0) continue; const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + text.length); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); return true; } return false; }, highlightText);
await cardPanel.getByRole("button", { name: "將選取文字建立劃記", exact: true }).click();
await page.getByText("已標示文字並加入左側「劃記」。", { exact: true }).waitFor();

// 資訊頁新增、編輯、移除屬性（此前的死按鈕）
await cardPanel.getByRole("button", { name: "資訊", exact: true }).click();
await cardPanel.getByRole("button", { name: "新增屬性", exact: true }).click();
await cardPanel.getByRole("textbox", { name: "屬性名稱", exact: true }).fill("負責人");
await cardPanel.getByRole("textbox", { name: "屬性內容", exact: true }).fill("林予安／產品營運");
await cardPanel.getByRole("button", { name: "儲存", exact: true }).click();
await page.getByText("已新增卡片屬性。", { exact: true }).waitFor();
await cardPanel.getByRole("textbox", { name: "負責人", exact: true }).fill("林予安／產品營運與跨部門協調");
await cardPanel.getByRole("button", { name: "新增屬性", exact: true }).click();
await cardPanel.getByRole("textbox", { name: "屬性名稱", exact: true }).fill("暫存欄位");
await cardPanel.getByRole("textbox", { name: "屬性內容", exact: true }).fill("稍後刪除");
await cardPanel.getByRole("button", { name: "儲存", exact: true }).click();
await cardPanel.getByRole("button", { name: "移除屬性：暫存欄位", exact: true }).click();
await cardPanel.getByRole("textbox", { name: "暫存欄位", exact: true }).waitFor({ state: "detached" });
const propertyLifecycleWorks = await cardPanel.getByRole("textbox", { name: "負責人", exact: true }).inputValue() === "林予安／產品營運與跨部門協調" && await cardPanel.getByRole("textbox", { name: "暫存欄位", exact: true }).count() === 0;
await cardPanel.getByRole("button", { name: "返回卡片庫", exact: true }).click();

// 卡片庫置頂、網址與 Markdown 匯入
await page.getByRole("button", { name: "卡片庫", exact: true }).click();
await page.locator(".library-organizer").getByRole("button", { name: /已置頂/ }).click();
const pinnedCardVisible = await page.locator(".library-card").filter({ hasText: "Q3 新功能上線協調" }).isVisible();
await page.locator(".library-organizer").getByRole("button", { name: /所有卡片/ }).click();
await page.locator(".url-capture-bar input").fill("https://example.com/launch-checklist");
await page.getByRole("button", { name: "儲存網址", exact: true }).click();
await page.getByText(/網址已儲存/).waitFor();
await page.getByRole("button", { name: "新增卡片", exact: true }).click();
await page.locator(".create-source-tabs").getByRole("button").filter({ hasText: "檔案" }).click();
await page.getByRole("button", { name: "選擇檔案", exact: true }).click();
await cardPanel.waitFor();
const markdownImported = await cardPanel.getByText("客服回報", { exact: true }).count() > 0 || await cardPanel.locator(".card-title-input").inputValue() === "客服回報";
await cardPanel.getByRole("button", { name: "返回卡片庫", exact: true }).click();

// 隻言片語：新增、標籤、置頂、編輯、轉卡片
await page.getByRole("button", { name: /^隻言片語/ }).click();
const fragmentCapture = page.locator(".fragment-capture");
await fragmentCapture.locator("textarea").fill("客服回報登入流程太長，灰度期間要盯完成率");
await createTag(fragmentCapture.locator("[data-tag-picker]"), "客服洞察");
await fragmentCapture.getByRole("button", { name: "留下來", exact: true }).click();
const firstFragment = page.locator(".fragment-stream article").filter({ hasText: "客服回報登入流程太長" });
await firstFragment.click({ button: "right" });
await page.getByRole("menuitem", { name: "釘選片語", exact: true }).click();
await firstFragment.dblclick();
await firstFragment.locator("textarea").fill("客服回報登入流程太長；灰度期間每天 17:00 檢查完成率");
await firstFragment.locator("textarea").press("Meta+Enter");
await fragmentCapture.locator("textarea").fill("主管在意轉換率，也擔心客服量暴增");
await fragmentCapture.getByRole("button", { name: "留下來", exact: true }).click();
const secondFragment = page.locator(".fragment-stream article").filter({ hasText: "主管在意轉換率" });
await secondFragment.click({ button: "right" });
await page.getByRole("menuitem", { name: "轉成卡片", exact: true }).click();
await cardPanel.waitFor();
const fragmentConverted = await cardPanel.locator(".card-title-input").inputValue().then((value) => value.includes("主管在意轉換率"));
await cardPanel.getByRole("button", { name: "返回卡片庫", exact: true }).click();

// 待辦：期限、完成、重開與右鍵移除期限
await page.getByRole("button", { name: "待辦", exact: true }).click();
await page.getByPlaceholder("新增待辦事項…").fill("週五前完成 Q3 上線風險清單");
await page.locator(".task-add .task-date-trigger").click();
await page.locator(".task-add .task-calendar-popover").getByRole("button", { name: "明天", exact: true }).click();
await page.locator(".task-add").getByRole("button", { name: "加入", exact: true }).click();
let workTask = page.locator(".task-groups article").filter({ hasText: "週五前完成 Q3 上線風險清單" });
await workTask.waitFor();
await workTask.locator(".task-check").click();
workTask = page.locator(".task-groups article").filter({ hasText: "週五前完成 Q3 上線風險清單" });
await workTask.locator(".task-check").click();
await workTask.click({ button: "right" });
await page.getByRole("menuitem", { name: "移除期限", exact: true }).click();
await workTask.getByText("沒有期限", { exact: true }).waitFor();
const taskLifecycleWorks = await workTask.getByText("沒有期限", { exact: true }).isVisible();

// 日誌：輸入會議記錄、標籤與劃記
await page.getByRole("button", { name: "日誌", exact: true }).click();
const journal = page.locator(".journal-paper");
await journal.locator(".prose-editor").fill("Q3 上線會議記錄\n決議先開放 20% 使用者，觀察登入完成率。\n客服需在週五前完成新話術。");
const journalPicker = journal.locator(".journal-tags [data-tag-picker]");
await journalPicker.locator(".add-tag").click();
await journalPicker.getByRole("button").filter({ hasText: "Q3 上線" }).click();
const journalHighlight = "決議先開放 20% 使用者";
await journal.locator(".prose-editor").evaluate((editor, text) => { const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT); let node; while ((node = walker.nextNode())) { const index = node.textContent?.indexOf(text) ?? -1; if (index < 0) continue; const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + text.length); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); return true; } return false; }, journalHighlight);
await journal.getByRole("button", { name: "重點標示並建立劃記", exact: true }).click();
await page.getByText("已標示文字並加入左側「劃記」。", { exact: true }).waitFor();
await page.getByRole("button", { name: "劃記", exact: true }).click();
await page.locator(".highlight-card").filter({ hasText: journalHighlight }).waitFor();
const journalHighlightVisible = await page.locator(".highlight-card").filter({ hasText: journalHighlight }).isVisible();

// 右鍵卡片轉成白板，確認新白板每張卡片都有內容
await page.getByRole("button", { name: "卡片庫", exact: true }).click();
const sourceCard = page.locator(".library-card").filter({ hasText: "Q3 新功能上線協調" });
await sourceCard.click({ button: "right" });
await page.getByRole("menuitem", { name: "轉換成白板", exact: true }).click();
const aiPanel = page.locator(".ai-panel");
await aiPanel.locator(".ai-action-plan").waitFor();
await aiPanel.getByRole("button", { name: /套用 5 個變更/ }).click();
await page.locator(".board-switcher-trigger").getByText("Q3 上線作戰白板", { exact: true }).waitFor();
await page.waitForFunction(() => document.querySelectorAll(".flow-card").length === 2);
const convertedBoardHasContent = await page.locator(".flow-card").count() === 2 && await page.locator(".flow-card").evaluateAll((cards) => cards.every((card) => !card.textContent.includes("新的卡片") && !card.textContent.includes("雙擊開啟並開始編輯")));
const textCount = await page.locator(".react-flow__node-text").count();
await page.getByRole("button", { name: "新增文字", exact: true }).click();
await page.waitForFunction((count) => document.querySelectorAll(".react-flow__node-text").length === count + 1, textCount);
await page.getByRole("button", { name: "上一步", exact: true }).click();
await page.getByRole("button", { name: "下一步", exact: true }).click();
await page.screenshot({ path: path.join(output, "01-workday-board.png"), fullPage: true });

// 一般 AI 對話、Markdown、存成卡片與跨模組動作
await page.getByRole("button", { name: "AI 助理", exact: true }).click();
await aiPanel.locator("textarea").fill("請摘要今天的工作進度");
await aiPanel.getByRole("button", { name: "送出", exact: true }).click();
await aiPanel.getByRole("heading", { name: "今日工作摘要", exact: true }).waitFor();
await aiPanel.getByRole("button", { name: "存成卡片", exact: true }).click();
await cardPanel.waitFor();
const aiSavedCard = await cardPanel.locator(".card-title-input").inputValue().then((value) => value.includes("AI 整理"));
const cardLayerCoversBoardTools = await page.locator(".card-focus-layer").evaluate((layer) => { const layerZ = Number.parseInt(getComputedStyle(layer).zIndex, 10); const boardMeta = document.querySelector(".board-meta-bar"); const boardToolbar = document.querySelector(".board-toolbar"); return layerZ > Number.parseInt(getComputedStyle(boardMeta).zIndex, 10) && layerZ > Number.parseInt(getComputedStyle(boardToolbar).zIndex, 10); });
await cardPanel.getByRole("button", { name: "白板", exact: true }).click();
await page.getByRole("button", { name: "AI 助理", exact: true }).click();
await aiPanel.locator("textarea").fill("請新增檢查數據待辦、追加日誌並留下客服提醒");
await aiPanel.getByRole("button", { name: "送出", exact: true }).click();
await aiPanel.locator(".ai-action-plan").waitFor();
await aiPanel.getByRole("button", { name: /套用 3 個變更/ }).click();
await aiPanel.getByText("已完成 3 個變更。", { exact: true }).waitFor();
await page.getByRole("button", { name: "關閉 AI", exact: true }).click();

// 第二大腦與搜尋／標籤控制
await page.getByRole("button", { name: "第二大腦", exact: true }).click();
await page.locator(".second-brain-page").waitFor();
await page.waitForFunction(() => document.querySelectorAll(".brain-node-label").length >= 8);
const brainIncludesWorkday = (await page.locator(".brain-node-label").allTextContents()).some((text) => text.includes("Q3") || text.includes("客服"));
await page.locator(".brain-toolbar input").fill("Q3");
const brainSearchWorks = await page.locator(".brain-node-label").count() > 0;
await page.getByRole("button", { name: "清除搜尋", exact: true }).click();

// 資料庫：置頂、標籤與待辦三種資料共同存在
await page.getByRole("button", { name: "資料庫", exact: true }).click();
await page.locator(".database-sidebar").getByRole("button", { name: /已置頂/ }).click();
const databasePinnedWorks = await page.locator(".data-table").getByText("Q3 新功能上線協調", { exact: true }).isVisible();
await page.locator(".database-sidebar").getByRole("button", { name: /待辦/ }).click();
await page.locator(".database-task-row").filter({ hasText: "檢查 Q3 上線後的登入完成率" }).waitFor();
const databaseTaskWorks = await page.locator(".database-task-row").filter({ hasText: "檢查 Q3 上線後的登入完成率" }).isVisible();

// 設定：路由、主題、字級、語言與匯出
await page.getByRole("button", { name: "設定", exact: true }).click();
const routing = page.locator(".routing-mode-setting");
for (const mode of ["極速", "省錢", "平衡"]) await routing.getByRole("button").filter({ hasText: mode }).click();
for (const theme of ["淺色", "深色", "墨色", "跟隨系統"]) await page.locator(".theme-grid button").filter({ hasText: theme }).click();
for (const scale of ["緊湊", "舒適", "大字", "標準"]) await page.locator(".font-scale-setting button").filter({ hasText: scale }).click();
const settingsControlsWork = await routing.getByRole("button").filter({ hasText: "平衡" }).getAttribute("aria-pressed") === "true" && await page.evaluate(() => document.documentElement.dataset.fontScale === "100");
await page.locator(".backup-actions button").filter({ hasText: "完整 JSON 備份" }).click();
await page.locator(".backup-actions button").filter({ hasText: "Markdown＋附件" }).click();
await page.waitForFunction(() => window.__employeeQa.savedFiles.length >= 2);
const exportsWork = await page.evaluate(() => window.__employeeQa.savedFiles.length >= 2);
await page.screenshot({ path: path.join(output, "02-workday-settings.png"), fullPage: true });

const dataState = await page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open("chengjing"); request.onerror = () => reject(request.error); request.onsuccess = () => { const database = request.result; const read = (name) => new Promise((done) => { const query = database.transaction(name, "readonly").objectStore(name).getAll(); query.onsuccess = () => done(query.result); }); Promise.all([read("cards"), read("boards"), read("boardNodes"), read("tasks"), read("highlights"), read("fragments"), read("tags")]).then(([cards, boards, nodes, tasks, highlights, fragments, tags]) => { const source = cards.find((card) => card.title === "Q3 新功能上線協調"); const board = boards.find((item) => item.title === "Q3 上線作戰白板"); const boardCardIds = new Set(nodes.filter((node) => node.boardId === board?.id && node.cardId).map((node) => node.cardId)); resolve({ sourceReady: Boolean(source?.favorite && source.state === "active" && source.properties?.負責人 === "林予安／產品營運與跨部門協調"), boardCardsNonEmpty: cards.filter((card) => boardCardIds.has(card.id)).every((card) => card.title !== "新的卡片" && card.plainText.trim()), taskCount: tasks.filter((task) => /Q3|上線/.test(task.title)).length, highlightCount: highlights.filter((item) => /20%/.test(item.text)).length, fragmentReady: fragments.some((item) => item.pinned && item.text.includes("每天 17:00")), tagNames: tags.map((tag) => tag.name) }); }); }; }));

const report = { commandShortcuts, propertyLifecycleWorks, pinnedCardVisible, markdownImported, fragmentConverted, taskLifecycleWorks, journalHighlightVisible, convertedBoardHasContent, aiSavedCard, cardLayerCoversBoardTools, brainIncludesWorkday, brainSearchWorks, databasePinnedWorks, databaseTaskWorks, settingsControlsWork, exportsWork, dataState, aiCalls: await page.evaluate(() => window.__employeeQa.aiCalls.length), errors };
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();

if (!commandShortcuts || !propertyLifecycleWorks || !pinnedCardVisible || !markdownImported || !fragmentConverted || !taskLifecycleWorks || !journalHighlightVisible || !convertedBoardHasContent || !aiSavedCard || !cardLayerCoversBoardTools || !brainIncludesWorkday || !brainSearchWorks || !databasePinnedWorks || !databaseTaskWorks || !settingsControlsWork || !exportsWork || !dataState.sourceReady || !dataState.boardCardsNonEmpty || dataState.taskCount < 2 || dataState.highlightCount < 2 || !dataState.fragmentReady || !dataState.tagNames.includes("Q3 上線") || !dataState.tagNames.includes("客服洞察") || errors.length) process.exitCode = 1;
