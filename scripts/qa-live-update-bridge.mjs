import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

const executable = process.env.CHENGJING_PACKAGED_APP;
if (!executable) throw new Error("CHENGJING_PACKAGED_APP is required");
const expectedLatest = process.env.CHENGJING_EXPECTED_LATEST || "0.5.8";
const port = await freePort();
const userData = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-update-bridge-"));
const child = spawn(executable, ["--background", `--remote-debugging-port=${port}`], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    CHENGJING_SMOKE_USER_DATA: userData,
    CHENGJING_SMOKE_UPDATE_FORCE_FALLBACK: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });
let browser;
try {
  const endpoint = `http://127.0.0.1:${port}`;
  const startedAt = Date.now();
  while (true) {
    try { if ((await fetch(`${endpoint}/json/version`)).ok) break; } catch {}
    if (Date.now() - startedAt > 15_000) throw new Error(`Update bridge launch timed out: ${output.slice(-800)}`);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const page = context.pages().find((candidate) => candidate.url().includes("quick-capture")) || context.pages()[0] || await context.waitForEvent("page");
  const update = await page.evaluate(() => window.chengjing.updates.check(true));
  const report = {
    packagedVersion: update.currentVersion,
    status: update.status,
    latestVersion: update.latestVersion,
    asset: update.asset?.name,
    digest: update.asset?.digest,
    downloadUrl: update.asset?.url,
  };
  console.log(JSON.stringify(report, null, 2));
  if (update.status !== "available" || update.latestVersion !== expectedLatest || update.asset?.name !== `ChengJing-${expectedLatest}-arm64.dmg` || !update.asset?.digest?.startsWith("sha256:")) process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill("SIGTERM");
  if (child.exitCode === null) await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 2500))]);
  await fs.rm(userData, { recursive: true, force: true });
}
