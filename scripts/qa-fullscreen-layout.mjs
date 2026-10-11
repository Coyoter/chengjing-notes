import { _electron as electron } from "playwright";
import electronPath from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
if (process.platform !== "darwin") process.exit(0);
const require = createRequire(import.meta.url), run = promisify(execFile);
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-safe-layout-"));
const fixture = path.join(profile, "fixture.node"), output = path.resolve("qa-artifacts/fullscreen-layout");
await fs.mkdir(output, { recursive: true });
await run("xcrun", ["clang++", "electron/native/WindowPresentation.mm", "-fobjc-arc", "-std=c++17", "-bundle", "-undefined", "dynamic_lookup", "-DNAPI_VERSION=8", "-DCHENGJING_FULLSCREEN_TEST_FIXTURE", "-I", require("node-api-headers").include_dir, "-framework", "Cocoa", "-framework", "CoreGraphics", "-o", fixture]);
const packaged = process.env.CHENGJING_PACKAGED_APP;
const baseline = process.argv.includes("--baseline");
const executablePath = packaged || (baseline ? "/Applications/澄境.app/Contents/MacOS/澄境" : electronPath);
const client = await electron.launch({ executablePath, args: packaged || baseline ? [] : ["."], env: { ...process.env, CHENGJING_SMOKE: "1", CHENGJING_SMOKE_USER_DATA: profile, CHENGJING_WINDOW_DIAGNOSTICS: "1" } });
let page; const reports = [];
async function native(action) {
  return client.evaluate(({ BrowserWindow }, { fixture, action }) => {
    const load = process.getBuiltinModule("module").createRequire(process.cwd() + "/package.json"), bridge = load(fixture), window = BrowserWindow.getAllWindows()[0];
    if (action === "show") bridge.showOverlay();
    if (action === "hide") bridge.hideOverlay();
    return { state: JSON.parse(bridge.read(window.getNativeWindowHandle())), layout: JSON.parse(bridge.readLayout(window.getNativeWindowHandle())), bounds: window.getBounds(), fullscreen: window.isFullScreen() };
  }, { fixture, action });
}
async function refresh() { await page.evaluate(() => window.chengjing.app.refreshWindowLayout?.()); }
try {
  page = await client.firstWindow(); await page.locator(".app-shell").waitFor();
  await page.evaluate(() => window.chengjing.quickCapture.showMain());
  await client.evaluate(({ BrowserWindow, app }) => { const w = BrowserWindow.getAllWindows()[0]; app.focus({ steal: true }); w.show(); w.focus(); });
  await page.waitForTimeout(800);
  await client.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(true));
  await page.waitForFunction(async () => (await window.chengjing.app.getWindowState()).fullscreen);
  await page.waitForTimeout(800);
  const healthy = await native("read"); assert.equal(healthy.state.autoHideMenuBar, true); reports.push({ label: "healthy", ...healthy });
  const originalBounds = healthy.bounds;
  const overlay = await native("show"); await refresh();
  await page.waitForTimeout(1200);
  const protectedState = await native("read");
  assert.equal(protectedState.state.autoHideMenuBar, true, "The missing case keeps the supposedly healthy auto-hide flags");
  assert.ok(protectedState.layout.menuBars.length > 0, "Real visible top overlay must be measured");
  assert.deepEqual(protectedState.bounds, originalBounds); assert.equal(protectedState.fullscreen, true);
  const observed = await page.evaluate(() => ({ brandTop: document.querySelector(".brand-row").getBoundingClientRect().top,
    dragTop: document.querySelector(".window-drag-region").getBoundingClientRect().top,
    toolbarTop: document.querySelector(".topbar").getBoundingClientRect().top, viewportOverflow: document.documentElement.scrollHeight - innerHeight,
    inset: getComputedStyle(document.documentElement).getPropertyValue("--mac-fullscreen-menu-inset").trim() }));
  const windowTop = protectedState.layout.windowBounds.y;
  const obstruction = Math.max(...protectedState.layout.menuBars.map(bar => bar.y + bar.height - windowTop));
  if (baseline) assert.ok(observed.brandTop < obstruction, "Old build should reproduce the uncovered layout gap");
  else {
    assert.ok(observed.brandTop >= obstruction && observed.toolbarTop >= obstruction, JSON.stringify({ observed, obstruction }));
    assert.equal(observed.dragTop, observed.brandTop, "The drag region follows the shifted sidebar without a second offset");
    assert.ok(observed.viewportOverflow <= 1);
    await page.screenshot({ path: path.join(output, "protected-content.png") });
  }
  reports.push({ label: "visible-overlay-with-healthy-flags", ...protectedState, observed, obstruction });
  await native("hide"); await refresh(); await page.waitForTimeout(1200);
  const removed = await page.evaluate(() => document.querySelector(".brand-row").getBoundingClientRect().top);
  assert.equal(removed, 0, "No permanent blank strip after the overlay disappears"); reports.push({ label: "hidden-overlay", brandTop: removed });
  if (!baseline) {
    await client.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25));
    await native("show"); await refresh(); await page.waitForTimeout(1200);
    const zoomed = await page.evaluate(() => ({ top: document.querySelector(".brand-row").getBoundingClientRect().top, inset: getComputedStyle(document.documentElement).getPropertyValue("--mac-fullscreen-menu-inset").trim() }));
    assert.ok(zoomed.top * 1.25 >= obstruction - 1); reports.push({ label: "zoom-compensation", ...zoomed });
    await native("hide"); await client.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
  }
  console.log(JSON.stringify({ passed: true, baseline, reports }, null, 2));
  await fs.writeFile(path.join(output, baseline ? "baseline.json" : "fixed.json"), JSON.stringify({ passed: true, baseline, reports }, null, 2));
} catch (error) {
  process.exitCode = 1; console.error(error);
  reports.push(await native("read").catch(() => ({})));
  await fs.writeFile(path.join(output, baseline ? "baseline.json" : "fixed.json"), JSON.stringify({ passed: false, baseline, error: error.stack, reports }, null, 2));
} finally { await native("hide").catch(() => {}); await client.close(); await fs.rm(profile, { recursive: true, force: true }); }
