import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/second-brain");
await fs.mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1540, height: 960 }, colorScheme: "dark", locale: "zh-TW" });
const page = await context.newPage();
page.setDefaultTimeout(10_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
page.on("dialog", (dialog) => dialog.accept());

await page.addInitScript(() => {
  window.__brainSemanticQA = { organizeInput: "", reportInput: "", organizeCalls: 0, structuredOutput: false };
  window.chengjing = {
    onShortcut: () => () => {},
    ai: {
      keyStatus: async () => ({ configured: true, encrypted: true }),
      setKey: async () => ({ configured: true }),
      clearKey: async () => ({ configured: false }),
      listModels: async () => [],
      openRouterChat: async (payload) => {
        const prompt = payload.messages.map((message) => message.content).join("\n");
        if (prompt.includes("只輸出 JSON")) {
          window.__brainSemanticQA.organizeCalls += 1;
          window.__brainSemanticQA.structuredOutput ||= Boolean(payload.responseFormat?.json_schema);
          window.__brainSemanticQA.organizeInput = prompt;
          if (window.__brainSemanticQA.organizeCalls === 1) return { text: '{"connections":[{"source":', model: payload.model, usage: null, finishReason: "length" };
          const blocks = [...prompt.matchAll(/<node key="([^"]+)"[^>]*>[\s\S]*?<content>([\s\S]*?)<\/content>[\s\S]*?<\/node>/g)].map((match) => ({ key: match[1], content: match[2] }));
          const source = blocks.find((item) => item.content.includes("產品提案被臨時要求全部重做"))?.key;
          const target = blocks.find((item) => item.content.includes("昨晚翻來覆去一直睡不著"))?.key;
          const unrelated = blocks.find((item) => item.content.includes("陽台的薄荷長出新葉"))?.key;
          return { text: JSON.stringify({ connections: [
            { source, target, relationType: "possible_influence", reason: "提案突然重做可能與同日晚間難以入睡處於相同壓力脈絡，仍需本人確認", evidence: ["一則記錄提案被要求重做", "另一則記錄當晚睡不著"], confidence: 0.78 },
            { source, target: unrelated, relationType: "semantic", reason: "時間接近但缺少足夠共同意義", evidence: ["一則提到提案", "另一則提到植物"], confidence: 0.4 },
          ] }), model: payload.model, usage: null, finishReason: "stop" };
        }
        window.__brainSemanticQA.reportInput = prompt;
        return { text: "我有點在意你最近是不是撐得有些緊。**提案突然被要求全部重做**，本來就很容易讓人一直在腦中反覆盤算；同一段時間你又留下了睡不著的記錄，也許白天那種失去掌控感，到了晚上還沒有完全放過你。你似乎一邊努力把事情重新整理好，一邊又不太允許自己承認這次變動真的讓人很挫折。那種「還是得繼續做」的力氣很珍貴，但如果一直沒有地方放下來，也可能慢慢變成身體和情緒都在替你扛。不過，時間接近並不能證明前者造成後者，也可能和作息、其他工作或生活裡沒有寫下來的事情有關。我只是有點好奇：你最近是不是把太多注意力放在趕快恢復正常，反而沒留時間照顧那個其實已經很累的自己？如果下次工作又突然出現大變動，你願不願意先替自己留一小段真正停下來的時間，不急著解決、不急著表現得沒事，只看看當下最需要的是什麼？也許你不必每一次都立刻撐回原來的位置。", model: payload.model, usage: null, finishReason: "stop" };
      },
    },
  };
});

await page.goto(base, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /^隻言片語/ }).click();
const capture = page.getByPlaceholder(/此刻腦中閃過什麼/);
for (const text of ["產品提案被臨時要求全部重做", "昨晚翻來覆去一直睡不著", "陽台的薄荷長出新葉"]) {
  await capture.click();
  await capture.fill("");
  await capture.pressSequentially(text);
  await page.getByRole("button", { name: "留下來", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "留下來", exact: true }).click();
}
await page.waitForFunction(() => document.querySelectorAll(".fragment-stream article").length === 3);
await page.locator(".fragment-stream article").first().click({ button: "right" });
const fragmentMenu = await page.locator('[data-context-menu="fragment"]').isVisible();
await page.getByRole("menuitem", { name: "釘選片語" }).click();
await page.locator(".fragment-stream article.is-pinned").waitFor();
await page.screenshot({ path: path.join(output, "01-fragments.png"), fullPage: true });

await page.getByRole("button", { name: "第二大腦", exact: true }).click();
const brain = page.locator(".second-brain-page");
await brain.waitFor();
await page.waitForFunction(() => Number(document.querySelector(".second-brain-page")?.getAttribute("data-brain-nodes")) >= 10);
await page.waitForTimeout(800);
const brainNodeCount = Number(await brain.getAttribute("data-brain-nodes"));
const canvasVisible = await page.locator(".second-brain-page canvas").isVisible();
await page.screenshot({ path: path.join(output, "02-second-brain.png"), fullPage: true });

await page.getByRole("button", { name: "手動連結", exact: true }).click();
const accessNodes = page.locator("[data-brain-node-key]");
await accessNodes.nth(0).evaluate((element) => element.click());
await page.getByText(/已選第一個神經元/).waitFor();
await accessNodes.nth(1).evaluate((element) => element.click());
await page.waitForFunction(() => Number(document.querySelector(".second-brain-page")?.getAttribute("data-brain-persisted-links")) >= 1);
const manualLinkCreated = true;
await page.getByRole("button", { name: "連結中", exact: true }).click();

await page.getByRole("button", { name: "AI 整理連結", exact: true }).click();
await page.getByText(/AI 已建立 1 條語意關聯，並更新今日反思/).waitFor();
await page.waitForFunction(() => Number(document.querySelector(".second-brain-page")?.getAttribute("data-brain-persisted-links")) >= 2);
const aiLinkCreated = true;
const lowConfidenceRejected = Number(await brain.getAttribute("data-brain-persisted-links")) === 2;
await page.getByText(/時間接近並不能證明/).waitFor();
const autoReflectionUpdated = true;
const reportMarkdown = page.locator(".brain-report-markdown");
await reportMarkdown.locator("strong").getByText("提案突然被要求全部重做", { exact: true }).waitFor();
const markdownRendered = await reportMarkdown.locator("strong").getByText("提案突然被要求全部重做", { exact: true }).isVisible()
  && await reportMarkdown.locator("p").count() >= 3;
const reflectionSegmented = await reportMarkdown.locator("p").count() >= 3 && await reportMarkdown.locator("p").count() <= 4;
const reportVisibleText = await reportMarkdown.innerText();
const rawMarkdownHidden = !reportVisibleText.includes("**") && !reportVisibleText.includes("##");
const warmInsightStyle = reportVisibleText.startsWith("我有點在意你")
  && reportVisibleText.includes("我只是有點好奇")
  && await reportMarkdown.locator("h1, h2, h3, ul, ol, table").count() === 0;
const reportPanel = page.locator(".brain-report");
await reportPanel.evaluate((element) => new Promise((resolve) => requestAnimationFrame(() => resolve(element.classList.contains("has-overflow")))));
await page.locator(".brain-report.has-overflow").waitFor();
const defaultReportMetrics = await reportPanel.evaluate((element) => ({ width: element.getBoundingClientRect().width, overflow: getComputedStyle(element.querySelector(".brain-report-reading")).overflowY, footerCount: element.querySelectorAll(":scope > footer").length }));
const previewReading = reportPanel.locator(".brain-report-reading");
await previewReading.hover();
await page.mouse.wheel(0, 240);
await page.waitForFunction(() => (document.querySelector(".brain-report-reading")?.scrollTop || 0) > 0);
const previewScrollMetrics = await previewReading.evaluate((element) => ({ scrollTop: element.scrollTop, overflow: getComputedStyle(element).overflowY, scrollbarWidth: getComputedStyle(element).scrollbarWidth, webkitDisplay: getComputedStyle(element, "::-webkit-scrollbar").display }));
const previewScrollWithoutScrollbar = previewScrollMetrics.scrollTop > 0 && previewScrollMetrics.overflow === "auto" && previewScrollMetrics.scrollbarWidth === "none" && previewScrollMetrics.webkitDisplay === "none";
await previewReading.evaluate((element) => { element.scrollTop = 0; });
const metadataRemoved = defaultReportMetrics.footerCount === 0 && !(await reportPanel.innerText()).includes("google/gemini-3.8-flash") && !(await reportPanel.innerText()).includes("L LT");
await reportPanel.getByRole("button", { name: "展開閱讀", exact: true }).click();
const expandedReport = page.locator('.brain-report[role="dialog"]');
await expandedReport.waitFor();
await page.setViewportSize({ width: 1540, height: 440 });
const expandedReading = expandedReport.locator(".brain-report-reading");
await expandedReading.evaluate((element) => { element.scrollTop = 0; });
await expandedReading.hover();
await page.mouse.wheel(0, 420);
await page.waitForFunction(() => (document.querySelector('.brain-report[role="dialog"] .brain-report-reading')?.scrollTop || 0) > 0);
const expandedReportMetrics = await expandedReport.evaluate((element) => {
  const reading = element.querySelector(".brain-report-reading");
  const labelLayers = [...document.querySelectorAll(".brain-node-label-wrap")].map((label) => {
    let node = label;
    let maximum = 0;
    while (node && !node.classList?.contains("second-brain-page")) {
      const zIndex = Number.parseInt(getComputedStyle(node).zIndex, 10);
      if (Number.isFinite(zIndex)) maximum = Math.max(maximum, zIndex);
      node = node.parentElement;
    }
    return maximum;
  });
  return { width: element.getBoundingClientRect().width, background: getComputedStyle(element).backgroundColor, zIndex: Number(getComputedStyle(element).zIndex), maxLabelZ: Math.max(0, ...labelLayers), overflow: getComputedStyle(reading).overflowY, scrollTop: reading.scrollTop, scrollbarWidth: getComputedStyle(reading).scrollbarWidth, webkitDisplay: getComputedStyle(reading, "::-webkit-scrollbar").display, focused: document.activeElement === element, backdrop: Boolean(document.querySelector(".brain-report-backdrop")) };
});
const expandedReadingComfortable = expandedReportMetrics.width >= 900 && expandedReportMetrics.overflow === "auto" && expandedReportMetrics.scrollTop > 0 && expandedReportMetrics.scrollbarWidth === "none" && expandedReportMetrics.webkitDisplay === "none" && expandedReportMetrics.focused && expandedReportMetrics.backdrop;
const expandedOccludesLabels = expandedReportMetrics.background.startsWith("rgb(") && !expandedReportMetrics.background.includes("/") && expandedReportMetrics.zIndex > expandedReportMetrics.maxLabelZ;
await page.screenshot({ path: path.join(output, "03-brain-report-expanded.png"), fullPage: true });
await expandedReport.getByRole("button", { name: "收合閱讀", exact: true }).click();
await page.locator('.brain-report:not(.is-expanded)').waitFor();
await page.setViewportSize({ width: 1540, height: 960 });
await reportPanel.getByRole("button", { name: "縮到最小", exact: true }).click();
await page.locator(".brain-report.is-minimized").waitFor();
const minimizedMetrics = await reportPanel.evaluate((element) => ({ width: element.getBoundingClientRect().width, reading: element.querySelectorAll(".brain-report-reading").length }));
const minimizedReflectionWorks = minimizedMetrics.width < defaultReportMetrics.width && minimizedMetrics.reading === 0 && await reportPanel.getByRole("button", { name: "顯示今日反思", exact: true }).isVisible();
await page.screenshot({ path: path.join(output, "03-brain-report-minimized.png"), fullPage: true });
await reportPanel.getByRole("button", { name: "顯示今日反思", exact: true }).click();
await reportPanel.locator(".brain-report-reading").waitFor();
await page.locator("[data-brain-node-key]").filter({ hasText: "產品提案被臨時要求全部重做" }).evaluate((element) => element.click());
const semanticInspector = await page.locator(".brain-inspector-links").innerText();
const semanticLinkExplained = semanticInspector.includes("可能影響") && semanticInspector.includes("線索強度 78%") && semanticInspector.includes("提案被要求重做") && semanticInspector.includes("當晚睡不著");
const semanticAudit = await page.evaluate(() => ({
  organizeInput: window.__brainSemanticQA.organizeInput,
  reportInput: window.__brainSemanticQA.reportInput,
  organizeCalls: window.__brainSemanticQA.organizeCalls,
  structuredOutput: window.__brainSemanticQA.structuredOutput,
}));
const jsonRepairRetryWorks = semanticAudit.organizeCalls === 2 && semanticAudit.structuredOutput && semanticAudit.organizeInput.includes("上一個輸出不是完整 JSON");
const semanticPromptUsed = semanticAudit.organizeInput.includes("事件與狀態") && semanticAudit.organizeInput.includes("沒有相同詞仍可連結") && semanticAudit.organizeInput.includes("observed_at=") && semanticAudit.organizeInput.includes("time_gap_days=") && semanticAudit.organizeInput.includes('surface_overlap="none"');
const reportUsesSemanticEvidence = semanticAudit.reportInput.includes("產品提案被臨時要求全部重做") && semanticAudit.reportInput.includes("昨晚翻來覆去一直睡不著") && semanticAudit.reportInput.includes("一則記錄提案被要求重做") && semanticAudit.reportInput.includes("confidence=0.78");
const dailyReportCreated = true;
await page.screenshot({ path: path.join(output, "03-brain-report.png"), fullPage: true });
const editableHitTargetCount = Number(await brain.getAttribute("data-brain-editable-edge-hit-targets"));
const aiHitTargetConfigured = editableHitTargetCount === 2;
const aiEdgeAccess = page.locator('[data-brain-edge-origin="ai"]').first();
await aiEdgeAccess.dispatchEvent("contextmenu", { clientX: 620, clientY: 420 });
await page.locator(".brain-edge-menu").getByText(/提案突然重做可能/).waitFor();
await page.locator(".brain-edge-menu").getByRole("button", { name: "刪除這條連結", exact: true }).evaluate((element) => element.click());
await page.waitForFunction(() => Number(document.querySelector(".second-brain-page")?.getAttribute("data-brain-persisted-links")) === 1);
const aiRightClickDeleted = await page.locator('[data-brain-edge-origin="ai"]').count() === 0;

await page.getByRole("button", { name: "待辦", exact: true }).click();
await page.locator(".task-groups article").first().click({ button: "right" });
const taskMenu = await page.locator('[data-context-menu="task"]').isVisible();
await page.keyboard.press("Escape");
await page.getByRole("button", { name: "劃記", exact: true }).click();
await page.locator(".highlight-card").first().click({ button: "right" });
const highlightMenu = await page.locator('[data-context-menu="highlight"]').isVisible();
await page.keyboard.press("Escape");

await page.getByLabel("主要功能").getByRole("button", { name: "卡片庫", exact: true }).click();
await page.locator(".library-card").first().waitFor();
const cardVisual = await page.locator(".library-card").evaluateAll((cards) => ({
  backgrounds: [...new Set(cards.map((card) => getComputedStyle(card).backgroundColor))],
  before: getComputedStyle(cards[0], "::before").display,
  borderWidths: [...new Set(cards.map((card) => getComputedStyle(card).borderTopWidth))],
}));
const firstCard = page.locator(".library-card").first();
const deletedTitle = (await firstCard.locator("h3").textContent())?.trim();
await firstCard.click();
await page.locator("[data-card-menu-trigger]").click();
const editorMenu = await page.locator('[data-context-menu="card"]').isVisible();
await page.screenshot({ path: path.join(output, "04-card-menu.png"), fullPage: true });
await page.getByRole("menuitem", { name: "移到垃圾桶" }).click();
await page.getByRole("button", { name: "垃圾桶", exact: true }).click();
const trashedCard = page.locator(".library-card").filter({ hasText: deletedTitle || "" }).first();
await trashedCard.waitFor();
await trashedCard.click({ button: "right" });
await page.getByRole("menuitem", { name: "還原到卡片庫" }).click();
await trashedCard.waitFor({ state: "detached" });
const cardRestored = true;

await page.getByLabel("卡片庫分類").getByRole("button", { name: "卡片庫", exact: true }).click();
const restoredCard = page.locator(".library-card").filter({ hasText: deletedTitle || "" }).first();
await restoredCard.click({ button: "right" });
await page.getByRole("menuitem", { name: "移到垃圾桶" }).click();
await page.getByRole("button", { name: "垃圾桶", exact: true }).click();
const deleteCard = page.locator(".library-card").filter({ hasText: deletedTitle || "" }).first();
await deleteCard.click({ button: "right" });
await page.getByRole("menuitem", { name: /永久刪除/ }).click();
await deleteCard.waitFor({ state: "detached" });
const permanentDelete = true;

await page.getByRole("button", { name: "設定", exact: true }).click();
await page.getByRole("button", { name: "墨色", exact: true }).click();
const inkTheme = await page.evaluate(() => ({
  theme: document.documentElement.dataset.theme,
  canvas: getComputedStyle(document.documentElement).getPropertyValue("--canvas").trim(),
  text: getComputedStyle(document.documentElement).getPropertyValue("--text-1").trim(),
}));
await page.screenshot({ path: path.join(output, "05-ink-theme.png"), fullPage: true });
await page.getByLabel("主要功能").getByRole("button", { name: "第二大腦", exact: true }).click();
await page.locator(".second-brain-page canvas").waitFor();
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(output, "06-second-brain-ink.png"), fullPage: true });

const reportData = {
  fragmentMenu,
  taskMenu,
  highlightMenu,
  editorMenu,
  cardRestored,
  permanentDelete,
  cardVisual,
  brainNodeCount,
  canvasVisible,
  manualLinkCreated,
  aiLinkCreated,
  lowConfidenceRejected,
  autoReflectionUpdated,
  markdownRendered,
  reflectionSegmented,
  rawMarkdownHidden,
  warmInsightStyle,
  metadataRemoved,
  previewScrollWithoutScrollbar,
  expandedReadingComfortable,
  expandedOccludesLabels,
  minimizedReflectionWorks,
  jsonRepairRetryWorks,
  semanticLinkExplained,
  semanticPromptUsed,
  reportUsesSemanticEvidence,
  dailyReportCreated,
  aiHitTargetConfigured,
  aiRightClickDeleted,
  inkTheme,
  errors,
};
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(reportData, null, 2));
console.log(JSON.stringify(reportData, null, 2));
await browser.close();

if (
  !fragmentMenu || !taskMenu || !highlightMenu || !editorMenu || !cardRestored || !permanentDelete ||
  cardVisual.backgrounds.length !== 1 || cardVisual.before !== "none" || !canvasVisible || brainNodeCount < 10 ||
  !manualLinkCreated || !aiLinkCreated || !lowConfidenceRejected || !autoReflectionUpdated || !markdownRendered || !reflectionSegmented || !rawMarkdownHidden || !warmInsightStyle || !metadataRemoved || !previewScrollWithoutScrollbar || !expandedReadingComfortable || !expandedOccludesLabels || !minimizedReflectionWorks || !jsonRepairRetryWorks || !semanticLinkExplained || !semanticPromptUsed || !reportUsesSemanticEvidence || !dailyReportCreated || !aiHitTargetConfigured || !aiRightClickDeleted || inkTheme.theme !== "ink" || errors.length
) process.exitCode = 1;
