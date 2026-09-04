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
