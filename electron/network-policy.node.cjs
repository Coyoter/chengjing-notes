const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createNetworkPolicy, isUpdateResource, isLocalResource } = require("./network-policy.cjs");

function fixture(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), "chengjing-network-unit-")); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
test("off by default, survives restart and fails closed for damaged settings", (t) => {
  const root = fixture(t), policy = createNetworkPolicy(root);
  assert.equal(policy.snapshot().enabled, false);
  policy.setEnabled(true);
  assert.equal(createNetworkPolicy(root).snapshot().enabled, true);
  policy.setEnabled(false);
  assert.equal(createNetworkPolicy(root).snapshot().enabled, false);
  fs.writeFileSync(path.join(root, "network-policy.json"), "broken");
  assert.equal(createNetworkPolicy(root).snapshot().enabled, true);
  assert.throws(() => policy.setEnabled("false"), /invalid-local-only/);
});
test("disabling is staged until restart, so queued notes cannot upload during saving", (t) => {
  const root = fixture(t), policy = createNetworkPolicy(root);
  policy.setEnabled(true);
  policy.setEnabled(false, { activate: false });
  assert.equal(policy.snapshot().enabled, true);
  assert.throws(policy.assertOnline, /local-only-mode/);
  assert.equal(createNetworkPolicy(root).snapshot().enabled, false);
});
test("failed persistence never falsely reports a successful switch", (t) => {
  const root = fixture(t), policy = createNetworkPolicy(root);
  fs.mkdirSync(path.join(root, "network-policy.json.tmp"));
  assert.throws(() => policy.setEnabled(true));
  assert.equal(policy.snapshot().enabled, false);
});
test("update exception is private, read-only and limited to release metadata and installers", () => {
  const valid = [
    "https://api.github.com/repos/Coyoter/chengjing-notes/releases/latest",
    "https://chengjing-update-index.coyoter.workers.dev/v1/latest",
    "https://github.com/Coyoter/chengjing-notes/releases.atom",
    "https://github.com/Coyoter/chengjing-notes/releases/download/v0.10.20/ChengJing-0.10.20-arm64.dmg",
    "https://github.com/Coyoter/chengjing-notes/releases/download/v0.10.20/ChengJing-0.10.20-x64-Installer.exe",
    "https://release-assets.githubusercontent.com/github-production-release-asset/123/a-b?sig=example",
  ];
  for (const url of valid) { assert.ok(isUpdateResource(url)); assert.ok(isUpdateResource(url, "HEAD")); assert.equal(isUpdateResource(url, "POST"), false); }
  for (const url of ["https://api.github.com/user", "https://github.com/Other/repo/releases.atom", "https://github.com/Coyoter/chengjing-notes/issues", "https://api.github.com/repos/Coyoter/chengjing-notes/releases/latest?notes=private", "https://github.com.evil.test/Coyoter/chengjing-notes/releases.atom", "https://user@github.com/Coyoter/chengjing-notes/releases.atom", "https://github.com:444/Coyoter/chengjing-notes/releases.atom", "http://github.com/Coyoter/chengjing-notes/releases.atom", "https://huggingface.co/model"]) assert.equal(isUpdateResource(url), false, url);
});
test("local files and attachment protocol work, remote file shares do not", () => {
  for (const url of ["file:///tmp/local.txt", "file:///C:/notes/test.json", "chengjing-attachment://local/file", "data:text/plain,hello", "blob:null/test"]) assert.ok(isLocalResource(url));
  for (const url of ["https://google.com", "http://127.0.0.1:11434", "ws://127.0.0.1", "file://server/share/test.txt", "file:////server/share/test.txt"]) assert.equal(isLocalResource(url), false);
});
test("ordinary session blocks even update hosts; updater session blocks every other destination", (t) => {
  const policy = createNetworkPolicy(fixture(t)); policy.setEnabled(true);
  let ordinary, updater;
  policy.installSession({ webRequest: { onBeforeRequest: (fn) => { ordinary = fn; } }, enableNetworkEmulation: (value) => assert.equal(value.offline, true) });
  policy.installSession({ webRequest: { onBeforeRequest: (fn) => { updater = fn; } } }, true);
  const decision = (handler, url, method = "GET") => { let result; handler({ url, method }, (value) => { result = value.cancel; }); return result; };
  const release = "https://github.com/Coyoter/chengjing-notes/releases.atom";
  assert.equal(decision(ordinary, release), true);
  assert.equal(decision(updater, release), false);
  assert.equal(decision(updater, "https://accounts.google.com"), true);
  assert.equal(decision(ordinary, "file:///tmp/local"), false);
});
test("enable aborts pending fetch including bodies after headers, and prevents future calls", async (t) => {
  const policy = createNetworkPolicy(fixture(t));
  let called = 0, observedSignal;
  const transport = policy.transport({
    async fetch(_url, init) {
      called++; observedSignal = init.signal;
      return new Response(new ReadableStream({ start(controller) { init.signal.addEventListener("abort", () => controller.error(init.signal.reason)); } }));
    },
  });
  const response = await transport.fetch("https://example.test/body");
  const read = response.text();
  policy.setEnabled(true);
  assert.ok(observedSignal.aborted);
  await assert.rejects(read, /local-only-mode/);
  await assert.rejects(transport.fetch("https://example.test/after"), /local-only-mode/);
  assert.equal(called, 1);
});
test("enable aborts net.request uploads and preserves caller's abort signal", async (t) => {
  const policy = createNetworkPolicy(fixture(t)); let aborted = false;
  const transport = policy.transport({ request: () => ({ once() {}, abort() { aborted = true; } }), fetch: async (_url, init) => { assert.ok(init.signal.aborted); throw init.signal.reason; } });
  const caller = new AbortController(); caller.abort(new Error("caller-aborted"));
  await assert.rejects(transport.fetch("https://example.test", { signal: caller.signal }), /caller-aborted/);
  transport.request({ url: "https://example.test" });
  policy.setEnabled(true); assert.ok(aborted);
  assert.throws(() => transport.request({ url: "https://example.test" }), /local-only-mode/);
});
