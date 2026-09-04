const { normalizeBaseUrl } = require("./provider-settings.cjs");

const REQUEST_TIMEOUT_MS = 180_000;
const DISCOVERY_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 12_000_000;
const responsesWithoutTemperature = new Set();

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

function extractResponsesText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  if (!Array.isArray(payload?.output)) return "";
  return payload.output.flatMap((item) => Array.isArray(item?.content) ? item.content : []).map((part) => {
    if (typeof part === "string") return part;
    if (typeof part?.text === "string") return part.text;
    return "";
  }).join("");
}

function responsesTextFormat(responseFormat) {
  if (!responseFormat || typeof responseFormat !== "object") return undefined;
  if (responseFormat.type === "json_object") return { type: "json_object" };
  if (responseFormat.type !== "json_schema" || !responseFormat.json_schema || typeof responseFormat.json_schema !== "object") return undefined;
  const schema = responseFormat.json_schema;
  return {
    type: "json_schema",
    name: String(schema.name || "chengjing_response").slice(0, 64),
    schema: schema.schema || {},
    strict: Boolean(schema.strict),
  };
}

function responsesInput(messages) {
  const instructions = messages.filter((item) => item.role === "system").map((item) => item.content).join("\n\n").trim();
  const input = messages.filter((item) => item.role !== "system").map((item) => ({ role: item.role === "assistant" ? "assistant" : "user", content: item.content }));
  return { instructions, input: input.length ? input : "" };
}

function responseError(status, payload, secret = "") {
  let detail = String(payload?.error?.message || payload?.message || "").replace(/\s+/g, " ").trim().slice(0, 280);
  if (secret && secret.length >= 4) detail = detail.replaceAll(secret, "[redacted]");
  return new Error(detail ? `provider-http-${status}:${detail}` : `provider-http-${status}`);
}

function rejectsTemperature(payload) {
  const error = payload?.error && typeof payload.error === "object" ? payload.error : payload;
  const parameter = String(error?.param || error?.parameter || "").toLowerCase();
  const code = String(error?.code || error?.type || "").toLowerCase();
  const message = String(error?.message || payload?.message || "").toLowerCase();
  const unsupported = /unsupported|not[_ -]?supported/.test(`${code} ${message}`);
  return unsupported && (parameter === "temperature" || /['"`]?temperature['"`]?/.test(message));
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
    const temperature = Number.isFinite(request.temperature) ? Math.min(2, Math.max(0, Number(request.temperature))) : 0.55;
    const maxTokens = Math.min(Math.max(Number(request.maxTokens || 3_072), 64), 32_768);
    const useResponses = profile.apiMode === "responses";
    const prepared = responsesInput(messages);
    const textFormat = responsesTextFormat(request.responseFormat);
    const temperatureCapability = `${profile.id || profile.baseUrl}\u0000${model}`;
    const body = useResponses ? {
      model,
      input: prepared.input,
      ...(prepared.instructions ? { instructions: prepared.instructions } : {}),
      ...(responsesWithoutTemperature.has(temperatureCapability) ? {} : { temperature }),
      max_output_tokens: maxTokens,
      stream: false,
      ...(profile.type === "ollama" ? {} : { store: false }),
      ...(textFormat ? { text: { format: textFormat } } : {}),
    } : {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
      ...(request.responseFormat && typeof request.responseFormat === "object" ? { response_format: request.responseFormat } : {}),
    };
    const send = async (requestBody) => {
      const response = await fetchImpl(endpoint(profile.baseUrl, useResponses ? "responses" : "chat/completions"), {
        method: "POST",
        headers: providerHeaders(profile, { "Content-Type": "application/json", "X-Title": "ChengJing" }),
        body: JSON.stringify(requestBody),
        redirect: "error",
        signal,
      });
      return { response, payload: await readJsonResponse(response) };
    };
    let { response, payload } = await send(body);
    if (useResponses && Object.hasOwn(body, "temperature") && (!response.ok || payload?.error) && rejectsTemperature(payload)) {
      responsesWithoutTemperature.add(temperatureCapability);
      const { temperature: _temperature, ...compatibleBody } = body;
      ({ response, payload } = await send(compatibleBody));
    }
    if (!response.ok) throw responseError(response.status, payload, profile.apiKey);
    if (payload?.error) throw responseError(response.status || 500, payload, profile.apiKey);
    const choice = payload?.choices?.[0];
    const text = (useResponses ? extractResponsesText(payload) || extractTextContent(choice?.message?.content) : extractTextContent(choice?.message?.content)).trim();
    if (!text) throw new Error("provider-empty-response");
    return {
      text,
      model: String(payload?.model || model),
      usage: payload?.usage && typeof payload.usage === "object" ? payload.usage : null,
      finishReason: useResponses ? payload?.incomplete_details?.reason || payload?.status || null : choice?.finish_reason || null,
    };
  });
}

module.exports = {
  DISCOVERY_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  endpoint,
  extractTextContent,
  extractResponsesText,
  listProviderModels,
  providerChat,
  providerHeaders,
  rejectsTemperature,
  responsesInput,
  responsesTextFormat,
  testProvider,
};
