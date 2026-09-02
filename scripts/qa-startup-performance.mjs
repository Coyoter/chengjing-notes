import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { chromium } from "playwright";

const exec = promisify(execFile);
const executable = process.env.CHENGJING_PACKAGED_APP;
const rounds = Math.max(1, Math.min(7, Number(process.env.CHENGJING_PERFORMANCE_ROUNDS || 3)));
if (!executable) throw new Error("CHENGJING_PACKAGED_APP is required");

const reports = [];
for (let round = 0; round < rounds; round += 1) reports.push(await measureRound(round + 1));

const median = (key) => {
  const values = reports.map((report) => report[key]).sort((left, right) => left - right);
  return values[Math.floor(values.length / 2)];
};
const summary = {
  executable,
  rounds,
  reports,
  median: {
    debuggerReadyMs: median("debuggerReadyMs"),
    appShellReadyMs: median("appShellReadyMs"),
    firstInteractionMs: median("firstInteractionMs"),
    idleTimerDelayMs: median("idleTimerDelayMs"),
    processTreeRssMiB: median("processTreeRssMiB"),
  },
};
console.log(JSON.stringify(summary, null, 2));

async function measureRound(round) {
  const port = await freePort();
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), `chengjing-startup-${round}-`));
  const startedAt = performance.now();
  const child = spawn(executable, [`--remote-debugging-port=${port}`], {
    env: { ...process.env, CHENGJING_SMOKE_USER_DATA: userData },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  let browser;
  try {
    const endpoint = `http://127.0.0.1:${port}`;
    while (true) {
      try { if ((await fetch(`${endpoint}/json/version`)).ok) break; } catch {}
      if (performance.now() - startedAt > 20_000) throw new Error(`startup-timeout:${output.slice(-1000)}`);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    const debuggerReadyMs = Math.round(performance.now() - startedAt);
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    let page = context.pages().find((candidate) => !candidate.url().includes("quick-capture"));
    while (!page) {
      if (performance.now() - startedAt > 20_000) throw new Error(`main-window-timeout:${output.slice(-1000)}`);
      await new Promise((resolve) => setTimeout(resolve, 40));
      page = context.pages().find((candidate) => !candidate.url().includes("quick-capture"));
    }
    page.setDefaultTimeout(15_000);
    await page.locator(".app-shell").waitFor({ state: "attached" });
    const appShellReadyMs = Math.round(performance.now() - startedAt);
    const firstButton = page.locator(".primary-nav button").first();
    await firstButton.click();
    const firstInteractionMs = Math.round(performance.now() - startedAt);
    await page.waitForTimeout(1_500);
    const idleTimerDelayMs = Math.round(await page.evaluate(() => new Promise((resolve) => {
      const started = performance.now();
      setTimeout(() => resolve(performance.now() - started), 0);
    })));
    const processTreeRssMiB = await processTreeRss(child.pid);
    await page.evaluate(() => window.chengjing.app.quit());
    return { round, debuggerReadyMs, appShellReadyMs, firstInteractionMs, idleTimerDelayMs, processTreeRssMiB };
  } finally {
    await browser?.close().catch(() => {});
    if (child.exitCode === null) child.kill("SIGTERM");
    if (child.exitCode === null) await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 3_000))]);
    await fs.rm(userData, { recursive: true, force: true });
  }
}

async function processTreeRss(rootPid) {
  const { stdout } = await exec("ps", ["-axo", "pid=,ppid=,rss="]);
  const rows = stdout.trim().split("\n").map((line) => line.trim().split(/\s+/).map(Number)).filter((row) => row.length === 3 && row.every(Number.isFinite));
  const descendants = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, parentPid] of rows) {
      if (descendants.has(parentPid) && !descendants.has(pid)) { descendants.add(pid); changed = true; }
    }
  }
  const rssKiB = rows.filter(([pid]) => descendants.has(pid)).reduce((total, row) => total + row[2], 0);
  return Math.round(rssKiB / 1024);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}
