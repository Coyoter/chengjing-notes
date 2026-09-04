import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(address.port)); });
  });
}

const executable = process.env.CHENGJING_PACKAGED_APP;
if (!executable) throw new Error("CHENGJING_PACKAGED_APP is required");
const output = path.resolve("qa-artifacts/installed-performance");
await fs.mkdir(output, { recursive: true });
const tempData = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-installed-performance-"));
const port = await freePort();
const child = spawn(executable, [`--remote-debugging-port=${port}`], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, CHENGJING_SMOKE: "1", CHENGJING_SMOKE_USER_DATA: tempData },
});
let processOutput = "";
child.stdout.on("data", (chunk) => { processOutput += chunk.toString(); });
child.stderr.on("data", (chunk) => { processOutput += chunk.toString(); });
let browser;
try {
  const endpoint = `http://127.0.0.1:${port}`;
  const startedAt = Date.now();
  while (true) {
    try { if ((await fetch(`${endpoint}/json/version`)).ok) break; } catch {}
    if (Date.now() - startedAt > 20_000) throw new Error(`installed-launch-timeout:${processOutput.slice(-1000)}`);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  let page = context.pages().find((candidate) => !candidate.url().includes("quick-capture")) || context.pages()[0];
  if (page.url().includes("quick-capture")) {
    await page.evaluate(() => window.chengjing.quickCapture.showMain());
    await new Promise((resolve) => setTimeout(resolve, 500));
    page = context.pages().find((candidate) => !candidate.url().includes("quick-capture")) || page;
  }
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror:${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console:${message.text()}`); });
  await page.locator(".app-shell").waitFor({ state: "attached" });
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const googleConnectButton = page.getByRole("button", { name: "連結 Google 帳號", exact: true });
  await googleConnectButton.waitFor();
  const googleConnectButtonVisible = await googleConnectButton.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const icon = element.querySelector("img");
    return rect.width >= 180
      && Math.abs(rect.height - 40) <= 0.5
      && element.textContent?.trim() === "連結 Google 帳號"
      && icon instanceof HTMLImageElement
      && icon.complete
      && icon.naturalWidth === 40
      && icon.naturalHeight === 40;
  });
  const cloudLocalProbe = await page.evaluate(async () => {
    const started = performance.now();
    const status = await window.chengjing.cloudBackups.getLocalStatus();
    return { elapsedMs: performance.now() - started, configured: status.configured, connected: status.connected };
  });
  await page.locator(".local-backup-tools > summary").click();
  const storage = page.locator(".storage-usage-summary");
  await storage.waitFor();
  await page.waitForTimeout(900);
  const storageText = await storage.innerText();
  const storageSeparated = storageText.includes("筆記與結構") && storageText.includes("附件檔案") && storageText.includes("本機 AI 模型");
  const storageNoOverflow = await storage.evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
  await page.screenshot({ path: path.join(output, "settings-storage.png"), fullPage: true });
  await page.getByRole("button", { name: "第二大腦", exact: true }).click();
  const brain = page.locator(".second-brain-page");
  await brain.waitFor();
  await page.waitForTimeout(900);
  const brainNodes = Number(await brain.getAttribute("data-brain-nodes"));
  const renderedNodes = Number(await brain.getAttribute("data-brain-rendered-nodes"));
  const brainViewportBounded = renderedNodes === Math.min(200, brainNodes);
  await page.screenshot({ path: path.join(output, "second-brain.png"), fullPage: true });
  const report = { storageText, storageSeparated, storageNoOverflow, googleConnectButtonVisible, cloudLocalProbe, brainNodes, renderedNodes, brainViewportBounded, errors };
  await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await page.evaluate(() => window.chengjing.app.quit());
  if (!storageSeparated || !storageNoOverflow || !googleConnectButtonVisible || !cloudLocalProbe.configured || cloudLocalProbe.connected || cloudLocalProbe.elapsedMs > 250 || !brainViewportBounded || errors.length) process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill("SIGTERM");
  if (child.exitCode === null) await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 3000))]);
  await fs.rm(tempData, { recursive: true, force: true });
}
