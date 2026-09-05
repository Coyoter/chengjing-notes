import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

function minimalPdf(text) {
  const stream = `BT\n/F1 15 Tf\n72 720 Td\n(${text.replace(/[()\\]/g, "\\$&")}) Tj\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf).toString("base64");
}

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/knowledge-library");
await fs.mkdir(output, { recursive: true });
const pdfBase64 = minimalPdf("Confidential documents remain on this Mac and never leave the local device.");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1480, height: 920 }, colorScheme: "dark", locale: "zh-TW" });
await context.addInitScript(({ pdf }) => {
  window.chengjing = {
    app: { getPreferredLanguage: async () => ({ language: "zh-TW", preferredLanguages: ["zh-Hant-TW"] }), setLanguage: async (language) => ({ language }) },
    updates: { check: async () => ({ status: "current", currentVersion: "0.3.5", latestVersion: "0.3.5", releaseName: "澄境筆記 0.3.5", notes: "", publishedAt: "", htmlUrl: "", asset: null }), download: async () => ({ opened: false, status: "current" }), onProgress: () => () => {} },
    ai: { keyStatus: async () => ({ configured: true, encrypted: true, storage: "app-local-aes-256-gcm" }), setKey: async () => ({ configured: true, encrypted: true, storage: "app-local-aes-256-gcm" }), clearKey: async () => ({ configured: false, encrypted: true, storage: "app-local-aes-256-gcm" }), testOpenRouter: async () => ({ ok: true, label: "QA", limitRemaining: null, usage: null }), listModels: async () => [], openRouterChat: async (request) => ({ text: "QA", model: request.model, usage: null, finishReason: "stop" }) },
    files: { save: async () => ({ canceled: true }), open: async () => ({ canceled: false, files: [{ name: "Private-Source.pdf", path: "/qa/Private-Source.pdf", data: pdf }] }) },
    web: { read: async (url) => ({ title: "QA Web", byline: "", excerpt: "", content: "<p>QA</p>", textContent: "QA", siteName: "QA", url }) },
    onShortcut: () => () => {}, platform: "darwin",
  };
}, { pdf: pdfBase64 });

const page = await context.newPage();
page.setDefaultTimeout(20_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error" && !message.text().includes('unique "key" prop')) errors.push(`console: ${message.text()}`); });
await page.goto(base, { waitUntil: "networkidle" });

const knowledgeNavigationRemoved = await page.getByRole("button", { name: "知識問答", exact: true }).count() === 0;
const retiredIndexStoreRemoved = await page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open("chengjing");
  request.onerror = () => reject(request.error);
  request.onsuccess = () => resolve(!request.result.objectStoreNames.contains("ragChunks"));
}));

await page.getByRole("button", { name: "卡片庫", exact: true }).click();
await page.locator(".library-organizer").waitFor();
const productTopic = page.locator(".library-organizer .knowledge-topic").filter({ hasText: "產品研究" });
const workArea = page.locator(".library-organizer .knowledge-area").filter({ hasText: "工作" });
const seedHierarchyVisible = await productTopic.isVisible() && await workArea.isVisible();

await page.getByRole("button", { name: "新增領域", exact: true }).click();
await page.locator(".knowledge-group-form input").fill("個人");
await page.locator(".knowledge-group-form").getByRole("button", { name: "儲存", exact: true }).click();
await page.locator(".library-organizer .knowledge-area").filter({ hasText: "個人" }).waitFor();
await page.getByRole("button", { name: "新增主題 · 個人", exact: true }).click();
await page.locator(".knowledge-group-form.is-topic input").fill("閱讀計畫");
await page.locator(".knowledge-group-form.is-topic").getByRole("button", { name: "儲存", exact: true }).click();
const readingTopic = page.locator(".library-organizer .knowledge-topic").filter({ hasText: "閱讀計畫" });
await readingTopic.waitFor();
await readingTopic.click({ button: "right" });
await page.locator(".knowledge-context-menu").getByRole("menuitem", { name: "重新命名", exact: true }).click();
await page.locator(".knowledge-rename-dialog input").fill("深度閱讀");
await page.locator(".knowledge-rename-dialog").getByRole("button", { name: "儲存", exact: true }).click();
const renamedTopic = page.locator(".library-organizer .knowledge-topic").filter({ hasText: "深度閱讀" });
await renamedTopic.waitFor();
const hierarchyCrudWorks = true;

await productTopic.click();
await page.getByRole("button", { name: "新增卡片", exact: true }).click();
const createModal = page.locator(".unified-create-modal");
await createModal.waitFor();
const unifiedModesVisible = await createModal.getByRole("button", { name: /筆記/ }).isVisible()
  && await createModal.getByRole("button", { name: /網頁/ }).isVisible()
  && await createModal.getByRole("button", { name: /檔案/ }).isVisible();
await createModal.getByRole("button", { name: /檔案/ }).click();
const fileTypesVisible = (await Promise.all(["PDF / DOCX / MD", "PNG / JPG / WebP", "MP3 / WAV", "MP4 / MOV"].map((text) => createModal.getByText(text, { exact: true }).isVisible()))).every(Boolean);
await createModal.getByRole("button", { name: "選擇檔案", exact: true }).click();
await page.waitForFunction(() => document.querySelector(".card-editor-panel .card-title-input")?.value === "Private Source").catch(async (error) => {
  console.error(JSON.stringify({ importState: await createModal.innerText().catch(() => "closed"), errors }));
  throw error;
});
const importedPdfPreview = page.locator(".pdf-document-preview");
await importedPdfPreview.waitFor();
await page.waitForFunction(() => { const canvas = document.querySelector(".pdf-document-preview canvas"); return Boolean(canvas && canvas.width > 100 && canvas.height > 100); });
const pdfPreviewRendered = await importedPdfPreview.locator("canvas").evaluate((canvas) => canvas.width > 100 && canvas.height > 100)
  && await page.locator("embed.attachment-pdf").count() === 0;
await importedPdfPreview.locator(".pdf-preview-stage").click();
await page.locator(".pdf-reader-layer").waitFor();
const pdfReaderOpens = await page.locator(".pdf-reader-layer canvas").count() === 1;
await page.locator(".pdf-reader-back").click();
await page.screenshot({ path: path.join(output, "02-pdf-preview.png"), fullPage: true });
await page.getByRole("button", { name: "返回卡片庫", exact: true }).click();
await productTopic.click();
const pdfCard = page.locator('.library-card[data-card-kind="pdf"]').filter({ hasText: "Private Source" });
await pdfCard.waitFor();
const pdfImported = await pdfCard.getByText("PDF", { exact: true }).isVisible() && (await pdfCard.innerText()).includes("工作 / 產品研究");
const pdfData = await page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open("chengjing");
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const query = request.result.transaction("cards", "readonly").objectStore("cards").getAll();
    query.onsuccess = () => {
      const card = query.result.find((item) => item.title === "Private Source");
      resolve({ kind: card?.kind, text: card?.plainText || "", collectionId: card?.collectionId });
    };
  };
}));
const pdfTextExtracted = pdfData.kind === "pdf" && pdfData.text.includes("Confidential documents remain on this Mac") && Boolean(pdfData.collectionId);
await pdfCard.dragTo(renamedTopic);
await renamedTopic.click();
await page.locator('.library-card[data-card-kind="pdf"]').filter({ hasText: "Private Source" }).waitFor();
const dragClassificationWorks = true;
await page.screenshot({ path: path.join(output, "01-library-hierarchy.png"), fullPage: true });

const report = { knowledgeNavigationRemoved, retiredIndexStoreRemoved, seedHierarchyVisible, hierarchyCrudWorks, unifiedModesVisible, fileTypesVisible, pdfImported, pdfTextExtracted, pdfPreviewRendered, pdfReaderOpens, dragClassificationWorks, errors };
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (!knowledgeNavigationRemoved || !retiredIndexStoreRemoved || !seedHierarchyVisible || !hierarchyCrudWorks || !unifiedModesVisible || !fileTypesVisible || !pdfImported || !pdfTextExtracted || !pdfPreviewRendered || !pdfReaderOpens || !dragClassificationWorks || errors.length) process.exitCode = 1;
