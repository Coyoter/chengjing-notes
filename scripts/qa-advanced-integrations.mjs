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
let providerChatRequests = 0;
const providerMock = createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/v1/models") { response.end(JSON.stringify({ data: [{ id: "qwen3:8b", name: "Qwen 3 8B" }] })); return; }
  if (request.url === "/v1/chat/completions") { providerChatRequests += 1; const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); response.end(JSON.stringify({ model: body.model, choices: [{ message: { content: "本機 Provider 回覆正常" }, finish_reason: "stop" }], usage: { total_tokens: 8 } })); return; }
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
  const engineChoices = page.locator(".engine-choice-grid > button"); await engineChoices.first().waitFor();
  const customChoice = engineChoices.filter({ hasText: "自訂 AI Provider" }); await customChoice.click();
  const provider = page.locator(".advanced-provider"); await provider.waitFor();
  if (!(await provider.evaluate((element) => element.open))) await provider.locator(":scope > summary").click();
  const formInputs = provider.locator(".provider-form input");
  await formInputs.nth(1).fill("qwen3:8b"); await formInputs.nth(2).fill(`http://127.0.0.1:${providerPort}/v1`); await formInputs.nth(3).fill("qa-provider-secret");
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
  const refreshedMcp = page.locator(".mcp-section"); await refreshedMcp.scrollIntoViewIfNeeded(); await refreshedMcp.getByText("已可連線", { exact: true }).waitFor();
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
    engineChoiceCount: await engineChoices.count(), providerSaved: providerFiles.includes("ai-provider-settings.json"), providerEncrypted: !providerPlaintextLeak, providerChatWorks: providerReply.text === "本機 Provider 回覆正常" && providerChatRequests === 2,
    providerGeometry, mcpRunning: true, mcpGeometry, fiveLanguageFits, toolCount: tools.tools.length,
    coreTools: ["chengjing_search", "chengjing_create_note", "chengjing_create_whiteboard", "chengjing_create_kanban", "chengjing_connect_neurons"].every((name) => tools.tools.some((tool) => tool.name === name)),
    readOnlyBlocksWrites: deniedWrite.isError === true, rendererBridgeWrite: stored?.plainText?.includes("通過防衝突更新") === true, auditSuccesses: audit.filter((entry) => entry.outcome === "success").length,
    screenshots: ["/tmp/chengjing-provider-settings.png", "/tmp/chengjing-mcp-settings.png"],
  };
  console.log(JSON.stringify(result, null, 2));
  if (result.engineChoiceCount !== 3 || !result.providerSaved || !result.providerEncrypted || !result.providerChatWorks || !result.providerGeometry.fits || !result.mcpGeometry.fits || !result.fiveLanguageFits || !result.coreTools || !result.readOnlyBlocksWrites || !result.rendererBridgeWrite || result.auditSuccesses < 2) process.exitCode = 1;
} catch (error) { console.error(error); console.error(output.slice(-2000)); process.exitCode = 1; }
finally {
  await client?.close().catch(() => {}); if (browser) await browser.close().catch(() => {}); child.kill("SIGTERM"); await new Promise((resolve) => setTimeout(resolve, 300)); if (!child.killed) child.kill("SIGKILL"); await new Promise((resolve) => providerMock.close(resolve)); await fs.rm(tempData, { recursive: true, force: true });
}
