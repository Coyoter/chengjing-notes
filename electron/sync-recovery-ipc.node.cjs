"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { CHANNELS, registerSyncRecoveryIpc } = require("./sync-recovery-ipc.cjs");

function fixture(t) {
  const handlers = new Map(), calls = [];
  const sender = new EventEmitter();
  sender.mainFrame = {};
  sender.isDestroyed = () => false;
  let window = { webContents: sender, isDestroyed: () => false };
  let accessCount = 0;
  const service = Object.fromEntries(Object.keys(CHANNELS).map(method => [method, value => {
    calls.push([method, value]);
    return { method, value };
  }]));
  const dispose = registerSyncRecoveryIpc({
    ipcMain: {
      handle: (channel, fn) => {
        assert.equal(handlers.has(channel), false);
        handlers.set(channel, fn);
      },
      removeHandler: channel => handlers.delete(channel),
    },
    getMainWindow: () => window,
    getService: () => { accessCount++; return service; },
  });
  t.after(dispose);
  const event = () => ({ sender, senderFrame: sender.mainFrame });
  return {
    handlers, calls, sender, service, dispose, event,
    accessCount: () => accessCount,
    setWindow: next => { window = next; },
    invoke: (method, value, from = event()) => handlers.get(CHANNELS[method])(from, value),
  };
}

test("registers precisely five recovery channels and delegates requests", async t => {
  const h = fixture(t);
  assert.equal(h.handlers.size, 5);
  for (const method of ["getStatus", "createDaily", "download", "releaseDownload"]) {
    const value = method === "createDaily" ? { data: "snapshot", assets: [] } : "id";
    assert.equal((await h.invoke(method, value)).method, method);
  }
  assert.deepEqual(h.calls[0], ["getStatus", undefined]);
});

test("all channels reject foreign windows before accessing the service", async t => {
  const h = fixture(t);
  for (const method of Object.keys(CHANNELS)) {
    await assert.rejects(h.invoke(method, true, {
      sender: new EventEmitter(), senderFrame: h.sender.mainFrame,
    }), /untrusted-sender/);
  }
  assert.equal(h.accessCount(), 0);
});

test("rejects iframes and missing or destroyed main frames", async t => {
  const h = fixture(t);
  for (const senderFrame of [null, {}, undefined]) {
    await assert.rejects(h.invoke("getStatus", undefined, {
      sender: h.sender, senderFrame,
    }), /untrusted-sender/);
  }
  h.sender.isDestroyed = () => true;
  await assert.rejects(h.invoke("getStatus"), /untrusted-sender/);
  assert.equal(h.accessCount(), 0);
});

test("does not start a service when there is no active main window", async t => {
  const h = fixture(t);
  h.setWindow(null);
  await assert.rejects(h.invoke("getStatus"), /untrusted-sender/);
  assert.equal(h.accessCount(), 0);
});

test("enabling accepts only a literal boolean", async t => {
  const h = fixture(t);
  for (const value of ["true", 1, null, {}, undefined]) {
    await assert.rejects(h.invoke("setEnabled", value), /enabled-invalid/);
  }
  assert.equal(h.accessCount(), 0);
  await h.invoke("setEnabled", true);
  await h.invoke("setEnabled", false);
  assert.deepEqual(h.calls, [["setEnabled", true], ["setEnabled", false]]);
});

test("disabling reaches the service while an upload is still running", async t => {
  const h = fixture(t);
  let finish;
  h.service.createDaily = () => new Promise(resolve => { finish = resolve; });
  await h.invoke("setEnabled", true);
  const pending = h.invoke("createDaily", { data: "snapshot" });
  await h.invoke("setEnabled", false);
  assert.deepEqual(h.calls.at(-1), ["setEnabled", false]);
  finish({ done: true });
  assert.deepEqual(await pending, { done: true });
});

test("closing, crashing or navigating the owning renderer disarms recovery", async t => {
  const h = fixture(t);
  for (const event of ["destroyed", "render-process-gone", "did-navigate"]) {
    await h.invoke("setEnabled", true);
    h.sender.emit(event);
    assert.deepEqual(h.calls.at(-1), ["setEnabled", false]);
    assert.equal(h.sender.listenerCount(event), 0);
  }
});

test("repeated enable calls do not accumulate lifecycle listeners", async t => {
  const h = fixture(t);
  await h.invoke("setEnabled", true);
  await h.invoke("setEnabled", true);
  assert.equal(h.sender.listenerCount("destroyed"), 1);
  h.dispose();
  assert.equal(h.handlers.size, 0);
  assert.equal(h.sender.listenerCount("destroyed"), 0);
});

test("unexpected transport errors do not expose credentials or local paths", async t => {
  const h = fixture(t);
  h.service.getStatus = async () => {
    throw new Error("Bearer private-token /Users/private/file");
  };
  await assert.rejects(h.invoke("getStatus"),
    error => error.message === "sync-recovery-operation-failed");
  h.service.getStatus = async () => { throw new Error("cloud-auth-expired"); };
  await assert.rejects(h.invoke("getStatus"),
    error => error.message === "sync-recovery-auth-required");
  h.service.getStatus = async () => {
    throw new Error("sync-recovery-manifest-corrupt");
  };
  await assert.rejects(h.invoke("getStatus"),
    error => error.message === "sync-recovery-manifest-corrupt");
});
