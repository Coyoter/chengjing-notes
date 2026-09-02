import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/ai-actions");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1480, height: 920 }, colorScheme: "dark", locale: "zh-TW" });
await context.addInitScript(() => {
  const calls = [];
  window.__aiActionsQa = calls;
  const progressListeners = new Set();
  window.chengjing = {
    app: { getPreferredLanguage: async () => ({ language: "zh-TW", preferredLanguages: ["zh-Hant-TW"] }), setLanguage: async (language) => ({ language }) },
    updates: { check: async () => ({ status: "current", currentVersion: "0.2.10", latestVersion: "0.2.10", releaseName: "澄境筆記 0.2.10", notes: "", publishedAt: "", htmlUrl: "", asset: null }), download: async () => ({ opened: false, status: "current" }), onProgress: (callback) => { progressListeners.add(callback); return () => progressListeners.delete(callback); } },
    ai: {
      keyStatus: async () => ({ configured: true, encrypted: true, storage: "app-local-aes-256-gcm" }), setKey: async () => ({ configured: true, encrypted: true, storage: "app-local-aes-256-gcm" }), clearKey: async () => ({ configured: false, encrypted: true, storage: "app-local-aes-256-gcm" }), testOpenRouter: async () => ({ ok: true, label: "QA", limitRemaining: null, usage: null }), listModels: async () => [], embeddings: async () => ({ embeddings: [[1, 0]], model: "qa", usage: null }),
      openRouterChat: async (request) => {
        calls.push(request);
        const prompt = request.messages.at(-1)?.content || "";
        const targets = window.__aiActionUpdateTargets || {};
        const plan = prompt.includes("repair_board_action_fields") ? { summary: "保留原卡片，拆解成全新的視覺白板", actions: [
          { type: "create_board", description: "建立 AI 吵架王架構白板", tempId: "converted-board", title: "AI 吵架王架構", content: "從原卡片拆解出的核心概念與下一步。" },
          { type: "create_board_section", description: "建立核心脈絡區段", tempId: "core-section", boardRef: "converted-board", title: "核心脈絡", x: 80, y: 80, width: 1040, height: 520 },
          { type: "create_board_card", description: "建立產品核心卡片", tempId: "product-core", boardRef: "converted-board", title: "產品核心", content: "• 以 AI 協助生成回覆\n• 支援瀏覽器與 Android 使用情境", x: 130, y: 160 },
          { type: "create_board_card", description: "建立模型選擇卡片", tempId: "model-choice", boardRef: "converted-board", title: "模型選擇", content: "OpenRouter 提供彈性；Gemma 4 讓內容留在本機。", x: 450, y: 160 },
          { type: "create_board_card", description: "建立下一步卡片", tempId: "next-step", boardRef: "converted-board", title: "下一步", content: "確認使用者控制與生成內容的驗證流程。", x: 770, y: 160 },
          { type: "create_board_edge", boardRef: "converted-board", source: "產品核心", target: { title: "模型選擇" }, label: "實作方式" },
          { type: "create_board_edge", description: "連結模型選擇與下一步", boardRef: "converted-board", sourceRef: "model-choice", targetRef: "next-step", label: "需要確認" }
        ] } : prompt.includes("全新的白板") ? { summary: "已歸納內容但初次計畫漏掉實際欄位", actions: [
          { type: "create_board", description: "AI 吵架王架構", tempId: "converted-board", title: "AI 吵架王架構" },
          { type: "create_board_section", description: "核心脈絡", tempId: "core-section", boardRef: "converted-board", x: 80, y: 80, width: 1040, height: 520 },
          { type: "create_board_card", description: "產品核心", tempId: "product-core", boardRef: "converted-board", x: 130, y: 160 },
          { type: "create_board_card", description: "模型選擇", tempId: "model-choice", boardRef: "converted-board", x: 450, y: 160 },
          { type: "create_board_card", description: "下一步", tempId: "next-step", boardRef: "converted-board", x: 770, y: 160 },
          { type: "create_board_edge", boardRef: "converted-board", source: "產品核心", target: { title: "模型選擇" }, label: "實作方式" },
          { type: "create_board_edge", description: "連結模型選擇與下一步", boardRef: "converted-board", sourceRef: "model-choice", targetRef: "next-step", label: "需要確認" }
        ] } : prompt.includes("無法辨識連線測試") ? { summary: "保留可套用內容並略過無法辨識的連線", actions: [
          { type: "create_card", description: "建立不受錯誤連線影響的卡片", title: "部分套用仍保留的卡片", content: "單一關係線格式錯誤不應回滾其他內容。" },
          { type: "create_board_edge", label: "無法辨識" }
        ] } : prompt.includes("跨分類測試") ? { summary: "把白板結論同步輸出到卡片與日誌", actions: [
          { type: "create_card", description: "建立白板結論卡片", title: "AI 吵架王白板結論", content: "產品核心、模型選擇與驗證流程已形成可執行架構。" },
          { type: "append_journal", description: "把白板結論加入今日日誌", date: "2026-08-27", text: "白板結論：先確認模型選擇，再完成生成內容的驗證流程。" }
        ] } : prompt.includes("刪除測試") ? { summary: "把取消的內容移到垃圾桶", actions: [{ type: "delete_card", description: "把「安裝教學文章架構」移到垃圾桶", targetId: "card-writing" }] } : prompt.includes("更新測試") ? { summary: "同步修改卡片、待辦、片語與白板位置", actions: [
          { type: "update_card", description: "在產品研究卡片後追加決議", targetId: "card-ai-king", content: "補充決議：先完成卡片與 AI 協作。", contentMode: "append" },
          { type: "update_task", description: "完成並延期模型清單待辦", targetId: "task-1", title: "已確認 OpenRouter 模型清單", done: true, dueDate: "2026-09-09" },
          { type: "update_fragment", description: "更新會議提醒", targetId: targets.fragmentId, text: "會議簡報改成卡片與 AI 協作的使用情境。" },
          { type: "move_board_node", description: "移動決議卡片", targetId: targets.nodeId, x: 2200, y: 520 }
        ] } : { summary: "把會議記錄真正整理進白板與工作系統", actions: [
          { type: "create_board_section", description: "建立會議決議區段", tempId: "meeting-section", title: "會議決議", x: 1120, y: 100, width: 690, height: 420 },
          { type: "create_board_card", description: "建立發佈日期決議卡片", tempId: "decision-date", title: "確認發佈日期", content: "• 決策：先確認 0.3 版發佈日期 • 風險：日期仍未定案 • 下一步：由產品負責人確認", x: 1160, y: 170 },
          { type: "create_board_card", description: "建立簡報整理卡片", tempId: "decision-slides", title: "整理會議簡報", content: "將會議結論整理成對外簡報。", x: 1480, y: 170 },
          { type: "create_board_edge", description: "連結發佈日期與簡報工作", sourceRef: "decision-date", targetRef: "decision-slides", label: "確認後進行" },
          { type: "create_task", description: "建立發佈日期待辦", title: "確認 0.3 發佈日期", dueDate: "2026-09-05", cardRef: "decision-date" },
          { type: "append_journal", description: "把決議追加到今日日誌", date: "2026-08-26", text: "會議決議：確認 0.3 版發佈日期並整理簡報。" },
          { type: "create_fragment", description: "留下會議後續提醒", text: "會議簡報需要以讀者問題為主線。" }
        ] };
        return { text: JSON.stringify(plan), model: request.model, usage: null, finishReason: "stop" };
      },
    },
    files: { save: async () => ({ canceled: true }), open: async () => ({ canceled: true, files: [] }) }, web: { read: async () => { throw new Error("unused"); } }, onShortcut: () => () => {}, platform: "darwin",
  };
});
const page = await context.newPage();
page.setDefaultTimeout(20_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
await page.goto(base, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "白板", exact: true }).click();
await page.locator(".flow-card").first().waitFor();
const before = await page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open("chengjing"); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const names = ["cards", "boardNodes", "boardEdges", "tasks", "fragments"]; Promise.all(names.map((name) => new Promise((done) => { const query = db.transaction(name, "readonly").objectStore(name).count(); query.onsuccess = () => done([name, query.result]); }))).then((entries) => resolve(Object.fromEntries(entries))); }; }));

await page.getByRole("button", { name: "請 AI 整理這張白板", exact: true }).click();
const aiPanel = page.locator(".ai-panel");
await aiPanel.waitFor();
const composer = aiPanel.locator(".ai-composer textarea");
await composer.fill("請把以下會議記錄整理成真正的白板卡片與連線，並替決議建立待辦：確認 0.3 發佈日期、整理簡報。/");
await aiPanel.getByRole("button", { name: "送出", exact: true }).click();
const plan = aiPanel.locator(".ai-action-plan");
await plan.waitFor();
const previewCount = await plan.locator("[data-action-type]").count();
const duringPreview = await page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open("chengjing"); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const names = ["cards", "boardNodes", "boardEdges", "tasks", "fragments"]; Promise.all(names.map((name) => new Promise((done) => { const query = db.transaction(name, "readonly").objectStore(name).count(); query.onsuccess = () => done([name, query.result]); }))).then((entries) => resolve(Object.fromEntries(entries))); }; }));
const previewDoesNotMutate = JSON.stringify(before) === JSON.stringify(duringPreview) && previewCount === 7;
const structuredOutputRequested = await page.evaluate(() => Boolean(window.__aiActionsQa[0]?.responseFormat?.json_schema));
const conciseBoardInstructionRequested = await page.evaluate(() => { const instruction = window.__aiActionsQa[0]?.messages?.[0]?.content || ""; return instruction.includes("一張卡片只保留一個核心") && instruction.includes("不能為了簡短而刪除") && instruction.includes("create_board_text 只用於不超過 40 字"); });
await page.screenshot({ path: path.join(output, "01-action-preview.png"), fullPage: true });
await plan.getByRole("button", { name: "套用 7 個變更", exact: true }).click();
await aiPanel.getByText("已完成 7 個變更。", { exact: true }).waitFor();
await page.getByRole("button", { name: "關閉 AI", exact: true }).click();
await page.locator(".flow-card").filter({ hasText: "確認發佈日期" }).waitFor();
await page.locator(".flow-card").filter({ hasText: "整理會議簡報" }).waitFor();
const afterApply = await page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open("chengjing"); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const read = (name) => new Promise((done) => { const query = db.transaction(name, "readonly").objectStore(name).getAll(); query.onsuccess = () => done(query.result); }); Promise.all([read("cards"), read("boardNodes"), read("boardEdges"), read("tasks"), read("fragments")]).then(([cards, nodes, edges, tasks, fragments]) => { const createdCard = cards.find((card) => card.title === "確認發佈日期"); resolve({ cards: cards.filter((card) => ["確認發佈日期", "整理會議簡報"].includes(card.title)).length, nodes: nodes.filter((node) => node.cardId && ["確認發佈日期", "整理會議簡報"].includes(cards.find((card) => card.id === node.cardId)?.title)).length, structuredCard: createdCard?.plainText.split("\n").filter((line) => line.startsWith("• ")).length === 3 && createdCard?.contentHtml.includes("<ul>") && createdCard?.contentHtml.includes("<li><p>風險：日期仍未定案</p></li>"), linkedEdge: edges.some((edge) => edge.label === "確認後進行"), linkedTask: tasks.some((task) => task.title === "確認 0.3 發佈日期" && task.cardId === createdCard?.id), journal: cards.some((card) => card.kind === "journal" && card.plainText.includes("會議決議：確認 0.3 版發佈日期")), fragment: fragments.some((fragment) => fragment.text.includes("讀者問題")) }); }); }; }));
const appliedToRealSurfaces = afterApply.cards === 2 && afterApply.nodes === 2 && afterApply.structuredCard && afterApply.linkedEdge && afterApply.linkedTask && afterApply.journal && afterApply.fragment;
await page.waitForTimeout(750);
await page.screenshot({ path: path.join(output, "02-board-after-apply.png"), fullPage: true });
await page.getByRole("button", { name: "上一步", exact: true }).click();
await page.locator(".flow-card").filter({ hasText: "確認發佈日期" }).waitFor({ state: "detached" });
await page.locator(".flow-card").filter({ hasText: "整理會議簡報" }).waitFor({ state: "detached" });
const aiBoardUndoWorks = true;
await page.getByRole("button", { name: "下一步", exact: true }).click();
await page.locator(".flow-card").filter({ hasText: "確認發佈日期" }).waitFor();
await page.locator(".flow-card").filter({ hasText: "整理會議簡報" }).waitFor();
const aiBoardRedoWorks = true;

const updateTargetsReady = await page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open("chengjing"); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const read = (name) => new Promise((done) => { const query = db.transaction(name, "readonly").objectStore(name).getAll(); query.onsuccess = () => done(query.result); }); Promise.all([read("cards"), read("boardNodes"), read("fragments")]).then(([cards, nodes, fragments]) => { const card = cards.find((item) => item.title === "確認發佈日期"); const fragment = fragments.find((item) => item.text.includes("讀者問題")); const node = nodes.find((item) => item.cardId === card?.id); window.__aiActionUpdateTargets = { fragmentId: fragment?.id, nodeId: node?.id }; resolve(Boolean(fragment?.id && node?.id)); }); }; }));
await page.getByRole("button", { name: "請 AI 整理這張白板", exact: true }).click();
await aiPanel.locator(".ai-composer textarea").fill("更新測試：追加產品決議、完成待辦、修改提醒並移動白板卡片");
await aiPanel.getByRole("button", { name: "送出", exact: true }).click();
await plan.waitFor();
await plan.getByRole("button", { name: "套用 4 個變更", exact: true }).click();
await aiPanel.getByText("已完成 4 個變更。", { exact: true }).waitFor();
const updatesReachEverySurface = await page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open("chengjing"); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const targets = window.__aiActionUpdateTargets; const read = (store, id) => new Promise((done) => { const query = db.transaction(store, "readonly").objectStore(store).get(id); query.onsuccess = () => done(query.result); }); Promise.all([read("cards", "card-ai-king"), read("tasks", "task-1"), read("fragments", targets.fragmentId), read("boardNodes", targets.nodeId)]).then(([card, task, fragment, node]) => resolve(Boolean(card?.plainText.includes("先完成卡片與 AI 協作") && card?.contentHtml.includes("<strong>OpenRouter</strong>") && task?.title === "已確認 OpenRouter 模型清單" && task?.done === true && new Date(task.dueAt).getDate() === 9 && fragment?.text === "會議簡報改成卡片與 AI 協作的使用情境。" && node?.x === 2200 && node?.y === 520))); }; }));
await page.getByRole("button", { name: "關閉 AI", exact: true }).click();

await page.getByRole("button", { name: "請 AI 整理這張白板", exact: true }).click();
await aiPanel.locator(".ai-composer textarea").fill("刪除測試：把安裝教學文章架構移到垃圾桶");
await aiPanel.getByRole("button", { name: "送出", exact: true }).click();
await plan.waitFor();
const destructiveWarningVisible = await plan.getByText(/包含刪除或覆蓋/).isVisible();
await plan.getByRole("button", { name: "取消計畫", exact: true }).click();
const stateAfterCancel = await page.evaluate(() => new Promise((resolve) => { const request = indexedDB.open("chengjing"); request.onsuccess = () => { const query = request.result.transaction("cards", "readonly").objectStore("cards").get("card-writing"); query.onsuccess = () => resolve(query.result?.state); }; }));
const cancelProtectsData = stateAfterCancel !== "trash";
await aiPanel.locator(".ai-composer textarea").fill("刪除測試：把安裝教學文章架構移到垃圾桶");
await aiPanel.getByRole("button", { name: "送出", exact: true }).click();
await plan.waitFor();
await plan.getByRole("button", { name: "套用 1 個變更", exact: true }).click();
await aiPanel.getByText("已完成 1 個變更。", { exact: true }).waitFor();
const stateAfterApply = await page.evaluate(() => new Promise((resolve) => { const request = indexedDB.open("chengjing"); request.onsuccess = () => { const query = request.result.transaction("cards", "readonly").objectStore("cards").get("card-writing"); query.onsuccess = () => resolve(query.result?.state); }; }));
const approvedDeleteMovesToTrash = stateAfterApply === "trash";

await aiPanel.getByRole("button", { name: "關閉 AI", exact: true }).click();
await page.getByRole("button", { name: "卡片庫", exact: true }).click();
const conversionSourceCard = page.locator(".library-card").filter({ hasText: "AI 吵架王：產品研究" });
const conversionBefore = await page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open("chengjing"); request.onerror = () => reject(request.error); request.onsuccess = () => { const database = request.result; const names = ["boards", "boardNodes", "boardEdges", "cards"]; Promise.all(names.map((name) => new Promise((done) => { const query = database.transaction(name, "readonly").objectStore(name).count(); query.onsuccess = () => done([name, query.result]); }))).then((entries) => resolve(Object.fromEntries(entries))); }; }));
const conversionSourceBefore = await page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open("chengjing"); request.onerror = () => reject(request.error); request.onsuccess = () => { const query = request.result.transaction("cards", "readonly").objectStore("cards").get("card-ai-king"); query.onsuccess = () => resolve(query.result?.plainText || ""); }; }));
await conversionSourceCard.click({ button: "right" });
await page.getByRole("menuitem", { name: "轉換成白板", exact: true }).waitFor();
const rightClickConvertAvailable = true;
await page.getByRole("menuitem", { name: "轉換成白板", exact: true }).click();
await page.locator(".card-editor-panel").waitFor();
await aiPanel.waitFor();
await plan.waitFor();
const conversionPreviewCount = await plan.locator("[data-action-type]").count();
const conversionDuringPreview = await page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open("chengjing"); request.onerror = () => reject(request.error); request.onsuccess = () => { const database = request.result; const names = ["boards", "boardNodes", "boardEdges", "cards"]; Promise.all(names.map((name) => new Promise((done) => { const query = database.transaction(name, "readonly").objectStore(name).count(); query.onsuccess = () => done([name, query.result]); }))).then((entries) => resolve(Object.fromEntries(entries))); }; }));
const conversionPreviewProtectsData = JSON.stringify(conversionBefore) === JSON.stringify(conversionDuringPreview) && conversionPreviewCount === 7;
const conversionRequest = await page.evaluate(() => window.__aiActionsQa.findLast((request) => (request.messages.at(-1)?.content || "").includes("全新的白板")));
const conversionRepairRequested = await page.evaluate(() => { const requests = window.__aiActionsQa.filter((request) => (request.messages.at(-1)?.content || "").includes("全新的白板")); return requests.length === 2 && (requests.at(-1)?.messages.at(-1)?.content || "").includes("repair_board_action_fields"); });
const conversionSchemaSupportsNewBoard = Boolean(conversionRequest?.responseFormat?.json_schema?.schema?.properties?.actions?.items?.properties?.boardRef)
  && conversionRequest?.responseFormat?.json_schema?.schema?.properties?.actions?.items?.properties?.type?.enum?.includes("create_board");
const crossModuleCatalogSent = (conversionRequest?.messages?.at(-1)?.content || "").includes('"workspaceCatalog"')
  && (conversionRequest?.messages?.at(-1)?.content || "").includes('"boards"')
  && (conversionRequest?.messages?.at(-1)?.content || "").includes('"tasks"');
await page.screenshot({ path: path.join(output, "03-card-to-board-preview.png"), fullPage: true });
await plan.getByRole("button", { name: "套用 7 個變更", exact: true }).click();
await page.locator(".board-switcher-trigger").getByText("AI 吵架王架構", { exact: true }).waitFor();
const cardConvertedToNewBoard = await page.evaluate(({ sourceBefore }) => new Promise((resolve, reject) => { const request = indexedDB.open("chengjing"); request.onerror = () => reject(request.error); request.onsuccess = () => { const database = request.result; const readAll = (name) => new Promise((done) => { const query = database.transaction(name, "readonly").objectStore(name).getAll(); query.onsuccess = () => done(query.result); }); Promise.all([readAll("boards"), readAll("boardNodes"), readAll("boardEdges"), readAll("cards")]).then(([boards, nodes, edges, cards]) => { const board = boards.find((item) => item.title === "AI 吵架王架構"); const boardNodes = nodes.filter((node) => node.boardId === board?.id); const convertedCards = cards.filter((card) => ["產品核心", "模型選擇", "下一步"].includes(card.title)); const section = boardNodes.find((node) => node.kind === "section"); resolve(Boolean(board && boardNodes.length === 4 && section?.title === "核心脈絡" && edges.filter((edge) => edge.boardId === board.id).length === 2 && convertedCards.length === 3 && convertedCards.every((card) => card.plainText.trim() && card.title !== "新的卡片") && cards.find((card) => card.id === "card-ai-king")?.plainText === sourceBefore)); }); }; }), { sourceBefore: conversionSourceBefore });
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(output, "04-card-converted-board.png"), fullPage: true });

await page.getByRole("button", { name: "請 AI 整理這張白板", exact: true }).click();
await aiPanel.getByRole("button", { name: "關閉搜尋其他本機卡片", exact: true }).click();
await aiPanel.locator(".ai-composer textarea").fill("跨分類測試：請把目前白板的結論匯出成卡片，並同步追加到日誌");
await aiPanel.getByRole("button", { name: "送出", exact: true }).click();
await plan.waitFor();
const crossModulePreviewTypes = await plan.locator("[data-action-type]").evaluateAll((items) => items.map((item) => item.getAttribute("data-action-type")));
const crossModuleRequest = await page.evaluate(() => window.__aiActionsQa.findLast((request) => (request.messages.at(-1)?.content || "").includes("跨分類測試")));
const actionScopeHonorsToggle = (crossModuleRequest?.messages?.at(-1)?.content || "").includes('"cards":[]') && (crossModuleRequest?.messages?.at(-1)?.content || "").includes('"tasks":[]');
await plan.getByRole("button", { name: "套用 2 個變更", exact: true }).click();
await aiPanel.getByText("已完成 2 個變更。", { exact: true }).waitFor();
const boardExportsAcrossModules = await page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open("chengjing"); request.onerror = () => reject(request.error); request.onsuccess = () => { const query = request.result.transaction("cards", "readonly").objectStore("cards").getAll(); query.onsuccess = () => { const cards = query.result; resolve(Boolean(cards.some((card) => card.title === "AI 吵架王白板結論" && card.state === "active") && cards.some((card) => card.kind === "journal" && card.journalDate === "2026-08-27" && card.plainText.includes("白板結論：先確認模型選擇")))); }; }; }));

await aiPanel.locator(".ai-composer textarea").fill("新增內容並執行無法辨識連線測試");
await aiPanel.getByRole("button", { name: "送出", exact: true }).click();
await plan.waitFor();
const malformedEdgePreviewReadable = await plan.getByText("建立「無法辨識」關係線", { exact: true }).isVisible() && !(await plan.innerText()).includes("create_board_edge");
await plan.getByRole("button", { name: "套用 2 個變更", exact: true }).click();
await aiPanel.getByText("已完成 1 個變更；略過 1 條無法辨識的關係線。白板其他內容已安全建立。", { exact: true }).waitFor();
const malformedEdgeDoesNotRollback = await page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open("chengjing"); request.onerror = () => reject(request.error); request.onsuccess = () => { const query = request.result.transaction("cards", "readonly").objectStore("cards").getAll(); query.onsuccess = () => resolve(query.result.some((card) => card.title === "部分套用仍保留的卡片")); }; }));
const malformedEdgeShowsNoRedError = await aiPanel.locator(".ai-error").count() === 0;
await page.screenshot({ path: path.join(output, "05-edge-reference-recovered.png"), fullPage: true });

const report = { previewCount, previewDoesNotMutate, structuredOutputRequested, conciseBoardInstructionRequested, appliedToRealSurfaces, afterApply, aiBoardUndoWorks, aiBoardRedoWorks, updateTargetsReady, updatesReachEverySurface, destructiveWarningVisible, cancelProtectsData, approvedDeleteMovesToTrash, rightClickConvertAvailable, conversionPreviewCount, conversionPreviewProtectsData, conversionRepairRequested, conversionSchemaSupportsNewBoard, crossModuleCatalogSent, cardConvertedToNewBoard, crossModulePreviewTypes, actionScopeHonorsToggle, boardExportsAcrossModules, malformedEdgePreviewReadable, malformedEdgeDoesNotRollback, malformedEdgeShowsNoRedError, errors };
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (!previewDoesNotMutate || !structuredOutputRequested || !conciseBoardInstructionRequested || !appliedToRealSurfaces || !aiBoardUndoWorks || !aiBoardRedoWorks || !updateTargetsReady || !updatesReachEverySurface || !destructiveWarningVisible || !cancelProtectsData || !approvedDeleteMovesToTrash || !rightClickConvertAvailable || !conversionPreviewProtectsData || !conversionRepairRequested || !conversionSchemaSupportsNewBoard || !crossModuleCatalogSent || !cardConvertedToNewBoard || JSON.stringify(crossModulePreviewTypes) !== JSON.stringify(["create_card", "append_journal"]) || !actionScopeHonorsToggle || !boardExportsAcrossModules || !malformedEdgePreviewReadable || !malformedEdgeDoesNotRollback || !malformedEdgeShowsNoRedError || errors.length) process.exitCode = 1;
