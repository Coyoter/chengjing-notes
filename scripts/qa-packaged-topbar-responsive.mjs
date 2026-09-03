import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const executable = process.env.CHENGJING_PACKAGED_APP;
if (!executable) throw new Error("CHENGJING_PACKAGED_APP is required");
const output = path.resolve("qa-artifacts/packaged-topbar-responsive");
await fs.mkdir(output, { recursive: true });
const userData = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-topbar-"));
const port = await freePort();
const child = spawn(executable, [`--remote-debugging-port=${port}`], {
  env: { ...process.env, CHENGJING_SMOKE_USER_DATA: userData },
  stdio: ["ignore", "pipe", "pipe"],
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
    if (Date.now() - startedAt > 20_000) throw new Error(`packaged-topbar-launch-timeout:${processOutput.slice(-1000)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  let page = context.pages().find((candidate) => !candidate.url().includes("quick-capture"));
  while (!page) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    page = context.pages().find((candidate) => !candidate.url().includes("quick-capture"));
  }
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror:${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`console:${message.text()}`); });
  await page.locator(".app-shell").waitFor();
  await page.evaluate(() => window.resizeTo(1100, 760));
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await page.locator(".font-scale-setting").scrollIntoViewIfNeeded();
  await page.locator(".font-scale-setting button").nth(3).click();
  await page.getByRole("button", { name: "今日", exact: true }).click();
  await page.getByRole("button", { name: "詢問 AI", exact: true }).click();
  await page.locator(".ai-panel").waitFor();
  await page.waitForTimeout(300);
  const compact = await readTopbar(page);
  await page.screenshot({ path: path.join(output, "01-mac-1100-ai-compact.png") });
  await page.getByRole("button", { name: "關閉 AI", exact: true }).click();
  await page.locator(".right-panel").waitFor({ state: "detached" });
  await page.waitForTimeout(300);
  const expanded = await readTopbar(page);
  await page.screenshot({ path: path.join(output, "02-mac-1100-expanded.png") });
  const state = await page.evaluate(() => window.chengjing.app.getWindowState());
  const report = { state, compact, expanded, errors };
  await fs.writeFile(path.join(output, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  await page.evaluate(() => window.chengjing.app.quit());
  if (!compact.fits || compact.textDisplay !== "none" || compact.shortcutDisplay !== "none" || compact.searchWidth > 40 || !compact.accessibleName.includes("搜尋卡片") || !expanded.fits || expanded.textDisplay === "none" || expanded.shortcutDisplay === "none" || errors.length) process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill("SIGTERM");
  if (child.exitCode === null) await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 3_000))]);
  await fs.rm(userData, { recursive: true, force: true });
}

async function readTopbar(page) {
  return page.locator(".topbar").evaluate((topbar) => {
    const search = topbar.querySelector(".search-trigger");
    const text = search.querySelector("span");
    const shortcut = search.querySelector("kbd");
    const topbarRect = topbar.getBoundingClientRect();
    const searchRect = search.getBoundingClientRect();
    const childrenFit = [...topbar.children].every((child) => {
      const rect = child.getBoundingClientRect();
      return rect.left >= topbarRect.left - 1 && rect.right <= topbarRect.right + 1 && rect.top >= topbarRect.top - 1 && rect.bottom <= topbarRect.bottom + 1;
    });
    return {
      fits: topbar.scrollWidth <= topbar.clientWidth + 1 && search.scrollHeight <= search.clientHeight + 1 && childrenFit,
      topbarWidth: topbarRect.width,
      searchWidth: searchRect.width,
      textDisplay: getComputedStyle(text).display,
      shortcutDisplay: getComputedStyle(shortcut).display,
      accessibleName: search.getAttribute("aria-label") || "",
    };
  });
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
