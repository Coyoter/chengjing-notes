const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { appendMcpAudit, normalizeMcpSettings, readMcpAudit, readMcpSettings, readOrCreateMcpToken, regenerateMcpToken, writeMcpSettings } = require("./mcp-settings.cjs");

test("MCP 預設關閉且唯讀，連接埠限制在非系統範圍", () => {
  assert.deepEqual(normalizeMcpSettings(), { enabled: false, accessMode: "read-only", port: 47831 });
  assert.deepEqual(normalizeMcpSettings({ enabled: true, accessMode: "allow", port: 49_001 }), { enabled: true, accessMode: "allow", port: 49_001 });
  assert.equal(normalizeMcpSettings({ port: 80 }).port, 47831);
});

test("MCP Token 加密保存且稽核紀錄有界", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-mcp-settings-test-"));
  try {
    await writeMcpSettings(root, { enabled: true, accessMode: "ask", port: 48_001 });
    assert.deepEqual(await readMcpSettings(root), { enabled: true, accessMode: "ask", port: 48_001 });
    const first = await readOrCreateMcpToken(root);
    const second = await readOrCreateMcpToken(root);
    assert.equal(first, second);
    assert.equal((await fs.readFile(path.join(root, "mcp-access-token.vault.json"))).includes(Buffer.from(first)), false);
    assert.notEqual(await regenerateMcpToken(root), first);
    for (let index = 0; index < 45; index += 1) await appendMcpAudit(root, { tool: "chengjing_search", summary: `query-${index}`, outcome: "success" });
    const audit = await readMcpAudit(root);
    assert.equal(audit.length, 40);
    assert.equal(audit[0].summary, "query-44");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
