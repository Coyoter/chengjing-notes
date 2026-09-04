const { createHash, randomBytes, randomUUID } = require("node:crypto");
const { createReadStream } = require("node:fs");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const {
  clearSecureToken,
  hasSecureToken,
  readCloudSettings,
  readSecureToken,
  writeCloudSettings,
  writeSecureToken,
} = require("./cloud-backup-settings.cjs");

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const APP_PROPERTY = "chengjing-cloud-backup-v1";
const MANIFEST_PREFIX = "ChengJing-Cloud-Manifest-";
const ASSET_PREFIX = "ChengJing-Cloud-Asset-";
const DAY_MS = 86_400_000;
const PREVIOUS_MAX_AGE_MS = 2 * DAY_MS;

function isoDay(timestamp) {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

function contentHash(data) {
  const raw = String(data || "");
  try {
    const parsed = JSON.parse(raw);
    const stable = JSON.stringify({
      format: parsed.format,
      version: parsed.version,
      attachmentMode: parsed.attachmentMode,
      communityIdentity: parsed.communityIdentity,
      data: parsed.data,
    });
    return createHash("sha256").update(stable, "utf8").digest("hex");
  } catch {
    return createHash("sha256").update(raw, "utf8").digest("hex");
  }
}

function normalizeSnapshot(file) {
  const properties = file?.appProperties || {};
  if (properties.app !== APP_PROPERTY || properties.kind !== "manifest") return null;
  if (properties.slot !== "current" && properties.slot !== "previous") return null;
  const snapshotAt = Date.parse(properties.snapshotAt || file.modifiedTime || file.createdTime || "");
  if (!file.id || !Number.isFinite(snapshotAt)) return null;
  return {
    id: String(file.id),
    name: String(file.name || ""),
    slot: properties.slot,
    snapshotAt,
    day: String(properties.day || isoDay(snapshotAt)),
    contentHash: /^[a-f0-9]{64}$/i.test(String(properties.contentHash || "")) ? String(properties.contentHash).toLowerCase() : "",
    deviceId: String(properties.deviceId || ""),
    size: Math.max(0, Number(file.size || 0)),
  };
}

function selectCloudSnapshots(files, now = Date.now()) {
  const snapshots = (Array.isArray(files) ? files : []).map(normalizeSnapshot).filter(Boolean);
  const newest = (slot) => snapshots.filter((item) => item.slot === slot).sort((left, right) => right.snapshotAt - left.snapshotAt)[0] || null;
  const current = newest("current");
  const previousCandidate = newest("previous");
  const previous = previousCandidate && now - previousCandidate.snapshotAt <= PREVIOUS_MAX_AGE_MS ? previousCandidate : null;
  return { current, previous, snapshots };
}

function shouldPromoteToPrevious(snapshot, nextTimestamp = Date.now()) {
  if (!snapshot) return false;
  const age = nextTimestamp - snapshot.snapshotAt;
  return age >= 0 && age <= PREVIOUS_MAX_AGE_MS && isoDay(snapshot.snapshotAt) !== isoDay(nextTimestamp);
}

function parseBackupPayload(raw) {
  const parsed = JSON.parse(String(raw || ""));
  if (parsed?.format !== "chengjing-backup" || parsed?.version !== 2 || parsed?.attachmentMode !== "content-addressed" || !parsed?.data) throw new Error("cloud-backup-payload-invalid");
  const hashes = new Set();
  for (const attachment of Array.isArray(parsed.data.attachments) ? parsed.data.attachments : []) {
    const hash = String(attachment?.sha256 || "").toLowerCase();
    if (hash && !/^[a-f0-9]{64}$/.test(hash)) throw new Error("cloud-backup-asset-invalid");
    if (hash) hashes.add(hash);
  }
  return { parsed, hashes };
}

function publicSnapshot(snapshot) {
  return snapshot ? { id: snapshot.id, snapshotAt: snapshot.snapshotAt, size: snapshot.size, day: snapshot.day } : null;
}

function responseText(language, ok) {
  const traditional = language === "zh-TW";
  const simplified = language === "zh-CN";
  const title = ok
    ? (traditional ? "Google 雲端已連結" : simplified ? "Google 云端已连接" : "Google Drive connected")
    : (traditional ? "無法完成連結" : simplified ? "无法完成连接" : "Connection was not completed");
  const message = ok
    ? (traditional ? "你可以關閉這個頁面，回到澄境繼續。" : simplified ? "你可以关闭这个页面，回到澄境继续。" : "You can close this page and return to ChengJing.")
    : (traditional ? "請關閉這個頁面，回到澄境後再試一次。" : simplified ? "请关闭这个页面，回到澄境后再试一次。" : "Close this page, return to ChengJing, and try again.");
  return `<!doctype html><html lang="${language || "en"}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><style>body{margin:0;background:#101713;color:#eef5f0;font:16px/1.65 system-ui,sans-serif;display:grid;min-height:100vh;place-items:center}.card{max-width:520px;margin:24px;padding:32px;border:1px solid #365247;border-radius:16px;background:#18231e;box-shadow:0 18px 60px #0005}h1{font-size:24px;margin:0 0 8px;color:${ok ? "#73dfb5" : "#ff938a"}}p{margin:0;color:#becbc4}</style><body><main class="card"><h1>${title}</h1><p>${message}</p></main></body></html>`;
}

function createGoogleDriveBackupService(options) {
  const { net, safeStorage, shell, userDataDirectory, attachmentsDirectory, clientId, clientSecret, platform = process.platform, getLanguage = () => "en" } = options;
  let tokenCache;
  let activeOAuth = null;
  const restoreRoot = path.join(userDataDirectory, "google-cloud-restore-staging");
  const debug = (stage) => {
    if (process.env.CHENGJING_SMOKE !== "1") return;
    console.log(`[cloud-backup] ${stage}`);
    void fs.appendFile(path.join(userDataDirectory, "cloud-backup-qa.log"), `${new Date().toISOString()} ${stage}\n`, "utf8").catch(() => {});
  };

  async function timedFetch(url, init = {}, timeoutMs = 30_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await net.fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("cloud-request-timeout");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function tokenBody(values) {
    const body = new URLSearchParams(values);
    if (clientSecret) body.set("client_secret", clientSecret);
    return body.toString();
  }

  async function settings() {
    const value = await readCloudSettings(userDataDirectory);
    if (!value.deviceId) return writeCloudSettings(userDataDirectory, value);
    return value;
  }

  async function saveSettings(value) {
    return writeCloudSettings(userDataDirectory, value);
  }

  async function loadToken() {
    if (tokenCache !== undefined) return tokenCache;
    tokenCache = await readSecureToken(userDataDirectory, safeStorage, platform);
    return tokenCache;
  }

  async function saveToken(value) {
    tokenCache = value;
    await writeSecureToken(userDataDirectory, safeStorage, value, platform);
  }

  async function refreshAccessToken() {
    const token = await loadToken();
    if (!token?.refreshToken) throw new Error("cloud-auth-required");
    const response = await timedFetch(TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody({ client_id: clientId, refresh_token: token.refreshToken, grant_type: "refresh_token" }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      if (payload?.error === "invalid_grant") {
        tokenCache = null;
        await clearSecureToken(userDataDirectory).catch(() => {});
        const current = await settings();
        await saveSettings({ ...current, enabled: false, lastError: "cloud-auth-expired" });
        throw new Error("cloud-auth-expired");
      }
      throw new Error(`cloud-token-refresh-${response.status}`);
    }
    const next = {
      ...token,
      accessToken: payload.access_token,
      expiresAt: Date.now() + Math.max(60, Number(payload.expires_in || 3600)) * 1000,
      tokenType: payload.token_type || token.tokenType || "Bearer",
      scope: payload.scope || token.scope || DRIVE_SCOPE,
    };
    await saveToken(next);
    return next.accessToken;
  }

  async function accessToken(forceRefresh = false) {
    const token = await loadToken();
    if (!token) throw new Error("cloud-auth-required");
    if (!forceRefresh && token.accessToken && Number(token.expiresAt || 0) - Date.now() > 60_000) return token.accessToken;
    return refreshAccessToken();
  }

  async function authenticatedFetch(url, init = {}, retry = true) {
    const access = await accessToken();
    const headers = new Headers(init.headers || {});
    headers.set("Authorization", `Bearer ${access}`);
    const response = await timedFetch(url, { ...init, headers }, 45_000);
    if (response.status === 401 && retry) {
      const refreshed = await accessToken(true);
      headers.set("Authorization", `Bearer ${refreshed}`);
      return timedFetch(url, { ...init, headers }, 45_000);
    }
    return response;
  }

  async function requireOk(response, code) {
    if (response.ok) return response;
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`${code}-${response.status}${detail ? `:${detail}` : ""}`);
  }

  async function listFiles() {
    const files = [];
    let pageToken = "";
    do {
      const query = new URLSearchParams({
        spaces: "appDataFolder",
        pageSize: "1000",
        fields: "nextPageToken,files(id,name,size,createdTime,modifiedTime,md5Checksum,appProperties)",
        q: "trashed = false",
      });
      if (pageToken) query.set("pageToken", pageToken);
      const response = await requireOk(await authenticatedFetch(`${DRIVE_API}/files?${query}`), "cloud-list-failed");
      const payload = await response.json();
      files.push(...(Array.isArray(payload.files) ? payload.files : []));
      pageToken = String(payload.nextPageToken || "");
    } while (pageToken);
    return files;
  }

  async function downloadText(fileId) {
    const response = await requireOk(await authenticatedFetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`), "cloud-download-failed");
    return response.text();
  }

  async function createBufferFile(metadata, raw, mimeType = "application/json") {
    const boundary = `chengjing-${randomBytes(18).toString("hex")}`;
    const head = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`, "utf8");
    const body = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), "utf8");
    const tail = Buffer.from(`\r\n--${boundary}--`, "utf8");
    const response = await requireOk(await authenticatedFetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,size,createdTime,modifiedTime,appProperties`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: Buffer.concat([head, body, tail]),
    }), "cloud-upload-failed");
    return response.json();
  }

  async function createStreamFile(metadata, filePath, size, mimeType = "application/octet-stream") {
    const start = await requireOk(await authenticatedFetch(`${DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,name,size,createdTime,modifiedTime,appProperties`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": String(size),
      },
      body: JSON.stringify(metadata),
    }), "cloud-upload-start-failed");
    const location = start.headers.get("location");
    if (!location) throw new Error("cloud-upload-session-missing");
    const access = await accessToken();
    return new Promise((resolve, reject) => {
      const request = net.request({ method: "PUT", url: location, redirect: "follow" });
      request.chunkedEncoding = true;
      request.setHeader("Authorization", `Bearer ${access}`);
      request.setHeader("Content-Type", mimeType);
      request.setHeader("Content-Range", `bytes 0-${Math.max(0, size - 1)}/${size}`);
      request.on("error", reject);
      request.on("response", (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("error", reject);
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`cloud-upload-stream-failed-${response.statusCode}:${raw.slice(0, 500)}`));
            return;
          }
          try { resolve(raw ? JSON.parse(raw) : {}); }
          catch (error) { reject(error); }
        });
      });
      void (async () => {
        try {
          for await (const chunk of createReadStream(filePath)) {
            await new Promise((delivered) => request.write(chunk, undefined, delivered));
          }
          request.end();
        } catch (error) {
          request.abort();
          reject(error);
        }
      })();
    });
  }

  async function updateFileMetadata(fileId, metadata) {
    const response = await requireOk(await authenticatedFetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=id,name,size,createdTime,modifiedTime,appProperties`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metadata),
    }), "cloud-update-failed");
    return response.json();
  }

  async function deleteFile(fileId) {
    const response = await authenticatedFetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) await requireOk(response, "cloud-delete-failed");
  }

  function resolveAssetPath(relativePath) {
    const root = path.resolve(attachmentsDirectory);
    const normalized = String(relativePath || "").replaceAll("\\", "/").replace(/^\/+/, "");
    const candidate = path.resolve(root, normalized);
    if (!normalized || (candidate !== root && !candidate.startsWith(`${root}${path.sep}`))) throw new Error("cloud-backup-asset-path-invalid");
    return candidate;
  }

  async function uploadMissingAssets(files, assets) {
    const existing = new Set(files
      .filter((file) => file?.appProperties?.app === APP_PROPERTY && file?.appProperties?.kind === "asset")
      .map((file) => String(file.appProperties.sha256 || "").toLowerCase())
      .filter((hash) => /^[a-f0-9]{64}$/.test(hash)));
    let uploaded = 0;
    let reused = 0;
    for (const asset of assets) {
      const hash = String(asset?.sha256 || "").toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("cloud-backup-asset-invalid");
      if (existing.has(hash)) { reused += 1; continue; }
      const filePath = resolveAssetPath(asset.relativePath);
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size !== Number(asset.size)) throw new Error("cloud-backup-asset-size-mismatch");
      const actualHash = await new Promise((resolve, reject) => {
        const digest = createHash("sha256");
        const stream = createReadStream(filePath);
        stream.on("data", (chunk) => digest.update(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(digest.digest("hex")));
      });
      if (actualHash !== hash) throw new Error("cloud-backup-asset-hash-mismatch");
      await createStreamFile({
        name: `${ASSET_PREFIX}${hash}`,
        parents: ["appDataFolder"],
        appProperties: { app: APP_PROPERTY, kind: "asset", sha256: hash },
      }, filePath, stat.size);
      existing.add(hash);
      uploaded += 1;
    }
    return { uploaded, reused };
  }

  async function profile() {
    const query = new URLSearchParams({ fields: "user(displayName,emailAddress)" });
    const response = await requireOk(await authenticatedFetch(`${DRIVE_API}/about?${query}`), "cloud-profile-failed");
    const payload = await response.json();
    return { accountName: String(payload?.user?.displayName || ""), accountEmail: String(payload?.user?.emailAddress || "") };
  }

  async function connect() {
    if (!clientId || !clientSecret) throw new Error("cloud-service-not-configured");
    if (activeOAuth) throw new Error("cloud-auth-in-progress");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(24).toString("base64url");
    let finish;
    const callback = new Promise((resolve, reject) => { finish = { resolve, reject }; });
    const server = http.createServer((request, response) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const receivedState = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      const denied = url.searchParams.get("error");
      const valid = receivedState === state && Boolean(code) && !denied;
      response.writeHead(valid ? 200 : 400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", Connection: "close" });
      response.end(responseText(getLanguage(), valid), () => request.socket.end());
      if (receivedState !== state) finish.reject(new Error("cloud-auth-state-mismatch"));
      else if (denied) finish.reject(new Error("cloud-auth-denied"));
      else if (!code) finish.reject(new Error("cloud-auth-code-missing"));
      else finish.resolve(code);
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") { server.close(); throw new Error("cloud-auth-listener-failed"); }
    const redirectUri = `http://127.0.0.1:${address.port}`;
    const auth = new URL(AUTH_URL);
    auth.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: DRIVE_SCOPE,
      access_type: "offline",
      prompt: "consent",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    }).toString();
    const timeout = setTimeout(() => finish.reject(new Error("cloud-auth-timeout")), 5 * 60_000);
    activeOAuth = { server };
    try {
      await shell.openExternal(auth.toString());
      const code = await callback;
      debug("oauth-code-received");
      const response = await timedFetch(TOKEN_URL, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody({
          client_id: clientId,
          code,
          code_verifier: verifier,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }),
      });
      debug(`oauth-token-response-${response.status}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) debug(`oauth-token-error-${String(payload?.error || "unknown").replace(/[^a-z0-9_-]/gi, "-")}-${String(payload?.error_description || "").replace(/[^a-z0-9 _.,:-]/gi, "").slice(0, 180)}`);
      if (!response.ok || !payload.access_token || !payload.refresh_token) throw new Error(`cloud-auth-exchange-${response.status}`);
      debug("oauth-token-encrypt-start");
      await saveToken({
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token,
        expiresAt: Date.now() + Math.max(60, Number(payload.expires_in || 3600)) * 1000,
        tokenType: payload.token_type || "Bearer",
        scope: payload.scope || DRIVE_SCOPE,
      });
      debug("oauth-token-encrypt-complete");
      debug("oauth-drive-status-start");
      const [account, files] = await Promise.all([profile(), listFiles()]);
      debug("oauth-drive-status-complete");
      const currentSettings = await settings();
      const selected = selectCloudSnapshots(files);
      const baselineMatches = Boolean(selected.current && currentSettings.lastKnownManifestId === selected.current.id);
      const next = await saveSettings({
        ...currentSettings,
        ...account,
        enabled: !selected.current || baselineMatches ? currentSettings.enabled || !selected.current : false,
        conflict: Boolean(selected.current && !baselineMatches),
        lastError: "",
      });
      return statusFrom(next, true, selected);
    } finally {
      clearTimeout(timeout);
      activeOAuth = null;
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve)).catch(() => {});
    }
  }

  function statusFrom(value, connected, selected, configured = Boolean(clientId && clientSecret)) {
    const current = publicSnapshot(selected?.current || null);
    const previous = publicSnapshot(selected?.previous || null);
    const needsDecision = Boolean(connected && current && value.lastKnownManifestId !== current.id);
    return { configured, connected, settings: { ...value, enabled: connected && value.enabled && !needsDecision, conflict: needsDecision }, current, previous, needsDecision };
  }

  async function getLocalStatus() {
    const value = await settings();
    const connected = await hasSecureToken(userDataDirectory);
    return {
      configured: Boolean(clientId && clientSecret),
      connected,
      settings: { ...value, enabled: connected && value.enabled },
      current: null,
      previous: null,
      needsDecision: Boolean(value.conflict),
    };
  }

  async function pruneRemoteHistory(files, selected) {
    const keepManifestIds = new Set();
    if (selected.current) keepManifestIds.add(selected.current.id);
    if (selected.previous) keepManifestIds.add(selected.previous.id);
    const referenced = new Set();
    for (const snapshot of [selected.current, selected.previous].filter(Boolean)) {
      const raw = await downloadText(snapshot.id);
      for (const hash of parseBackupPayload(raw).hashes) referenced.add(hash);
    }
    const ownedManifests = selected.snapshots.filter((snapshot) => !keepManifestIds.has(snapshot.id));
    const unusedAssets = files.filter((file) => {
      if (file?.appProperties?.app !== APP_PROPERTY || file?.appProperties?.kind !== "asset") return false;
      return !referenced.has(String(file.appProperties.sha256 || "").toLowerCase());
    });
    await Promise.all([...ownedManifests.map((item) => item.id), ...unusedAssets.map((item) => item.id)].map(deleteFile));
  }

  async function getStatus() {
    const value = await settings();
    const connected = await hasSecureToken(userDataDirectory);
    if (!clientId || !clientSecret || !connected) return statusFrom(value, connected, null);
    const files = await listFiles();
    const selected = selectCloudSnapshots(files);
    debug(`status-current-${selected.current ? "yes" : "no"}-previous-${selected.previous ? "yes" : "no"}`);
    await pruneRemoteHistory(files, selected);
    const result = statusFrom(value, true, selected);
    if (result.needsDecision !== value.conflict || result.settings.enabled !== value.enabled) {
      result.settings = await saveSettings({ ...value, enabled: result.settings.enabled, conflict: result.needsDecision });
    }
    return result;
  }

  async function updateSettings(patch = {}) {
    const current = await settings();
    const connected = await hasSecureToken(userDataDirectory);
    if (patch.enabled && !connected) throw new Error("cloud-auth-required");
    if (patch.enabled && current.conflict) throw new Error("cloud-backup-decision-required");
    return saveSettings({
      ...current,
      enabled: typeof patch.enabled === "boolean" ? patch.enabled : current.enabled,
      intervalMinutes: [15, 30, 60, 180].includes(Number(patch.intervalMinutes)) ? Number(patch.intervalMinutes) : current.intervalMinutes,
      lastError: "",
    });
  }

  async function disconnect() {
    const token = await loadToken().catch(() => null);
    if (token?.refreshToken || token?.accessToken) {
      await timedFetch(REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: token.refreshToken || token.accessToken }).toString(),
      }).catch(() => {});
    }
    tokenCache = null;
    await clearSecureToken(userDataDirectory);
    const current = await settings();
    const next = await saveSettings({ ...current, enabled: false, accountName: "", accountEmail: "", lastError: "", conflict: false });
    return statusFrom(next, false, null);
  }

  async function write(request = {}) {
    const attemptedAt = Date.now();
    let currentSettings = await settings();
    try {
      debug("write-start");
      if (!await hasSecureToken(userDataDirectory)) throw new Error("cloud-auth-required");
      const raw = String(request.data || "");
      const { hashes } = parseBackupPayload(raw);
      const hash = contentHash(raw);
      const files = await listFiles();
      const selected = selectCloudSnapshots(files, attemptedAt);
      debug(`write-list-complete-current-${selected.current ? "yes" : "no"}`);
      const force = Boolean(request.force);
      if (selected.current && currentSettings.lastKnownManifestId !== selected.current.id && !force) throw new Error("cloud-backup-conflict");
      if (selected.current && currentSettings.lastContentHash === hash && selected.current.contentHash === hash) {
        const next = await saveSettings({ ...currentSettings, enabled: true, lastAttemptAt: attemptedAt, lastSuccessAt: Date.now(), lastError: "", conflict: false });
        return { skipped: true, uploadedAssets: 0, reusedAssets: hashes.size, settings: next, current: publicSnapshot(selected.current), previous: publicSnapshot(selected.previous) };
      }
      const assets = Array.isArray(request.assets) ? request.assets : [];
      const declared = new Set(assets.map((item) => String(item?.sha256 || "").toLowerCase()));
      for (const required of hashes) if (!declared.has(required)) throw new Error("cloud-backup-asset-missing");
      const assetResult = await uploadMissingAssets(files, assets);
      debug(`write-assets-complete-${assetResult.uploaded}-${assetResult.reused}`);
      const snapshotAt = Date.now();
      const manifest = await createBufferFile({
        name: `${MANIFEST_PREFIX}${new Date(snapshotAt).toISOString().replaceAll(":", "-")}.json`,
        parents: ["appDataFolder"],
        appProperties: {
          app: APP_PROPERTY,
          kind: "manifest",
          slot: "current",
          snapshotAt: new Date(snapshotAt).toISOString(),
          day: isoDay(snapshotAt),
          contentHash: hash,
          deviceId: currentSettings.deviceId,
        },
      }, raw);
      const newCurrent = normalizeSnapshot(manifest);
      if (!newCurrent) throw new Error("cloud-manifest-invalid");
      debug("write-manifest-created");

      let keptPrevious = selected.previous;
      if (selected.current && shouldPromoteToPrevious(selected.current, snapshotAt)) {
        const promoted = await updateFileMetadata(selected.current.id, { appProperties: { app: APP_PROPERTY, kind: "manifest", slot: "previous", snapshotAt: new Date(selected.current.snapshotAt).toISOString(), day: selected.current.day, contentHash: selected.current.contentHash, deviceId: selected.current.deviceId } });
        keptPrevious = normalizeSnapshot(promoted);
      }
      const keepIds = new Set([newCurrent.id]);
      if (keptPrevious && snapshotAt - keptPrevious.snapshotAt <= PREVIOUS_MAX_AGE_MS) keepIds.add(keptPrevious.id);
      await Promise.all(selected.snapshots.filter((item) => !keepIds.has(item.id)).map((item) => deleteFile(item.id)));

      const referencedHashes = new Set(hashes);
      if (keptPrevious && keepIds.has(keptPrevious.id)) {
        const previousRaw = await downloadText(keptPrevious.id);
        for (const previousHash of parseBackupPayload(previousRaw).hashes) referencedHashes.add(previousHash);
      }
      const assetFiles = files.filter((file) => file?.appProperties?.app === APP_PROPERTY && file?.appProperties?.kind === "asset");
      await Promise.all(assetFiles.filter((file) => !referencedHashes.has(String(file.appProperties.sha256 || "").toLowerCase())).map((file) => deleteFile(file.id)));
      debug("write-remote-cleanup-complete");

      currentSettings = await saveSettings({
        ...currentSettings,
        enabled: true,
        lastAttemptAt: attemptedAt,
        lastSuccessAt: Date.now(),
        lastContentHash: hash,
        lastKnownManifestId: newCurrent.id,
        lastError: "",
        conflict: false,
      });
      debug("write-success");
      return { skipped: false, uploadedAssets: assetResult.uploaded, reusedAssets: assetResult.reused, settings: currentSettings, current: publicSnapshot(newCurrent), previous: publicSnapshot(keptPrevious) };
    } catch (error) {
      debug(`write-error-${String(error?.message || "unknown").replace(/[^a-z0-9 _.,:-]/gi, "-").slice(0, 180)}`);
      const conflict = error?.message === "cloud-backup-conflict" || error?.message === "cloud-backup-decision-required";
      await saveSettings({ ...currentSettings, enabled: conflict ? false : currentSettings.enabled, lastAttemptAt: attemptedAt, lastError: String(error?.message || "cloud-backup-failed").slice(0, 600), conflict }).catch(() => {});
      throw error;
    }
  }

  async function streamDownload(fileId, destination) {
    const access = await accessToken();
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    return new Promise((resolve, reject) => {
      const request = net.request({ method: "GET", url: `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, redirect: "follow" });
      request.setHeader("Authorization", `Bearer ${access}`);
      request.on("error", reject);
      request.on("response", async (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          response.on("end", () => reject(new Error(`cloud-download-failed-${response.statusCode}:${Buffer.concat(chunks).toString("utf8").slice(0, 500)}`)));
          response.on("error", reject);
          return;
        }
        const handle = await fs.open(destination, "wx", 0o600).catch(reject);
        if (!handle) return;
        try {
          for await (const chunk of response) await handle.write(chunk);
          await handle.sync();
          await handle.close();
          resolve();
        } catch (error) {
          await handle.close().catch(() => {});
          await fs.rm(destination, { force: true }).catch(() => {});
          reject(error);
        }
      });
      request.end();
    });
  }

  async function downloadBackup(slot) {
    if (slot !== "current" && slot !== "previous") throw new Error("cloud-restore-slot-invalid");
    const files = await listFiles();
    const selected = selectCloudSnapshots(files);
    const snapshot = selected[slot];
    if (!snapshot) throw new Error(slot === "previous" ? "cloud-previous-unavailable" : "cloud-current-unavailable");
    const raw = await downloadText(snapshot.id);
    const { hashes } = parseBackupPayload(raw);
    const assetFiles = new Map(files
      .filter((file) => file?.appProperties?.app === APP_PROPERTY && file?.appProperties?.kind === "asset")
      .map((file) => [String(file.appProperties.sha256 || "").toLowerCase(), file]));
    await fs.rm(restoreRoot, { recursive: true, force: true });
    const assetRoot = path.join(restoreRoot, "ChengJing-AutoBackup-Assets");
    await fs.mkdir(assetRoot, { recursive: true, mode: 0o700 });
    for (const hash of hashes) {
      const file = assetFiles.get(hash);
      if (!file?.id) throw new Error("cloud-restore-asset-missing");
      const destination = path.join(assetRoot, hash);
      await streamDownload(file.id, destination);
      const downloadedHash = await new Promise((resolve, reject) => {
        const digest = createHash("sha256");
        const stream = createReadStream(destination);
        stream.on("data", (chunk) => digest.update(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(digest.digest("hex")));
      });
      if (downloadedHash !== hash) throw new Error("cloud-restore-asset-corrupt");
    }
    const backupFilePath = path.join(restoreRoot, `${MANIFEST_PREFIX}${slot}.json`);
    await fs.writeFile(backupFilePath, raw, { mode: 0o600 });
    return { restoreId: randomUUID(), data: raw, backupFilePath, contentHash: contentHash(raw), baselineManifestId: selected.current?.id || "", snapshot: publicSnapshot(snapshot) };
  }

  async function completeRestore(request = {}) {
    const manifestId = String(request.baselineManifestId || "");
    if (!manifestId) throw new Error("cloud-restore-manifest-invalid");
    const current = await settings();
    const next = await saveSettings({ ...current, enabled: true, lastKnownManifestId: manifestId, lastContentHash: String(request.contentHash || ""), lastSuccessAt: 0, lastError: "", conflict: false });
    await fs.rm(restoreRoot, { recursive: true, force: true }).catch(() => {});
    return next;
  }

  async function cancelRestore() {
    await fs.rm(restoreRoot, { recursive: true, force: true }).catch(() => {});
    return { cleaned: true };
  }

  async function adoptCurrentForOverwrite() {
    const files = await listFiles();
    const selected = selectCloudSnapshots(files);
    const current = await settings();
    return saveSettings({ ...current, lastKnownManifestId: selected.current?.id || "", conflict: false, lastError: "" });
  }

  async function removeThisDeviceTestData() {
    const currentSettings = await settings();
    const files = await listFiles();
    const snapshots = selectCloudSnapshots(files).snapshots;
    const removeIds = new Set(snapshots.filter((snapshot) => snapshot.deviceId === currentSettings.deviceId).map((snapshot) => snapshot.id));
    const remainingSnapshots = snapshots.filter((snapshot) => !removeIds.has(snapshot.id));
    const referenced = new Set();
    for (const snapshot of remainingSnapshots) {
      const raw = await downloadText(snapshot.id);
      for (const hash of parseBackupPayload(raw).hashes) referenced.add(hash);
    }
    const orphanedAssets = files.filter((file) => file?.appProperties?.app === APP_PROPERTY
      && file?.appProperties?.kind === "asset"
      && !referenced.has(String(file.appProperties.sha256 || "").toLowerCase()));
    await Promise.all([...removeIds, ...orphanedAssets.map((file) => file.id)].map(deleteFile));
    const next = await saveSettings({ ...currentSettings, enabled: false, lastAttemptAt: 0, lastSuccessAt: 0, lastContentHash: "", lastKnownManifestId: "", lastError: "", conflict: false });
    return { removedManifests: removeIds.size, removedAssets: orphanedAssets.length, settings: next };
  }

  return {
    adoptCurrentForOverwrite,
    cancelRestore,
    completeRestore,
    connect,
    disconnect,
    downloadBackup,
    getLocalStatus,
    getStatus,
    removeThisDeviceTestData,
    updateSettings,
    write,
  };
}

module.exports = {
  APP_PROPERTY,
  ASSET_PREFIX,
  DAY_MS,
  DRIVE_SCOPE,
  MANIFEST_PREFIX,
  PREVIOUS_MAX_AGE_MS,
  contentHash,
  createGoogleDriveBackupService,
  isoDay,
  normalizeSnapshot,
  parseBackupPayload,
  selectCloudSnapshots,
  shouldPromoteToPrevious,
};
