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
const run = promisify(execFile), require = createRequire(import.meta.url);
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-fullscreen-qa-"));
const fixture = path.join(profile, "fixture.node");
const output = path.resolve("qa-artifacts/fullscreen-presentation");
await fs.mkdir(output, { recursive: true });
await run("xcrun", ["clang++", "electron/native/WindowPresentation.mm", "-std=c++17", "-fobjc-arc", "-bundle", "-undefined", "dynamic_lookup", "-DNAPI_VERSION=8", "-DCHENGJING_FULLSCREEN_TEST_FIXTURE", "-I", require("node-api-headers").include_dir, "-framework", "Cocoa", "-o", fixture]);
const baseline = process.argv.includes("--baseline");
const packaged = process.env.CHENGJING_PACKAGED_APP;
const executablePath = packaged || (baseline ? "/Applications/澄境.app/Contents/MacOS/澄境" : electronPath);
const client = await electron.launch({ executablePath, args: packaged || baseline ? [] : ["."], env: { ...process.env, CHENGJING_SMOKE: "1", CHENGJING_SMOKE_USER_DATA: profile, CHENGJING_WINDOW_DIAGNOSTICS: "1" } });
const reports = [];
let page;
const sample = label => client.evaluate(({ BrowserWindow }, { fixture, label }) => {
  const load = process.getBuiltinModule("module").createRequire(process.cwd() + "/package.json");
  const window = BrowserWindow.getAllWindows()[0], native = load(fixture);
  return { label, bounds: window.getBounds(), fullscreen: window.isFullScreen(), state: JSON.parse(native.read(window.getNativeWindowHandle())) };
}, { fixture, label });
async function waitFor(predicate, label, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { const value = await sample(label); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Native state did not settle: ${label}`);
}
try {
  page = await client.firstWindow(); await page.locator(".app-shell").waitFor();
  await client.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setTitle("澄境－全螢幕呈現回歸測試"));
  await page.evaluate(() => window.chengjing.quickCapture.showMain());
  await client.evaluate(({ BrowserWindow, app }) => { const window = BrowserWindow.getAllWindows()[0]; app.focus({ steal: true }); window.show(); window.focus(); });
  console.log("Native test window ready for foreground activation");
  await waitFor(value => value.state.active && value.state.keyWindow, "foreground-before-fullscreen", process.argv.includes("--interactive") ? 60000 : 10000);
  // Exercise the same native Fill/restore path used in the original report.
  // This is a test setup step, never a return-to-app repair strategy.
  await client.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
  await page.waitForTimeout(400);
  await client.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
  await page.waitForTimeout(400);
  // A native full-screen Space requires an interactive desktop; this test is
  // deliberately separate from headless CI geometry checks.
  await client.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(true));
  const healthy = await waitFor(value => value.fullscreen && value.state.active && value.state.keyWindow && value.state.autoHideMenuBar, "healthy-fullscreen");
  reports.push(healthy); assert.equal(healthy.state.menuBarVisible, false);
  await page.waitForTimeout(600);
  const injected = await client.evaluate(({ BrowserWindow }, fixture) => {
    const load = process.getBuiltinModule("module").createRequire(process.cwd() + "/package.json");
    const native = load(fixture), window = BrowserWindow.getAllWindows()[0];
    const result = JSON.parse(native.injectMissingState());
    return { result, bounds: window.getBounds(), state: JSON.parse(native.read(window.getNativeWindowHandle())) };
  }, fixture);
  assert.equal(injected.result.injected, true); assert.equal(injected.state.autoHideMenuBar, false); assert.equal(injected.state.fullscreen, true);
  assert.deepEqual(injected.bounds, healthy.bounds); reports.push({ label: "injected-missing-presentation", ...injected });
  await client.evaluate(({ app }) => app.emit("did-become-active"));
  if (baseline) {
    await page.waitForTimeout(1200); const failure = await sample("baseline-missing-autohide-state");
    assert.equal(failure.state.autoHideMenuBar, false); assert.equal(failure.fullscreen, true); assert.deepEqual(failure.bounds, healthy.bounds); reports.push(failure);
  } else {
    const repaired = await waitFor(value => value.state.autoHideMenuBar && !value.state.menuBarVisible, "repaired-fullscreen");
    assert.deepEqual(repaired.bounds, healthy.bounds); assert.equal(repaired.fullscreen, true); reports.push(repaired);
    await client.evaluate(({ app }) => app.hide());
    await waitFor(value => !value.state.active, "hidden-app");
    await page.waitForTimeout(600);
    await page.evaluate(() => window.chengjing.quickCapture.showMain());
    const returned = await waitFor(value => value.state.active && value.state.keyWindow && value.state.autoHideMenuBar && !value.state.menuBarVisible, "hide-return-fullscreen");
    assert.deepEqual(returned.bounds, healthy.bounds); reports.push(returned);
    // No input/cursor movement during this period; catches repeat corrections.
    await page.waitForTimeout(process.argv.includes("--short") ? 1000 : 45000);
    const idle = await sample("idle-fullscreen"); assert.deepEqual(idle.bounds, healthy.bounds); reports.push(idle);
    await page.evaluate(() => window.chengjing.quickCapture.showMain());
    const idleReturn = await waitFor(value => value.state.active && value.state.keyWindow && value.state.autoHideMenuBar && !value.state.menuBarVisible, "idle-return-fullscreen");
    assert.deepEqual(idleReturn.bounds, healthy.bounds); reports.push(idleReturn);
    if (process.argv.includes("--display-wake")) {
      await run("pmset", ["displaysleepnow"]);
      await page.waitForTimeout(4000);
      reports.push(await sample("display-off"));
      await run("caffeinate", ["-u", "-t", "2"]);
      const passiveWake = await sample("display-wake-before-reactivation");
      assert.equal(passiveWake.fullscreen, true); assert.deepEqual(passiveWake.bounds, healthy.bounds); reports.push(passiveWake);
      await page.evaluate(() => window.chengjing.quickCapture.showMain());
      const wake = await waitFor(value => value.fullscreen && value.state.active && value.state.keyWindow && value.state.autoHideMenuBar && !value.state.menuBarVisible, "display-wake-fullscreen");
      assert.deepEqual(wake.bounds, healthy.bounds); reports.push(wake);
    }
    await client.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(false));
    await waitFor(value => !value.fullscreen, "ordinary-window");
    await page.waitForTimeout(600);
    const normal = await sample("normal-after-fullscreen"); assert.equal(normal.state.menuBarVisible, true); reports.push(normal);
  }
  console.log(JSON.stringify({ passed: true, baseline, reports }, null, 2));
  if (!baseline) {
    const log = await fs.readFile(path.join(profile, "window-diagnostics", "placement.jsonl"), "utf8");
    const events = log.trim().split("\n").map(JSON.parse);
    assert.ok(events.some(event => event.event === "fullscreen-presentation-repaired"));
    if (process.argv.includes("--display-wake")) assert.ok(events.some(event => event.event.startsWith("screens-wake")), "Real display wake notification must reach the guard");
  }
  await fs.writeFile(path.join(output, baseline ? "baseline.json" : "fixed.json"), JSON.stringify({ passed: true, baseline, reports }, null, 2));
} catch (error) {
  process.exitCode = 1; console.error(error);
  reports.push(await sample("failure-state").catch(() => ({ label: "failure-state-unavailable" })));
  await fs.writeFile(path.join(output, baseline ? "baseline.json" : "fixed.json"), JSON.stringify({ passed: false, baseline, reports, error: error.stack }, null, 2));
} finally { await client.close(); await fs.rm(profile, { recursive: true, force: true }); }
