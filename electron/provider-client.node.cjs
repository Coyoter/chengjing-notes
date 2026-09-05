const assert = require("node:assert/strict");
const test = require("node:test");
const { listProviderModels, providerChat, testProvider } = require("./provider-client.cjs");

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

test("OpenAI 相容 Provider 可列出模型並產生內容", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (String(url).endsWith("/models")) return jsonResponse({ data: [{ id: "qwen3:8b" }, { id: "gemma3:4b", name: "Gemma 3" }] });
    return jsonResponse({ model: "qwen3:8b", choices: [{ message: { content: "整理完成" }, finish_reason: "stop" }], usage: { total_tokens: 42 } });
  };
  const profile = { type: "ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3:8b", apiKey: "" };
  const models = await listProviderModels(fetchImpl, profile);
  assert.deepEqual(models, [{ id: "qwen3:8b", name: "qwen3:8b" }, { id: "gemma3:4b", name: "Gemma 3" }]);
  assert.deepEqual(await testProvider(fetchImpl, profile), { ok: true, models, modelAvailable: true });
  const result = await providerChat(fetchImpl, profile, { messages: [{ role: "user", content: "整理" }], responseFormat: { type: "json_object" } });
  assert.equal(result.text, "整理完成");
  assert.equal(calls.at(-1).url, "http://127.0.0.1:11434/v1/chat/completions");
  assert.equal(calls.at(-1).options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(calls.at(-1).options.body).response_format, { type: "json_object" });
});

test("遠端 Gateway 使用 Bearer Key 且錯誤不回傳金鑰", async () => {
  const fetchImpl = async (_url, options = {}) => {
    assert.equal(options.headers.Authorization, "Bearer secret-key");
    return jsonResponse({ error: { message: "model unavailable for secret-key" } }, 503);
  };
  await assert.rejects(
    providerChat(fetchImpl, { type: "openai-compatible", baseUrl: "https://gateway.example.com/v1", model: "custom/model", apiKey: "secret-key" }, { messages: [] }),
    (error) => /provider-http-503:model unavailable for \[redacted\]/.test(error.message) && !error.message.includes("secret-key"),
  );
});

test("Responses API 轉換欄位、停用遠端儲存並解析巢狀 output_text", async () => {
  let sent;
  const fetchImpl = async (url, options = {}) => {
    sent = { url, headers: options.headers, body: JSON.parse(options.body) };
    return jsonResponse({
      id: "resp_test",
      model: "openai/gpt-test",
      status: "completed",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Responses 回覆正常" }] }],
      usage: { input_tokens: 12, output_tokens: 5, total_tokens: 17 },
    });
  };
  const result = await providerChat(fetchImpl, { type: "openai-compatible", apiMode: "responses", baseUrl: "https://gateway.example.com/v1", model: "openai/gpt-test", apiKey: "gateway-key" }, {
    messages: [{ role: "system", content: "系統規則" }, { role: "user", content: "問題" }, { role: "assistant", content: "先前回答" }, { role: "user", content: "追問" }],
    maxTokens: 4_000,
    responseFormat: { type: "json_schema", json_schema: { name: "answer", strict: true, schema: { type: "object" } } },
  });
  assert.equal(sent.url, "https://gateway.example.com/v1/responses");
  assert.equal(sent.body.instructions, "系統規則");
  assert.deepEqual(sent.body.input, [{ role: "user", content: "問題" }, { role: "assistant", content: "先前回答" }, { role: "user", content: "追問" }]);
  assert.equal(sent.body.max_output_tokens, 4_000);
  assert.equal(sent.body.max_tokens, undefined);
  assert.equal(sent.body.store, false);
  assert.deepEqual(sent.body.text.format, { type: "json_schema", name: "answer", schema: { type: "object" }, strict: true });
  assert.equal(result.text, "Responses 回覆正常");
  assert.equal(result.finishReason, "completed");
});

test("Ollama Responses 模式維持非狀態式且不傳送 store", async () => {
  let sent;
  const fetchImpl = async (url, options = {}) => { sent = { url, body: JSON.parse(options.body) }; return jsonResponse({ model: "qwen3:8b", status: "completed", output_text: "本機完成" }); };
  const result = await providerChat(fetchImpl, { type: "ollama", apiMode: "responses", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3:8b", apiKey: "" }, { messages: [{ role: "user", content: "測試" }] });
  assert.equal(sent.url, "http://127.0.0.1:11434/v1/responses");
  assert.equal(sent.body.store, undefined);
  assert.equal(sent.body.previous_response_id, undefined);
  assert.equal(sent.body.conversation, undefined);
  assert.equal(result.text, "本機完成");
});

test("Responses 模型不支援 temperature 時自動重試並記住相容模式", async () => {
  const sent = [];
  const fetchImpl = async (_url, options = {}) => {
    const body = JSON.parse(options.body); sent.push(body);
    if (Object.hasOwn(body, "temperature")) return jsonResponse({ error: { type: "invalid_request_error", param: "temperature", message: "Unsupported parameter: 'temperature' is not supported with this model." } }, 400);
    return jsonResponse({ model: "company/reasoning", status: "completed", output_text: "相容重試完成" });
  };
  const profile = { id: "company-responses-profile", type: "openai-compatible", apiMode: "responses", baseUrl: "https://company.example.com/v1", model: "company/reasoning", apiKey: "company-key" };
  const first = await providerChat(fetchImpl, profile, { messages: [{ role: "user", content: "第一次" }], temperature: 0.8 });
  const second = await providerChat(fetchImpl, profile, { messages: [{ role: "user", content: "第二次" }], temperature: 0.8 });
  assert.equal(first.text, "相容重試完成");
  assert.equal(second.text, "相容重試完成");
  assert.equal(sent.length, 3);
  assert.equal(sent[0].temperature, 0.8);
  assert.equal(sent[1].temperature, undefined);
  assert.equal(sent[2].temperature, undefined);
});

test("temperature 相容快取會在位址改變後重新判斷，429 不重試", async () => {
  let calls = 0;
  const profile = { id: "scoped-cache-profile", type: "openai-compatible", apiMode: "responses", baseUrl: "https://first.example/v1", model: "reasoning" };
  await providerChat(async (_url, options) => {
    calls++;
    return JSON.parse(options.body).temperature === undefined ? jsonResponse({ output_text: "OK" }) : jsonResponse({ error: { message: "temperature not supported" } }, 400);
  }, profile);
  assert.equal(calls, 2);
  await providerChat(async (_url, options) => { assert.equal(typeof JSON.parse(options.body).temperature, "number"); return jsonResponse({ output_text: "OK" }); }, { ...profile, baseUrl: "https://second.example/v1" });
  calls = 0;
  await assert.rejects(providerChat(async () => { calls++; return jsonResponse({ error: { message: "Unsupported temperature; quota exceeded" } }, 429); }, { ...profile, model: "quota" }), /provider-http-429/);
  assert.equal(calls, 1);
});
