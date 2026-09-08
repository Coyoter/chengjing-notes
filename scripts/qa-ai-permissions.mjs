// Fresh browser profile and mocked model only. Never attach to an installed app.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const browser = await chromium.launch({ headless: true });
const output = path.resolve("qa-artifacts/ai-permissions");
await fs.mkdir(output, { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: "zh-TW", colorScheme: "dark" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(process.env.CHENGJING_URL || "http://127.0.0.1:5199", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const { useAppStore } = await import("/src/store.ts");
    useAppStore.getState().setLanguage("zh-TW");
    useAppStore.getState().setAIAutoApply(false);
    useAppStore.getState().setAIEngine("openrouter");
    window.chengjing = { platform: "darwin", ai: { openRouterChat: async request => {
      const prompt = request.messages.at(-1).content;
      let plan;
      if (prompt.includes("你有權限")) plan = { summary: "可批次處理工作內容。", actions: [] };
      else if (prompt.includes("清空測試待辦")) plan = { summary: "清除測試待辦", actions: [{ type: "workspace_tool", tool: "chengjing_delete_items", arguments: { table: "tasks", all: true }, description: "刪除全部待辦" }] };
      else plan = { summary: "新增 120 筆測試待辦", actions: Array.from({ length: 120 }, (_, i) => ({ type: "create_task", title: `Permission QA ${i}`, description: `新增待辦 ${i}` })) };
      return { text: JSON.stringify(plan), model: request.model, usage: null, finishReason: "stop" };
    } } };
    useAppStore.getState().openAI();
  });
  const panel = page.locator(".ai-panel");
  await panel.waitFor();
  await panel.getByRole("button", { name: "先預覽", exact: true }).click();
  assert.equal(await panel.getByRole("button", { name: "直接執行", exact: true }).getAttribute("aria-pressed"), "true");
  await panel.locator("textarea").fill("請新增 120 個測試待辦");
  await panel.getByRole("button", { name: "送出", exact: true }).click();
  await panel.getByText("已完成 120 個變更。", { exact: true }).waitFor();
  assert.equal(await panel.locator(".ai-action-plan").count(), 0);
  const taskCount = () => page.evaluate(async () => { const { db } = await import("/src/db.ts"); return db.tasks.filter(task => task.title.startsWith("Permission QA")).count(); });
  assert.equal(await taskCount(), 120);
  await panel.locator("textarea").fill("你有權限刪除所有內容嗎？");
  await panel.getByRole("button", { name: "送出", exact: true }).click();
  await panel.getByText("可批次處理工作內容。", { exact: true }).waitFor();
  assert.equal(await taskCount(), 120);
  await page.screenshot({ path: path.join(output, "desktop-direct.png") });
  await panel.getByRole("button", { name: "直接執行", exact: true }).click();
  await panel.locator("textarea").fill("清空測試待辦");
  await panel.getByRole("button", { name: "送出", exact: true }).click();
  await panel.locator(".ai-action-plan").waitFor();
  assert.equal(await taskCount(), 120);
  await panel.getByRole("button", { name: "套用 1 個變更", exact: true }).click();
  await panel.getByText("已完成 1 個變更。", { exact: true }).waitFor();
  assert.equal(await taskCount(), 0);
  await page.evaluate(async () => { const { undoGlobalAction } = await import("/src/lib/globalHistory.ts"); await undoGlobalAction(); });
  // Chat receipts may be the newest Undo entry; undo until the data batch.
  if (await taskCount() === 0) await page.evaluate(async () => { const { undoGlobalAction } = await import("/src/lib/globalHistory.ts"); await undoGlobalAction(); });
  assert.equal(await taskCount(), 120);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    document.documentElement.dataset.platform = "android";
    window.chengjing.platform = "android";
    const { useAppStore } = await import("/src/store.ts");
    useAppStore.setState({ rightPanel: "none" });
    useAppStore.getState().openAI();
  });
  await panel.locator(".ai-permission-toggle").waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(output, "mobile-preview.png") });
  const geometry = await panel.locator(".ai-permission-toggle").evaluate(button => {
    const rect = button.getBoundingClientRect();
    return { height: rect.height, width: rect.width, visible: rect.left >= 0 && rect.right <= innerWidth, fits: button.scrollWidth <= button.clientWidth };
  });
  assert.ok(geometry.visible && geometry.fits && geometry.height >= 44);
  assert.deepEqual(errors, []);
  const result = { automatic120Tasks: true, capabilityQuestionDoesNotDelete: true, previewDoesNotWrite: true, bulkDeleteAndUndo: true, mobileGeometry: geometry, errors };
  await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
