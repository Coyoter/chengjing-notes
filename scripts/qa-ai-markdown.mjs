import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/ai-markdown");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", locale: "zh-TW" });
await context.addInitScript(() => {
  const response = `### 一、現行工作職責

1. **理財內容營運與數據分析**
   - 佔整體工作量約 **50%～60%**。
   - 每週檢視成效數據與表現趨勢。
2. **合作夥伴營運**
   - 負責導入、權限設定與問題處理。

---

### 二、後續方向

> 這是仍需本人確認的整理，不代表唯一結論。

請先確認 \`KPI\`，再安排下一步。

| 項目 | 狀態 |
| --- | --- |
| 權限盤點 | 進行中 |
| 年度結算 | 待確認 |

[安全連結](https://example.com/guide)<script>window.bad=true</script><img src="https://tracker.example/pixel">`;
  window.chengjing = {
    app: { getPreferredLanguage: async () => ({ language: "zh-TW", preferredLanguages: ["zh-Hant-TW"] }), setLanguage: async (language) => ({ language }) },
    updates: { check: async () => ({ status: "current", currentVersion: "0.3.3", latestVersion: "0.3.3", releaseName: "澄境筆記 0.3.3", notes: "", publishedAt: "", htmlUrl: "", asset: null }), download: async () => ({ opened: false, status: "current" }), onProgress: () => () => {} },
    ai: { keyStatus: async () => ({ configured: true, encrypted: true, storage: "app-local-aes-256-gcm" }), setKey: async () => ({ configured: true, encrypted: true, storage: "app-local-aes-256-gcm" }), clearKey: async () => ({ configured: false, encrypted: true, storage: "app-local-aes-256-gcm" }), testOpenRouter: async () => ({ ok: true, label: "QA", limitRemaining: null, usage: null }), listModels: async () => [], openRouterChat: async (request) => ({ text: response, model: request.model, usage: null, finishReason: "stop" }), embeddings: async () => ({ embeddings: [[1, 0]], model: "qa", usage: null }) },
    files: { save: async () => ({ canceled: true }), open: async () => ({ canceled: true, files: [] }) }, web: { read: async () => { throw new Error("unused"); } }, onShortcut: () => () => {}, platform: "darwin",
  };
});

const page = await context.newPage();
page.setDefaultTimeout(20_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
await page.goto(base, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "詢問 AI", exact: true }).click();
const panel = page.locator(".ai-panel");
await panel.waitFor();
await panel.locator(".ai-composer textarea").fill("請盤點目前工作職責");
await panel.getByRole("button", { name: "送出", exact: true }).click();
const userBubble = panel.locator(".ai-message.is-user").last();
const userBubbleMetrics = await userBubble.evaluate((element) => { const box = element.getBoundingClientRect(); const content = element.querySelector(".ai-message-plain").getBoundingClientRect(); return { height: box.height, contentInset: content.top - box.top, visualIdentityLabels: element.querySelectorAll("header").length, ariaLabel: element.getAttribute("aria-label") }; });
const compactUserBubble = userBubbleMetrics.height <= 52 && userBubbleMetrics.contentInset <= 12 && userBubbleMetrics.visualIdentityLabels === 0 && userBubbleMetrics.ariaLabel === "你";
const markdown = panel.locator(".ai-message-markdown").last();
await markdown.getByRole("heading", { name: "一、現行工作職責", exact: true }).waitFor();
const markdownStructureRendered = await markdown.locator("h3").count() === 2
  && await markdown.locator("ol > li").count() === 2
  && await markdown.locator("ul > li").count() === 3
  && await markdown.locator("strong").count() >= 3
  && await markdown.locator("hr").count() === 1
  && await markdown.locator("blockquote").count() === 1
  && await markdown.locator("code").getByText("KPI", { exact: true }).isVisible()
  && await markdown.locator("table").count() === 1;
const visibleText = await markdown.innerText();
const rawSyntaxHidden = !visibleText.includes("###") && !visibleText.includes("**") && !visibleText.includes("---") && !visibleText.includes("`");
const unsafeContentRemoved = await markdown.locator("script, img").count() === 0 && await page.evaluate(() => window.bad !== true);
const safeLink = markdown.getByRole("link", { name: "安全連結", exact: true });
const safeLinkAttributes = await safeLink.getAttribute("target") === "_blank" && await safeLink.getAttribute("rel") === "noopener noreferrer";
const readingMetrics = await markdown.evaluate((element) => ({ overflow: element.scrollWidth - element.clientWidth, minFontSize: Math.min(...[...element.querySelectorAll("p, li, code, th, td")].map((item) => Number.parseFloat(getComputedStyle(item).fontSize))) }));
const narrowPanelReadable = readingMetrics.overflow <= 1 && readingMetrics.minFontSize >= 12;
await page.screenshot({ path: path.join(output, "01-ai-markdown.png"), fullPage: true });

const assistantMessage = panel.locator(".ai-message.is-assistant").last();
await assistantMessage.hover();
await assistantMessage.getByRole("button", { name: "存成卡片", exact: true }).click();
const savedCardUsesFormattedHtml = await page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open("chengjing");
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const query = request.result.transaction("cards", "readonly").objectStore("cards").getAll();
    query.onsuccess = () => { const card = query.result.find((item) => item.kind === "ai"); resolve(Boolean(card?.contentHtml.includes("<h3>") && card?.contentHtml.includes("<table>") && !card?.contentHtml.includes("<script"))); };
  };
}));

const report = { compactUserBubble, userBubbleMetrics, markdownStructureRendered, rawSyntaxHidden, unsafeContentRemoved, safeLinkAttributes, narrowPanelReadable, savedCardUsesFormattedHtml, readingMetrics, errors };
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (!compactUserBubble || !markdownStructureRendered || !rawSyntaxHidden || !unsafeContentRemoved || !safeLinkAttributes || !narrowPanelReadable || !savedCardUsesFormattedHtml || errors.length) process.exitCode = 1;
