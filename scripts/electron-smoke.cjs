const { app, BrowserWindow, ipcMain, net } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { clearSecret, readSecret, secretStatus, writeSecret } = require("../electron/key-vault.cjs");

const tempData = fs.mkdtempSync(path.join(os.tmpdir(), "chengjing-smoke-"));
app.setPath("userData", tempData);
ipcMain.handle("app:set-language", async (_event, language) => ({ language }));
ipcMain.handle("app:get-preferred-language", async () => ({ language: "zh-TW", preferredLanguages: ["zh-Hant-TW"] }));
ipcMain.handle("update:check", async () => ({ status: "current", currentVersion: app.getVersion(), latestVersion: app.getVersion(), releaseName: `v${app.getVersion()}`, notes: "", publishedAt: "", htmlUrl: "", asset: null }));
ipcMain.handle("update:download", async () => ({ opened: false, status: "current", currentVersion: app.getVersion() }));

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.resolve("electron/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    await window.loadFile(path.resolve("dist/index.html"));
    await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (document.body.innerText.includes('今天想釐清什麼')) { clearInterval(timer); resolve(true); }
        if (Date.now() - started > 10000) { clearInterval(timer); reject(new Error('介面載入逾時')); }
      }, 100);
    })`);
    const vaultSecret = "test-openrouter-smoke-local-secret";
    await writeSecret(tempData, vaultSecret);
    const vaultSet = await secretStatus(tempData);
    const keyProbeResponse = await net.fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${vaultSecret}` } });
    const chatProbeResponse = await net.fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${vaultSecret}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "openai/gpt-5.6-luna", messages: [{ role: "user", content: "ping" }], max_tokens: 1 }) });
    await window.webContents.reloadIgnoringCache();
    await window.webContents.executeJavaScript(`new Promise((resolve) => { const timer = setInterval(() => { if (document.body.innerText.includes('今天想釐清什麼')) { clearInterval(timer); resolve(true); } }, 100); })`);
    const vaultStatus = await secretStatus(tempData);
    const decryptedAfterReload = await readSecret(tempData);
    const vaultFiles = fs.readdirSync(tempData).map((name) => path.join(tempData, name)).filter((file) => fs.statSync(file).isFile());
    const vaultContainsPlaintext = vaultFiles.some((file) => fs.readFileSync(file).includes(vaultSecret));
    await clearSecret(tempData);
    const result = await window.webContents.executeJavaScript(`(() => {
      return {
        title: document.title,
        brandVisible: document.body.innerText.includes('澄境'),
        todayVisible: document.body.innerText.includes('今天想釐清什麼'),
        bridgeVisible: Boolean(window.chengjing?.ai && window.chengjing?.files && window.chengjing?.web),
        webGPU: Boolean(navigator.gpu),
      };
    })()`);
    const modelsResponse = await net.fetch("https://openrouter.ai/api/v1/models");
    const models = modelsResponse.ok ? (await modelsResponse.json()).data : [];
    const report = { electron: process.versions.electron, node: process.versions.node, appLocalEncryptedStorage: vaultSet.configured && vaultStatus.configured && vaultStatus.storage === "app-local-aes-256-gcm" && !vaultContainsPlaintext, vaultPersistedAfterReload: vaultStatus.configured && decryptedAfterReload === vaultSecret, openRouterKeyEndpointReached: [401, 403].includes(keyProbeResponse.status), openRouterChatEndpointReached: [401, 403].includes(chatProbeResponse.status), openRouterModelCount: Array.isArray(models) ? models.length : 0, ...result };
    console.log(JSON.stringify(report, null, 2));
    if (!result.brandVisible || !result.todayVisible || !result.bridgeVisible || !result.webGPU || !report.appLocalEncryptedStorage || !report.vaultPersistedAfterReload || !report.openRouterKeyEndpointReached || !report.openRouterChatEndpointReached || report.openRouterModelCount < 1) process.exitCode = 1;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    window.destroy();
    fs.rmSync(tempData, { recursive: true, force: true });
    app.quit();
  }
});
