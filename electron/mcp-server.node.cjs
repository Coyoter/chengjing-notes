const assert = require("node:assert/strict");
const test = require("node:test");
const http = require("node:http");
const net = require("node:net");
const { Client, StreamableHTTPClientTransport } = require("@modelcontextprotocol/client");
const { createChengJingMcpServer, safeEqual } = require("./mcp-server.cjs");

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function rawRequest(port, headers, body = "{}") {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: "/mcp", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...headers } }, (response) => { response.resume(); response.on("end", () => resolve(response.statusCode)); });
    request.on("error", reject); request.end(body);
  });
}

test("MCP 權杖使用固定時間比對", () => {
  assert.equal(safeEqual("Bearer abc", "Bearer abc"), true);
  assert.equal(safeEqual("Bearer abc", "Bearer abd"), false);
  assert.equal(safeEqual("short", "a much longer value"), false);
});

test("本機 Streamable HTTP MCP 可被正式 Client 初始化、列出與呼叫工具", async () => {
  const port = await freePort(); const token = "test-token-that-is-long-enough-for-mcp"; const calls = [];
  const server = createChengJingMcpServer({
    port, token,
    execute: async (tool, args, meta) => { calls.push({ tool, args, meta }); return tool === "chengjing_status" ? { app: "ChengJing", ok: true } : { created: true, id: "note-test" }; },
  });
  await server.start();
  const endpoint = `http://127.0.0.1:${port}/mcp`;
  try {
    const denied = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(denied.status, 401);
    assert.equal(await rawRequest(port, { Host: "attacker.example", Authorization: `Bearer ${token}` }), 403);
    assert.equal(await rawRequest(port, { Origin: "https://attacker.example", Authorization: `Bearer ${token}` }), 403);
    const client = new Client({ name: "chengjing-integration-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.some((item) => item.name === "chengjing_search"), true);
    assert.equal(tools.tools.some((item) => item.name === "chengjing_create_kanban"), true);
    assert.equal(tools.tools.some((item) => item.name === "chengjing_connect_neurons"), true);
    const status = await client.callTool({ name: "chengjing_status", arguments: {} });
    assert.deepEqual(status.structuredContent, { app: "ChengJing", ok: true });
    await client.callTool({ name: "chengjing_create_note", arguments: { title: "MCP 測試", content: "內容" } });
    assert.equal(calls[0].meta.write, false);
    assert.equal(calls[1].meta.write, true);
    await client.close();
  } finally { await server.stop(); }
});
