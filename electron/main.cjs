const { app, BrowserWindow, clipboard, ClipboardItem, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, protocol, safeStorage, screen, shell, Tray } = require("electron");
const { createHash, randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { createReadStream } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { cleanupIncrementalAssets, createAutoBackup, isOwnedBackupFilename, normalizeSettings: normalizeAutoBackupSettings, readSettings: readAutoBackupSettings, writeSettings: writeAutoBackupSettings } = require("./auto-backup.cjs");
const { createGoogleDriveBackupService } = require("./google-drive-backup.cjs");
const { clientId: googleOAuthClientId, clientSecret: googleOAuthClientSecret } = require("./google-oauth-config.cjs");
const { clearSecret, readSecret, secretStatus, writeSecret } = require("./key-vault.cjs");
const { buildApplicationMenuTemplate, shouldUseUpdateMenuIcon } = require("./menu-template.cjs");
const { parseMacHotkey } = require("./mac-hotkey.cjs");
const { isUpdateCandidateStale, parseLatestRelease, parseLatestReleaseFeed } = require("./update-service.cjs");
const { DEFAULT_SHORTCUT, readQuickCaptureSettings, writeQuickCaptureSettings } = require("./quick-capture-settings.cjs");

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key";
const GITHUB_RELEASE_URL = "https://api.github.com/repos/Coyoter/chengjing-notes/releases/latest";
const GITHUB_RELEASE_FEED_URL = "https://github.com/Coyoter/chengjing-notes/releases.atom";
const CLOUDFLARE_UPDATE_INDEX_URL = "https://chengjing-update-index.coyoter.workers.dev/v1/latest";
const LEGACY_KEY_FILE = "openrouter-key.bin";
const CLIPBOARD_MIME = "web application/x.chengjing-clipboard";
let mainWindow = null;
let quickCaptureWindow = null;
let quickCapturePresented = false;
let nativeQuickCaptureReady = false;
let nativeQuickCapturePresented = false;
let isQuitting = false;
let tray = null;
let quickCaptureShortcut = DEFAULT_SHORTCUT;
let quickCaptureShortcutRegistered = false;
let quickCaptureShortcutBackend = "none";
let nativeHotkeyProcess = null;
let latestUpdate = null;
let latestUpdateCheckedAt = 0;
let githubApiBlockedUntil = 0;
let activeUpdateDownload = null;
let autoBackupOperation = Promise.resolve();
let cloudBackupOperation = Promise.resolve();
let googleDriveBackupService = null;
let mcpServer = null;
let mcpServerStatus = { running: false, endpoint: "", error: "" };
let mcpOperation = Promise.resolve();
let mcpWriteOperation = Promise.resolve();
let mcpStartupTimer = null;
let mcpRendererReady = false;
const mcpRendererWaiters = new Set();
const mcpWorkspaceRequests = new Map();
const isDev = process.argv.includes("--dev");
const isSmoke = process.env.CHENGJING_SMOKE === "1";
const explicitBackgroundLaunch = process.argv.includes("--background");
let currentLanguage = "en";
let trayImageDetails = { empty: true, width: 0, height: 0, path: "" };

function mcpSettingsApi() { return require("./mcp-settings.cjs"); }
function providerSettingsApi() { return require("./provider-settings.cjs"); }
function providerClientApi() { return require("./provider-client.cjs"); }

function languageFromPreferences(preferredLanguages = []) {
  const primary = String(preferredLanguages[0] || "").trim().toLowerCase().replaceAll("_", "-");
  if (/^zh(?:-|$)/.test(primary)) {
    if (/(?:^|-)hant(?:-|$)|(?:^|-)(tw|hk|mo)(?:-|$)/.test(primary)) return "zh-TW";
    return "zh-CN";
  }
  if (/^ja(?:-|$)/.test(primary)) return "ja";
  if (/^ko(?:-|$)/.test(primary)) return "ko";
  return "en";
}
if (process.env.CHENGJING_SMOKE_USER_DATA) app.setPath("userData", path.resolve(process.env.CHENGJING_SMOKE_USER_DATA));
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  isQuitting = true;
  app.quit();
} else {
  app.on("second-instance", () => {
    if (app.isReady()) void showMainWindow();
    else app.whenReady().then(() => showMainWindow());
  });
}
protocol.registerSchemesAsPrivileged([{ scheme: "chengjing-attachment", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

function attachmentsDirectory() {
  return path.join(app.getPath("userData"), "attachments");
}

function cloudBackupService() {
  if (!googleDriveBackupService) {
    googleDriveBackupService = createGoogleDriveBackupService({
      net,
      safeStorage,
      shell,
      userDataDirectory: app.getPath("userData"),
      attachmentsDirectory: attachmentsDirectory(),
      clientId: googleOAuthClientId,
      clientSecret: googleOAuthClientSecret,
      platform: process.platform,
      getLanguage: () => currentLanguage,
    });
  }
  return googleDriveBackupService;
}

function serializeMcp(operation) {
  const pending = mcpOperation.then(operation, operation);
  mcpOperation = pending.catch(() => {});
  return pending;
}

function mcpEndpoint(port) { return `http://127.0.0.1:${port}/mcp`; }

function mcpSetupSnippet(target, endpoint, token) {
  if (target === "claude") return `claude mcp add --transport http --scope user chengjing ${endpoint} --header "Authorization: Bearer ${token}"`;
  return `# Paste into ~/.codex/config.toml\n# Windows: %USERPROFILE%\\.codex\\config.toml\n[mcp_servers.chengjing]\nurl = "${endpoint}"\nhttp_headers = { Authorization = "Bearer ${token}" }`;
}

const MCP_STATUS_MESSAGES = {
  "zh-TW": { port: "這個連接埠正在被其他程式使用，請展開進階設定改用另一個號碼。", generic: "本機 MCP 無法啟動，請重新開啟澄境後再試。" },
  "zh-CN": { port: "此端口正被其他程序使用，请在高级设置中改用其他号码。", generic: "本机 MCP 无法启动，请重新打开澄境后重试。" },
  en: { port: "Another app is using this port. Open Advanced connection settings and choose another number.", generic: "Local MCP could not start. Restart ChengJing and try again." },
  ja: { port: "このポートは別のアプリが使用中です。詳細設定で別の番号を選んでください。", generic: "ローカルMCPを起動できません。ChengJingを再起動してお試しください。" },
  ko: { port: "다른 앱이 이 포트를 사용 중입니다. 고급 연결 설정에서 다른 번호를 선택하세요.", generic: "로컬 MCP를 시작할 수 없습니다. ChengJing을 다시 실행해 보세요." },
};

function friendlyMcpStartError(code) {
  if (!code) return "";
  const copy = MCP_STATUS_MESSAGES[currentLanguage] || MCP_STATUS_MESSAGES.en;
  return code === "EADDRINUSE" || String(code).includes("EADDRINUSE") ? copy.port : copy.generic;
}

function mcpPublicStatus(settings) {
  return {
    ...settings,
    running: mcpServerStatus.running,
    endpoint: mcpEndpoint(settings.port),
    error: friendlyMcpStartError(mcpServerStatus.error),
    tokenStored: true,
  };
}

async function stopMcpServer() {
  const current = mcpServer; mcpServer = null;
  if (current) await current.stop().catch(() => {});
  mcpServerStatus = { running: false, endpoint: "", error: "" };
}

function waitForMcpRenderer(timeoutMs = 12_000) {
  if (mcpRendererReady && mainWindow && !mainWindow.isDestroyed()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject };
    const timer = setTimeout(() => { mcpRendererWaiters.delete(waiter); reject(new Error("mcp-renderer-not-ready")); }, timeoutMs);
    waiter.resolve = () => { clearTimeout(timer); resolve(); };
    mcpRendererWaiters.add(waiter);
  });
}

function markMcpRendererReady() {
  mcpRendererReady = true;
  for (const waiter of mcpRendererWaiters) waiter.resolve();
  mcpRendererWaiters.clear();
}

async function sendMcpWorkspaceRequest(tool, args) {
  if (!mainWindow || mainWindow.isDestroyed()) await createWindow({ show: false });
  await waitForMcpRenderer();
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { mcpWorkspaceRequests.delete(requestId); reject(new Error("mcp-workspace-timeout")); }, 65_000);
    mcpWorkspaceRequests.set(requestId, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); },
    });
    mainWindow.webContents.send("mcp:workspace-request", { requestId, tool, arguments: args });
  });
}

const MCP_CONFIRM_MESSAGES = {
  "zh-TW": { title: "允許外部工具修改澄境？", detail: "這項操作來自已連接的 Codex、Claude Code 或其他 MCP 用戶端。確認後仍可在澄境使用「復原」。", cancel: "不允許", allow: "允許這一次", readOnly: "澄境 MCP 目前是唯讀模式。請到設定調整後再試。" },
  "zh-CN": { title: "允许外部工具修改澄境？", detail: "此操作来自已连接的 Codex、Claude Code 或其他 MCP 客户端。确认后仍可在澄境中撤销。", cancel: "不允许", allow: "仅允许这一次", readOnly: "澄境 MCP 当前为只读模式。请到设置中调整后重试。" },
  en: { title: "Allow an external tool to change ChengJing?", detail: "This request comes from a connected Codex, Claude Code, or another MCP client. You can still Undo it in ChengJing.", cancel: "Don't allow", allow: "Allow once", readOnly: "ChengJing MCP is in read-only mode. Change the access level in Settings to continue." },
  ja: { title: "外部ツールによるChengJingの変更を許可しますか？", detail: "接続中のCodex、Claude Code、または他のMCPクライアントからの操作です。ChengJingで取り消すことができます。", cancel: "許可しない", allow: "今回だけ許可", readOnly: "ChengJing MCPは読み取り専用です。設定でアクセス権を変更してください。" },
  ko: { title: "외부 도구가 ChengJing을 변경하도록 허용할까요?", detail: "연결된 Codex, Claude Code 또는 다른 MCP 클라이언트의 요청입니다. ChengJing에서 실행 취소할 수 있습니다.", cancel: "허용 안 함", allow: "이번만 허용", readOnly: "ChengJing MCP가 읽기 전용 모드입니다. 설정에서 접근 수준을 변경하세요." },
};

async function executeMcpToolNow(tool, args, meta = {}) {
  const { appendMcpAudit, readMcpSettings } = mcpSettingsApi();
  const userDataDirectory = app.getPath("userData");
  const settings = await readMcpSettings(userDataDirectory);
  const copy = MCP_CONFIRM_MESSAGES[currentLanguage] || MCP_CONFIRM_MESSAGES.en;
  if (meta.write && settings.accessMode === "read-only") {
    await appendMcpAudit(userDataDirectory, { tool, summary: meta.summary, outcome: "denied" });
    throw new Error(copy.readOnly);
  }
  if (meta.write && settings.accessMode === "ask") {
    await showMainWindow();
    const result = await dialog.showMessageBox(mainWindow, { type: "question", title: copy.title, message: copy.title, detail: `${String(meta.summary || tool).slice(0, 240)}\n\n${copy.detail}`, buttons: [copy.cancel, copy.allow], cancelId: 0, defaultId: 0, noLink: true });
    if (result.response !== 1) {
      await appendMcpAudit(userDataDirectory, { tool, summary: meta.summary, outcome: "denied" });
      throw new Error("The ChengJing user did not allow this change.");
    }
  }
  try {
    const value = await sendMcpWorkspaceRequest(tool, args);
    await appendMcpAudit(userDataDirectory, { tool, summary: meta.summary, outcome: "success" });
    return value;
  } catch (error) {
    await appendMcpAudit(userDataDirectory, { tool, summary: meta.summary, outcome: "error" });
    throw error;
  }
}

function executeMcpTool(tool, args, meta = {}) {
  if (!meta.write) return executeMcpToolNow(tool, args, meta);
  const pending = mcpWriteOperation.then(() => executeMcpToolNow(tool, args, meta), () => executeMcpToolNow(tool, args, meta));
  mcpWriteOperation = pending.catch(() => {});
  return pending;
}

async function reconcileMcpServer() {
  const { readMcpSettings, readOrCreateMcpToken } = mcpSettingsApi();
  const userDataDirectory = app.getPath("userData");
  const settings = await readMcpSettings(userDataDirectory);
  await stopMcpServer();
  if (!settings.enabled) return mcpPublicStatus(settings);
  const { createChengJingMcpServer } = require("./mcp-server.cjs");
  const token = await readOrCreateMcpToken(userDataDirectory);
  const next = createChengJingMcpServer({ port: settings.port, token, version: currentAppVersion(), execute: executeMcpTool, onError: (error) => console.error(`[mcp] ${error instanceof Error ? error.message : String(error)}`) });
  try {
    const status = await next.start(); mcpServer = next; mcpServerStatus = { running: true, endpoint: status.endpoint, error: "" };
  } catch (error) {
    await next.stop().catch(() => {}); mcpServerStatus = { running: false, endpoint: "", error: String(error?.code || error?.message || "mcp-start-failed") };
  }
  return mcpPublicStatus(settings);
}

function safeAttachmentName(value) {
  const cleaned = path.basename(String(value || "attachment")).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "-").replace(/\s+/g, " ").trim();
  return (cleaned || "attachment").slice(0, 160);
}

function resolveAttachmentPath(relativePath) {
  const root = path.resolve(attachmentsDirectory());
  const normalized = String(relativePath || "").replaceAll("\\", "/").replace(/^\/+/, "");
  const candidate = path.resolve(root, normalized);
  if (!normalized || (candidate !== root && !candidate.startsWith(`${root}${path.sep}`))) throw new Error("invalid-attachment-path");
  return candidate;
}

async function importAttachmentPath(request = {}) {
  const sourcePath = path.resolve(String(request.sourcePath || ""));
  const stat = await fs.stat(sourcePath);
  if (!stat.isFile()) throw new Error("attachment-source-invalid");
  const id = String(request.id || randomUUID()).slice(0, 200);
  const fileId = id.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120) || randomUUID();
  const name = safeAttachmentName(request.name || path.basename(sourcePath));
  const relativePath = `${fileId}-${name}`;
  const destination = resolveAttachmentPath(relativePath);
  await fs.mkdir(attachmentsDirectory(), { recursive: true });
  if (sourcePath !== destination) await fs.copyFile(sourcePath, destination);
  const sha256 = await sha256File(destination);
  return { id, name, mime: String(request.mime || "application/octet-stream"), size: stat.size, storage: "file", relativePath, sha256, createdAt: Number(request.createdAt) || Date.now() };
}

async function importAttachmentData(request = {}) {
  const id = String(request.id || randomUUID()).slice(0, 200);
  const fileId = id.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120) || randomUUID();
  const name = safeAttachmentName(request.name);
  const relativePath = `${fileId}-${name}`;
  const destination = resolveAttachmentPath(relativePath);
  const buffer = Buffer.from(String(request.data || ""), "base64");
  await fs.mkdir(attachmentsDirectory(), { recursive: true });
  await fs.writeFile(destination, buffer, { mode: 0o600 });
  return { id, name, mime: String(request.mime || "application/octet-stream"), size: buffer.byteLength, storage: "file", relativePath, sha256: createHash("sha256").update(buffer).digest("hex"), createdAt: Number(request.createdAt) || Date.now() };
}

async function directoryBytes(directory) {
  let total = 0;
  let count = 0;
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      total += (await fs.stat(path.join(directory, entry.name))).size;
      count += 1;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return { bytes: total, count };
}

const ERROR_MESSAGES = {
  "zh-TW": { invalidKey: "OpenRouter API 金鑰無效或沒有權限。", balance: "OpenRouter 餘額不足，請先到 OpenRouter 儲值。", modelNotFound: "OpenRouter 找不到這個模型名稱。", responseTimeout: "模型回覆逾時，請稍後再試。", rateLimit: "OpenRouter 請求太頻繁或已達額度上限。", serviceDown: "OpenRouter 或模型供應商暫時無法服務。", replyError: "OpenRouter 回覆錯誤：{detail}", requestFailed: "OpenRouter 請求失敗（HTTP {status}）。", offline: "macOS 目前回報離線，無法{action}。", dns: "無法解析 OpenRouter 網址，請檢查 DNS 或 VPN 後再試。", dnsNetwork: "無法解析 OpenRouter 網址，請檢查 DNS 或網路連線後再試。", proxy: "macOS 的代理或 VPN 無法連上 OpenRouter，請檢查系統網路代理設定。", certificate: "OpenRouter 的安全憑證驗證失敗，請確認系統時間與網路攔截軟體。", connectionReset: "與 OpenRouter 的連線被中斷，請稍後再試。", certificateProxy: "無法驗證 OpenRouter 的安全憑證，請確認系統時間與網路代理設定。", networkFallback: "無法{action}。請到設定按「測試 OpenRouter」取得更明確的結果。", actionConnect: "連線到 OpenRouter", actionModels: "取得 OpenRouter 模型清單", completeKey: "請輸入完整的 OpenRouter API 金鑰。", noKey: "尚未設定 OpenRouter API 金鑰。", verifiedKey: "已驗證的金鑰", testTimeout: "OpenRouter 連線測試超過 20 秒，已停止。請檢查網路或代理設定。", modelsFailed: "目前無法取得 OpenRouter 模型清單。", modelsTimeout: "同步 OpenRouter 模型超過 20 秒，已停止。", chooseModel: "請選擇或輸入正確的 OpenRouter 模型名稱。", noText: "模型沒有產生文字，請換一個模型再試。", generationTimeout: "生成超過 3 分鐘，已停止這次請求。", webProtocol: "只支援 http 或 https 網址。", webFailed: "讀取網頁失敗（HTTP {status}）。", webTooLarge: "這個網頁過大，請改用複製貼上匯入。", noArticle: "無法辨識這個網頁的主要文章內容。", saveFile: "儲存檔案", allFiles: "所有檔案", chooseFile: "選擇檔案" },
  "zh-CN": { invalidKey: "OpenRouter API 密钥无效或没有权限。", balance: "OpenRouter 余额不足，请先到 OpenRouter 充值。", modelNotFound: "OpenRouter 找不到这个模型名称。", responseTimeout: "模型响应超时，请稍后重试。", rateLimit: "OpenRouter 请求过于频繁或已达到额度上限。", serviceDown: "OpenRouter 或模型供应商暂时无法服务。", replyError: "OpenRouter 返回错误：{detail}", requestFailed: "OpenRouter 请求失败（HTTP {status}）。", offline: "macOS 当前报告离线，无法{action}。", dns: "无法解析 OpenRouter 地址，请检查 DNS 或 VPN 后重试。", dnsNetwork: "无法解析 OpenRouter 地址，请检查 DNS 或网络连接后重试。", proxy: "macOS 代理或 VPN 无法连接 OpenRouter，请检查系统代理设置。", certificate: "OpenRouter 安全证书验证失败，请检查系统时间和网络拦截软件。", connectionReset: "与 OpenRouter 的连接已中断，请稍后重试。", certificateProxy: "无法验证 OpenRouter 安全证书，请检查系统时间和网络代理设置。", networkFallback: "无法{action}。请到设置点击“测试 OpenRouter”查看更明确的结果。", actionConnect: "连接 OpenRouter", actionModels: "获取 OpenRouter 模型列表", completeKey: "请输入完整的 OpenRouter API 密钥。", noKey: "尚未设置 OpenRouter API 密钥。", verifiedKey: "已验证的密钥", testTimeout: "OpenRouter 连接测试超过 20 秒，已停止。请检查网络或代理设置。", modelsFailed: "目前无法获取 OpenRouter 模型列表。", modelsTimeout: "同步 OpenRouter 模型超过 20 秒，已停止。", chooseModel: "请选择或输入正确的 OpenRouter 模型名称。", noText: "模型没有生成文字，请换一个模型重试。", generationTimeout: "生成超过 3 分钟，已停止本次请求。", webProtocol: "仅支持 http 或 https 地址。", webFailed: "读取网页失败（HTTP {status}）。", webTooLarge: "这个网页过大，请改用复制粘贴导入。", noArticle: "无法识别这个网页的主要文章内容。", saveFile: "保存文件", allFiles: "所有文件", chooseFile: "选择文件" },
  en: { invalidKey: "The OpenRouter API key is invalid or lacks permission.", balance: "Your OpenRouter balance is insufficient. Add credits in OpenRouter first.", modelNotFound: "OpenRouter could not find that model ID.", responseTimeout: "The model response timed out. Try again later.", rateLimit: "OpenRouter requests are too frequent or the quota has been reached.", serviceDown: "OpenRouter or the model provider is temporarily unavailable.", replyError: "OpenRouter error: {detail}", requestFailed: "OpenRouter request failed (HTTP {status}).", offline: "macOS reports that you are offline, so ChengJing cannot {action}.", dns: "Could not resolve OpenRouter. Check DNS or VPN settings and try again.", dnsNetwork: "Could not resolve OpenRouter. Check DNS or your network connection and try again.", proxy: "The macOS proxy or VPN could not reach OpenRouter. Check system proxy settings.", certificate: "OpenRouter certificate verification failed. Check the system clock and network inspection software.", connectionReset: "The OpenRouter connection was interrupted. Try again later.", certificateProxy: "Could not verify OpenRouter's certificate. Check the system clock and network proxy settings.", networkFallback: "Could not {action}. Open Settings and run “Test OpenRouter” for a more specific result.", actionConnect: "connect to OpenRouter", actionModels: "retrieve the OpenRouter model list", completeKey: "Enter the complete OpenRouter API key.", noKey: "No OpenRouter API key is configured.", verifiedKey: "Verified key", testTimeout: "The OpenRouter connection test exceeded 20 seconds and was stopped. Check network or proxy settings.", modelsFailed: "The OpenRouter model list is currently unavailable.", modelsTimeout: "Syncing OpenRouter models exceeded 20 seconds and was stopped.", chooseModel: "Choose or enter a valid OpenRouter model ID.", noText: "The model returned no text. Try another model.", generationTimeout: "Generation exceeded 3 minutes and was stopped.", webProtocol: "Only http and https URLs are supported.", webFailed: "Could not read the web page (HTTP {status}).", webTooLarge: "This page is too large. Import it by copy and paste instead.", noArticle: "Could not identify the main article content on this page.", saveFile: "Save file", allFiles: "All files", chooseFile: "Choose file" },
  ja: { invalidKey: "OpenRouter APIキーが無効か、権限がありません。", balance: "OpenRouterの残高が不足しています。先にクレジットを追加してください。", modelNotFound: "OpenRouterでこのモデルIDが見つかりません。", responseTimeout: "モデルの応答がタイムアウトしました。後でもう一度お試しください。", rateLimit: "OpenRouterへのリクエストが多すぎるか、上限に達しました。", serviceDown: "OpenRouterまたはモデル提供元が一時的に利用できません。", replyError: "OpenRouterエラー：{detail}", requestFailed: "OpenRouterリクエストに失敗しました（HTTP {status}）。", offline: "macOSがオフラインと報告しているため、{action}できません。", dns: "OpenRouterのアドレスを解決できません。DNSまたはVPNを確認してください。", dnsNetwork: "OpenRouterのアドレスを解決できません。DNSまたはネット接続を確認してください。", proxy: "macOSのプロキシまたはVPNからOpenRouterへ接続できません。システムのプロキシ設定を確認してください。", certificate: "OpenRouterの証明書検証に失敗しました。システム時刻と通信監視ソフトを確認してください。", connectionReset: "OpenRouterとの接続が中断されました。後でもう一度お試しください。", certificateProxy: "OpenRouterの証明書を検証できません。システム時刻とネットワークプロキシを確認してください。", networkFallback: "{action}できません。設定で「OpenRouterをテスト」を実行すると詳しい結果を確認できます。", actionConnect: "OpenRouterに接続", actionModels: "OpenRouterモデル一覧を取得", completeKey: "完全なOpenRouter APIキーを入力してください。", noKey: "OpenRouter APIキーが設定されていません。", verifiedKey: "検証済みキー", testTimeout: "OpenRouter接続テストが20秒を超えたため停止しました。ネットワークまたはプロキシ設定を確認してください。", modelsFailed: "現在OpenRouterモデル一覧を取得できません。", modelsTimeout: "OpenRouterモデルの同期が20秒を超えたため停止しました。", chooseModel: "正しいOpenRouterモデルIDを選択または入力してください。", noText: "モデルがテキストを生成しませんでした。別のモデルをお試しください。", generationTimeout: "生成が3分を超えたため停止しました。", webProtocol: "httpまたはhttpsのURLだけに対応しています。", webFailed: "ウェブページを読み込めませんでした（HTTP {status}）。", webTooLarge: "このページは大きすぎます。コピー＆ペーストで読み込んでください。", noArticle: "このページの主要な記事内容を識別できませんでした。", saveFile: "ファイルを保存", allFiles: "すべてのファイル", chooseFile: "ファイルを選択" },
  ko: { invalidKey: "OpenRouter API 키가 유효하지 않거나 권한이 없습니다.", balance: "OpenRouter 잔액이 부족합니다. 먼저 크레딧을 충전하세요.", modelNotFound: "OpenRouter에서 해당 모델 ID를 찾을 수 없습니다.", responseTimeout: "모델 응답 시간이 초과되었습니다. 나중에 다시 시도하세요.", rateLimit: "OpenRouter 요청이 너무 많거나 한도에 도달했습니다.", serviceDown: "OpenRouter 또는 모델 제공자가 일시적으로 사용할 수 없습니다.", replyError: "OpenRouter 오류: {detail}", requestFailed: "OpenRouter 요청 실패(HTTP {status}).", offline: "macOS가 오프라인 상태로 보고하여 {action}할 수 없습니다.", dns: "OpenRouter 주소를 확인할 수 없습니다. DNS 또는 VPN을 확인하세요.", dnsNetwork: "OpenRouter 주소를 확인할 수 없습니다. DNS 또는 네트워크 연결을 확인하세요.", proxy: "macOS 프록시 또는 VPN으로 OpenRouter에 연결할 수 없습니다. 시스템 프록시 설정을 확인하세요.", certificate: "OpenRouter 인증서 확인에 실패했습니다. 시스템 시간과 네트워크 검사 소프트웨어를 확인하세요.", connectionReset: "OpenRouter 연결이 중단되었습니다. 나중에 다시 시도하세요.", certificateProxy: "OpenRouter 인증서를 확인할 수 없습니다. 시스템 시간과 네트워크 프록시를 확인하세요.", networkFallback: "{action}할 수 없습니다. 설정에서 ‘OpenRouter 테스트’를 실행하면 더 구체적인 결과를 볼 수 있습니다.", actionConnect: "OpenRouter에 연결", actionModels: "OpenRouter 모델 목록 가져오기", completeKey: "전체 OpenRouter API 키를 입력하세요.", noKey: "OpenRouter API 키가 설정되지 않았습니다.", verifiedKey: "확인된 키", testTimeout: "OpenRouter 연결 테스트가 20초를 초과해 중단했습니다. 네트워크 또는 프록시 설정을 확인하세요.", modelsFailed: "현재 OpenRouter 모델 목록을 가져올 수 없습니다.", modelsTimeout: "OpenRouter 모델 동기화가 20초를 초과해 중단했습니다.", chooseModel: "올바른 OpenRouter 모델 ID를 선택하거나 입력하세요.", noText: "모델이 텍스트를 생성하지 않았습니다. 다른 모델을 시도하세요.", generationTimeout: "생성이 3분을 초과해 중단했습니다.", webProtocol: "http 또는 https URL만 지원합니다.", webFailed: "웹 페이지를 읽지 못했습니다(HTTP {status}).", webTooLarge: "이 페이지는 너무 큽니다. 복사하여 붙여넣는 방식으로 가져오세요.", noArticle: "이 페이지의 주요 기사 내용을 찾지 못했습니다.", saveFile: "파일 저장", allFiles: "모든 파일", chooseFile: "파일 선택" },
};

const WINDOWS_ERROR_MESSAGES = {
  "zh-TW": { offline: "Windows 目前回報離線，無法{action}。", proxy: "Windows 的代理或 VPN 無法連上 OpenRouter，請檢查系統網路代理設定。" },
  "zh-CN": { offline: "Windows 当前报告离线，无法{action}。", proxy: "Windows 代理或 VPN 无法连接 OpenRouter，请检查系统代理设置。" },
  en: { offline: "Windows reports that you are offline, so ChengJing cannot {action}.", proxy: "The Windows proxy or VPN could not reach OpenRouter. Check system proxy settings." },
  ja: { offline: "Windowsがオフラインと報告しているため、{action}できません。", proxy: "WindowsのプロキシまたはVPNからOpenRouterへ接続できません。システムのプロキシ設定を確認してください。" },
  ko: { offline: "Windows가 오프라인 상태로 보고하여 {action}할 수 없습니다.", proxy: "Windows 프록시 또는 VPN으로 OpenRouter에 연결할 수 없습니다. 시스템 프록시 설정을 확인하세요." },
};

function message(key, variables = {}) {
  const base = ERROR_MESSAGES[currentLanguage] || ERROR_MESSAGES["zh-TW"];
  const platform = process.platform === "win32" ? (WINDOWS_ERROR_MESSAGES[currentLanguage] || WINDOWS_ERROR_MESSAGES["zh-TW"]) : {};
  let value = platform[key] || base[key] || ERROR_MESSAGES["zh-TW"][key] || key;
  for (const [name, replacement] of Object.entries(variables)) value = value.replaceAll(`{${name}}`, String(replacement));
  return value;
}

const PROVIDER_MESSAGES = {
  "zh-TW": { unavailable: "無法連上這個 AI Provider，請檢查網址、模型與服務是否正在執行。", timeout: "AI Provider 回應逾時，請確認服務與模型是否可用。", invalid: "AI Provider 回傳了無法辨識的內容。", empty: "AI Provider 沒有產生文字，請換一個模型再試。", url: "API 位址無效。遠端服務必須使用 HTTPS；HTTP 只允許 localhost。", model: "請輸入模型 ID。", limit: "最多可以保存 12 組 AI Provider 連線。" },
  "zh-CN": { unavailable: "无法连接这个 AI Provider，请检查地址、模型和服务是否正在运行。", timeout: "AI Provider 响应超时，请确认服务和模型是否可用。", invalid: "AI Provider 返回了无法识别的内容。", empty: "AI Provider 没有生成文字，请更换模型重试。", url: "API 地址无效。远程服务必须使用 HTTPS；HTTP 仅允许 localhost。", model: "请输入模型 ID。", limit: "最多可保存 12 个 AI Provider 连接。" },
  en: { unavailable: "Could not reach this AI provider. Check the URL, model, and whether the service is running.", timeout: "The AI provider timed out. Check that the service and model are available.", invalid: "The AI provider returned an unreadable response.", empty: "The AI provider returned no text. Try another model.", url: "The API URL is invalid. Remote services require HTTPS; HTTP is allowed only for localhost.", model: "Enter a model ID.", limit: "You can save up to 12 AI provider connections." },
  ja: { unavailable: "このAI Providerに接続できません。URL、モデル、サービスの実行状態を確認してください。", timeout: "AI Providerの応答がタイムアウトしました。サービスとモデルを確認してください。", invalid: "AI Providerから認識できない応答が返されました。", empty: "AI Providerがテキストを生成しませんでした。別のモデルをお試しください。", url: "API URLが無効です。リモートはHTTPS必須で、HTTPはlocalhostだけ使用できます。", model: "モデルIDを入力してください。", limit: "AI Provider接続は最大12件まで保存できます。" },
  ko: { unavailable: "이 AI Provider에 연결할 수 없습니다. URL, 모델 및 서비스 실행 상태를 확인하세요.", timeout: "AI Provider 응답 시간이 초과되었습니다. 서비스와 모델을 확인하세요.", invalid: "AI Provider가 인식할 수 없는 응답을 반환했습니다.", empty: "AI Provider가 텍스트를 생성하지 않았습니다. 다른 모델을 시도하세요.", url: "API 주소가 올바르지 않습니다. 원격 서비스는 HTTPS를 사용해야 하며 HTTP는 localhost에서만 허용됩니다.", model: "모델 ID를 입력하세요.", limit: "AI Provider 연결은 최대 12개까지 저장할 수 있습니다." },
};

function friendlyProviderError(error) {
  const code = String(error?.message || "");
  const copy = PROVIDER_MESSAGES[currentLanguage] || PROVIDER_MESSAGES.en;
  if (code === "provider-timeout") return copy.timeout;
  if (code === "provider-response-invalid" || code === "provider-response-too-large") return copy.invalid;
  if (code === "provider-empty-response") return copy.empty;
  if (code === "provider-base-url-invalid" || code === "provider-insecure-remote-url") return copy.url;
  if (code === "provider-model-required") return copy.model;
  if (code === "provider-profile-limit") return copy.limit;
  if (/^provider-http-\d+/.test(code)) {
    return require("./provider-errors.cjs").providerHttpError(code, currentLanguage) || copy.unavailable;
  }
  if (/^(provider-|fetch failed|net::)/i.test(code) || error instanceof TypeError) return copy.unavailable;
  return copy.unavailable;
}

async function readApiKey() {
  return readSecret(app.getPath("userData"));
}

const UPDATE_MESSAGES = {
  "zh-TW": { checkFailed: "暫時無法檢查 GitHub Releases。", staleRelease: "更新服務回傳了比目前 App 更舊的版本；澄境已忽略這份過期資料，請稍後再試。", noRelease: "GitHub 上尚未發布可用版本。", invalidRelease: "GitHub Release 的版本資料無法辨識。", noDmg: "這個版本沒有適用於目前 Mac 的 DMG。", unsafeUrl: "更新下載網址未通過安全檢查。", downloadFailed: "新版 DMG 下載失敗，請稍後再試。", verifyFailed: "新版 DMG 驗證失敗，檔案已移除。", openFailed: "DMG 已下載，但 macOS 無法自動開啟：{error}" },
  "zh-CN": { checkFailed: "暂时无法检查 GitHub Releases。", staleRelease: "更新服务返回了比当前应用更旧的版本；澄境已忽略这份过期数据，请稍后重试。", noRelease: "GitHub 上尚未发布可用版本。", invalidRelease: "无法识别 GitHub Release 的版本信息。", noDmg: "这个版本没有适用于当前 Mac 的 DMG。", unsafeUrl: "更新下载地址未通过安全检查。", downloadFailed: "新版 DMG 下载失败，请稍后重试。", verifyFailed: "新版 DMG 验证失败，文件已移除。", openFailed: "DMG 已下载，但 macOS 无法自动打开：{error}" },
  en: { checkFailed: "Could not check GitHub Releases right now.", staleRelease: "The update service returned a version older than this app. ChengJing ignored the stale result; try again later.", noRelease: "No downloadable release has been published on GitHub yet.", invalidRelease: "The GitHub Release version data could not be recognized.", noDmg: "This release has no DMG for the current Mac.", unsafeUrl: "The update download URL failed its safety check.", downloadFailed: "The new DMG could not be downloaded. Try again later.", verifyFailed: "The new DMG failed verification and was removed.", openFailed: "The DMG was downloaded, but macOS could not open it: {error}" },
  ja: { checkFailed: "現在GitHub Releasesを確認できません。", staleRelease: "更新サービスが現在のAppより古いバージョンを返しました。ChengJingは古い結果を無視しました。後でもう一度お試しください。", noRelease: "GitHubにはまだ利用可能なリリースがありません。", invalidRelease: "GitHub Releaseのバージョン情報を認識できません。", noDmg: "このリリースには現在のMac用DMGがありません。", unsafeUrl: "更新のダウンロードURLが安全性チェックを通過しませんでした。", downloadFailed: "新しいDMGをダウンロードできませんでした。後でもう一度お試しください。", verifyFailed: "新しいDMGの検証に失敗したため削除しました。", openFailed: "DMGはダウンロードされましたが、macOSで開けません：{error}" },
  ko: { checkFailed: "지금 GitHub Releases를 확인할 수 없습니다.", staleRelease: "업데이트 서비스가 현재 앱보다 오래된 버전을 반환했습니다. ChengJing이 오래된 결과를 무시했으니 나중에 다시 시도하세요.", noRelease: "GitHub에 아직 사용 가능한 릴리스가 없습니다.", invalidRelease: "GitHub Release 버전 정보를 확인할 수 없습니다.", noDmg: "이 릴리스에는 현재 Mac용 DMG가 없습니다.", unsafeUrl: "업데이트 다운로드 URL이 안전성 검사를 통과하지 못했습니다.", downloadFailed: "새 DMG를 다운로드하지 못했습니다. 나중에 다시 시도하세요.", verifyFailed: "새 DMG 검증에 실패하여 파일을 제거했습니다.", openFailed: "DMG를 다운로드했지만 macOS에서 열 수 없습니다: {error}" },
};

const WINDOWS_UPDATE_MESSAGES = {
  "zh-TW": { noDmg: "這個版本沒有適用於目前 Windows 電腦的安裝程式。", downloadFailed: "新版 Windows 安裝程式下載失敗，請稍後再試。", verifyFailed: "新版 Windows 安裝程式驗證失敗，檔案已移除。", openFailed: "Windows 安裝程式已下載，但無法自動開啟：{error}" },
  "zh-CN": { noDmg: "这个版本没有适用于当前 Windows 电脑的安装程序。", downloadFailed: "新版 Windows 安装程序下载失败，请稍后重试。", verifyFailed: "新版 Windows 安装程序验证失败，文件已删除。", openFailed: "Windows 安装程序已下载，但无法自动打开：{error}" },
  en: { noDmg: "This release has no installer for this Windows computer.", downloadFailed: "The new Windows installer could not be downloaded. Try again later.", verifyFailed: "The new Windows installer failed verification and was removed.", openFailed: "The Windows installer was downloaded but could not be opened: {error}" },
  ja: { noDmg: "このリリースには現在のWindows PC用インストーラーがありません。", downloadFailed: "新しいWindowsインストーラーをダウンロードできませんでした。後でもう一度お試しください。", verifyFailed: "新しいWindowsインストーラーの検証に失敗したため削除しました。", openFailed: "Windowsインストーラーをダウンロードしましたが開けません：{error}" },
  ko: { noDmg: "이 릴리스에는 현재 Windows PC용 설치 프로그램이 없습니다.", downloadFailed: "새 Windows 설치 프로그램을 다운로드하지 못했습니다. 나중에 다시 시도하세요.", verifyFailed: "새 Windows 설치 프로그램 검증에 실패하여 파일을 삭제했습니다.", openFailed: "Windows 설치 프로그램을 다운로드했지만 열 수 없습니다: {error}" },
};

function updateMessage(key, variables = {}) {
  const base = UPDATE_MESSAGES[currentLanguage] || UPDATE_MESSAGES["zh-TW"];
  const platform = process.platform === "win32" ? (WINDOWS_UPDATE_MESSAGES[currentLanguage] || WINDOWS_UPDATE_MESSAGES["zh-TW"]) : {};
  let value = platform[key] || base[key] || UPDATE_MESSAGES["zh-TW"][key] || key;
  for (const [name, replacement] of Object.entries(variables)) value = value.replaceAll(`{${name}}`, String(replacement));
  return value;
}

const BACKUP_MESSAGES = {
  "zh-TW": { chooseFolder: "選擇澄境自動備份資料夾", directoryRequired: "請先選擇自動備份資料夾。", directoryInvalid: "選定的自動備份資料夾目前無法使用，請重新選擇。", payloadInvalid: "澄境無法建立這份備份，請稍後再試。", writeFailed: "自動備份寫入失敗，請確認資料夾仍可使用。" },
  "zh-CN": { chooseFolder: "选择澄境自动备份文件夹", directoryRequired: "请先选择自动备份文件夹。", directoryInvalid: "所选的自动备份文件夹目前无法使用，请重新选择。", payloadInvalid: "澄境无法创建此备份，请稍后重试。", writeFailed: "自动备份写入失败，请确认文件夹仍可使用。" },
  en: { chooseFolder: "Choose ChengJing automatic backup folder", directoryRequired: "Choose an automatic backup folder first.", directoryInvalid: "The selected automatic backup folder is currently unavailable. Choose it again.", payloadInvalid: "ChengJing could not create this backup. Try again later.", writeFailed: "Automatic backup could not be written. Make sure the folder is still available." },
  ja: { chooseFolder: "ChengJingの自動バックアップ先を選択", directoryRequired: "先に自動バックアップ先を選択してください。", directoryInvalid: "選択した自動バックアップ先を現在使用できません。もう一度選択してください。", payloadInvalid: "このバックアップを作成できませんでした。後でもう一度お試しください。", writeFailed: "自動バックアップを書き込めませんでした。フォルダが利用できるか確認してください。" },
  ko: { chooseFolder: "ChengJing 자동 백업 폴더 선택", directoryRequired: "먼저 자동 백업 폴더를 선택하세요.", directoryInvalid: "선택한 자동 백업 폴더를 현재 사용할 수 없습니다. 다시 선택하세요.", payloadInvalid: "이 백업을 만들 수 없습니다. 나중에 다시 시도하세요.", writeFailed: "자동 백업을 저장하지 못했습니다. 폴더를 계속 사용할 수 있는지 확인하세요." },
};

function backupMessage(key) {
  return (BACKUP_MESSAGES[currentLanguage] || BACKUP_MESSAGES["zh-TW"])[key] || BACKUP_MESSAGES["zh-TW"][key] || key;
}

function serializeAutoBackup(operation) {
  const pending = autoBackupOperation.then(operation, operation);
  autoBackupOperation = pending.catch(() => {});
  return pending;
}

function serializeCloudBackup(operation) {
  const pending = cloudBackupOperation.then(operation, operation);
  cloudBackupOperation = pending.catch(() => {});
  return pending;
}

const CLOUD_BACKUP_MESSAGES = {
  "zh-TW": {
    notConfigured: "Google 雲端備份尚未完成服務設定。",
    authRequired: "請先連結 Google 帳號。",
    authExpired: "Google 授權已失效，請重新連結帳號。",
    authDenied: "你取消了 Google 授權，雲端備份沒有啟用。",
    authTimeout: "Google 登入等候逾時，請再試一次。",
    secureStorage: "這台電腦目前無法安全保存 Google 授權，雲端備份沒有啟用。",
    decision: "雲端已有另一份資料。請先選擇復原雲端內容，或明確以這台裝置取代。",
    conflict: "雲端備份已被另一台裝置更新。為避免互相覆蓋，澄境已暫停這台裝置的自動備份。",
    previousUnavailable: "目前沒有可用的一天前備份。",
    currentUnavailable: "目前沒有可用的雲端備份。",
    restoreAsset: "雲端備份的附件不完整，為保護資料，澄境沒有執行復原。",
    connection: "目前無法連上 Google Drive，請確認網路後再試。",
    write: "Google 雲端備份未完成，澄境會在下次閒置時重試。",
    restore: "無法下載這份雲端備份，請稍後再試。",
  },
  "zh-CN": { notConfigured: "Google 云端备份尚未完成服务设置。", authRequired: "请先连接 Google 帐号。", authExpired: "Google 授权已失效，请重新连接帐号。", authDenied: "你取消了 Google 授权，云端备份未启用。", authTimeout: "Google 登录等待超时，请重试。", secureStorage: "这台电脑目前无法安全保存 Google 授权，云端备份未启用。", decision: "云端已有另一份数据。请先选择恢复云端内容，或明确使用这台设备替换。", conflict: "云端备份已被另一台设备更新。为避免互相覆盖，澄境已暂停这台设备的自动备份。", previousUnavailable: "目前没有可用的一天前备份。", currentUnavailable: "目前没有可用的云端备份。", restoreAsset: "云端备份的附件不完整，为保护数据，澄境未执行恢复。", connection: "目前无法连接 Google Drive，请确认网络后重试。", write: "Google 云端备份未完成，澄境会在下次空闲时重试。", restore: "无法下载这份云端备份，请稍后重试。" },
  en: { notConfigured: "Google cloud backup has not been configured for this build.", authRequired: "Connect a Google Account first.", authExpired: "Google authorization has expired. Reconnect your account.", authDenied: "Google authorization was cancelled, so cloud backup was not enabled.", authTimeout: "Google sign-in timed out. Try again.", secureStorage: "This computer cannot securely store Google authorization right now, so cloud backup was not enabled.", decision: "Another backup already exists in the cloud. Restore it first or explicitly replace it with this device.", conflict: "Another device updated the cloud backup. ChengJing paused automatic backup here to prevent overwriting it.", previousUnavailable: "No previous-day backup is available.", currentUnavailable: "No cloud backup is available.", restoreAsset: "The cloud backup is missing an attachment. ChengJing did not restore it, to protect your data.", connection: "Could not connect to Google Drive. Check your connection and try again.", write: "Google cloud backup did not finish. ChengJing will retry the next time it is idle.", restore: "Could not download this cloud backup. Try again later." },
};

function cloudBackupMessage(key) {
  return (CLOUD_BACKUP_MESSAGES[currentLanguage] || CLOUD_BACKUP_MESSAGES.en)[key] || CLOUD_BACKUP_MESSAGES.en[key] || key;
}

function friendlyCloudBackupError(error, operation = "connection") {
  const code = String(error?.message || "");
  if (code === "cloud-service-not-configured") return cloudBackupMessage("notConfigured");
  if (code === "cloud-auth-required") return cloudBackupMessage("authRequired");
  if (code === "cloud-auth-expired" || code === "cloud-token-unreadable") return cloudBackupMessage("authExpired");
  if (code === "cloud-auth-denied") return cloudBackupMessage("authDenied");
  if (code === "cloud-auth-timeout") return cloudBackupMessage("authTimeout");
  if (code === "cloud-secure-storage-unavailable") return cloudBackupMessage("secureStorage");
  if (code === "cloud-backup-decision-required") return cloudBackupMessage("decision");
  if (code === "cloud-backup-conflict") return cloudBackupMessage("conflict");
  if (code === "cloud-previous-unavailable") return cloudBackupMessage("previousUnavailable");
  if (code === "cloud-current-unavailable") return cloudBackupMessage("currentUnavailable");
  if (/cloud-(?:restore-asset|backup-asset)/.test(code)) return cloudBackupMessage("restoreAsset");
  return cloudBackupMessage(operation);
}

async function createRestoreSafetyBackup(request = {}) {
  const directory = path.join(app.getPath("userData"), "Restore Safety");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const result = await createAutoBackup({
    directory,
    data: String(request.data || ""),
    retentionCount: 3,
    assetsDirectory: attachmentsDirectory(),
    assets: Array.isArray(request.assets) ? request.assets : [],
  });
  const entries = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !isOwnedBackupFilename(entry.name)) continue;
    entries.push({ name: entry.name, modifiedAt: (await fs.stat(path.join(directory, entry.name))).mtimeMs });
  }
  entries.sort((left, right) => right.modifiedAt - left.modifiedAt);
  await Promise.all(entries.slice(1).map((entry) => fs.rm(path.join(directory, entry.name), { force: true })));
  await cleanupIncrementalAssets(directory);
  return result;
}

function friendlyAutoBackupError(error) {
  if (error?.message === "backup-directory-required") return backupMessage("directoryRequired");
  if (error?.message === "backup-directory-invalid" || error?.code === "ENOENT" || error?.code === "ENOTDIR") return backupMessage("directoryInvalid");
  if (error?.message === "backup-payload-invalid" || error?.name === "SyntaxError") return backupMessage("payloadInvalid");
  return backupMessage("writeFailed");
}

function currentAppVersion() {
  return isSmoke && process.env.CHENGJING_UPDATE_CURRENT_VERSION
    ? String(process.env.CHENGJING_UPDATE_CURRENT_VERSION)
    : app.getVersion();
}

function updateRequestHeaders(accept) {
  return {
    Accept: accept,
    "User-Agent": `ChengJing/${currentAppVersion()}`,
    "X-GitHub-Api-Version": "2026-03-10",
  };
}

function noteGitHubRateLimit(response) {
  const retryAfter = Number(response.headers.get("retry-after") || 0);
  const resetAt = Number(response.headers.get("x-ratelimit-reset") || 0) * 1000;
  githubApiBlockedUntil = retryAfter > 0 ? Date.now() + retryAfter * 1000 : resetAt > Date.now() ? resetAt : Date.now() + 60_000;
}

async function parseUpdateResponse(response) {
  if (!response.ok) throw new Error(`update-source-${response.status}`);
  const payload = await response.json();
  const update = parseLatestRelease(payload, currentAppVersion(), process.arch, process.platform);
  if (isUpdateCandidateStale(update, currentAppVersion())) throw new Error("update-source-stale");
  return update;
}

async function updateFromCloudflare(signal) {
  const response = await net.fetch(CLOUDFLARE_UPDATE_INDEX_URL, {
    headers: updateRequestHeaders("application/json"),
    signal,
  });
  return parseUpdateResponse(response);
}

async function enrichFeedUpdate(update, signal) {
  if (!update.asset) return update;
  let size = 0;
  try {
    const assetResponse = await net.fetch(update.asset.url, { method: "HEAD", headers: updateRequestHeaders("application/octet-stream"), signal });
    if (assetResponse.ok) size = Number(assetResponse.headers.get("content-length") || 0) || 0;
  } catch {}
  return { ...update, asset: { ...update.asset, digest: null, size } };
}

async function updateFromGitHubFeed(signal) {
  const response = await net.fetch(GITHUB_RELEASE_FEED_URL, {
    headers: updateRequestHeaders("application/atom+xml"),
    signal,
  });
  if (!response.ok) throw new Error(`github-feed-${response.status}`);
  if (Number(response.headers.get("content-length") || 0) > 1_000_000) throw new Error("github-feed-too-large");
  const update = parseLatestReleaseFeed(await response.text(), currentAppVersion(), process.arch, process.platform);
  if (isUpdateCandidateStale(update, currentAppVersion())) throw new Error("update-source-stale");
  return enrichFeedUpdate(update, signal);
}

async function checkForUpdate(options = {}) {
  const force = Boolean(options?.force);
  if (!force && latestUpdate && Date.now() - latestUpdateCheckedAt < 5 * 60_000) return latestUpdate;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    let checkedUpdate = null;
    const forceFallback = isSmoke && process.env.CHENGJING_SMOKE_UPDATE_FORCE_FALLBACK === "1";
    if (!forceFallback && Date.now() >= githubApiBlockedUntil) {
      try {
        const response = await net.fetch(GITHUB_RELEASE_URL, {
          headers: updateRequestHeaders("application/vnd.github+json"),
          signal: controller.signal,
        });
        if (response.status === 403 || response.status === 429) noteGitHubRateLimit(response);
        checkedUpdate = await parseUpdateResponse(response);
      } catch {}
    }
    if (!checkedUpdate) {
      try { checkedUpdate = await updateFromCloudflare(controller.signal); }
      catch { checkedUpdate = await updateFromGitHubFeed(controller.signal); }
    }
    latestUpdate = checkedUpdate;
    latestUpdateCheckedAt = Date.now();
    return latestUpdate;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(updateMessage("checkFailed"));
    if (error?.message === "update-source-stale") throw new Error(updateMessage("staleRelease"));
    throw new Error(updateMessage("checkFailed"));
  } finally {
    clearTimeout(timer);
  }
}

function updateUrlIsTrusted(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["github.com", "objects.githubusercontent.com", "github-releases.githubusercontent.com"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function verifyDownloadedUpdate(filePath, asset) {
  const stat = await fs.stat(filePath);
  if (asset.size > 0 && stat.size !== asset.size) throw new Error(updateMessage("verifyFailed"));
  if (asset.digest?.startsWith("sha256:")) {
    const actual = await sha256File(filePath);
    if (actual.toLowerCase() !== asset.digest.slice(7).toLowerCase()) throw new Error(updateMessage("verifyFailed"));
  }
}

async function downloadLatestUpdate() {
  if (activeUpdateDownload) return activeUpdateDownload;
  activeUpdateDownload = (async () => {
    const update = latestUpdate?.status === "available" ? latestUpdate : await checkForUpdate();
    if (update.status !== "available") return { opened: false, status: update.status, currentVersion: update.currentVersion };
    if (!update.asset) throw new Error(updateMessage("noDmg"));
    if (!updateUrlIsTrusted(update.asset.url)) throw new Error(updateMessage("unsafeUrl"));
    const folder = path.join(app.getPath("temp"), "chengjing-updates");
    const filename = path.basename(update.asset.name);
    const expectedExtension = process.platform === "win32" ? ".exe" : ".dmg";
    if (!filename.toLowerCase().endsWith(expectedExtension)) throw new Error(updateMessage("noDmg"));
    const destination = path.join(folder, filename);
    const partial = `${destination}.part`;
    await fs.mkdir(folder, { recursive: true });
    await fs.rm(destination, { force: true });
    await fs.rm(partial, { force: true });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15 * 60_000);
    let fileHandle = null;
    try {
      const response = await net.fetch(update.asset.url, {
        headers: { "User-Agent": `ChengJing/${currentAppVersion()}` },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(updateMessage("downloadFailed"));
      const total = Number(response.headers.get("content-length") || 0) || update.asset.size || 0;
      fileHandle = await fs.open(partial, "w", 0o600);
      const reader = response.body.getReader();
      let received = 0;
      let lastProgressAt = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        await fileHandle.write(chunk);
        received += chunk.length;
        const now = Date.now();
        if (now - lastProgressAt >= 160) {
          lastProgressAt = now;
          mainWindow?.webContents.send("update:progress", { state: "progressing", received, total, percent: total > 0 ? Math.min(100, received / total * 100) : 0 });
        }
      }
      await fileHandle.sync();
      await fileHandle.close();
      fileHandle = null;
      await fs.rename(partial, destination);
      await verifyDownloadedUpdate(destination, update.asset);
    } catch (error) {
      await fileHandle?.close().catch(() => {});
      await Promise.all([fs.rm(partial, { force: true }).catch(() => {}), fs.rm(destination, { force: true }).catch(() => {})]);
      if (error instanceof Error && error.message === updateMessage("verifyFailed")) throw error;
      throw new Error(updateMessage("downloadFailed"));
    } finally {
      clearTimeout(timeout);
    }
    mainWindow?.webContents.send("update:progress", { state: "completed", received: update.asset.size, total: update.asset.size, percent: 100 });
    if (isSmoke && process.env.CHENGJING_UPDATE_SKIP_OPEN === "1") return { opened: false, verified: true, filePath: destination, latestVersion: update.latestVersion };
    const openError = await shell.openPath(destination);
    if (openError) throw new Error(updateMessage("openFailed", { error: openError }));
    return { opened: true, verified: true, filePath: destination, latestVersion: update.latestVersion };
  })().finally(() => { activeUpdateDownload = null; });
  return activeUpdateDownload;
}

function friendlyOpenRouterError(status, payload) {
  const detail = payload?.error?.message;
  if (status === 401 || status === 403) return message("invalidKey");
  if (status === 402) return message("balance");
  if (status === 404) return message("modelNotFound");
  if (status === 408) return message("responseTimeout");
  if (status === 429) return message("rateLimit");
  if (status >= 500) return message("serviceDown");
  return detail ? message("replyError", { detail }) : message("requestFailed", { status });
}

function friendlyNetworkError(error, action = message("actionConnect")) {
  const code = error?.cause?.code || error?.code || "";
  const detail = String(error?.message || "");
  if (!net.isOnline()) return message("offline", { action });
  if (detail.includes("ERR_NAME_NOT_RESOLVED")) return message("dns");
  if (detail.includes("ERR_PROXY_CONNECTION_FAILED") || detail.includes("ERR_TUNNEL_CONNECTION_FAILED")) return message("proxy");
  if (detail.includes("ERR_CERT")) return message("certificate");
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return message("dnsNetwork");
  if (code === "ECONNREFUSED" || code === "ECONNRESET") return message("connectionReset");
  if (String(code).includes("CERT")) return message("certificateProxy");
  return message("networkFallback", { action });
}

function trayMessages() {
  return (TRAY_MESSAGES[currentLanguage] || TRAY_MESSAGES["zh-TW"]);
}

function currentLoginItemSettings() {
  return process.platform === "darwin"
    ? app.getLoginItemSettings({ type: "mainAppService" })
    : app.getLoginItemSettings({ args: ["--background"] });
}

function updateLoginItemSettings(openAtLogin) {
  if (process.platform === "darwin") {
    app.setLoginItemSettings({ openAtLogin, type: "mainAppService" });
    return;
  }
  app.setLoginItemSettings({ openAtLogin, args: ["--background"] });
}

async function showMainWindow() {
  if (process.platform === "darwin") {
    app.setActivationPolicy("regular");
    await app.dock?.show();
  }
  if (!mainWindow || mainWindow.isDestroyed()) await createWindow({ show: true });
  else { mainWindow.show(); mainWindow.focus(); }
}

function enterBackgroundAgentMode() {
  if (process.platform !== "darwin") return;
  app.setActivationPolicy("accessory");
  app.dock?.hide();
}

function quickCaptureBounds() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = 618;
  const height = 228;
  return {
    width,
    height,
    x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    y: Math.round(display.workArea.y + display.workArea.height * 0.62 - height / 2),
  };
}

async function createQuickCaptureWindow() {
  if (quickCaptureWindow && !quickCaptureWindow.isDestroyed()) return quickCaptureWindow;
  quickCaptureWindow = new BrowserWindow({
    ...quickCaptureBounds(),
    title: "澄境・隻言片語",
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    ...(process.platform === "darwin" ? { type: "panel", roundedCorners: false } : {}),
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    excludedFromShownWindowsMenu: true,
    show: false,
    hasShadow: false,
    opacity: 0,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      paintWhenInitiallyHidden: true,
    },
  });
  if (process.platform === "darwin") {
    quickCaptureWindow.setAlwaysOnTop(true, "floating");
    quickCaptureWindow.setHiddenInMissionControl(true);
  } else {
    quickCaptureWindow.setAlwaysOnTop(true);
  }
  quickCaptureWindow.setIgnoreMouseEvents(true);
  if (isDev) await quickCaptureWindow.loadURL("http://127.0.0.1:5173/?quick-capture=1");
  else await quickCaptureWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"), { query: { "quick-capture": "1" } });
  if (process.platform === "darwin") quickCaptureWindow.showInactive();
  quickCaptureWindow.on("blur", () => { if (quickCapturePresented && !quickCaptureWindow?.webContents.isDevToolsOpened()) parkQuickCaptureWindow(); });
  quickCaptureWindow.on("closed", () => {
    quickCaptureWindow = null;
    quickCapturePresented = false;
  });
  return quickCaptureWindow;
}

function parkQuickCaptureWindow() {
  if (nativeQuickCaptureReady && nativeHotkeyProcess?.stdin?.writable) {
    nativeQuickCapturePresented = false;
    nativeHotkeyProcess.stdin.write("hide\n");
    return;
  }
  const window = quickCaptureWindow;
  quickCapturePresented = false;
  if (!window || window.isDestroyed()) return;
  window.setOpacity(0);
  window.setIgnoreMouseEvents(true);
  window.blur();
  window.setFocusable(false);
  if (process.platform !== "darwin") window.hide();
}

async function showQuickCapture() {
  const startedAt = performance.now();
  if (nativeQuickCaptureReady && nativeHotkeyProcess?.stdin?.writable) {
    const nextPresented = !nativeQuickCapturePresented;
    nativeQuickCapturePresented = nextPresented;
    nativeHotkeyProcess.stdin.write(nextPresented ? "show\n" : "hide\n");
    return { shown: nextPresented, native: true, latencyMs: performance.now() - startedAt };
  }
  const window = await createQuickCaptureWindow();
  if (quickCapturePresented) {
    parkQuickCaptureWindow();
    return { shown: false, latencyMs: performance.now() - startedAt };
  }
  window.setBounds(quickCaptureBounds(), false);
  window.setFocusable(true);
  window.setIgnoreMouseEvents(false);
  if (!window.isVisible()) {
    if (process.platform === "darwin") window.showInactive();
    else window.show();
  }
  window.setOpacity(1);
  window.focus();
  quickCapturePresented = true;
  window.webContents.send("quick-capture:focus");
  return { shown: true, latencyMs: performance.now() - startedAt };
}

function nativeQuickCaptureBounds() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = 554;
  const height = 164;
  return {
    width,
    height,
    x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    y: Math.round(display.workArea.y + display.workArea.height * 0.38 - height / 2),
  };
}

function nativeHotkeyExecutablePath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "native", "ChengJingQuickCapture.app", "Contents", "MacOS", "ChengJingQuickCapture")
    : path.join(__dirname, "..", "build", "ChengJingQuickCapture.app", "Contents", "MacOS", "ChengJingQuickCapture");
}

function stopQuickCaptureShortcut() {
  if (nativeHotkeyProcess) {
    const processToStop = nativeHotkeyProcess;
    nativeHotkeyProcess = null;
    nativeQuickCaptureReady = false;
    nativeQuickCapturePresented = false;
    processToStop.removeAllListeners();
    processToStop.stdout?.removeAllListeners();
    processToStop.stderr?.removeAllListeners();
    processToStop.kill("SIGTERM");
  }
  if (quickCaptureShortcut && globalShortcut.isRegistered(quickCaptureShortcut)) globalShortcut.unregister(quickCaptureShortcut);
  quickCaptureShortcutRegistered = false;
  quickCaptureShortcutBackend = "none";
}

async function startNativeHotkey(accelerator) {
  const parsed = parseMacHotkey(accelerator);
  if (!parsed) return false;
  const executable = nativeHotkeyExecutablePath();
  try { await fs.access(executable); } catch { return false; }
  return new Promise((resolve) => {
    const child = spawn(executable, [String(parsed.keyCode), String(parsed.modifiers)], { stdio: ["pipe", "pipe", "pipe"] });
    let settled = false;
    let buffer = "";
    const finish = (registered) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!registered) child.kill("SIGTERM");
      resolve(registered);
    };
    const timer = setTimeout(() => finish(false), 2_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line === "ready" && !settled) {
          nativeHotkeyProcess = child;
          nativeQuickCaptureReady = true;
          nativeQuickCapturePresented = false;
          quickCaptureShortcutBackend = "native-appkit";
          quickCaptureShortcutRegistered = true;
          finish(true);
        } else if (line === "trigger" && child === nativeHotkeyProcess) {
          // The native helper shows the prebuilt AppKit panel before reporting the hotkey.
        } else if (line === "shown" && child === nativeHotkeyProcess) {
          nativeQuickCapturePresented = true;
        } else if (line === "hidden" && child === nativeHotkeyProcess) {
          nativeQuickCapturePresented = false;
        } else if (line.startsWith("submit:") && child === nativeHotkeyProcess) {
          try {
            const value = Buffer.from(line.slice(7), "base64").toString("utf8").trim();
            if (!value || value.length > 500) throw new Error("invalid-native-capture");
            quickCaptureWindow?.webContents.send("quick-capture:native-submit", value);
          } catch {
            child.stdin?.write("error\n");
          }
        } else if (line.startsWith("error:")) {
          finish(false);
        }
      }
    });
    child.on("error", () => finish(false));
    child.on("exit", () => {
      if (child === nativeHotkeyProcess) {
        nativeHotkeyProcess = null;
        nativeQuickCaptureReady = false;
        nativeQuickCapturePresented = false;
        quickCaptureShortcutRegistered = false;
        quickCaptureShortcutBackend = "none";
      }
      finish(false);
    });
  });
}

async function registerQuickCaptureShortcut(accelerator) {
  stopQuickCaptureShortcut();
  if (process.platform === "darwin" && await startNativeHotkey(accelerator)) {
    quickCaptureShortcut = accelerator;
    return true;
  }
  let registered = false;
  try { registered = globalShortcut.register(accelerator, () => void showQuickCapture()); } catch { registered = false; }
  if (registered) {
    quickCaptureShortcut = accelerator;
    quickCaptureShortcutRegistered = true;
    quickCaptureShortcutBackend = "electron";
  }
  return registered;
}

function refreshTrayMenu() {
  if (!tray) return;
  const m = trayMessages();
  tray.setToolTip(m.tooltip);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: m.quickCapture, accelerator: quickCaptureShortcut, click: () => void showQuickCapture() },
    { label: m.showApp, click: () => void showMainWindow() },
    { type: "separator" },
    { label: m.quit, click: () => app.quit() },
  ]));
}

function createTray() {
  if (tray || isSmoke) return;
  const trayIconPath = path.join(__dirname, "assets", process.platform === "darwin" ? "ChengJingTrayTemplate.png" : "ChengJingTray.png");
  const image = nativeImage.createFromPath(trayIconPath);
  const size = image.getSize();
  trayImageDetails = { empty: image.isEmpty(), width: size.width, height: size.height, path: trayIconPath };
  if (image.isEmpty()) throw new Error(`tray-icon-empty:${trayIconPath}`);
  if (process.platform === "darwin") image.setTemplateImage(true);
  tray = new Tray(image, "d4c01a40-29ff-4a43-966a-d1ecdc6776b2");
  tray.setIgnoreDoubleClickEvents(true);
  tray.on("click", () => void showQuickCapture());
  refreshTrayMenu();
}

async function createWindow({ show = !isSmoke } = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1040,
    minHeight: 680,
    title: "澄境",
    backgroundColor: "#141817",
    autoHideMenuBar: process.platform === "win32",
    ...(process.platform === "darwin" ? {
      titleBarStyle: "hidden",
      titleBarOverlay: { height: 68 },
    } : {}),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("did-start-loading", () => { mcpRendererReady = false; });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowedDev = isDev && url.startsWith("http://127.0.0.1:5173");
    const allowedFile = !isDev && url.startsWith("file:");
    if (!allowedDev && !allowedFile) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.webContents.on("context-menu", (_event, params) => {
    if (!params.isEditable && !params.selectionText) return;
    const m = MENU_MESSAGES[currentLanguage] || MENU_MESSAGES["zh-TW"];
    const template = [
      ...(params.isEditable ? [
        { role: "undo", label: m.undo, enabled: Boolean(params.editFlags?.canUndo) },
        { role: "redo", label: m.redo, enabled: Boolean(params.editFlags?.canRedo) },
        { type: "separator" },
        { role: "cut", label: m.cut, enabled: Boolean(params.editFlags?.canCut) },
      ] : []),
      { role: "copy", label: m.copy, enabled: Boolean(params.editFlags?.canCopy || params.selectionText) },
      ...(params.isEditable ? [
        { role: "paste", label: m.paste, enabled: Boolean(params.editFlags?.canPaste) },
        { role: "selectAll", label: m.selectAll, enabled: Boolean(params.editFlags?.canSelectAll) },
      ] : []),
    ];
    Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });

  const sendWindowState = () => mainWindow?.webContents.send("app:window-state", { fullscreen: Boolean(mainWindow?.isFullScreen()), maximized: Boolean(mainWindow?.isMaximized()) });
  mainWindow.on("enter-full-screen", sendWindowState);
  mainWindow.on("leave-full-screen", sendWindowState);
  mainWindow.on("maximize", sendWindowState);
  mainWindow.on("unmaximize", sendWindowState);
  mainWindow.on("close", (event) => {
    if (isQuitting || isSmoke) return;
    event.preventDefault();
    mainWindow.hide();
    if (process.platform === "darwin") enterBackgroundAgentMode();
  });

  if (isDev) {
    await mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.once("ready-to-show", () => { if (show && !isSmoke) mainWindow.show(); });
  mainWindow.on("closed", () => {
    mcpRendererReady = false;
    for (const request of mcpWorkspaceRequests.values()) request.reject(new Error("mcp-renderer-closed"));
    mcpWorkspaceRequests.clear();
    mainWindow = null;
  });
  return mainWindow;
}

const MENU_MESSAGES = {
  "zh-TW": { app: "澄境", about: "關於澄境", hide: "隱藏澄境", hideOthers: "隱藏其他應用程式", showAll: "全部顯示", quit: "結束澄境", file: "檔案", newCard: "新增卡片", search: "快速搜尋", export: "匯出備份", closeWindow: "關閉視窗", edit: "編輯", undo: "復原", redo: "重做", cut: "剪下", copy: "複製", paste: "貼上", selectAll: "全選", view: "顯示", reload: "重新載入", devtools: "開發者工具", actualSize: "實際大小", zoomIn: "放大", zoomOut: "縮小", fullscreen: "全螢幕", window: "視窗" },
  "zh-CN": { app: "澄境", about: "关于澄境", hide: "隐藏澄境", hideOthers: "隐藏其他应用", showAll: "全部显示", quit: "退出澄境", file: "文件", newCard: "新增卡片", search: "快速搜索", export: "导出备份", closeWindow: "关闭窗口", edit: "编辑", undo: "撤销", redo: "重做", cut: "剪切", copy: "复制", paste: "粘贴", selectAll: "全选", view: "显示", reload: "重新加载", devtools: "开发者工具", actualSize: "实际大小", zoomIn: "放大", zoomOut: "缩小", fullscreen: "全屏", window: "窗口" },
  en: { app: "ChengJing", about: "About ChengJing", hide: "Hide ChengJing", hideOthers: "Hide Others", showAll: "Show All", quit: "Quit ChengJing", file: "File", newCard: "New Card", search: "Quick Search", export: "Export Backup", closeWindow: "Close Window", edit: "Edit", undo: "Undo", redo: "Redo", cut: "Cut", copy: "Copy", paste: "Paste", selectAll: "Select All", view: "View", reload: "Reload", devtools: "Developer Tools", actualSize: "Actual Size", zoomIn: "Zoom In", zoomOut: "Zoom Out", fullscreen: "Full Screen", window: "Window" },
  ja: { app: "ChengJing", about: "ChengJingについて", hide: "ChengJingを隠す", hideOthers: "ほかを隠す", showAll: "すべて表示", quit: "ChengJingを終了", file: "ファイル", newCard: "新しいカード", search: "クイック検索", export: "バックアップを書き出す", closeWindow: "ウインドウを閉じる", edit: "編集", undo: "取り消す", redo: "やり直す", cut: "切り取り", copy: "コピー", paste: "ペースト", selectAll: "すべて選択", view: "表示", reload: "再読み込み", devtools: "開発者ツール", actualSize: "実際のサイズ", zoomIn: "拡大", zoomOut: "縮小", fullscreen: "フルスクリーン", window: "ウインドウ" },
  ko: { app: "ChengJing", about: "ChengJing 정보", hide: "ChengJing 가리기", hideOthers: "기타 가리기", showAll: "모두 보기", quit: "ChengJing 종료", file: "파일", newCard: "새 카드", search: "빠른 검색", export: "백업 내보내기", closeWindow: "창 닫기", edit: "편집", undo: "실행 취소", redo: "다시 실행", cut: "잘라내기", copy: "복사", paste: "붙여넣기", selectAll: "전체 선택", view: "보기", reload: "새로고침", devtools: "개발자 도구", actualSize: "실제 크기", zoomIn: "확대", zoomOut: "축소", fullscreen: "전체 화면", window: "윈도우" },
};

const TRAY_MESSAGES = {
  "zh-TW": { tooltip: "澄境・快速留下隻言片語", quickCapture: "留下隻言片語", showApp: "顯示澄境", quit: "結束澄境" },
  "zh-CN": { tooltip: "澄境・快速留下只言片语", quickCapture: "留下只言片语", showApp: "显示澄境", quit: "退出澄境" },
  en: { tooltip: "ChengJing · Quick Fragment", quickCapture: "Capture a fragment", showApp: "Show ChengJing", quit: "Quit ChengJing" },
  ja: { tooltip: "ChengJing・ひとこと記録", quickCapture: "ひとことを残す", showApp: "ChengJingを表示", quit: "ChengJingを終了" },
  ko: { tooltip: "ChengJing · 빠른 생각 기록", quickCapture: "짧은 생각 남기기", showApp: "ChengJing 보기", quit: "ChengJing 종료" },
};

const UPDATE_MENU_LABELS = {
  "zh-TW": "檢查更新…",
  "zh-CN": "检查更新…",
  en: "Check for Updates…",
  ja: "アップデートを確認…",
  ko: "업데이트 확인…",
};

function installMenu(language = currentLanguage) {
  const baseMessages = MENU_MESSAGES[language] || MENU_MESSAGES["zh-TW"];
  const m = { ...baseMessages, checkUpdates: UPDATE_MENU_LABELS[language] || UPDATE_MENU_LABELS["zh-TW"] };
  const template = buildApplicationMenuTemplate({
    messages: m,
    isMac: process.platform === "darwin",
    checkUpdatesIcon: (() => {
      const systemVersion = process.platform === "darwin" ? process.getSystemVersion() : "";
      if (!shouldUseUpdateMenuIcon(process.platform, systemVersion) || typeof nativeImage.createMenuSymbol !== "function") return undefined;
      try {
        const icon = nativeImage.createMenuSymbol("arrow.triangle.2.circlepath");
        return icon.isEmpty() ? undefined : icon;
      } catch { return undefined; }
    })(),
    sendShortcut: (value) => {
      if (value === "close-main-window") {
        mainWindow?.close();
        return;
      }
      mainWindow?.webContents.send("shortcut", value);
    },
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle("app:set-language", async (_event, language) => {
  if (!MENU_MESSAGES[language]) return { language: currentLanguage };
  currentLanguage = language;
  installMenu(currentLanguage);
  refreshTrayMenu();
  return { language: currentLanguage };
});

ipcMain.handle("app:get-preferred-language", async () => {
  const preferredLanguages = app.getPreferredSystemLanguages();
  return { language: languageFromPreferences(preferredLanguages), preferredLanguages };
});

ipcMain.handle("app:get-system-version", async () => ({ platform: process.platform, arch: process.arch, version: process.getSystemVersion() }));
ipcMain.handle("app:get-window-state", async () => ({
  exists: Boolean(mainWindow && !mainWindow.isDestroyed()),
  visible: Boolean(mainWindow?.isVisible()),
  fullscreen: Boolean(mainWindow?.isFullScreen()),
  maximized: Boolean(mainWindow?.isMaximized()),
  bounds: mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null,
}));

ipcMain.handle("app:quit", async () => {
  setImmediate(() => app.quit());
  return { quitting: true };
});

ipcMain.handle("app:close-main", async () => {
  mainWindow?.close();
  return { closed: Boolean(mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) };
});

ipcMain.handle("app:get-menu-snapshot", async () => {
  const menu = Menu.getApplicationMenu();
  return (menu?.items || []).map((item) => ({
    label: item.label,
    role: item.role || "",
    submenu: (item.submenu?.items || []).map((child) => ({ label: child.label, role: child.role || "", type: child.type || "normal", hasIcon: Boolean(child.icon && (typeof child.icon.isEmpty !== "function" || !child.icon.isEmpty())) })),
  }));
});

ipcMain.handle("quick-capture:get-settings", async () => ({
  shortcut: quickCaptureShortcut,
  defaultShortcut: DEFAULT_SHORTCUT,
  registered: quickCaptureShortcutRegistered,
  shortcutBackend: quickCaptureShortcutBackend,
  openAtLogin: currentLoginItemSettings().openAtLogin,
  loginStatus: currentLoginItemSettings().status || "unknown",
  wasOpenedAtLogin: Boolean(currentLoginItemSettings().wasOpenedAtLogin),
  trayReady: Boolean(tray),
  trayImageEmpty: trayImageDetails.empty,
  trayImageSize: { width: trayImageDetails.width, height: trayImageDetails.height },
  trayBounds: tray ? tray.getBounds() : null,
  inputBackend: nativeQuickCaptureReady ? "native-nstextview" : "electron-textarea",
  windowReady: nativeQuickCaptureReady || Boolean(quickCaptureWindow && !quickCaptureWindow.isDestroyed()),
  windowVisible: nativeQuickCaptureReady ? nativeQuickCapturePresented : quickCapturePresented,
  windowNativeVisible: nativeQuickCaptureReady ? nativeQuickCapturePresented : Boolean(quickCaptureWindow?.isVisible()),
  windowWarm: nativeQuickCaptureReady ? !nativeQuickCapturePresented : Boolean(quickCaptureWindow?.isVisible() && !quickCapturePresented && quickCaptureWindow?.getOpacity() === 0),
  windowOpacity: nativeQuickCaptureReady ? (nativeQuickCapturePresented ? 1 : 0) : (quickCaptureWindow?.getOpacity() ?? 0),
  windowFocused: nativeQuickCaptureReady ? nativeQuickCapturePresented : Boolean(quickCaptureWindow?.isFocused()),
  appActive: process.platform === "darwin" ? app.isActive() : true,
  imeReady: nativeQuickCaptureReady ? nativeQuickCapturePresented : Boolean(quickCapturePresented && quickCaptureWindow?.isFocused() && (process.platform !== "darwin" || app.isActive())),
  windowAlwaysOnTop: nativeQuickCaptureReady || Boolean(quickCaptureWindow?.isAlwaysOnTop()),
  windowVisibleOnAllWorkspaces: nativeQuickCaptureReady || Boolean(quickCaptureWindow?.isVisibleOnAllWorkspaces()),
  windowHasShadow: nativeQuickCaptureReady || Boolean(quickCaptureWindow?.hasShadow()),
  windowBounds: nativeQuickCaptureReady ? nativeQuickCaptureBounds() : (quickCaptureWindow && !quickCaptureWindow.isDestroyed() ? quickCaptureWindow.getBounds() : null),
}));

ipcMain.handle("quick-capture:native-submit-result", async (_event, succeeded) => {
  if (!nativeQuickCaptureReady || !nativeHotkeyProcess?.stdin?.writable) return { acknowledged: false };
  nativeHotkeyProcess.stdin.write(succeeded ? "saved\n" : "error\n");
  return { acknowledged: true };
});

ipcMain.handle("quick-capture:set-shortcut", async (_event, rawShortcut) => {
  const next = String(rawShortcut || "").trim();
  if (!next || next.length > 80 || !/^(?=.*(?:Command|Control|Alt|Shift|Super|Meta))[^\r\n]+$/.test(next)) throw new Error("invalid-shortcut");
  const previous = quickCaptureShortcut;
  const registered = await registerQuickCaptureShortcut(next);
  if (!registered) {
    if (previous) await registerQuickCaptureShortcut(previous);
    throw new Error("shortcut-unavailable");
  }
  await writeQuickCaptureSettings(app.getPath("userData"), { shortcut: next });
  refreshTrayMenu();
  return { shortcut: next, registered: true, shortcutBackend: quickCaptureShortcutBackend };
});

ipcMain.handle("quick-capture:set-recording", async (_event, recording) => {
  if (recording) stopQuickCaptureShortcut();
  else await registerQuickCaptureShortcut(quickCaptureShortcut);
  return { suspended: Boolean(recording), registered: quickCaptureShortcutRegistered };
});

ipcMain.handle("quick-capture:set-open-at-login", async (_event, enabled) => {
  const openAtLogin = Boolean(enabled);
  const previousBounds = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
  const preserveBounds = Boolean(previousBounds && !mainWindow.isFullScreen() && !mainWindow.isMaximized());
  updateLoginItemSettings(openAtLogin);
  await new Promise((resolve) => setImmediate(resolve));
  if (preserveBounds && mainWindow && !mainWindow.isDestroyed()) {
    const currentBounds = mainWindow.getBounds();
    if (currentBounds.x !== previousBounds.x || currentBounds.y !== previousBounds.y || currentBounds.width !== previousBounds.width || currentBounds.height !== previousBounds.height) {
      mainWindow.setBounds(previousBounds, false);
    }
  }
  const result = currentLoginItemSettings();
  return { openAtLogin: result.openAtLogin, status: result.status || "unknown" };
});

ipcMain.handle("quick-capture:hide", async () => { parkQuickCaptureWindow(); return { hidden: true }; });
ipcMain.handle("quick-capture:show", async () => showQuickCapture());
ipcMain.handle("quick-capture:show-main", async () => { await showMainWindow(); return { shown: true }; });

ipcMain.handle("clipboard:write", async (_event, request = {}) => {
  const text = String(request.text || "").slice(0, 1_000_000);
  const payload = JSON.stringify(request.payload || null);
  if (payload.length > 500_000) throw new Error("clipboard-payload-too-large");
  const escaped = text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
  await clipboard.write([new ClipboardItem({
    "text/plain": new Blob([text], { type: "text/plain" }),
    "text/html": new Blob([`<span>${escaped.replaceAll("\n", "<br>")}</span>`], { type: "text/html" }),
    [CLIPBOARD_MIME]: new Blob([payload], { type: CLIPBOARD_MIME }),
  })]);
  return { written: true };
});

ipcMain.handle("clipboard:read", async () => {
  const text = (await clipboard.readText()).slice(0, 1_000_000);
  const items = await clipboard.read();
  const item = items.find((candidate) => candidate.types.includes(CLIPBOARD_MIME));
  if (!item) return { text, payload: null };
  try { return { text, payload: JSON.parse(await (await item.getType(CLIPBOARD_MIME)).text()) }; }
  catch { return { text, payload: null }; }
});

ipcMain.handle("mcp:renderer-ready", async () => { markMcpRendererReady(); return { ready: true }; });
ipcMain.handle("mcp:workspace-result", async (_event, response = {}) => {
  const requestId = String(response.requestId || "");
  const pending = mcpWorkspaceRequests.get(requestId);
  if (!pending) return { accepted: false };
  mcpWorkspaceRequests.delete(requestId);
  if (response.error) pending.reject(new Error(String(response.error).slice(0, 800)));
  else pending.resolve(response.result);
  return { accepted: true };
});
ipcMain.handle("mcp:get-settings", async () => serializeMcp(async () => {
  const { readMcpSettings, readOrCreateMcpToken } = mcpSettingsApi();
  const userDataDirectory = app.getPath("userData");
  const settings = await readMcpSettings(userDataDirectory);
  await readOrCreateMcpToken(userDataDirectory);
  if (settings.enabled && !mcpServerStatus.running && !mcpServerStatus.error) return reconcileMcpServer();
  return mcpPublicStatus(settings);
}));
ipcMain.handle("mcp:update-settings", async (_event, patch = {}) => serializeMcp(async () => {
  const { readMcpSettings, writeMcpSettings } = mcpSettingsApi();
  const current = await readMcpSettings(app.getPath("userData"));
  await writeMcpSettings(app.getPath("userData"), { ...current, ...patch });
  return reconcileMcpServer();
}));
ipcMain.handle("mcp:regenerate-token", async () => serializeMcp(async () => {
  const { regenerateMcpToken } = mcpSettingsApi();
  await regenerateMcpToken(app.getPath("userData"));
  return reconcileMcpServer();
}));
ipcMain.handle("mcp:copy-setup", async (_event, target) => serializeMcp(async () => {
  const { readMcpSettings, readOrCreateMcpToken } = mcpSettingsApi();
  const settings = await readMcpSettings(app.getPath("userData"));
  const token = await readOrCreateMcpToken(app.getPath("userData"));
  const normalizedTarget = target === "claude" ? "claude" : "codex";
  clipboard.writeText(mcpSetupSnippet(normalizedTarget, mcpEndpoint(settings.port), token));
  return { copied: true, target: normalizedTarget };
}));
ipcMain.handle("mcp:get-audit", async () => mcpSettingsApi().readMcpAudit(app.getPath("userData")));

ipcMain.handle("update:check", async (_event, options) => checkForUpdate(options));
ipcMain.handle("update:download", async () => downloadLatestUpdate());

ipcMain.handle("backup:get-settings", async () => serializeAutoBackup(() => readAutoBackupSettings(app.getPath("userData"))));

ipcMain.handle("backup:choose-folder", async () => serializeAutoBackup(async () => {
  const current = await readAutoBackupSettings(app.getPath("userData"));
  if (isSmoke && process.env.CHENGJING_SMOKE_AUTO_BACKUP_DIR) {
    const directory = path.resolve(process.env.CHENGJING_SMOKE_AUTO_BACKUP_DIR);
    await fs.mkdir(directory, { recursive: true });
    const settings = await writeAutoBackupSettings(app.getPath("userData"), { ...current, directory, enabled: true, lastError: "" });
    return { canceled: false, settings };
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: backupMessage("chooseFolder"),
    defaultPath: current.directory || app.getPath("documents"),
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true, settings: current };
  const directory = path.resolve(result.filePaths[0]);
  const directoryStat = await fs.stat(directory);
  if (!directoryStat.isDirectory()) throw new Error(backupMessage("directoryInvalid"));
  const settings = await writeAutoBackupSettings(app.getPath("userData"), { ...current, directory, enabled: true, lastError: "" });
  return { canceled: false, settings };
}));

ipcMain.handle("backup:update-settings", async (_event, patch = {}) => serializeAutoBackup(async () => {
  const current = await readAutoBackupSettings(app.getPath("userData"));
  const next = normalizeAutoBackupSettings({
    ...current,
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : current.enabled,
    intervalDays: [1, 3, 7].includes(Number(patch.intervalDays)) ? Number(patch.intervalDays) : current.intervalDays,
    retentionCount: Number.isFinite(Number(patch.retentionCount)) ? Number(patch.retentionCount) : current.retentionCount,
  });
  if (next.enabled && !next.directory) throw new Error(backupMessage("directoryRequired"));
  return writeAutoBackupSettings(app.getPath("userData"), next);
}));

ipcMain.handle("backup:write", async (_event, request = {}) => serializeAutoBackup(async () => {
  const attemptedAt = Date.now();
  const current = await readAutoBackupSettings(app.getPath("userData"));
  try {
    if (!current.directory) throw new Error("backup-directory-required");
    const result = await createAutoBackup({
      directory: current.directory,
      data: String(request.data || ""),
      retentionCount: current.retentionCount,
      assetsDirectory: attachmentsDirectory(),
      assets: Array.isArray(request.assets) ? request.assets : [],
    });
    const settings = await writeAutoBackupSettings(app.getPath("userData"), {
      ...current,
      lastAttemptAt: attemptedAt,
      lastSuccessAt: Date.now(),
      lastFilePath: result.filePath,
      lastError: "",
    });
    return { ...result, settings };
  } catch (error) {
    const friendly = friendlyAutoBackupError(error);
    await writeAutoBackupSettings(app.getPath("userData"), { ...current, lastAttemptAt: attemptedAt, lastError: friendly }).catch(() => {});
    throw new Error(friendly);
  }
}));

ipcMain.handle("backup:write-safety", async (_event, request = {}) => serializeAutoBackup(async () => {
  try {
    const result = await createRestoreSafetyBackup(request);
    return { filePath: result.filePath, filename: result.filename, bytes: result.bytes };
  } catch (error) {
    throw new Error(friendlyAutoBackupError(error));
  }
}));

ipcMain.handle("cloud-backup:get-local-status", async () => {
  try { return await cloudBackupService().getLocalStatus(); }
  catch (error) { throw new Error(friendlyCloudBackupError(error)); }
});

ipcMain.handle("cloud-backup:get-status", async () => serializeCloudBackup(async () => {
  try { return await cloudBackupService().getStatus(); }
  catch (error) { throw new Error(friendlyCloudBackupError(error)); }
}));

ipcMain.handle("cloud-backup:connect", async () => serializeCloudBackup(async () => {
  try { return await cloudBackupService().connect(); }
  catch (error) { throw new Error(friendlyCloudBackupError(error)); }
}));

ipcMain.handle("cloud-backup:disconnect", async () => serializeCloudBackup(async () => {
  try { return await cloudBackupService().disconnect(); }
  catch (error) { throw new Error(friendlyCloudBackupError(error)); }
}));

ipcMain.handle("cloud-backup:update-settings", async (_event, patch = {}) => serializeCloudBackup(async () => {
  try { return await cloudBackupService().updateSettings(patch); }
  catch (error) { throw new Error(friendlyCloudBackupError(error)); }
}));

ipcMain.handle("cloud-backup:write", async (_event, request = {}) => serializeCloudBackup(async () => {
  try { return await cloudBackupService().write(request); }
  catch (error) { throw new Error(friendlyCloudBackupError(error, "write")); }
}));

ipcMain.handle("cloud-backup:download", async (_event, slot) => serializeCloudBackup(async () => {
  try { return await cloudBackupService().downloadBackup(slot); }
  catch (error) { throw new Error(friendlyCloudBackupError(error, "restore")); }
}));

ipcMain.handle("cloud-backup:complete-restore", async (_event, request = {}) => serializeCloudBackup(async () => {
  try { return await cloudBackupService().completeRestore(request); }
  catch (error) { throw new Error(friendlyCloudBackupError(error, "restore")); }
}));

ipcMain.handle("cloud-backup:cancel-restore", async () => serializeCloudBackup(() => cloudBackupService().cancelRestore()));

ipcMain.handle("cloud-backup:adopt-current-for-overwrite", async () => serializeCloudBackup(async () => {
  try { return await cloudBackupService().adoptCurrentForOverwrite(); }
  catch (error) { throw new Error(friendlyCloudBackupError(error)); }
}));

if (isSmoke) {
  ipcMain.handle("cloud-backup:qa-cleanup", async () => serializeCloudBackup(async () => cloudBackupService().removeThisDeviceTestData()));
}

ipcMain.handle("ai:key-status", async () => secretStatus(app.getPath("userData")));

ipcMain.handle("ai:set-key", async (_event, rawKey) => {
  const value = String(rawKey || "").trim();
  if (value.length < 12) throw new Error(message("completeKey"));
  await writeSecret(app.getPath("userData"), value);
  await fs.rm(path.join(app.getPath("userData"), LEGACY_KEY_FILE), { force: true });
  return { configured: true, encrypted: true, storage: "app-local-aes-256-gcm" };
});

ipcMain.handle("ai:clear-key", async () => {
  await clearSecret(app.getPath("userData"));
  await fs.rm(path.join(app.getPath("userData"), LEGACY_KEY_FILE), { force: true });
  return { configured: false, encrypted: true, storage: "app-local-aes-256-gcm" };
});

ipcMain.handle("ai:test-openrouter", async () => {
  const apiKey = await readApiKey();
  if (!apiKey) throw new Error(message("noKey"));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await net.fetch(OPENROUTER_KEY_URL, { headers: { Authorization: `Bearer ${apiKey}` }, signal: controller.signal });
    const raw = await response.text();
    let payload = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
    if (!response.ok) throw new Error(friendlyOpenRouterError(response.status, payload));
    return {
      ok: true,
      label: String(payload?.data?.label || message("verifiedKey")),
      limitRemaining: Number.isFinite(Number(payload?.data?.limit_remaining)) ? Number(payload.data.limit_remaining) : null,
      usage: Number.isFinite(Number(payload?.data?.usage)) ? Number(payload.data.usage) : null,
    };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(message("testTimeout"));
    if (error instanceof TypeError || /net::|fetch failed/i.test(String(error?.message))) throw new Error(friendlyNetworkError(error, message("actionConnect")));
    throw error;
  } finally {
    clearTimeout(timer);
  }
});

ipcMain.handle("ai:list-models", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await net.fetch(OPENROUTER_MODELS_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(message("modelsFailed"));
    const payload = await response.json();
    return Array.isArray(payload?.data)
      ? payload.data.map((model) => ({
          id: model.id,
          name: model.name || model.id,
          contextLength: Number(model.context_length || 0),
          created: Number(model.created || 0),
          pricing: model.pricing || null,
          architecture: model.architecture || null,
        }))
      : [];
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(message("modelsTimeout"));
    if (error instanceof TypeError || /net::|fetch failed/i.test(String(error?.message))) throw new Error(friendlyNetworkError(error, message("actionModels")));
    throw error;
  } finally {
    clearTimeout(timer);
  }
});

ipcMain.handle("ai:openrouter-chat", async (_event, request) => {
  const smokeMessages = Array.isArray(request?.messages) ? request.messages : [];
  if (process.env.CHENGJING_SMOKE_AI_MARKDOWN === "1" && smokeMessages.some((item) => String(item?.content || "").includes("__CHENGJING_MARKDOWN_SMOKE__"))) {
    return { text: "### 封裝 AI 回答\n\n1. **核心重點**\n   - 第一項\n   - 第二項\n\n---\n\n> 仍需回到來源確認。\n\n`KPI`<script>window.bad=true</script><img src=\"https://tracker.example/pixel\">", model: "smoke/markdown", usage: null, finishReason: "stop" };
  }
  const apiKey = await readApiKey();
  if (!apiKey) throw new Error(message("noKey"));
  const model = String(request?.model || "").trim();
  if (!model || !model.includes("/")) throw new Error(message("chooseModel"));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    return await require("./openrouter-chat.cjs").openRouterChat(net.fetch.bind(net), apiKey, request, controller.signal);
  } catch (error) {
    if (error.status) throw new Error(friendlyOpenRouterError(error.status, error.payload));
    if (error.message === "openrouter-no-text") throw new Error(message("noText"));
    if (error?.name === "AbortError") throw new Error(message("generationTimeout"));
    if (error instanceof TypeError || /net::|fetch failed/i.test(String(error?.message))) throw new Error(friendlyNetworkError(error, message("actionConnect")));
    throw error;
  } finally {
    clearTimeout(timer);
  }
});

ipcMain.handle("ai:provider-settings", async () => providerSettingsApi().readProviderSettings(app.getPath("userData")));

ipcMain.handle("ai:provider-upsert", async (_event, input = {}) => {
  try { return await providerSettingsApi().upsertProviderProfile(app.getPath("userData"), input); }
  catch (error) { throw new Error(friendlyProviderError(error)); }
});

ipcMain.handle("ai:provider-select", async (_event, id) => {
  try { return await providerSettingsApi().selectProviderProfile(app.getPath("userData"), String(id || "")); }
  catch (error) { throw new Error(friendlyProviderError(error)); }
});

ipcMain.handle("ai:provider-remove", async (_event, id) => {
  try { return await providerSettingsApi().removeProviderProfile(app.getPath("userData"), String(id || "")); }
  catch (error) { throw new Error(friendlyProviderError(error)); }
});

ipcMain.handle("ai:provider-test", async (_event, id) => {
  try {
    const profile = await providerSettingsApi().providerProfileWithSecret(app.getPath("userData"), String(id || ""));
    return await providerClientApi().testProvider((url, options) => net.fetch(url, options), profile);
  } catch (error) { throw new Error(friendlyProviderError(error)); }
});

ipcMain.handle("ai:provider-models", async (_event, id) => {
  try {
    const profile = await providerSettingsApi().providerProfileWithSecret(app.getPath("userData"), String(id || ""));
    return await providerClientApi().listProviderModels((url, options) => net.fetch(url, options), profile);
  } catch (error) { throw new Error(friendlyProviderError(error)); }
});

ipcMain.handle("ai:provider-chat", async (_event, request = {}) => {
  try {
    const profile = await providerSettingsApi().providerProfileWithSecret(app.getPath("userData"), String(request.profileId || ""));
    return await providerClientApi().providerChat((url, options) => net.fetch(url, options), profile, request);
  } catch (error) { throw new Error(friendlyProviderError(error)); }
});

ipcMain.handle("web:read", async (_event, rawUrl) => {
  const target = new URL(String(rawUrl || "").trim());
  if (!/^https?:$/.test(target.protocol)) throw new Error(message("webProtocol"));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(target, {
      headers: { "User-Agent": "Mozilla/5.0 ChengJing/0.1" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(message("webFailed", { status: response.status }));
    const html = await response.text();
    if (html.length > 12_000_000) throw new Error(message("webTooLarge"));
    const [{ JSDOM }, { Readability }] = await Promise.all([import("jsdom"), import("@mozilla/readability")]);
    const dom = new JSDOM(html, { url: response.url || target.href });
    const article = new Readability(dom.window.document).parse();
    if (!article?.textContent?.trim()) throw new Error(message("noArticle"));
    return {
      title: article.title || dom.window.document.title || target.hostname,
      byline: article.byline || "",
      excerpt: article.excerpt || "",
      content: article.content || "",
      textContent: article.textContent.trim(),
      siteName: article.siteName || target.hostname,
      url: response.url || target.href,
    };
  } finally {
    clearTimeout(timer);
  }
});

ipcMain.handle("file:save", async (_event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: options?.title || message("saveFile"),
    defaultPath: options?.defaultPath || "chengjing-backup.json",
    filters: options?.filters || [{ name: message("allFiles"), extensions: ["*"] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const data = options?.encoding === "base64"
    ? Buffer.from(String(options?.data || ""), "base64")
    : String(options?.data || "");
  await fs.writeFile(result.filePath, data);
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle("file:open", async (_event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: options?.title || message("chooseFile"),
    properties: options?.multiple ? ["openFile", "multiSelections"] : ["openFile"],
    filters: options?.filters || [{ name: message("allFiles"), extensions: ["*"] }],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true, files: [] };
  const files = await Promise.all(result.filePaths.map(async (filePath) => ({
    name: path.basename(filePath),
    path: filePath,
    data: options?.metadataOnly ? "" : (await fs.readFile(filePath)).toString("base64"),
  })));
  return { canceled: false, files };
});

ipcMain.handle("attachment:import-path", async (_event, request) => importAttachmentPath(request));
ipcMain.handle("attachment:import-data", async (_event, request) => importAttachmentData(request));
let attachmentRemovalQueue;
function pendingAttachmentRemovals() {
  return attachmentRemovalQueue ||= require("./attachment-recovery.cjs").createAttachmentRemovalQueue(attachmentsDirectory(), app.getPath("userData"));
}
ipcMain.handle("attachment:remove", async (_event, request = {}) => pendingAttachmentRemovals().defer(request.relativePath));
ipcMain.handle("attachment:pending-paths", async () => pendingAttachmentRemovals().pendingPaths());
ipcMain.handle("attachment:sweep-pending", async (_event, request = {}) => pendingAttachmentRemovals().sweep(Array.isArray(request.keep) ? request.keep : []));
ipcMain.handle("attachment:stats", async () => directoryBytes(attachmentsDirectory()));
ipcMain.handle("attachment:read-data", async (_event, request = {}) => (await fs.readFile(resolveAttachmentPath(request.relativePath))).toString("base64"));
ipcMain.handle("attachment:cleanup", async (_event, request = {}) => {
  const keep = new Set((Array.isArray(request.keep) ? request.keep : []).map((value) => path.basename(String(value))));
  let removed = 0;
  try {
    for (const entry of await fs.readdir(attachmentsDirectory(), { withFileTypes: true })) {
      if (!entry.isFile() || keep.has(entry.name)) continue;
      await fs.rm(resolveAttachmentPath(entry.name), { force: true });
      removed += 1;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return { removed };
});
ipcMain.handle("attachment:restore-from-backup", async (_event, request = {}) => {
  return require("./attachment-recovery.cjs").restoreAttachmentFile(attachmentsDirectory(), request);
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  if (process.platform === "win32") app.setAppUserModelId("tw.techtarian.chengjing");
  protocol.handle("chengjing-attachment", async (request) => {
    try {
      const url = new URL(request.url);
      const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      const filePath = resolveAttachmentPath(relativePath);
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) throw new Error("attachment-not-found");
      const response = await net.fetch(pathToFileURL(filePath).href);
      const headers = new Headers(response.headers);
      headers.set("Access-Control-Allow-Origin", "*");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      console.error(`[attachment-protocol] ${request.url}: ${error instanceof Error ? error.message : String(error)}`);
      return new Response("Attachment not found", { status: 404 });
    }
  });
  currentLanguage = languageFromPreferences(app.getPreferredSystemLanguages());
  installMenu();
  await fs.rm(path.join(app.getPath("userData"), "models", "multilingual-e5-small"), { recursive: true, force: true }).catch(() => {});
  const backgroundLaunch = process.platform === "darwin"
    ? (explicitBackgroundLaunch || Boolean(currentLoginItemSettings().wasOpenedAtLogin))
    : explicitBackgroundLaunch;
  if (backgroundLaunch && process.platform === "darwin" && !isSmoke) enterBackgroundAgentMode();
  if (!isSmoke) {
    const quickSettings = await readQuickCaptureSettings(app.getPath("userData"));
    quickCaptureShortcut = quickSettings.shortcut;
    await createQuickCaptureWindow();
    if (!(await registerQuickCaptureShortcut(quickCaptureShortcut)) && quickCaptureShortcut !== DEFAULT_SHORTCUT) {
      quickCaptureShortcut = DEFAULT_SHORTCUT;
      await registerQuickCaptureShortcut(quickCaptureShortcut);
      await writeQuickCaptureSettings(app.getPath("userData"), { shortcut: quickCaptureShortcut });
    }
    createTray();
  }
  if (!backgroundLaunch) await createWindow();
  mcpStartupTimer = setTimeout(() => {
    mcpStartupTimer = null;
    void fs.readFile(path.join(app.getPath("userData"), "mcp-settings.json"), "utf8")
      .then((raw) => JSON.parse(raw))
      .then((saved) => { if (saved?.enabled) return serializeMcp(reconcileMcpServer); })
      .catch(() => {});
  }, 750);
  app.on("activate", async () => {
    if (quickCapturePresented || nativeQuickCapturePresented) return;
    await showMainWindow();
  });
});

app.on("before-quit", () => { isQuitting = true; });
app.on("will-quit", () => { if (mcpStartupTimer) clearTimeout(mcpStartupTimer); stopQuickCaptureShortcut(); globalShortcut.unregisterAll(); void stopMcpServer(); });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
