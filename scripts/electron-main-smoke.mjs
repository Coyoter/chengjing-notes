import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import electronPath from "electron";
import { chromium } from "playwright";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

const tempData = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-main-smoke-"));
const retiredRagModel = path.join(tempData, "models", "multilingual-e5-small");
await fs.mkdir(retiredRagModel, { recursive: true });
await fs.writeFile(path.join(retiredRagModel, "retired-model.bin"), "retired-rag-model");
const autoBackupTarget = path.join(tempData, "automatic-backups");
const port = await freePort();
const packagedExecutable = process.env.CHENGJING_PACKAGED_APP || "";
const executable = packagedExecutable || electronPath;
const executableArgs = packagedExecutable ? [`--remote-debugging-port=${port}`] : [".", `--remote-debugging-port=${port}`];
const child = spawn(executable, executableArgs, {
  cwd: process.cwd(),
  env: { ...process.env, CHENGJING_SMOKE: "1", CHENGJING_SMOKE_USER_DATA: tempData, CHENGJING_SMOKE_AUTO_BACKUP_DIR: autoBackupTarget },
  stdio: ["ignore", "pipe", "pipe"],
});
let childOutput = "";
child.stdout.on("data", (chunk) => { childOutput += chunk.toString(); });
child.stderr.on("data", (chunk) => { childOutput += chunk.toString(); });
let browser;
const secret = "test-openrouter-main-ipc-secret";

try {
  const endpoint = `http://127.0.0.1:${port}`;
  const started = Date.now();
  while (true) {
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) break;
    } catch {}
    if (Date.now() - started > 15_000) throw new Error(`正式主程序啟動逾時：${childOutput.slice(-1000)}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.waitForEvent("page");
  page.setDefaultTimeout(12_000);
  await page.getByText("今天想釐清什麼？").waitFor();
  const nativeMenuSnapshot = await page.evaluate(() => window.chengjing.app.getMenuSnapshot());
  const systemVersion = await page.evaluate(() => window.chengjing.app.getSystemVersion());
  const updateMenuLabel = systemVersion.platform === "darwin" ? "澄境" : "檔案";
  const nativeCheckUpdateItem = nativeMenuSnapshot.find((item) => item.label === updateMenuLabel)?.submenu.find((item) => item.label === "檢查更新…");
  const nativeCheckUpdateMenu = Boolean(nativeCheckUpdateItem);
  const nativeCheckUpdateMenuIconMatchesSystem = nativeCheckUpdateItem?.hasIcon === (systemVersion.platform === "darwin" && Number.parseInt(systemVersion.version.split(".")[0], 10) === 26);
  const quitBridgeAvailable = await page.evaluate(() => typeof window.chengjing.app.quit === "function");
  const retiredRagModelRemoved = await fs.access(retiredRagModel).then(() => false).catch(() => true);
  await page.waitForTimeout(1_650);
  const startupUpdateDialog = page.locator(".update-dialog");
  if (await startupUpdateDialog.isVisible().catch(() => false)) await startupUpdateDialog.locator(".secondary-button").click();
  const localOnnxRuntimeDetails = await page.evaluate(async () => {
    const mjsUrl = new URL("./ort/ort-wasm-simd-threaded.asyncify.mjs", document.baseURI).href;
    const wasmUrl = new URL("./ort/ort-wasm-simd-threaded.asyncify.wasm", document.baseURI).href;
    const [mjsResponse, wasmResponse] = await Promise.all([fetch(mjsUrl), fetch(wasmUrl)]);
    const runtimeModule = await import(mjsUrl);
    return {
      mjsOk: mjsResponse.ok,
      wasmOk: wasmResponse.ok,
      mjsBytes: (await mjsResponse.arrayBuffer()).byteLength,
      wasmBytes: (await wasmResponse.arrayBuffer()).byteLength,
      runtimeFactory: typeof runtimeModule.default === "function",
    };
  });
  const localOnnxRuntimeBundled = localOnnxRuntimeDetails.mjsOk && localOnnxRuntimeDetails.wasmOk
    && localOnnxRuntimeDetails.mjsBytes > 10_000 && localOnnxRuntimeDetails.wasmBytes > 10_000_000
    && localOnnxRuntimeDetails.runtimeFactory;
  const attachmentStorage = await page.evaluate(async () => {
    const text = "澄境附件檔案系統測試";
    const data = btoa(unescape(encodeURIComponent(text)));
    const stored = await window.chengjing.attachments.importData({ id: "smoke-attachment", name: "測試附件.txt", mime: "text/plain", data });
    const response = await fetch(`chengjing-attachment://local/${encodeURIComponent(stored.relativePath)}`);
    const readData = await window.chengjing.attachments.readData(stored.relativePath);
    const stats = await window.chengjing.attachments.stats();
    return { stored, fetched: await response.text(), readData, stats, expectedData: data };
  });
  const attachmentFileStorageWorks = attachmentStorage.stored.storage === "file"
    && attachmentStorage.stored.sha256?.length === 64
    && attachmentStorage.fetched === "澄境附件檔案系統測試"
    && attachmentStorage.readData === attachmentStorage.expectedData
    && attachmentStorage.stats.count === 1;
  await page.getByRole("button", { name: "許願池", exact: true }).click();
  const packagedWishPool = page.locator(".wish-pool-panel");
  await packagedWishPool.waitFor();
  await packagedWishPool.locator(".wish-item").first().waitFor();
  const packagedWishIdentityText = await packagedWishPool.locator(".wish-identity-bar").innerText();
  const packagedIdentitySeals = packagedWishPool.locator(".identity-seal[data-identity-pattern]");
  const packagedWishPoolWorks = await packagedWishPool.getByRole("heading", { name: "許願池", exact: true }).isVisible()
    && packagedWishIdentityText.includes("共享身分")
    && packagedWishIdentityText.includes("建立你的共享身分")
    && await packagedIdentitySeals.count() > 0
    && Boolean(await packagedIdentitySeals.first().getAttribute("data-identity-pattern"))
    && await packagedWishPool.evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
  await packagedWishPool.getByRole("button", { name: "關閉許願池", exact: true }).click();
  await packagedWishPool.waitFor({ state: "detached" });
  const packagedInboxRemoved = await page.getByRole("button", { name: /^收件匣/ }).count() === 0;
  await page.getByRole("button", { name: /^隻言片語/ }).click();
  await page.locator(".fragment-capture").waitFor();
  const packagedFragmentsAvailable = await page.locator(".fragment-capture textarea").isVisible() && await page.locator(".fragment-stream").isVisible();
  await page.getByRole("button", { name: "日誌", exact: true }).click();
  const packagedJournalNavigationGrouped = await page.locator(".journal-date-navigation-actions").evaluate((group) => { const today = group.querySelector(".journal-today-button")?.getBoundingClientRect(); const picker = group.querySelector(".task-date-trigger")?.getBoundingClientRect(); return Boolean(today && picker && Math.abs(today.top - picker.top) <= 1.1 && Math.abs(today.height - picker.height) <= 1.1 && picker.left - today.right >= 4 && picker.left - today.right <= 8); });
  await page.getByRole("button", { name: "選擇日期", exact: true }).click();
  const packagedJournalCalendar = page.getByRole("dialog", { name: "日誌日期月曆", exact: true });
  await packagedJournalCalendar.waitFor();
  const packagedJournalDatePickerWorks = packagedJournalNavigationGrouped && await packagedJournalCalendar.locator(".task-calendar-days button").count() === 42
    && await packagedJournalCalendar.locator(".task-date-presets").count() === 0
    && await packagedJournalCalendar.getByRole("button", { name: "清除日期", exact: true }).count() === 0;
  await page.keyboard.press("Escape");
  const packagedHighlightTarget = "把新的筆記應用做成真正能長期使用的工具";
  await page.locator(".journal-paper .prose-editor").evaluate((editor, text) => {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const index = node.textContent?.indexOf(text) ?? -1;
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + text.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      break;
    }
  }, packagedHighlightTarget);
  await page.getByRole("button", { name: "重點標示並建立劃記", exact: true }).click();
  const packagedHighlight = page.locator(".journal-paper .prose-editor mark").filter({ hasText: packagedHighlightTarget });
  await packagedHighlight.waitFor();
  const packagedHighlightThemeWorks = await packagedHighlight.evaluate((element) => {
    const futureMarkupUsesThemeToken = !element.getAttribute("style") && !element.getAttribute("data-color");
    element.setAttribute("style", "background-color: #f4d483");
    document.documentElement.dataset.theme = "dark";
    const style = getComputedStyle(element);
    return futureMarkupUsesThemeToken
      && style.backgroundColor === "rgb(113, 90, 49)"
      && style.color === "rgb(244, 239, 228)";
  });
  await page.getByRole("button", { name: "白板", exact: true }).click();
  await page.locator(".flow-card").first().waitFor();
  const textNodeCount = await page.locator(".react-flow__node-text").count();
  await page.getByRole("button", { name: "新增文字", exact: true }).click();
  await page.waitForFunction((count) => document.querySelectorAll(".react-flow__node-text").length === count + 1, textNodeCount);
  const undoBoardButton = page.getByRole("button", { name: "上一步", exact: true });
  await page.waitForFunction(() => !document.querySelector('button[aria-label="上一步"]')?.hasAttribute("disabled"));
  await undoBoardButton.click();
  await page.waitForFunction((count) => document.querySelectorAll(".react-flow__node-text").length === count, textNodeCount);
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  try {
    await page.waitForFunction((count) => document.querySelectorAll(".react-flow__node-text").length === count + 1, textNodeCount);
  } catch (error) {
    const diagnostic = await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open("chengjing");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const query = request.result.transaction("boardNodes", "readonly").objectStore("boardNodes").getAll();
        query.onsuccess = () => { const controls = document.querySelector(".global-history-controls"); resolve({ storedTextNodes: query.result.filter((item) => item.kind === "text").length, renderedTextNodes: document.querySelectorAll(".react-flow__node-text").length, undoDisabled: document.querySelector('button[aria-label="上一步"]')?.hasAttribute("disabled"), redoDisabled: document.querySelector('button[aria-label="下一步"]')?.hasAttribute("disabled"), boardHistoryIndex: controls?.getAttribute("data-board-history-index"), boardHistoryLength: controls?.getAttribute("data-board-history-length"), boardHistoryNodeCounts: controls?.getAttribute("data-board-history-node-counts") }); };
      };
    }));
    throw new Error(`board-redo-diagnostic:${JSON.stringify(diagnostic)}:${error.message}`);
  }
  const packagedBoardHistoryWorks = true;
  const packagedEdgeLabelsAvoidNodes = await page.evaluate(() => {
    const labels = [...document.querySelectorAll(".smart-edge-label")].map((item) => item.getBoundingClientRect()).filter((box) => box.width && box.height);
    const nodes = [...document.querySelectorAll(".react-flow__node-card, .react-flow__node-text, .react-flow__node-mindmap")].map((item) => item.getBoundingClientRect()).filter((box) => box.width && box.height);
    return labels.length > 0 && labels.every((label) => nodes.every((node) => label.right <= node.left || label.left >= node.right || label.bottom <= node.top || label.top >= node.bottom));
  });
  await page.getByRole("button", { name: "卡片庫", exact: true }).click();
  const packagedPinnedFilter = page.locator(".library-organizer").getByRole("button", { name: /已置頂/ });
  await packagedPinnedFilter.click();
  const packagedPinnedCards = page.locator(".library-card");
  await packagedPinnedCards.first().waitFor();
  const packagedPinnedCollectionWorks = await packagedPinnedCards.count() > 0 && await packagedPinnedCards.evaluateAll((items) => items.every((item) => item.getAttribute("data-pinned") === "true"));
  await page.locator(".library-organizer").getByRole("button", { name: /所有卡片/ }).click();
  await page.locator(".library-card").filter({ hasText: "Gemma 4 本機模式" }).click();
  const packagedCardLayer = page.locator(".card-focus-layer");
  await packagedCardLayer.waitFor();
  const packagedBackButtonNoDrag = await packagedCardLayer.getByRole("button", { name: "返回卡片庫", exact: true }).evaluate((element) => getComputedStyle(element).webkitAppRegion === "no-drag" && getComputedStyle(element.closest(".card-focus-layer")).webkitAppRegion === "no-drag" && element.getBoundingClientRect().top >= 42 && getComputedStyle(element.closest(".card-focus-layer")).paddingTop === "42px");
  const packagedCardConvertButtonVisible = await packagedCardLayer.getByRole("button", { name: "轉換成白板", exact: true }).isVisible();
  await packagedCardLayer.locator("[data-card-menu-trigger]").click();
  await page.getByRole("menuitem", { name: "轉換成白板", exact: true }).waitFor();
  const packagedCardConvertContextVisible = true;
  await page.keyboard.press("Escape");
  await packagedCardLayer.getByRole("button", { name: "AI 動作", exact: true }).click();
  const packagedReferenceBar = page.locator(".ai-context-bar .is-card-reference");
  await packagedReferenceBar.getByText("參考卡片", { exact: true }).waitFor();
  const packagedComposer = page.locator(".ai-panel .ai-composer textarea");
  const packagedSpaceSearchToggle = page.locator(".ai-space-search-toggle");
  const packagedSpaceSearchBefore = await packagedSpaceSearchToggle.getAttribute("aria-pressed");
  await packagedSpaceSearchToggle.click();
  const packagedSpaceSearchAfter = await packagedSpaceSearchToggle.getAttribute("aria-pressed");
  await packagedSpaceSearchToggle.click();
  const packagedSpaceSearchToggleWorks = packagedSpaceSearchBefore !== packagedSpaceSearchAfter && await packagedSpaceSearchToggle.getAttribute("aria-pressed") === packagedSpaceSearchBefore;
  const packagedCardAIStartsBlank = await packagedComposer.inputValue() === "";
  const packagedPromptButton = page.getByRole("button", { name: "摘要這張卡片", exact: true });
  await packagedPromptButton.click();
  const packagedPromptFillsOnDemand = await packagedComposer.inputValue() === "請摘要目前卡片，列出三個核心觀點與一個下一步。";
  await packagedComposer.fill("");
  const packagedCardAIWorks = packagedBackButtonNoDrag && packagedCardConvertButtonVisible && packagedCardAIStartsBlank && packagedPromptFillsOnDemand && packagedSpaceSearchToggleWorks && (await packagedReferenceBar.innerText()).includes("Gemma 4 本機模式") && await page.evaluate(() => {
    const card = document.querySelector(".card-focus-layer")?.getBoundingClientRect();
    const ai = document.querySelector(".right-panel")?.getBoundingClientRect();
    return Boolean(card && ai && card.right <= ai.left + 1);
  });
  await page.getByRole("button", { name: "關閉 AI", exact: true }).click();
  await packagedCardLayer.getByRole("button", { name: "返回卡片庫", exact: true }).click();
  await packagedCardLayer.waitFor({ state: "detached" });
  let packagedAIMarkdownWorks = true;
  let packagedAIConversationPersists = true;
  if (process.env.CHENGJING_SMOKE_AI_MARKDOWN === "1") {
    await page.getByRole("button", { name: "詢問 AI", exact: true }).click();
    const aiPanel = page.locator(".ai-panel");
    await aiPanel.locator(".ai-composer textarea").fill("__CHENGJING_MARKDOWN_SMOKE__");
    await aiPanel.getByRole("button", { name: "送出", exact: true }).click();
    const userBubbleCompact = await aiPanel.locator(".ai-message.is-user").last().evaluate((element) => { const box = element.getBoundingClientRect(); const content = element.querySelector(".ai-message-plain").getBoundingClientRect(); return box.height <= 52 && content.top - box.top <= 12 && element.querySelectorAll("header").length === 0 && element.getAttribute("aria-label") === "你"; });
    const markdown = aiPanel.locator(".ai-message-markdown").last();
    await markdown.getByRole("heading", { name: "封裝 AI 回答", exact: true }).waitFor();
    packagedAIMarkdownWorks = userBubbleCompact && await markdown.locator("strong").getByText("核心重點", { exact: true }).isVisible()
      && await markdown.locator("ul > li").count() === 2
      && await markdown.locator("hr").count() === 1
      && await markdown.locator("blockquote").count() === 1
      && await markdown.locator("code").getByText("KPI", { exact: true }).isVisible()
      && await markdown.locator("script, img").count() === 0
      && !(await markdown.innerText()).includes("###")
      && !(await markdown.innerText()).includes("**")
      && await page.evaluate(() => window.bad !== true);
    const messageCount = await aiPanel.locator(".ai-message").count();
    await page.getByRole("button", { name: "關閉 AI", exact: true }).click();
    await page.getByRole("button", { name: "詢問 AI", exact: true }).click();
    await aiPanel.locator(".ai-message-markdown").last().getByRole("heading", { name: "封裝 AI 回答", exact: true }).waitFor();
    packagedAIConversationPersists = await aiPanel.locator(".ai-message").count() === messageCount;
    await aiPanel.getByRole("button", { name: "開啟新對話", exact: true }).click();
    await aiPanel.locator(".ai-empty").waitFor();
    packagedAIConversationPersists = packagedAIConversationPersists && await aiPanel.locator(".ai-message").count() === 0;
    await page.getByRole("button", { name: "關閉 AI", exact: true }).click();
  }
  const preferredLanguage = await page.evaluate(() => window.chengjing.app.getPreferredLanguage());
  const primaryLanguage = String(preferredLanguage.preferredLanguages?.[0] || "").toLowerCase().replaceAll("_", "-");
  const expectedPreferredLanguage = /^zh(?:-|$)/.test(primaryLanguage)
    ? (/(?:^|-)hant(?:-|$)|(?:^|-)(tw|hk|mo)(?:-|$)/.test(primaryLanguage) ? "zh-TW" : "zh-CN")
    : /^ja(?:-|$)/.test(primaryLanguage) ? "ja"
      : /^ko(?:-|$)/.test(primaryLanguage) ? "ko" : "en";
  const preferredLanguageDetected = preferredLanguage.language === expectedPreferredLanguage;
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("chengjing");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const scrollParagraph = "這一段用來確認展開閱讀遇到超長內容時仍能用滑鼠滾輪與觸控板往下閱讀，而且右側不會出現視覺捲軸。".repeat(12);
      const transaction = request.result.transaction("brainReports", "readwrite");
      transaction.objectStore("brainReports").put({ id: "smoke-markdown-report", date, content: `## 封裝反思\n\n這是 **粗體內容**。<script>window.bad = true</script>\n\n- 清單項目\n\n你最近似乎同時處理很多需要反覆確認的事情，注意力一直在不同工作之間切換。這不是結論，只是一個值得留意的節奏。\n\n有些記錄反覆提到重新整理與等待確認，也許真正消耗你的不只是工作量，而是每一件事都還沒有完全落地。\n\n不過，時間接近不能證明它們互為原因，生活裡也可能還有沒有寫下來的因素。這些線索比較像邀請你回頭確認，而不是替你下判斷。\n\n如果今天只能替自己減少一個尚未決定的項目，你最想先讓哪件事真正告一段落？也許先收好一件事，就能騰出一點比較安靜的空間。\n\n${scrollParagraph}`, model: "smoke", createdAt: Date.now(), updatedAt: Date.now() });
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => reject(transaction.error);
    };
  }));
  await page.getByRole("button", { name: "第二大腦", exact: true }).click();
  await page.locator(".brain-report-markdown").getByRole("heading", { name: "封裝反思", exact: true }).waitFor();
  const markdownReportRendered = await page.locator(".brain-report-markdown strong").getByText("粗體內容", { exact: true }).isVisible()
    && await page.locator(".brain-report-markdown li").getByText("清單項目", { exact: true }).isVisible()
    && await page.locator(".brain-report-markdown script").count() === 0
    && !(await page.locator(".brain-report-markdown").innerText()).includes("**");
  const reportPanel = page.locator(".brain-report");
  const reportMetadataRemoved = await reportPanel.locator(":scope > footer").count() === 0 && !(await reportPanel.innerText()).includes("smoke");
  const defaultReportWidth = await reportPanel.evaluate((element) => element.getBoundingClientRect().width);
  const previewReading = reportPanel.locator(".brain-report-reading");
  await previewReading.hover();
  await page.mouse.wheel(0, 260);
  await page.waitForFunction(() => (document.querySelector(".brain-report-reading")?.scrollTop || 0) > 0);
  const previewScrollWithoutScrollbar = await previewReading.evaluate((element) => element.scrollTop > 0 && getComputedStyle(element).overflowY === "auto" && getComputedStyle(element).scrollbarWidth === "none" && getComputedStyle(element, "::-webkit-scrollbar").display === "none");
  await previewReading.evaluate((element) => { element.scrollTop = 0; });
  await reportPanel.getByRole("button", { name: "展開閱讀", exact: true }).click();
  const expandedReport = page.locator('.brain-report[role="dialog"]');
  await expandedReport.waitFor();
  await page.waitForFunction(() => document.activeElement?.classList.contains("brain-report"));
  const expandedReading = expandedReport.locator(".brain-report-reading");
  await expandedReading.hover();
  await page.mouse.wheel(0, 520);
  await page.waitForFunction(() => (document.querySelector('.brain-report[role="dialog"] .brain-report-reading')?.scrollTop || 0) > 0);
  const expandedReadingMetrics = await expandedReport.evaluate((element, defaultWidth) => {
    const reading = element.querySelector(".brain-report-reading");
    const maxLabelZ = Math.max(0, ...[...document.querySelectorAll(".brain-node-label-wrap")].map((label) => {
      let node = label;
      let maximum = 0;
      while (node && !node.classList?.contains("second-brain-page")) {
        const zIndex = Number.parseInt(getComputedStyle(node).zIndex, 10);
        if (Number.isFinite(zIndex)) maximum = Math.max(maximum, zIndex);
        node = node.parentElement;
      }
      return maximum;
    }));
    return { larger: element.getBoundingClientRect().width >= 900 && element.getBoundingClientRect().width > defaultWidth, opaque: getComputedStyle(element).backgroundColor.startsWith("rgb(") && !getComputedStyle(element).backgroundColor.includes("/"), aboveLabels: Number(getComputedStyle(element).zIndex) > maxLabelZ, scrolls: reading.scrollTop > 0 && getComputedStyle(reading).overflowY === "auto", hiddenScrollbar: getComputedStyle(reading).scrollbarWidth === "none" && getComputedStyle(reading, "::-webkit-scrollbar").display === "none", backdrop: Boolean(document.querySelector(".brain-report-backdrop")) };
  }, defaultReportWidth);
  const expandedReadingMode = expandedReadingMetrics.larger && expandedReadingMetrics.opaque && expandedReadingMetrics.aboveLabels && expandedReadingMetrics.scrolls && expandedReadingMetrics.hiddenScrollbar && expandedReadingMetrics.backdrop;
  await expandedReport.getByRole("button", { name: "收合閱讀", exact: true }).click();
  await reportPanel.getByRole("button", { name: "縮到最小", exact: true }).click();
  await page.locator(".brain-report.is-minimized").waitFor();
  const minimizedReflectionMode = await reportPanel.evaluate((element, defaultWidth) => element.getBoundingClientRect().width < defaultWidth && element.querySelectorAll(".brain-report-reading").length === 0, defaultReportWidth);
  await reportPanel.getByRole("button", { name: "顯示今日反思", exact: true }).click();
  await reportPanel.locator(".brain-report-reading").waitFor();
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const packagedRoutingModes = page.locator(".routing-mode-setting");
  await packagedRoutingModes.waitFor();
  const packagedOpenRouterRoutingModes = await packagedRoutingModes.getByRole("button").count() === 3
    && await packagedRoutingModes.getByRole("button").filter({ hasText: "平衡" }).getAttribute("aria-pressed") === "true"
    && await packagedRoutingModes.getByText(/45 tokens\/s/).isVisible()
    && await packagedRoutingModes.getByText(/Nitro/).isVisible();
  const keyCard = page.locator(".settings-card").filter({ hasText: "OpenRouter API 金鑰" });
  await keyCard.locator("input").fill(secret);
  await keyCard.getByRole("button", { name: "儲存金鑰", exact: true }).click();
  await page.getByText(/金鑰已加密保存，但連線測試未通過：OpenRouter API 金鑰無效/).waitFor();
  const chatProbeMessage = await page.evaluate(() => window.chengjing.ai.openRouterChat({ model: "openai/gpt-5.6-luna", messages: [{ role: "user", content: "ping" }], maxTokens: 1 }).then(() => "unexpected-success").catch((error) => error.message));
  const chatHandlerReached = /OpenRouter API 金鑰無效|沒有權限/.test(chatProbeMessage) && !/連不到 OpenRouter|確認網路/.test(chatProbeMessage);
  let updateFallbackReached = true;
  if (process.env.CHENGJING_SMOKE_UPDATE_FORCE_FALLBACK === "1") {
    const expectedLatest = process.env.CHENGJING_SMOKE_EXPECTED_LATEST_VERSION || "0.2.9";
    const fallbackUpdate = await page.evaluate(() => window.chengjing.updates.check(true));
    const expectedAssetName = systemVersion.platform === "win32" ? `ChengJing-${expectedLatest}-${systemVersion.arch}-Installer.exe` : `ChengJing-${expectedLatest}-arm64.dmg`;
    updateFallbackReached = fallbackUpdate.latestVersion === expectedLatest
      && fallbackUpdate.asset?.name === expectedAssetName
      && fallbackUpdate.asset?.url.startsWith("https://github.com/Coyoter/chengjing-notes/releases/download/")
      && fallbackUpdate.asset?.digest?.startsWith("sha256:");
  }
  const configuredBeforeReload = /已保存在澄境/.test(await keyCard.innerText());
  await page.reload({ waitUntil: "load" });
  await page.getByText("今天想釐清什麼？").waitFor();
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const reloadedKeyCard = page.locator(".settings-card").filter({ hasText: "OpenRouter API 金鑰" });
  await reloadedKeyCard.getByText(/已保存在澄境/).waitFor();
  const configuredAfterReload = true;
  const files = await fs.readdir(tempData, { withFileTypes: true });
  const rawFiles = await Promise.all(files.filter((entry) => entry.isFile()).map((entry) => fs.readFile(path.join(tempData, entry.name))));
  const plaintextAbsent = rawFiles.every((buffer) => !buffer.includes(secret));
  await reloadedKeyCard.getByRole("button", { name: "移除", exact: true }).click();
  await reloadedKeyCard.getByText(/尚未設定/).waitFor();
  const removed = !(await reloadedKeyCard.innerText()).includes("已保存在澄境");
  const autoBackupIpc = await page.evaluate(async (attachment) => {
    const selection = await window.chengjing.backups.chooseFolder();
    const configured = await window.chengjing.backups.updateSettings({ enabled: true, intervalDays: 3, retentionCount: 3 });
    const data = JSON.stringify({ format: "chengjing-backup", version: 2, exportedAt: new Date().toISOString(), data: { cards: [{ id: "main-smoke-backup" }], attachments: [attachment] } });
    const written = await window.chengjing.backups.write({ data, reason: "manual", assets: [{ relativePath: attachment.relativePath, sha256: attachment.sha256, size: attachment.size }] });
    return { selection, configured, written };
  }, attachmentStorage.stored);
  const autoBackupRaw = await fs.readFile(autoBackupIpc.written.filePath, "utf8");
  const autoBackupAsset = await fs.readFile(path.join(autoBackupTarget, "ChengJing-AutoBackup-Assets", attachmentStorage.stored.sha256), "utf8");
  const autoBackupAtomicWrite = JSON.parse(autoBackupRaw).data.cards[0].id === "main-smoke-backup"
    && autoBackupIpc.written.filename.startsWith("ChengJing-AutoBackup-")
    && !autoBackupIpc.selection.canceled
    && autoBackupIpc.configured.intervalDays === 3
    && autoBackupIpc.written.copiedAssets === 1
    && autoBackupAsset === "澄境附件檔案系統測試";
  const incrementalBackupRestoreWorks = await page.evaluate(async ({ attachment, backupFilePath }) => {
    await window.chengjing.attachments.remove(attachment.relativePath);
    const restored = await window.chengjing.attachments.restoreFromBackup({ ...attachment, backupFilePath });
    const response = await fetch(`chengjing-attachment://local/${encodeURIComponent(restored.relativePath)}`);
    return restored.sha256 === attachment.sha256 && await response.text() === "澄境附件檔案系統測試";
  }, { attachment: attachmentStorage.stored, backupFilePath: autoBackupIpc.written.filePath });
  const autoBackupFiles = await fs.readdir(autoBackupTarget);
  const autoBackupTemporaryFilesAbsent = !autoBackupFiles.some((name) => name.includes(".tmp-"));
  await page.reload({ waitUntil: "load" });
  await page.getByText("今天想釐清什麼？").waitFor();
  const persistedBackupSettings = await page.evaluate(() => window.chengjing.backups.getSettings());
  const autoBackupSettingsPersisted = persistedBackupSettings.enabled && persistedBackupSettings.intervalDays === 3 && persistedBackupSettings.lastSuccessAt > 0 && persistedBackupSettings.lastFilePath === autoBackupIpc.written.filePath;
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.locator(".language-grid button").filter({ hasText: "English" }).click();
  await page.locator('html[lang="en"]').waitFor();
  const menuLanguage = await page.evaluate(() => window.chengjing.app.setLanguage("en"));
  const englishMenuSnapshot = await page.evaluate(() => window.chengjing.app.getMenuSnapshot());
  const englishUpdateMenuLabel = systemVersion.platform === "darwin" ? "ChengJing" : "File";
  const nativeCheckUpdateMenuLocalized = englishMenuSnapshot.find((item) => item.label === englishUpdateMenuLabel)?.submenu.some((item) => item.label === "Check for Updates…") === true;
  const languageSwitched = await page.getByRole("button", { name: "Settings", exact: true }).isVisible();
  await page.reload({ waitUntil: "load" });
  await page.locator('html[lang="en"]').waitFor();
  await page.getByText(/What would you like to clarify today/).waitFor();
  const languagePersisted = true;
  const report = { packagedApp: Boolean(packagedExecutable), nativeCheckUpdateMenu, nativeCheckUpdateMenuIconMatchesSystem, nativeCheckUpdateMenuLocalized, quitBridgeAvailable, retiredRagModelRemoved, localOnnxRuntimeBundled, localOnnxRuntimeDetails, attachmentFileStorageWorks, incrementalBackupRestoreWorks, packagedWishPoolWorks, packagedInboxRemoved, packagedFragmentsAvailable, packagedJournalDatePickerWorks, packagedPinnedCollectionWorks, packagedCardConvertButtonVisible, packagedCardConvertContextVisible, packagedCardAIWorks, packagedAIConversationPersists, packagedHighlightThemeWorks, packagedBoardHistoryWorks, packagedEdgeLabelsAvoidNodes, packagedAIMarkdownWorks, packagedOpenRouterRoutingModes, preferredLanguageDetected, preferredLanguage: preferredLanguage.language, markdownReportRendered, reportMetadataRemoved, previewScrollWithoutScrollbar, expandedReadingMode, minimizedReflectionMode, configuredBeforeReload, configuredAfterReload, plaintextAbsent, removed, chatHandlerReached, updateFallbackReached, autoBackupAtomicWrite, autoBackupTemporaryFilesAbsent, autoBackupSettingsPersisted, languageSwitched, languagePersisted, nativeMenuLanguage: menuLanguage?.language === "en", keychainPromptPathAbsent: !childOutput.includes("safeStorage") && !childOutput.includes("Keychain"), rendererLoaded: true };
  console.log(JSON.stringify(report, null, 2));
  if (!nativeCheckUpdateMenu || !nativeCheckUpdateMenuIconMatchesSystem || !nativeCheckUpdateMenuLocalized || !quitBridgeAvailable || !retiredRagModelRemoved || !localOnnxRuntimeBundled || !attachmentFileStorageWorks || !incrementalBackupRestoreWorks || !packagedWishPoolWorks || !packagedInboxRemoved || !packagedFragmentsAvailable || !packagedJournalDatePickerWorks || !packagedPinnedCollectionWorks || !packagedCardConvertButtonVisible || !packagedCardConvertContextVisible || !packagedCardAIWorks || !packagedAIConversationPersists || !packagedHighlightThemeWorks || !packagedBoardHistoryWorks || !packagedEdgeLabelsAvoidNodes || !packagedAIMarkdownWorks || !packagedOpenRouterRoutingModes || !preferredLanguageDetected || !markdownReportRendered || !reportMetadataRemoved || !previewScrollWithoutScrollbar || !expandedReadingMode || !minimizedReflectionMode || !configuredBeforeReload || !configuredAfterReload || !plaintextAbsent || !removed || !chatHandlerReached || !updateFallbackReached || !autoBackupAtomicWrite || !autoBackupTemporaryFilesAbsent || !autoBackupSettingsPersisted || !languageSwitched || !languagePersisted || !report.nativeMenuLanguage || !report.keychainPromptPathAbsent) process.exitCode = 1;
} catch (error) {
  console.error(error);
  if (childOutput.trim()) console.error(childOutput.slice(-2_000));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
  if (child.exitCode === null) await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 3000))]);
  await fs.rm(tempData, { recursive: true, force: true, maxRetries: 4, retryDelay: 120 });
}
