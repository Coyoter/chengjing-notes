import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import electronPath from "electron";
import { chromium } from "playwright";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const require = createRequire(import.meta.url);
const { readOrCreateMcpToken } = require("../electron/mcp-settings.cjs");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(address.port)); });
  });
}

const tempData = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-integrations-"));
const debugPort = await freePort(); const mcpPort = await freePort(); const providerPort = await freePort();
let providerChatRequests = 0; const providerResponsesBodies = [];
const providerMock = createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/v1/models") { response.end(JSON.stringify({ data: [{ id: "qwen3:8b", name: "Qwen 3 8B" }] })); return; }
  if (request.url === "/v1/chat/completions") { providerChatRequests += 1; const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); response.end(JSON.stringify({ model: body.model, choices: [{ message: { content: "本機 Provider 回覆正常" }, finish_reason: "stop" }], usage: { total_tokens: 8 } })); return; }
  if (request.url === "/v1/responses") { providerChatRequests += 1; const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); providerResponsesBodies.push(body); response.end(JSON.stringify({ model: body.model, status: "completed", output_text: "本機 Provider 回覆正常", usage: { total_tokens: 8 } })); return; }
  response.statusCode = 404; response.end(JSON.stringify({ error: { message: "not found" } }));
});
await new Promise((resolve, reject) => { providerMock.once("error", reject); providerMock.listen(providerPort, "127.0.0.1", resolve); });
const packagedExecutable = process.env.CHENGJING_PACKAGED_APP || "";
const executable = packagedExecutable || electronPath;
const executableArgs = packagedExecutable ? [`--remote-debugging-port=${debugPort}`] : [".", `--remote-debugging-port=${debugPort}`];
const child = spawn(executable, executableArgs, { cwd: process.cwd(), env: { ...process.env, CHENGJING_SMOKE: "1", CHENGJING_SMOKE_USER_DATA: tempData }, stdio: ["ignore", "pipe", "pipe"] });
let output = ""; child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { output += chunk; });
let browser; let client;

try {
  const deadline = Date.now() + 15_000;
  while (true) {
    try { if ((await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(`Electron 啟動逾時：${output.slice(-1200)}`);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  const page = browser.contexts()[0].pages()[0]; page.setDefaultTimeout(12_000); await page.getByText("今天想釐清什麼？").waitFor();
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const jumpNav = page.locator(".settings-jump-nav"); await jumpNav.waitFor(); const anchorCount = await jumpNav.getByRole("link").count();
  await jumpNav.screenshot({ path: "/tmp/chengjing-settings-anchors.png" });
  const initialSettingsScroll = await page.locator(".settings-page").evaluate((element) => element.scrollTop);
  await jumpNav.getByRole("link", { name: "打賞", exact: true }).click();
  await page.waitForFunction((before) => { const target = document.getElementById("support-author").getBoundingClientRect(); const viewport = document.querySelector(".settings-page").getBoundingClientRect(); return document.querySelector(".settings-page").scrollTop > before + 100 && target.top < viewport.bottom && target.bottom > viewport.top; }, initialSettingsScroll);
  await jumpNav.getByRole("link", { name: "語言", exact: true }).click();
  await page.waitForFunction(() => Math.abs(document.getElementById("language-settings").getBoundingClientRect().top - document.querySelector(".settings-page").getBoundingClientRect().top) < 30);
  const anchorScrollWorks = true;
  const mcpInitiallyCollapsed = !(await page.locator("#mcp-settings").evaluate((element) => element.open));
  await page.locator("#mcp-settings").screenshot({ path: "/tmp/chengjing-mcp-collapsed.png" });
  await jumpNav.getByRole("link", { name: "外部整合", exact: true }).click(); await page.waitForFunction(() => document.getElementById("mcp-settings").open);
  const anchorDisclosureWorks = mcpInitiallyCollapsed;
  await page.locator("#mcp-settings > summary").click();
  await jumpNav.getByRole("link", { name: "外觀", exact: true }).click(); await page.locator(".font-scale-setting button").filter({ hasText: "大字" }).click();
  await jumpNav.getByRole("link", { name: "AI", exact: true }).click();
  const engineChoices = page.locator(".engine-choice-grid > button"); await engineChoices.first().waitFor();
  const provider = page.locator(".advanced-provider"); await provider.waitFor();
  const modelDisclosure = page.locator(".engine-config-section");
  const defaultEngineOrganized = await modelDisclosure.evaluate((element) => element.open) && !(await provider.evaluate((element) => element.open)) && await page.locator(".active-engine-settings").getByText("OpenRouter API 金鑰", { exact: true }).isVisible();
  await page.locator("#ai-settings").screenshot({ path: "/tmp/chengjing-settings-openrouter.png" });
  await modelDisclosure.screenshot({ path: "/tmp/chengjing-settings-openrouter-models.png" });
  await engineChoices.filter({ hasText: "Gemma 4 E2B" }).click();
  await page.waitForFunction(() => !document.querySelector(".engine-config-section").open && !document.querySelector(".advanced-provider").open && document.querySelector(".active-engine-settings")?.innerText.includes("Gemma 4 E2B"));
  const engineSurfaceReport = await page.evaluate(() => {
    const original = document.documentElement.dataset.theme; const reports = {};
    for (const theme of ["light", "dark", "ink"]) { document.documentElement.dataset.theme = theme; const section = getComputedStyle(document.getElementById("ai-settings")).backgroundColor; const card = getComputedStyle(document.querySelector(".engine-runtime-card")).backgroundColor; const action = getComputedStyle(document.querySelector(".engine-runtime-card .model-storage")).backgroundColor; reports[theme] = { section, card, action, separated: section !== card && card !== action }; }
    document.documentElement.dataset.theme = original; return reports;
  });
  const engineSurfaceHierarchy = Object.values(engineSurfaceReport).every((item) => item.separated);
  await page.locator("#ai-settings").screenshot({ path: "/tmp/chengjing-settings-gemma.png" });
  await modelDisclosure.locator(":scope > summary").click(); await modelDisclosure.locator(".featured-models > button").first().waitFor(); const inactiveModelsRemainAccessible = await modelDisclosure.locator(".featured-models > button").count() === 3;
  const geminiPresetUpdated = await modelDisclosure.getByRole("button", { name: /Gemini 3\.8 Flash.*google\/gemini-3\.8-flash/ }).count() === 1
    && await modelDisclosure.getByText("Gemini 3.7 Flash", { exact: true }).count() === 0;
  await modelDisclosure.locator(":scope > summary").click();
  const customChoice = engineChoices.filter({ hasText: "自訂 AI Provider" }); await customChoice.click();
  await page.waitForFunction(() => document.querySelector(".advanced-provider").open && !document.querySelector(".engine-config-section").open && !document.querySelector(".active-engine-settings"));
  const engineDisclosureWorks = defaultEngineOrganized && inactiveModelsRemainAccessible;
  if (!(await provider.evaluate((element) => element.open))) await provider.locator(":scope > summary").click();
  const formInputs = provider.locator(".provider-form input");
  await formInputs.nth(1).fill("qwen3:8b"); await formInputs.nth(2).fill(`http://127.0.0.1:${providerPort}/v1`); await formInputs.nth(3).fill("qa-provider-secret");
  await provider.locator(".provider-api-mode button").filter({ hasText: "Responses API" }).click();
  await provider.locator('.provider-form button[type="submit"]').click(); await provider.getByText("連線已安全儲存。").waitFor();
  await provider.getByRole("button", { name: "測試連線", exact: true }).click(); await provider.getByText("連線正常，找到 1 個模型。").waitFor();
  const providerSettings = await page.evaluate(() => window.chengjing.ai.providerSettings());
  const providerReply = await page.evaluate((profileId) => window.chengjing.ai.providerChat({ profileId, model: "qwen3:8b", messages: [{ role: "user", content: "測試" }] }), providerSettings.selectedProfileId);
  await page.getByRole("button", { name: "詢問 AI", exact: true }).click();
  const aiPanel = page.locator(".ai-panel"); await aiPanel.locator("textarea").fill("請測試自訂 Provider"); await aiPanel.getByRole("button", { name: "送出", exact: true }).click(); await aiPanel.getByText("本機 Provider 回覆正常", { exact: true }).waitFor();
  await aiPanel.getByRole("button", { name: "關閉 AI", exact: true }).click();
  const providerFiles = await fs.readdir(tempData); const providerPlaintextLeak = (await Promise.all(providerFiles.map(async (name) => fs.readFile(path.join(tempData, name)).then((value) => value.includes(Buffer.from("qa-provider-secret"))).catch(() => false)))).some(Boolean);
  const providerGeometry = await provider.evaluate((element) => ({ fits: element.scrollWidth <= element.clientWidth + 1, width: element.getBoundingClientRect().width, formWidth: element.querySelector(".provider-form")?.getBoundingClientRect().width || 0 }));
  await provider.screenshot({ path: "/tmp/chengjing-provider-settings.png" });

  const mcpSection = page.locator(".mcp-section"); await mcpSection.scrollIntoViewIfNeeded(); await mcpSection.waitFor();
  await page.evaluate((port) => window.chengjing.mcp.updateSettings({ enabled: true, accessMode: "read-only", port }), mcpPort);
  await page.reload(); await page.getByText("今天想釐清什麼？").waitFor(); await page.getByRole("button", { name: "設定", exact: true }).click();
  const refreshedMcp = page.locator(".mcp-section"); await refreshedMcp.scrollIntoViewIfNeeded(); await refreshedMcp.locator(".mcp-section-summary > em").filter({ hasText: "已可連線" }).waitFor();
  const mcpGeometry = await refreshedMcp.evaluate((element) => ({ fits: element.scrollWidth <= element.clientWidth + 1, width: element.getBoundingClientRect().width, controls: element.querySelectorAll("button").length }));
  await refreshedMcp.screenshot({ path: "/tmp/chengjing-mcp-settings.png" });
  const languageExpectations = [
    ["zh-TW", "讓 Codex、Claude Code 控制澄境", "自訂 AI Provider"],
    ["zh-CN", "让 Codex、Claude Code 控制澄境", "自定义 AI Provider"],
    ["en", "Let Codex and Claude Code work with ChengJing", "Custom AI provider"],
    ["ja", "CodexやClaude CodeからChengJingを操作", "カスタムAI Provider"],
    ["ko", "Codex와 Claude Code로 ChengJing 제어", "사용자 지정 AI Provider"],
  ];
  const languageReports = [];
  for (let index = 0; index < languageExpectations.length; index += 1) {
    await page.locator(".language-grid button").nth(index).click();
    await page.waitForFunction((language) => document.documentElement.lang === language, languageExpectations[index][0]);
    languageReports.push(await page.evaluate(([mcpTitle, providerTitle]) => ({
      mcp: document.body.innerText.includes(mcpTitle), provider: document.body.innerText.includes(providerTitle),
      fits: document.querySelector(".settings-page").scrollWidth <= document.querySelector(".settings-page").clientWidth + 1,
    }), languageExpectations[index].slice(1)));
  }
  await page.locator(".language-grid button").nth(0).click();
  const fiveLanguageFits = languageReports.every((report) => report.mcp && report.provider && report.fits);

  const token = await readOrCreateMcpToken(tempData); const endpoint = `http://127.0.0.1:${mcpPort}/mcp`;
  client = new Client({ name: "chengjing-live-qa", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  const tools = await client.listTools();
  const deniedWrite = await client.callTool({ name: "chengjing_create_note", arguments: { title: "不應寫入", content: "唯讀模式" } });
  await page.evaluate(() => window.chengjing.mcp.updateSettings({ accessMode: "allow" }));
  const created = await client.callTool({ name: "chengjing_create_note", arguments: { title: "MCP 真實橋接測試", content: "由正式 MCP Client 寫入澄境" } });
  const createdId = created.structuredContent.id; const createdAt = created.structuredContent.updatedAt;
  await client.callTool({ name: "chengjing_update_note", arguments: { id: createdId, expectedUpdatedAt: createdAt, content: "並通過防衝突更新", contentMode: "append" } });
  const stored = await page.evaluate((id) => new Promise((resolve, reject) => { const request = indexedDB.open("chengjing"); request.onerror = () => reject(request.error); request.onsuccess = () => { const query = request.result.transaction("cards", "readonly").objectStore("cards").get(id); query.onerror = () => reject(query.error); query.onsuccess = () => resolve(query.result); }; }), createdId);
  const audit = await page.evaluate(() => window.chengjing.mcp.getAudit());
  const result = {
    packagedApp: Boolean(packagedExecutable),
    anchorCount, anchorScrollWorks, anchorDisclosureWorks, anchorFits: await jumpNav.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    engineChoiceCount: await engineChoices.count(), engineDisclosureWorks, engineSurfaceHierarchy, geminiPresetUpdated, providerSaved: providerFiles.includes("ai-provider-settings.json"), providerEncrypted: !providerPlaintextLeak, providerChatWorks: providerReply.text === "本機 Provider 回覆正常" && providerChatRequests === 2,
    providerResponsesWorks: providerSettings.profiles[0]?.apiMode === "responses" && providerResponsesBodies.length === 2 && providerResponsesBodies.every((body) => body.max_output_tokens > 0 && body.max_tokens === undefined && body.store === undefined && Array.isArray(body.input)),
    providerGeometry, mcpRunning: true, mcpGeometry, fiveLanguageFits, toolCount: tools.tools.length,
    coreTools: ["chengjing_search", "chengjing_create_note", "chengjing_create_whiteboard", "chengjing_create_kanban", "chengjing_connect_neurons"].every((name) => tools.tools.some((tool) => tool.name === name)),
    readOnlyBlocksWrites: deniedWrite.isError === true, rendererBridgeWrite: stored?.plainText?.includes("通過防衝突更新") === true, auditSuccesses: audit.filter((entry) => entry.outcome === "success").length,
    screenshots: ["/tmp/chengjing-settings-anchors.png", "/tmp/chengjing-mcp-collapsed.png", "/tmp/chengjing-settings-openrouter.png", "/tmp/chengjing-settings-openrouter-models.png", "/tmp/chengjing-settings-gemma.png", "/tmp/chengjing-provider-settings.png", "/tmp/chengjing-mcp-settings.png"],
  };
  console.log(JSON.stringify(result, null, 2));
  if (result.anchorCount !== 8 || !result.anchorScrollWorks || !result.anchorDisclosureWorks || !result.anchorFits || result.engineChoiceCount !== 3 || !result.engineDisclosureWorks || !result.engineSurfaceHierarchy || !result.geminiPresetUpdated || !result.providerSaved || !result.providerEncrypted || !result.providerChatWorks || !result.providerResponsesWorks || !result.providerGeometry.fits || !result.mcpGeometry.fits || !result.fiveLanguageFits || !result.coreTools || !result.readOnlyBlocksWrites || !result.rendererBridgeWrite || result.auditSuccesses < 2) process.exitCode = 1;
} catch (error) { console.error(error); console.error(output.slice(-2000)); process.exitCode = 1; }
finally {
  await client?.close().catch(() => {}); if (browser) await browser.close().catch(() => {}); child.kill("SIGTERM"); await new Promise((resolve) => setTimeout(resolve, 300)); if (!child.killed) child.kill("SIGKILL"); await new Promise((resolve) => providerMock.close(resolve)); await fs.rm(tempData, { recursive: true, force: true });
}
