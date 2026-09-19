import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: "zh-TW" });
const errors = []; page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") console.log("browser:", message.text()); });
try {
  await page.goto(process.env.CHENGJING_URL || "http://127.0.0.1:5173", { waitUntil: "networkidle" });
  const report = await page.evaluate(async () => {
    const { db } = await import("/src/db.ts");
    const { buildBrainGraph, buildBrainSemanticContext } = await import("/src/lib/brain.ts");
    const { planBrainAnalysis } = await import("/src/lib/brainAnalysis.ts");
    const now = Date.now();
    const cards = Array.from({ length: 10000 }, (_, i) => ({ id: `perf-${i}`, title: `合成研究${i}`, plainText: (`這是資料庫效能測試的第${i}張卡片，研究與工作流程。`).repeat(40), contentHtml: "<p>測試</p>", kind: "note", state: "active", tagIds: [], favorite: false, color: "slate", attachmentIds: [], properties: {}, createdAt: now - i * 86400000, updatedAt: now - i * 86400000, searchTerms: [] }));
    cards[9999].plainText += "很久以前的完整內容查找驗證";
    const native = db.backendDB();
    await new Promise((resolve, reject) => { const tx = native.transaction("cards", "readwrite"); const store = tx.objectStore("cards"); cards.forEach((card) => store.put(card)); tx.oncomplete = resolve; tx.onerror = reject; });
    const start = performance.now();
    const baseline = buildBrainGraph({ cards, tasks: [], boards: [], boardNodes: [], tags: [], storedEdges: [], fragments: [] });
    const baselineMs = performance.now() - start;
    let ticks = 0; const timer = setInterval(() => ticks++, 10);
    async function load(query = "", page = 0) {
      const worker = new Worker(new URL("/src/lib/brainWorkspace.worker.ts", location.href), { type: "module" });
      try { return await new Promise((resolve, reject) => { worker.onmessage = ({ data }) => data.error ? reject(Error(data.error)) : resolve(data.result); worker.onerror = (error) => reject(Error(error.message)); worker.postMessage({ database: db.name, language: "zh-TW", query, page }); }); }
      finally { worker.terminate(); }
    }
    const first = await load(); const backgroundTicks = ticks;
    const second = await load("", 1);
    const old = await load("很久以前的完整內容查找驗證");
    clearInterval(timer);
    const prior = buildBrainSemanticContext(baseline.nodes);
    const current = planBrainAnalysis(first.graph.nodes, [], {});
    return { baselineMs, backgroundMs: first.elapsedMs, backgroundTicks, workingNodes: first.graph.nodes.length, hasMore: first.hasMore, pageChanged: first.graph.nodes[0].key !== second.graph.nodes[0].key, oldFound: old.graph.nodes.some((node) => node.key === "card:perf-9999"), oldPromptChars: prior.text.length, newPromptChars: current.text.length };
  });
  assert.ok(report.workingNodes <= 1400); assert.ok(report.hasMore && report.pageChanged && report.oldFound); assert.ok(report.backgroundTicks > 0); assert.ok(report.newPromptChars < report.oldPromptChars);
  console.log(JSON.stringify(report));
  // Exact deterministic assertion; interactive exploration uses the shared TypeSafe helper.
  await page.getByRole("button", { name: "第二大腦", exact: true }).click();
  await page.waitForFunction(() => Number(document.querySelector(".second-brain-page")?.getAttribute("data-brain-nodes")) >= 1000);
  const rendered = Number(await page.locator(".second-brain-page").getAttribute("data-brain-rendered-nodes"));
  assert.ok(rendered <= 200);
  await fs.mkdir("qa-artifacts/brain-performance", { recursive: true });
  await page.screenshot({ path: "qa-artifacts/brain-performance/desktop.png" });
  assert.deepEqual(errors, []);
  const result = { syntheticCards: 10000, ...report, rendered, errors };
  await fs.writeFile("qa-artifacts/brain-performance/summary.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.log("STATE", (await page.locator("body").innerText()).slice(-1800), errors); throw error; }
finally { await browser.close(); }
