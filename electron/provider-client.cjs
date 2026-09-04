const { normalizeBaseUrl } = require("./provider-settings.cjs");

const REQUEST_TIMEOUT_MS = 180_000;
const DISCOVERY_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 12_000_000;

function endpoint(baseUrl, suffix) {
  return `${String(baseUrl).replace(/\/+$/, "")}/${String(suffix).replace(/^\/+/, "")}`;
}

function providerHeaders(profile, extra = {}) {
  return {
    Accept: "application/json",
    ...(profile.apiKey ? { Authorization: `Bearer ${profile.apiKey}` } : {}),
    ...extra,
  };
}

function extractTextContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => {
    if (typeof item === "string") return item;
    if (typeof item?.text === "string") return item.text;
    if (typeof item?.content === "string") return item.content;
    return "";
  }).join("");
}

function responseError(status, payload, secret = "") {
  let detail = String(payload?.error?.message || payload?.message || "").replace(/\s+/g, " ").trim().slice(0, 280);
  if (secret && secret.length >= 4) detail = detail.replaceAll(secret, "[redacted]");
  return new Error(detail ? `provider-http-${status}:${detail}` : `provider-http-${status}`);
}

async function readJsonResponse(response) {
  const declared = Number(response.headers?.get?.("content-length") || 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error("provider-response-too-large");
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) throw new Error("provider-response-too-large");
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw new Error("provider-response-invalid"); }
}

async function withTimeout(timeoutMs, operation) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await operation(controller.signal); }
  catch (error) {
    if (error?.name === "AbortError") throw new Error("provider-timeout");
    throw error;
  } finally { clearTimeout(timer); }
}

async function listProviderModels(fetchImpl, rawProfile) {
  const profile = { ...rawProfile, baseUrl: normalizeBaseUrl(rawProfile.baseUrl, rawProfile.type) };
  return withTimeout(DISCOVERY_TIMEOUT_MS, async (signal) => {
    const response = await fetchImpl(endpoint(profile.baseUrl, "models"), {
      headers: providerHeaders(profile),
      redirect: "error",
      signal,
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) throw responseError(response.status, payload, profile.apiKey);
    return Array.isArray(payload?.data)
      ? payload.data.flatMap((model) => {
          const id = String(model?.id || "").trim().slice(0, 240);
          return id ? [{ id, name: String(model?.name || id).trim().slice(0, 240) }] : [];
        }).slice(0, 500)
      : [];
  });
}

async function testProvider(fetchImpl, profile) {
  const models = await listProviderModels(fetchImpl, profile);
  return { ok: true, models, modelAvailable: models.some((model) => model.id === profile.model) };
}

async function providerChat(fetchImpl, rawProfile, request = {}) {
  const profile = { ...rawProfile, baseUrl: normalizeBaseUrl(rawProfile.baseUrl, rawProfile.type) };
  const model = String(request.model || profile.model || "").trim().slice(0, 240);
  if (!model) throw new Error("provider-model-required");
  const messages = Array.isArray(request.messages) ? request.messages.slice(-80).map((item) => ({
    role: ["system", "assistant", "user"].includes(item?.role) ? item.role : "user",
    content: String(item?.content || "").slice(0, 200_000),
  })) : [];
  return withTimeout(REQUEST_TIMEOUT_MS, async (signal) => {
    const body = {
      model,
      messages,
      temperature: Number.isFinite(request.temperature) ? Math.min(2, Math.max(0, Number(request.temperature))) : 0.55,
      max_tokens: Math.min(Math.max(Number(request.maxTokens || 3_072), 64), 32_768),
      stream: false,
    };
    if (request.responseFormat && typeof request.responseFormat === "object") body.response_format = request.responseFormat;
    const response = await fetchImpl(endpoint(profile.baseUrl, "chat/completions"), {
      method: "POST",
      headers: providerHeaders(profile, { "Content-Type": "application/json", "X-Title": "ChengJing" }),
      body: JSON.stringify(body),
      redirect: "error",
      signal,
    });
    const payload = await readJsonResponse(response);
    if (!response.ok) throw responseError(response.status, payload, profile.apiKey);
    const choice = payload?.choices?.[0];
    const text = extractTextContent(choice?.message?.content).trim();
    if (!text) throw new Error("provider-empty-response");
    return {
      text,
      model: String(payload?.model || model),
      usage: payload?.usage && typeof payload.usage === "object" ? payload.usage : null,
      finishReason: choice?.finish_reason || null,
    };
  });
}

module.exports = {
  DISCOVERY_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  endpoint,
  extractTextContent,
  listProviderModels,
  providerChat,
  providerHeaders,
  testProvider,
};
