"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ERROR = "local-only-mode";
const LOCAL_PROTOCOLS = new Set(["file:", "data:", "blob:", "about:", "chengjing-attachment:"]);

function isLocalResource(input) {
  try {
    const url = new URL(String(input));
    if (url.protocol === "file:") return (!url.hostname || url.hostname === "localhost") && !url.pathname.startsWith("//");
    return LOCAL_PROTOCOLS.has(url.protocol);
  } catch { return false; }
}

// No shared allowlist: even Google/GitHub requests made by the renderer are blocked.
// Only the main-process updater can use its separate, non-persistent session.
function isUpdateResource(input, method = "GET") {
  try {
    const url = new URL(String(input));
    if (url.protocol !== "https:" || url.username || url.password || url.port || !["GET", "HEAD"].includes(method)) return false;
    const host = url.hostname;
    if (host === "chengjing-update-index.coyoter.workers.dev") return url.pathname === "/v1/latest" && !url.search;
    if (host === "api.github.com") return url.pathname === "/repos/Coyoter/chengjing-notes/releases/latest" && !url.search;
    if (host === "github.com") return !url.search && (url.pathname === "/Coyoter/chengjing-notes/releases.atom"
      || /^\/Coyoter\/chengjing-notes\/releases\/download\/v\d+\.\d+\.\d+\/ChengJing-\d+\.\d+\.\d+-(?:arm64|x64)(?:-Installer\.exe|\.dmg)$/.test(url.pathname));
    // GitHub redirects installer downloads to a signed, short-lived asset URL.
    return host === "release-assets.githubusercontent.com" && /^\/github-production-release-asset\/[\w-]+\/[\w-]+$/.test(url.pathname);
  } catch { return false; }
}

function createNetworkPolicy(directory) {
  const filename = path.join(directory, "network-policy.json");
  let enabled = false;
  let revision = 0;
  try {
    const saved = JSON.parse(fs.readFileSync(filename, "utf8"));
    // A damaged policy must never silently re-enable networking.
    enabled = typeof saved.localOnly === "boolean" ? saved.localOnly : true;
  } catch (error) { enabled = error.code !== "ENOENT"; }
  const active = new Set();
  const assertOnline = () => { if (enabled) throw new Error(ERROR); };
  const snapshot = () => ({ enabled, revision });
  function setEnabled(value, { activate = true } = {}) {
    if (typeof value !== "boolean") throw new Error("invalid-local-only-setting");
    // Synchronous durable write: no new application callback can race this switch.
    // A failed write leaves the old policy in force and never reports success.
    fs.mkdirSync(directory, { recursive: true });
    const temp = `${filename}.tmp`;
    const fd = fs.openSync(temp, "w", 0o600);
    try { fs.writeFileSync(fd, JSON.stringify({ localOnly: value })); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temp, filename);
    if (activate) enabled = value;
    revision += 1;
    if (enabled) { for (const abort of [...active]) { try { abort(); } catch { /* One completed request must not prevent cancelling the others. */ } } active.clear(); }
    return snapshot();
  }
  function installSession(session, updater = false) {
    session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: updater
      ? !isUpdateResource(details.url, details.method)
      : enabled && !isLocalResource(details.url) }));
    if (!updater) session.enableNetworkEmulation({ offline: enabled });
  }
  function track(abort) { active.add(abort); return () => active.delete(abort); }
  function transport(raw) {
    return {
      isOnline: () => !enabled && raw.isOnline(),
      async fetch(input, init = {}) {
        const url = input?.url || String(input);
        if (isLocalResource(url)) return raw.fetch(input, init);
        assertOnline();
        const controller = new AbortController();
        let reader, bodyController, aborted = false;
        const untrack = track(() => {
          aborted = true;
          const error = new Error(ERROR);
          controller.abort(error);
          // Electron's fetch abort signal may stop applying once headers arrive.
          // Cancel its data pipe explicitly as well as rejecting the consumer.
          void reader?.cancel(error).catch(() => {});
          bodyController?.error(error);
        });
        const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
        try {
          const response = await raw.fetch(input, { ...init, signal });
          if (aborted) { void response.body?.cancel().catch(() => {}); throw new Error(ERROR); }
          if (!response.body) { untrack(); return response; }
          // Fetch resolves at headers, not end-of-body: keep downloads cancellable.
          reader = response.body.getReader();
          const body = new ReadableStream({
            start(stream) { bodyController = stream; if (aborted) stream.error(new Error(ERROR)); },
            async pull(stream) {
              try { const result = await reader.read(); if (aborted) return; if (result.done) { untrack(); stream.close(); } else stream.enqueue(result.value); }
              catch (error) { untrack(); if (!aborted) stream.error(error); }
            },
            cancel(reason) { untrack(); return reader.cancel(reason); },
          });
          const wrapped = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
          Object.defineProperty(wrapped, "url", { value: response.url });
          return wrapped;
        } catch (error) { untrack(); throw error; }
      },
      request(options) {
        assertOnline();
        const request = raw.request(options);
        const untrack = track(() => request.abort());
        request.once("close", untrack);
        return request;
      },
    };
  }
  return { snapshot, setEnabled, assertOnline, installSession, transport };
}

module.exports = { createNetworkPolicy, isLocalResource, isUpdateResource, ERROR };
