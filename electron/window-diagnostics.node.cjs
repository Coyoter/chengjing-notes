const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createWindowDiagnostics } = require("./window-diagnostics.cjs");
test("diagnostics are opt-in, persist the toggle, record geometry only and stop when disabled", async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-window-diag-"));
  try {
    const diagnostic = await createWindowDiagnostics({ userData, appVersion: "test", electronVersion: "44", environment: "0" });
    const geometry = { bounds: { x: -200, y: 31, width: 1000, height: 700 }, fullscreen: false, displays: [] };
    diagnostic.record("focus", geometry); await diagnostic.flush();
    await assert.rejects(fs.stat(diagnostic.directory), { code: "ENOENT" });
    await diagnostic.setEnabled(true); diagnostic.record("focus", geometry); diagnostic.record("focus", geometry); await diagnostic.flush();
    const file = path.join(diagnostic.directory, "placement.jsonl");
    const rows = (await fs.readFile(file, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(rows.length, 1); assert.deepEqual(rows[0].bounds, geometry.bounds);
    assert.deepEqual(Object.keys(rows[0]).sort(), ["timestamp", "appVersion", "electronVersion", "event", "bounds", "fullscreen", "displays"].sort());
    const reopened = await createWindowDiagnostics({ userData, appVersion: "test", electronVersion: "44" }); assert.equal(reopened.isEnabled(), true);
    await diagnostic.setEnabled(false); diagnostic.record("show", geometry); await diagnostic.flush();
    assert.equal((await fs.readFile(file, "utf8")).trim().split("\n").length, 1);
    const off = await createWindowDiagnostics({ userData, appVersion: "test", electronVersion: "44" }); assert.equal(off.isEnabled(), false);
  } finally { await fs.rm(userData, { recursive: true, force: true }); }
});
