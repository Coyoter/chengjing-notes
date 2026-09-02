import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

function multiPagePdf(pageTexts) {
  const fontId = 3 + pageTexts.length * 2;
  const kids = pageTexts.map((_text, index) => `${3 + index * 2} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${pageTexts.length} >>`,
  ];
  pageTexts.forEach((text, index) => {
    const contentId = 4 + index * 2;
    const stream = `BT\n/F1 24 Tf\n72 720 Td\n(${text.replace(/[()\\]/g, "\\$&")}) Tj\nET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf).toString("base64");
}

const cdpEndpoint = process.env.CHENGJING_CDP || "";
const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/pdf-viewer");
await fs.mkdir(output, { recursive: true });
const pdfBase64 = multiPagePdf(["CHENGJING PDF PREVIEW PAGE ONE", "CHENGJING PDF PREVIEW PAGE TWO", "CHENGJING PDF PREVIEW PAGE THREE"]);
const browser = cdpEndpoint ? await chromium.connectOverCDP(cdpEndpoint) : await chromium.launch({ headless: true });
const context = cdpEndpoint ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 1540, height: 960 }, colorScheme: "dark", locale: "zh-TW" });
if (!cdpEndpoint) await context.addInitScript(() => {
  globalThis.__pdfSaveCount = 0;
  window.chengjing = {
    app: { getPreferredLanguage: async () => ({ language: "zh-TW", preferredLanguages: ["zh-Hant-TW"] }), setLanguage: async (language) => ({ language }), quit: async () => ({ quitting: true }) },
    updates: { check: async () => ({ status: "current", currentVersion: "0.7.1", latestVersion: "0.7.1", releaseName: "澄境 0.7.1", notes: "", publishedAt: "", htmlUrl: "", asset: null }), download: async () => ({ opened: false, status: "current" }), onProgress: () => () => {} },
    ai: { keyStatus: async () => ({ configured: false, encrypted: true, storage: "app-local-aes-256-gcm" }), listModels: async () => [], openRouterChat: async () => ({ text: "QA", model: "qa/model" }) },
    files: { save: async () => { globalThis.__pdfSaveCount += 1; return { canceled: true }; }, open: async () => ({ canceled: true, files: [] }) },
    onShortcut: () => () => {},
    platform: "darwin",
  };
});
const page = cdpEndpoint
  ? context.pages().find((candidate) => !candidate.url().includes("quick-capture")) || context.pages()[0]
  : await context.newPage();
page.setDefaultTimeout(20_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error" && !/Invalid PDF structure|InvalidPDFException/.test(message.text())) errors.push(`console: ${message.text()}`); });
if (cdpEndpoint) await page.locator(".app-shell").waitFor();
else await page.goto(base, { waitUntil: "networkidle" });

await page.evaluate(async ({ pdf, broken }) => {
  function bytes(value) { const binary = atob(value); return Uint8Array.from(binary, (character) => character.charCodeAt(0)); }
  async function attachment(id, name, data) {
    if (window.chengjing?.attachments) return window.chengjing.attachments.importData({ id, name, mime: "application/pdf", data, createdAt: Date.now() });
    const value = bytes(data);
    return { id, name, mime: "application/pdf", size: value.byteLength, blob: new Blob([value], { type: "application/pdf" }), storage: "indexeddb", createdAt: Date.now() };
  }
  const validAttachment = await attachment("qa-pdf-valid", "澄境 PDF 預覽驗收.pdf", pdf);
  const brokenAttachment = await attachment("qa-pdf-broken", "無法預覽的 PDF.pdf", broken);
  const database = await new Promise((resolve, reject) => { const request = indexedDB.open("chengjing"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const transaction = database.transaction(["cards", "attachments"], "readwrite");
  transaction.objectStore("attachments").put(validAttachment);
  transaction.objectStore("attachments").put(brokenAttachment);
  const baseCard = { contentHtml: "<h2>PDF 文字內容</h2><p>第一頁文字</p><p>第二頁文字</p><p>第三頁文字</p>", plainText: "PDF 文字內容\n第一頁文字\n第二頁文字\n第三頁文字", kind: "pdf", state: "active", createdAt: Date.now(), updatedAt: Date.now(), tagIds: [], favorite: false, color: "rose", properties: { 頁數: 3 }, taskSyncState: "synced", searchTerms: ["pdf", "預覽"] };
  transaction.objectStore("cards").put({ ...baseCard, id: "qa-pdf-card-valid", title: "澄境 PDF 預覽驗收", attachmentIds: [validAttachment.id] });
  transaction.objectStore("cards").put({ ...baseCard, id: "qa-pdf-card-broken", title: "無法預覽的 PDF", attachmentIds: [brokenAttachment.id], properties: { 頁數: 1 } });
  await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
}, { pdf: pdfBase64, broken: Buffer.from("not-a-valid-pdf").toString("base64") });

await page.getByRole("button", { name: "卡片庫", exact: true }).click();
await page.locator(".library-card").filter({ hasText: "澄境 PDF 預覽驗收" }).click();
const preview = page.locator(".pdf-document-preview");
await preview.waitFor();
await page.waitForFunction(() => { const canvas = document.querySelector(".pdf-document-preview canvas"); return Boolean(canvas && canvas.width > 400 && canvas.height > 500 && !canvas.closest(".is-rendering")); });
const canvasProof = await preview.locator("canvas").evaluate((canvas) => {
  const context = canvas.getContext("2d");
  const sample = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let darkPixels = 0;
  for (let index = 0; index < sample.length; index += 160) if (sample[index] < 245 || sample[index + 1] < 245 || sample[index + 2] < 245) darkPixels += 1;
  return { width: canvas.width, height: canvas.height, darkPixels };
});
const previewRendered = canvasProof.darkPixels > 3 && (await preview.innerText()).includes("3 頁") && await page.locator("embed.attachment-pdf").count() === 0;
const previewSurface = await preview.locator(".pdf-preview-stage").evaluate((element) => getComputedStyle(element).backgroundColor);
const previewNotBlankWhite = previewSurface !== "rgb(255, 255, 255)" && previewSurface !== "rgba(0, 0, 0, 0)";
await page.screenshot({ path: path.join(output, "01-pdf-preview-dark.png"), fullPage: true });

await preview.locator(".pdf-preview-stage").click();
const reader = page.locator(".pdf-reader-layer");
await reader.waitFor();
await page.waitForFunction(() => { const canvas = document.querySelector(".pdf-reader-stage canvas"); return Boolean(canvas && canvas.width > 400 && !canvas.closest(".is-rendering")); });
await reader.getByRole("button", { name: "下一頁", exact: true }).click();
await page.waitForFunction(() => document.querySelector(".pdf-reader-toolbar input")?.value === "2");
const pageNavigationWorks = await reader.locator(".pdf-reader-toolbar input").inputValue() === "2";
await reader.getByRole("button", { name: "放大", exact: true }).click();
const zoomWorks = await reader.locator(".pdf-reader-toolbar > span").innerText() === "115%";
await reader.press("ArrowRight");
await page.waitForFunction(() => document.querySelector(".pdf-reader-toolbar input")?.value === "3");
const keyboardNavigationWorks = true;
if (!cdpEndpoint) {
  await reader.getByRole("button", { name: "儲存副本", exact: true }).click();
  await page.waitForFunction(() => globalThis.__pdfSaveCount === 1);
}
const saveCopyWorks = Boolean(cdpEndpoint) || await page.evaluate(() => globalThis.__pdfSaveCount === 1);
await page.screenshot({ path: path.join(output, "02-pdf-reader.png"), fullPage: true });
await reader.getByRole("button", { name: "返回卡片", exact: true }).click();
await reader.waitFor({ state: "detached" });
const extractedTextRemains = (await page.locator(".card-editor-panel .prose-editor").innerText()).includes("第三頁文字");

const themeReports = {};
for (const theme of ["light", "dark", "ink"]) {
  await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
  await page.waitForTimeout(100);
  themeReports[theme] = await preview.evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, overflow: element.scrollWidth - element.clientWidth }));
  await page.screenshot({ path: path.join(output, `03-pdf-preview-${theme}.png`), fullPage: true });
}
const themesCoherent = Object.values(themeReports).every((item) => item.background !== "rgba(0, 0, 0, 0)" && item.overflow <= 1);
await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });

await page.setViewportSize({ width: 1100, height: 800 });
await page.evaluate(() => { document.documentElement.style.setProperty("--font-scale", "1.2"); });
await preview.locator(".pdf-preview-stage").click();
await page.locator(".pdf-reader-layer").waitFor();
const compactMetrics = await page.locator(".pdf-reader-layer").evaluate((element) => {
  const toolbar = element.querySelector(".pdf-reader-toolbar");
  return { rootOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, readerOverflow: element.scrollWidth - element.clientWidth, toolbarOverflow: toolbar.scrollWidth - toolbar.clientWidth };
});
const compactReaderWorks = compactMetrics.rootOverflow <= 1 && compactMetrics.readerOverflow <= 1 && compactMetrics.toolbarOverflow <= 1;
await page.locator(".pdf-reader-back").click();
await page.setViewportSize({ width: 1540, height: 960 });
await page.evaluate(() => { document.documentElement.style.setProperty("--font-scale", "1"); });

await page.locator(".card-back-button").click();
await page.locator(".library-card").filter({ hasText: "無法預覽的 PDF" }).click();
const fallback = page.locator(".pdf-document-preview.is-unavailable");
await fallback.waitFor();
const gracefulFallback = (await fallback.innerText()).includes("暫時無法產生預覽") && (await page.locator(".prose-editor").innerText()).includes("第一頁文字") && await page.locator("embed.attachment-pdf").count() === 0;
await page.screenshot({ path: path.join(output, "04-pdf-fallback.png"), fullPage: true });
page.once("dialog", (dialog) => dialog.accept());
await fallback.getByRole("button", { name: "移除附件", exact: true }).click();
await fallback.waitFor({ state: "detached" });
const removableWithoutDeletingText = (await page.locator(".prose-editor").innerText()).includes("第一頁文字");

const report = { previewRendered, previewNotBlankWhite, canvasProof, pageNavigationWorks, zoomWorks, keyboardNavigationWorks, saveCopyWorks, extractedTextRemains, themesCoherent, themeReports, compactReaderWorks, compactMetrics, gracefulFallback, removableWithoutDeletingText, errors };
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (cdpEndpoint) await page.evaluate(() => window.chengjing?.app?.quit?.()).catch(() => {});
await browser.close();
if (!previewRendered || !previewNotBlankWhite || !pageNavigationWorks || !zoomWorks || !keyboardNavigationWorks || !saveCopyWorks || !extractedTextRemains || !themesCoherent || !compactReaderWorks || !gracefulFallback || !removableWithoutDeletingText || errors.length) process.exitCode = 1;
