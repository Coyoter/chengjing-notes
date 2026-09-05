const { providerPreferencesForRoutingMode } = require("./openrouter-routing.cjs");
const PARAMETER_ERROR_STATUSES = new Set([400, 404, 422]);

function errorDetail(payload, secret = "") {
  const error = payload?.error || {};
  let upstream = error.metadata?.raw;
  if (typeof upstream === "string") { try { upstream = JSON.parse(upstream); } catch { upstream = { message: upstream }; } }
  const raw = [error.message, upstream?.error?.message || upstream?.message, error.metadata?.provider_name].filter((value) => typeof value === "string" && value.trim()).join(" · ");
  return (secret ? raw.replaceAll(secret, "[redacted]") : raw).replace(/\s+/g, " ").slice(0, 700);
}

function schemaRejected(status, payload) {
  if (!PARAMETER_ERROR_STATUSES.has(status)) return false;
  const detail = `${errorDetail(payload)} ${payload?.error?.metadata?.provider_code || ""}`;
  return /invalid argument|INVALID_ARGUMENT|unsupported|not supported|does not support|response.?schema|json.?schema|response.?format/i.test(detail);
}

function reasoningRejected(status, payload) {
  if (!PARAMETER_ERROR_STATUSES.has(status)) return false;
  return /reasoning|thinking|effort/i.test(errorDetail(payload)) && /invalid|unsupported|not supported|does not support/i.test(errorDetail(payload));
}

function temperatureRejected(status, payload) {
  if (!PARAMETER_ERROR_STATUSES.has(status)) return false;
  return /temperature/i.test(errorDetail(payload)) && /invalid|unsupported|not supported|does not support/i.test(errorDetail(payload));
}

function withoutRequiredParameters(provider = {}) {
  const { require_parameters: _required, ...rest } = provider;
  return rest;
}

function compatibleBody(body, status, payload) {
  if (!PARAMETER_ERROR_STATUSES.has(status)) return null;
  if (body.reasoning && reasoningRejected(status, payload)) {
    const { reasoning: _reasoning, ...rest } = body;
    return rest;
  }
  if (Object.hasOwn(body, "temperature") && temperatureRejected(status, payload)) {
    const { temperature: _temperature, ...rest } = body;
    return rest;
  }
  if (body.response_format?.type === "json_schema" && schemaRejected(status, payload)) {
    const schema = body.response_format.json_schema?.schema || {};
    return {
      ...body,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: `Return only one JSON object matching this schema: ${JSON.stringify(schema)}` }, ...body.messages],
    };
  }
  if (body.response_format?.type === "json_object" && schemaRejected(status, payload)) {
    const { response_format: _format, reasoning: _reasoning, ...rest } = body;
    return { ...rest, provider: withoutRequiredParameters(rest.provider) };
  }
  return null;
}

function buildChatBody(request = {}) {
  const structured = Boolean(request.responseFormat && typeof request.responseFormat === "object");
  return {
    model: String(request.model || "").trim(),
    messages: Array.isArray(request.messages) ? request.messages : [],
    temperature: Number.isFinite(request.temperature) ? request.temperature : 0.55,
    max_tokens: Math.min(Math.max(Number(request.maxTokens) || 2048, 256), structured ? 32768 : 8192),
    stream: false,
    provider: { ...providerPreferencesForRoutingMode(request.routingMode), ...(structured ? { require_parameters: true } : {}) },
    ...(request.reasoning && typeof request.reasoning === "object" ? { reasoning: request.reasoning } : {}),
    ...(structured ? { response_format: request.responseFormat } : {}),
  };
}

async function openRouterChat(fetchImpl, apiKey, request, signal) {
  let body = buildChatBody(request);
  let emptyRetried = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "ChengJing" },
      body: JSON.stringify(body), signal,
    });
    const raw = await response.text();
    let payload;
    try { payload = JSON.parse(raw); } catch { payload = {}; }
    if (!response.ok || payload.error) {
      const status = Number(payload.error?.code) || response.status;
      const next = compatibleBody(body, status, payload);
      if (next) {
        body = next;
        continue;
      }
      const error = new Error(errorDetail(payload, apiKey) || `OpenRouter HTTP ${status}`);
      error.status = status;
      error.payload = { error: { message: error.message } };
      throw error;
    }
    const choice = payload.choices?.[0];
    if (choice?.error) {
      const error = new Error(errorDetail({ error: choice.error }, apiKey) || "OpenRouter generation failed");
      error.status = Number(choice.error.code) || 502;
      error.payload = { error: { message: error.message } };
      throw error;
    }
    const content = choice?.message?.content;
    const text = (typeof content === "string" ? content : Array.isArray(content) ? content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("") : "").trim();
    if (!text && choice?.message?.refusal) throw new Error(`openrouter-refusal:${String(choice.message.refusal).slice(0, 500)}`);
    if (!text && !["length", "max_output_tokens"].includes(choice?.finish_reason)) {
      if (!emptyRetried) {
        emptyRetried = true;
        body = { ...body, provider: { ...body.provider, sort: "throughput", allow_fallbacks: true } };
        continue;
      }
      throw new Error("openrouter-no-text");
    }
    return { text, model: payload.model || body.model, usage: payload.usage || null, finishReason: choice?.finish_reason || null };
  }
  throw new Error("openrouter-compatibility-exhausted");
}

module.exports = { buildChatBody, compatibleBody, errorDetail, openRouterChat, reasoningRejected, schemaRejected, temperatureRejected };
