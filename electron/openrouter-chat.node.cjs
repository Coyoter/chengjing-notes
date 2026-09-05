const assert = require("node:assert/strict");
const test = require("node:test");
const { buildChatBody, errorDetail, openRouterChat } = require("./openrouter-chat.cjs");

const schema = { type: "json_schema", json_schema: { name: "links", strict: false, schema: { type: "object", properties: { connections: { type: "array" } }, required: ["connections"] } } };
function response(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); }

test("Gemini 拒絕 JSON Schema 時自動改用 JSON 物件且保留本機驗證 schema", async () => {
  const bodies = [];
  const result = await openRouterChat(async (_url, options) => {
    const body = JSON.parse(options.body); bodies.push(body);
    if (body.response_format?.type === "json_schema") return response({ error: { code: 400, message: "Provider returned error", metadata: { raw: JSON.stringify({ error: { message: "Request contains an invalid argument." } }), provider_name: "Google" } } }, 400);
    return response({ model: "google/gemini-3.8-flash", choices: [{ finish_reason: "stop", message: { content: '{"connections":[]}' } }] });
  }, "secret", { model: "google/gemini-3.8-flash", messages: [{ role: "user", content: "organize" }], responseFormat: schema, maxTokens: 16000, reasoning: { effort: "low", exclude: true } });
  assert.equal(result.text, '{"connections":[]}');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].provider.require_parameters, true);
  assert.equal(bodies[0].max_tokens, 16000);
  assert.equal(bodies[1].response_format.type, "json_object");
  assert.match(bodies[1].messages[0].content, /connections/);
});

test("模型存在但沒有端點支援結構參數的 404 也會安全降級", async () => {
  const formats = [];
  const result = await openRouterChat(async (_url, options) => {
    const body = JSON.parse(options.body); formats.push(body.response_format?.type || "plain");
    if (body.response_format?.type === "json_schema") return response({ error: { code: 404, message: "No endpoints found that support response_format json_schema." } }, 404);
    return response({ choices: [{ finish_reason: "stop", message: { content: '{"connections":[]}' } }] });
  }, "secret", { model: "existing/model", messages: [], responseFormat: schema });
  assert.equal(result.text, '{"connections":[]}');
  assert.deepEqual(formats, ["json_schema", "json_object"]);
});

test("JSON 物件也被拒絕時降級純文字 JSON 指令", async () => {
  const formats = [];
  const result = await openRouterChat(async (_url, options) => {
    const body = JSON.parse(options.body); formats.push(body.response_format?.type || "plain");
    return body.response_format ? response({ error: { code: 400, message: "response_format unsupported" } }, 400)
      : response({ choices: [{ finish_reason: "stop", message: { content: '{"connections":[]}' } }] });
  }, "secret", { model: "other/model", messages: [], responseFormat: schema, reasoning: { effort: "low" } });
  assert.equal(result.text, '{"connections":[]}');
  assert.deepEqual(formats, ["json_schema", "json_object", "plain"]);
});

test("推理設定不相容時只移除推理設定並保留 schema", async () => {
  const bodies = [];
  await openRouterChat(async (_url, options) => {
    const body = JSON.parse(options.body); bodies.push(body);
    return body.reasoning ? response({ error: { code: 400, message: "reasoning effort is not supported" } }, 400)
      : response({ choices: [{ finish_reason: "stop", message: { content: '{"connections":[]}' } }] });
  }, "secret", { model: "other/model", messages: [], responseFormat: schema, reasoning: { effort: "low" } });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].reasoning, undefined);
  assert.equal(bodies[1].response_format.type, "json_schema");
});

test("模型拒絕 temperature 時只移除該選填參數", async () => {
  const bodies = [];
  await openRouterChat(async (_url, options) => {
    const body = JSON.parse(options.body); bodies.push(body);
    return Object.hasOwn(body, "temperature") ? response({ error: { code: 400, message: "Unsupported parameter: temperature is not supported with this model." } }, 400)
      : response({ choices: [{ finish_reason: "stop", message: { content: '{"connections":[]}' } }] });
  }, "secret", { model: "other/model", messages: [], responseFormat: schema, temperature: 0.2 });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].temperature, undefined);
  assert.equal(bodies[1].response_format.type, "json_schema");
});

test("空回覆只換一次快速 Provider，截斷則交回上層解析完整物件", async () => {
  let calls = 0;
  const result = await openRouterChat(async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    if (calls === 1) return response({ choices: [{ finish_reason: "stop", message: { content: "" } }] });
    assert.equal(body.provider.sort, "throughput");
    return response({ choices: [{ finish_reason: "stop", message: { content: '{"connections":[]}' } }] });
  }, "secret", { model: "deepseek/model", messages: [], responseFormat: schema });
  assert.equal(result.text, '{"connections":[]}');
  assert.equal(calls, 2);
  const truncated = await openRouterChat(async () => response({ choices: [{ finish_reason: "length", message: { content: "" } }] }), "secret", { model: "deepseek/model", messages: [], responseFormat: schema });
  assert.equal(truncated.finishReason, "length");
});

test("錯誤包含上游原因與 Provider，金鑰不會外洩", async () => {
  const payload = { error: { message: "Provider returned error", metadata: { raw: JSON.stringify({ error: { message: "Request contains an invalid argument." } }), provider_name: "Google" } } };
  assert.equal(errorDetail(payload), "Provider returned error · Request contains an invalid argument. · Google");
  await assert.rejects(openRouterChat(async () => response(payload, 400), "secret-key", { model: "model", messages: [] }), (error) => error.message.includes("invalid argument") && !error.message.includes("secret-key"));
  assert.equal(buildChatBody({ model: "model", responseFormat: schema, maxTokens: 100000 }).max_tokens, 32768);
});
