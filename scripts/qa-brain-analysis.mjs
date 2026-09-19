import { chromium } from "playwright";
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: "zh-TW", viewport: { width: 1440, height: 960 } });
try {
  await page.addInitScript(() => {
    window.__brainCalls = [];
    window.chengjing = { onShortcut: () => () => {}, ai: {
      keyStatus: async () => ({ configured: true }), listModels: async () => [],
      openRouterChat: async (request) => {
        window.__brainCalls.push({ maxTokens: request.maxTokens, prompt: request.messages.map((m) => m.content).join("\n") });
        return { text: JSON.stringify({ connections: [{ source: "card:analysis-a", target: "card:analysis-b", relationType: "shared_context", confidence: 0.8, reason: "兩則內容可能反映相同的工作規劃脈絡", evidence: ["整理工作規劃", "確認工作時程"] }] }), model: request.model, finishReason: "stop", usage: null };
      },
    } };
  });
  await page.goto(process.env.CHENGJING_URL || "http://127.0.0.1:5173", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const { db } = await import("/src/db.ts");
    await db.transaction("rw", [db.cards, db.tasks, db.boards, db.boardNodes, db.brainEdges], async () => {
      await db.cards.clear(); await db.tasks.clear(); await db.boards.clear(); await db.boardNodes.clear(); await db.brainEdges.clear();
    });
    const now = Date.now();
    for (const [id, text] of [["analysis-a", "整理工作規劃"], ["analysis-b", "確認工作時程"], ["analysis-c", "先前已保留的內容"]]) await db.cards.put({ id, title: text, plainText: text, contentHtml: `<p>${text}</p>`, state: "active", kind: "note", createdAt: now, updatedAt: now, favorite: false, tagIds: [], attachmentIds: [], color: "slate", properties: {} });
    await db.brainEdges.put({ id: "preserved-link", sourceType: "card", sourceId: "analysis-b", targetType: "card", targetId: "analysis-c", origin: "ai", reason: "已建立的其他關係", createdAt: now });
  });
  await page.getByRole("button", { name: "第二大腦", exact: true }).click();
  const organize = page.getByRole("button", { name: "AI 整理連結", exact: true });
  await organize.click();
  await page.getByText(/連結已保存/).waitFor();
  const result = await page.evaluate(async () => {
    const { db } = await import("/src/db.ts");
    return { calls: window.__brainCalls.length, preserved: Boolean(await db.brainEdges.get("preserved-link")), reports: await db.brainReports.count(), promptChars: window.__brainCalls[0].prompt.length };
  });
  assert.equal(result.calls, 1); assert.ok(result.preserved); assert.equal(result.reports, 0);
  await organize.click(); await page.getByText(/這批內容已整理/).waitFor();
  assert.equal(await page.evaluate(() => window.__brainCalls.length), 1);
  console.log(JSON.stringify({ ...result, unchangedDoesNotResend: true, noAutomaticReflection: true }));
} catch (error) { console.log((await page.locator("body").innerText()).slice(-1200)); throw error; }
finally { await browser.close(); }
