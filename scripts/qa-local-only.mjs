import { _electron as electron } from "playwright";
import electronPath from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const profile = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-local-only-qa-"));
const output = path.resolve("qa-artifacts/local-only");
await fs.mkdir(output, { recursive: true });
const hits = [], sockets = new Set();
let slowClosed = false, socketClosed = false, connectionCount = 0;
const server = http.createServer((request, response) => {
  hits.push(request.url);
  response.setHeader("Access-Control-Allow-Origin", "*");
  if (request.url === "/slow") {
    response.writeHead(200); response.flushHeaders(); response.write("start");
    const timer = setInterval(() => response.write("still-streaming"), 30);
    response.on("close", () => { clearInterval(timer); slowClosed = true; });
  } else if (request.url === "/redirect") { response.writeHead(302, { Location: "/redirect-target" }); response.end(); }
  else response.end("ok");
});
server.on("connection", socket => { connectionCount++; sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
server.on("upgrade", (request, socket) => {
  socket.on("error", () => {}); // Process shutdown may reset an upgraded test socket.
  hits.push(request.url);
  const accept = createHash("sha1").update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.on("close", () => { socketClosed = true; });
  socket.on("end", () => socket.end()); socket.resume();
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const packaged = process.env.CHENGJING_PACKAGED_APP;
let client, page;
const results = {};
async function launch() {
  client = await electron.launch({ executablePath: packaged || electronPath, args: packaged ? [] : ["."], env: { ...process.env, CHENGJING_SMOKE: "1", CHENGJING_PRIVACY_QA_SAVE: "1", CHENGJING_UPDATE_CURRENT_VERSION: "0.0.1", CHENGJING_SMOKE_USER_DATA: profile } });
  page = await client.firstWindow();
  await page.locator(".app-shell").waitFor();
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("chengjing-ui") || '{"state":{},"version":0}');
    saved.state.language = "zh-TW"; localStorage.setItem("chengjing-ui", JSON.stringify(saved));
    // The synthetic old version is for explicit updater checks below. Do not let
    // its automatic daily dialog race our note-creation test on fast CI networks.
    const now = new Date();
    localStorage.setItem("chengjing-last-successful-update-check-day", `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
  });
  await page.reload(); await page.locator(".app-shell").waitFor();
}
async function nativeFetch(url) {
  return client.evaluate(async ({ net }, url) => { try { return { ok: true, body: await (await net.fetch(url)).text() }; } catch (error) { return { ok: false, error: error.message }; } }, url);
}
try {
  await launch();
  console.log("QA: app launched");
  assert.equal(await page.evaluate(() => window.chengjing.privacy.initial.enabled), false);
  await page.locator(".quick-create").click();
  await page.locator(".create-card-title").fill("Local-only QA saved note");
  await page.locator(".create-card-fields textarea").fill("This local note must survive the mode switch.");
  await page.locator(".create-card-modal button[type=submit]").click();
  await page.locator(".create-card-modal").waitFor({ state: "hidden" });
  await page.evaluate(() => localStorage.setItem("chengjing-sync-enabled", "true"));
  assert.equal((await nativeFetch(`${base}/before`)).ok, true);
  console.log("QA: ordinary networking confirmed");
  await page.evaluate(base => { window.__slowResult = window.chengjing.web.read(`${base}/slow`).then(() => "completed", () => "aborted"); }, base);
  await client.evaluate(async ({ BrowserWindow }, base) => {
    const probe = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } });
    global.__networkProbe = probe;
    await probe.loadURL("data:text/html,<title>isolated network probe</title>");
    await probe.webContents.executeJavaScript(`new Promise((resolve, reject) => { const timer=setTimeout(()=>reject(new Error("probe websocket timeout")),5000); window.socket = new WebSocket(${JSON.stringify(base.replace("http:", "ws:") + "/socket")}); socket.onopen = () => {clearTimeout(timer);resolve(true)}; socket.onerror=()=>{clearTimeout(timer);reject(new Error("probe websocket failed"))}; })`);
  }, base);
  assert.ok(hits.includes("/slow") && hits.includes("/socket"));
  console.log("QA: existing streaming and WebSocket established");
  await page.evaluate(() => window.chengjing.privacy.setLocalOnly(true));
  console.log("QA: mode enabled");
  assert.equal(await page.evaluate(() => window.__slowResult), "aborted");
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.ok(slowClosed);
  results.inflightDownloadCancelled = true;
  const before = hits.length, connectionsBefore = connectionCount;
  for (const route of ["/blocked-get", "/redirect", "/blocked-upload"]) assert.equal((await nativeFetch(`${base}${route}`)).ok, false);
  assert.equal(hits.length, before);
  results.nativeRequestsBlockedBeforeServer = true;
  const blockedIpc = await page.evaluate(async () => {
    const api = window.chengjing;
    const requests = [() => api.sync.list(), () => api.sync.put("test", "private"), () => api.cloudBackups.connect(), () => api.cloudBackups.getStatus(), () => api.ai.listModels(), () => api.ai.providerChat({ profileId: "missing", model: "test", messages: [] }), () => api.web.read("https://example.com"), () => api.syncRecovery.createDaily({ data: "{}", assets: [] }), () => api.mcp.updateSettings({ enabled: true })];
    return Promise.all(requests.map(async request => { try { await request(); return "not-blocked"; } catch (error) { return error.message.includes("local-only-mode") ? "blocked" : error.message; } }));
  });
  assert.ok(blockedIpc.every(result => result === "blocked"), JSON.stringify(blockedIpc));
  results.cloudIpcBlocked = blockedIpc.length;
  const renderer = await client.evaluate(async ({}, base) => global.__networkProbe.webContents.executeJavaScript(`(async () => {
    const outcomes = [];
    try { await fetch(${JSON.stringify(base + "/renderer-fetch")}); outcomes.push(false); } catch { outcomes.push(true); }
    outcomes.push(await new Promise(resolve => { const image = new Image(); image.onload = () => resolve(false); image.onerror = () => resolve(true); image.src = ${JSON.stringify(base + "/image")}; }));
    outcomes.push(await new Promise(resolve => { const ws = new WebSocket(${JSON.stringify(base.replace("http:", "ws:") + "/new-socket")}); ws.onopen = () => resolve(false); ws.onerror = () => resolve(true); }));
    return outcomes;
  })()`), base);
  assert.ok(renderer.every(Boolean)); assert.equal(hits.length, before);
  assert.equal(connectionCount, connectionsBefore); results.noNewTcpConnectionsForBlockedRequests = true;
  results.rendererFetchImageAndWebSocketBlocked = true;
  // Real updater metadata uses a different session, not the ordinary allowlist.
  const update = await page.evaluate(() => window.chengjing.updates.check(true));
  assert.ok(update.latestVersion); results.updatesStillAvailable = update.latestVersion;
  if (update.asset) {
    const head = await client.evaluate(async ({ session }, url) => {
      const response = await session.fromPartition("chengjing-updater").fetch(url, { method: "HEAD" });
      return { status: response.status, finalUrl: response.url };
    }, update.asset.url);
    assert.equal(head.status, 200); results.installerDownloadRedirectAllowed = true;
  }
  const forbiddenUpdater = await client.evaluate(async ({ session }, url) => {
    try { await session.fromPartition("chengjing-updater").fetch(url); return false; } catch { return true; }
  }, `${base}/updater-cannot-tunnel`);
  assert.ok(forbiddenUpdater); assert.equal(hits.length, before);
  await client.close(); client = null;
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(socketClosed); results.existingWebSocketEndedOnRestart = true;

  await launch();
  assert.equal(await page.evaluate(() => window.chengjing.privacy.initial.enabled), true);
  const logPath = path.join(output, "denied-request-netlog.json");
  await client.evaluate(({ netLog }, filename) => netLog.startLogging(filename), logPath);
  assert.equal((await nativeFetch("https://cloud-local-only-qa.invalid/private")).ok, false);
  await client.evaluate(({ netLog }) => netLog.stopLogging());
  const log = JSON.parse(await fs.readFile(logPath, "utf8"));
  const dnsTypes = new Set(Object.entries(log.constants.logEventTypes).filter(([name]) => /HOST_RESOLVER|DNS_TRANSACTION/.test(name)).map(([, id]) => id));
  assert.equal(log.events.filter(event => dnsTypes.has(event.type) && JSON.stringify(event.params || {}).includes("cloud-local-only-qa.invalid")).length, 0);
  results.blockedBeforeDnsResolution = true;
  assert.ok((await page.evaluate(() => window.chengjing.updates.check(true))).latestVersion);
  results.updatesStillAvailableAfterRestart = true;
  assert.equal((await nativeFetch(`${base}/blocked-after-restart`)).ok, false);
  results.startupPolicyLoadedBeforeRenderer = true;
  assert.equal(await page.evaluate(() => localStorage.getItem("chengjing-sync-enabled")), "true");
  await page.locator(".sidebar-footer > button").nth(2).click();
  await page.locator("#privacy-settings").waitFor();
  results.saveHandshakeWithoutCloudSync = true;
  assert.equal(await page.locator('[data-nav-id="brain"]').isDisabled(), true);
  assert.equal(await page.locator(".ai-button").first().isDisabled(), true);
  assert.equal(await page.locator("#ai-settings").evaluate(element => Boolean(element.closest("fieldset")?.disabled && element.closest("fieldset")?.inert)), true);
  assert.equal(await page.locator("#sync-settings").evaluate(element => Boolean(element.closest("fieldset")?.disabled)), true);
  assert.equal(await page.locator(".local-method .backup-switch input").isDisabled(), false);
  assert.equal(await page.locator("#update-settings").evaluate(element => Boolean(element.closest("fieldset")?.disabled)), false);
  await page.screenshot({ path: path.join(output, "settings-local-only.png") });
  results.disabledControlsAndLocalBackupUsable = true;
  const attachment = await page.evaluate(() => window.chengjing.attachments.importData({ name: "local-test.txt", data: btoa("local attachment"), mime: "text/plain" }));
  assert.ok(attachment.relativePath);
  assert.equal(await page.evaluate(async attachment => (await fetch(`chengjing-attachment://local/${attachment.relativePath}`)).text(), attachment), "local attachment");
  results.localAttachmentRead = true;
  const backupDirectory = path.join(profile, "qa-local-backups");
  await fs.mkdir(backupDirectory);
  // Set only the isolated QA folder; no system picker and no user data.
  await client.evaluate(async ({ app }, directory) => {
    const require = process.getBuiltinModule("module").createRequire(`${app.getAppPath()}/electron/main.cjs`);
    await require("./auto-backup.cjs").writeSettings(app.getPath("userData"), { enabled: true, directory });
  }, backupDirectory);
  const backup = await page.evaluate(() => window.chengjing.backups.write({ reason: "manual", data: JSON.stringify({ format: "chengjing-backup", version: 1, exportedAt: new Date().toISOString(), data: {} }) }));
  assert.ok(backup.filePath); results.localBackupWritten = true;
  // The normal UI backup exports the real isolated database, not just a fixture.
  await page.locator('[data-nav-id="today"]').click();
  await page.locator(".sidebar-footer > button").nth(2).click();
  await page.locator(".local-method .backup-now-button, .local-method .primary-button").last().click();
  await page.waitForTimeout(500);
  const backupFiles = (await fs.readdir(backupDirectory)).filter(name => name.endsWith(".json"));
  const snapshots = await Promise.all(backupFiles.map(async name => JSON.parse(await fs.readFile(path.join(backupDirectory, name), "utf8"))));
  assert.ok(snapshots.some(snapshot => snapshot.data.cards?.some(card => card.title === "Local-only QA saved note")));
  results.notePreservedAndIncludedInCompleteLocalBackup = true;
  await page.evaluate(() => window.chengjing.privacy.setLocalOnly(false));
  await client.close(); client = null;
  await launch();
  assert.equal(await page.evaluate(() => window.chengjing.privacy.initial.enabled), false);
  assert.equal((await nativeFetch(`${base}/after-disabled`)).ok, true);
  results.disableRestoresNormalNetworking = true;
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify({ passed: true, results, serverHits: hits }, null, 2));
  console.log(JSON.stringify({ passed: true, results, output }, null, 2));
} catch (error) {
  if (page && !page.isClosed()) {
    const state = await page.evaluate(() => ({
      url: location.href, language: document.documentElement.lang,
      footer: [...document.querySelectorAll(".sidebar-footer button")].map(button => ({ text: button.textContent, title: button.getAttribute("title"), visible: Boolean(button.getClientRects().length) })),
      body: document.body.innerText.slice(0, 1600),
    })).catch(() => null);
    console.error("QA failure state:", JSON.stringify(state));
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  }
  throw error;
} finally {
  await client?.close().catch(() => {});
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
  if (results.disableRestoresNormalNetworking) await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
}
