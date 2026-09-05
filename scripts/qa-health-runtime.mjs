import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import electron from "electron";
import { chromium } from "playwright";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-health-"));
const port = await new Promise((resolve) => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); }); });
const packaged = process.env.CHENGJING_PACKAGED_APP;
const process_ = spawn(packaged || electron, [...(packaged ? [] : ["."]), `--remote-debugging-port=${port}`], { env: { ...process.env, CHENGJING_SMOKE: "1", CHENGJING_SMOKE_USER_DATA: directory }, stdio: ["ignore", "pipe", "pipe"] });
let output = ""; let browser;
process_.stdout.on("data", (part) => { output += part; }); process_.stderr.on("data", (part) => { output += part; });
try {
  const deadline = Date.now() + 20000;
  while (true) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {}
    if (Date.now() > deadline) throw new Error(`launch-timeout:${output.slice(-1000)}`);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0]; page.setDefaultTimeout(15000);
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.getByText("今天想釐清什麼？").waitFor();
  const taskBadge = await page.locator('.primary-nav button[title="待辦"], .primary-nav button').filter({ hasText: "待辦" }).innerText();
  await page.evaluate(() => {
    window.__healthDrawCalls = 0;
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      for (const method of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"]) {
        const original = proto[method];
        if (!original) continue;
        proto[method] = function (...args) { window.__healthDrawCalls++; return original.apply(this, args); };
      }
    }
  });
  await page.getByRole("button", { name: "第二大腦", exact: true }).click();
  await page.locator(".second-brain-page canvas").waitFor();
  await page.waitForTimeout(2200);
  const before = await page.evaluate(() => window.__healthDrawCalls);
  await page.waitForTimeout(1000);
  const idleDrawCalls = await page.evaluate((before) => window.__healthDrawCalls - before, before);
  const focusBefore = await page.locator(".second-brain-page").getAttribute("data-brain-viewport-focus");
  await page.keyboard.down("w"); await page.waitForTimeout(500); await page.keyboard.up("w");
  await page.waitForTimeout(400);
  const focusAfter = await page.locator(".second-brain-page").getAttribute("data-brain-viewport-focus");
  const interactionStillWorks = focusBefore !== focusAfter;
  const data = await page.evaluate(async () => {
    if (!window.chengjing.attachments.sweepPending) return { afterRemove: "unsupported", afterSweep: "unsupported" };
    const item = await window.chengjing.attachments.importData({ name: "undo.txt", mime: "text/plain", data: btoa("still readable") });
    await window.chengjing.attachments.remove(item.relativePath);
    const afterRemove = await window.chengjing.attachments.readData(item.relativePath);
    await window.chengjing.attachments.sweepPending([item.relativePath]);
    const afterSweep = await window.chengjing.attachments.readData(item.relativePath);
    return { afterRemove: atob(afterRemove), afterSweep: atob(afterSweep) };
  });
  const result = { packaged: Boolean(packaged), idleDrawCalls, interactionStillWorks, taskBadge, attachmentUndoWorks: data.afterRemove === "still readable" && data.afterSweep === "still readable", errors };
  console.log(JSON.stringify(result, null, 2));
  if (!process.env.CHENGJING_QA_BASELINE && (idleDrawCalls > 0 || !interactionStillWorks || !result.attachmentUndoWorks || errors.length)) process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  process_.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 300));
  await fs.rm(directory, { recursive: true, force: true });
}
