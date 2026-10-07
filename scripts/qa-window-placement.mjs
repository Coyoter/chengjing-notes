import { _electron as electron } from "playwright";
import electronPath from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

if (process.platform !== "darwin") { console.log("macOS window placement QA: not applicable on this platform"); process.exit(0); }
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-window-qa-"));
const output = path.resolve("qa-artifacts/window-placement");
await fs.mkdir(output, { recursive: true });
const packaged = process.env.CHENGJING_PACKAGED_APP;
const client = await electron.launch({ executablePath: packaged || electronPath, args: packaged ? [] : ["."], env: { ...process.env, CHENGJING_SMOKE: "1", CHENGJING_SMOKE_USER_DATA: profile, CHENGJING_WINDOW_DIAGNOSTICS: "1" } });
const reports = [], errors = [];
let page;
const snapshot = label => client.evaluate(({ BrowserWindow, screen }, label) => {
  const window = BrowserWindow.getAllWindows()[0];
  return { label, bounds: window.getBounds(), contentBounds: window.getContentBounds(), normalBounds: window.getNormalBounds(), fullscreen: window.isFullScreen(), maximized: window.isMaximized(), minimized: window.isMinimized(), visible: window.isVisible(), display: (() => { const { id, bounds, workArea, scaleFactor } = screen.getDisplayMatching(window.getBounds()); return { id, bounds, workArea, scaleFactor }; })() };
}, label);
const settle = () => page.waitForTimeout(650); // Native focus/full-screen callbacks are asynchronous.
async function assertUnchanged(before, label) {
  await settle(); const after = await snapshot(label); assert.deepEqual(after.bounds, before.bounds, label); reports.push(after); return after;
}
async function fullscreen(value) {
  await client.evaluate(async ({ BrowserWindow }, value) => {
    const window = BrowserWindow.getAllWindows()[0];
    await new Promise((resolve, reject) => {
      const event = value ? "enter-full-screen" : "leave-full-screen";
      const timer = setTimeout(() => reject(new Error(`Native ${event} timed out`)), 15000);
      window.once(event, () => { clearTimeout(timer); resolve(); }); window.setFullScreen(value);
    });
  }, value);
}
try {
  page = await client.firstWindow(); page.on("pageerror", error => errors.push(error.message));
  await page.locator(".app-shell").waitFor();
  const initial = await snapshot("created"); assert.ok(initial.bounds.y >= initial.display.workArea.y); reports.push(initial);
  await client.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.show(); window.focus(); });
  await assertUnchanged(initial, "shown");
  // Use an explicitly chosen ordinary window for the following cases. Small
  // CI desktops can make the initial fit occupy the entire work area.
  await client.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows()[0], area = screen.getDisplayMatching(window.getBounds()).workArea;
    const width = Math.min(1200, area.width - 80), height = Math.min(800, area.height - 80);
    window.setMinimumSize(Math.min(1040, width), Math.min(680, height));
    window.setBounds({ x: area.x + 40, y: area.y + 40, width, height });
  });
  await settle(); const normal = await snapshot("user-chosen-normal-window"); assert.equal(normal.maximized, false); reports.push(normal);
  await page.evaluate(() => window.chengjing.app.setLanguage("en"));
  await page.evaluate(() => window.chengjing.quickCapture.showMain()); await settle();
  await client.evaluate(({ app }) => {
    const original = app.setActivationPolicy.bind(app); global.__windowQaPolicyWrites = [];
    app.setActivationPolicy = policy => { global.__windowQaPolicyWrites.push(policy); return original(policy); };
  });
  await page.evaluate(() => window.chengjing.quickCapture.showMain()); await assertUnchanged(normal, "normal-return-no-policy-reset");
  assert.deepEqual(await client.evaluate(() => global.__windowQaPolicyWrites), []);

  await client.evaluate(({ BrowserWindow, app }) => { const window = BrowserWindow.getAllWindows()[0]; window.blur(); app.emit("did-become-active"); window.focus(); });
  await assertUnchanged(normal, "blur-focus-active");
  await client.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  await page.evaluate(() => window.chengjing.quickCapture.showMain()); await assertUnchanged(normal, "hidden-shown");
  await client.evaluate(({ BrowserWindow, app }) => { BrowserWindow.getAllWindows()[0].hide(); app.setActivationPolicy("accessory"); app.dock.hide(); });
  await page.evaluate(() => window.chengjing.quickCapture.showMain()); await assertUnchanged(normal, "accessory-return");
  await client.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  await page.waitForTimeout(500); await page.evaluate(() => window.chengjing.quickCapture.showMain());
  const restored = await assertUnchanged(normal, "minimized-restored"); assert.equal(restored.minimized, false);

  await client.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize()); await settle();
  const fill = await snapshot("native-fill"); assert.equal(fill.maximized, true); assert.ok(fill.bounds.y >= fill.display.workArea.y); reports.push(fill);
  await client.evaluate(({ BrowserWindow, app }) => { app.emit("did-become-active"); BrowserWindow.getAllWindows()[0].focus(); });
  await assertUnchanged(fill, "fill-active");
  await client.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize()); await assertUnchanged(normal, "unfilled");

  if (!process.argv.includes("--skip-fullscreen")) {
  await fullscreen(true); await settle();
  const full = await snapshot("native-fullscreen"); assert.equal(full.fullscreen, true); reports.push(full);
  await client.evaluate(({ BrowserWindow, app, screen }) => {
    app.emit("did-become-active"); BrowserWindow.getAllWindows()[0].focus(); screen.emit("display-metrics-changed", {}, screen.getPrimaryDisplay(), ["workArea"]);
  });
  await assertUnchanged(full, "fullscreen-active-metrics");
  await fullscreen(false); await assertUnchanged(normal, "leave-fullscreen");
  } else reports.push({ label: "native-fullscreen-not-tested", reason: "interactive-session-unavailable; verified separately with geometry and lifecycle tests" });

  // Simulated screen work-area change, applied to an actual native window. This
  // verifies event recovery without changing the user's real display settings.
  const injected = await client.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows()[0], bounds = window.getBounds();
    const original = screen.getAllDisplays.bind(screen); global.__windowQaOriginalDisplays = original;
    const currentId = screen.getDisplayMatching(bounds).id;
    const top = bounds.y + 40;
    screen.getAllDisplays = () => original().map(display => display.id === currentId ? { ...display, workArea: { ...display.workArea, y: top, height: display.workArea.y + display.workArea.height - top } } : display);
    screen.emit("display-metrics-changed", {}, screen.getDisplayMatching(bounds), ["workArea"]);
    return { top, before: bounds };
  });
  await settle(); const recovered = await snapshot("simulated-work-area-recovery");
  assert.equal(recovered.bounds.y, injected.top); assert.equal(recovered.bounds.x, injected.before.x); assert.equal(recovered.bounds.width, injected.before.width); assert.equal(recovered.bounds.height, injected.before.height); reports.push(recovered);
  await assertUnchanged(recovered, "corrected-window-remains-stable");
  await client.evaluate(({ BrowserWindow, screen }, bounds) => { screen.getAllDisplays = global.__windowQaOriginalDisplays; delete global.__windowQaOriginalDisplays; BrowserWindow.getAllWindows()[0].setBounds(bounds); }, normal.bounds);
  await assertUnchanged(normal, "display-fixture-restored");

  await client.evaluate(({ powerMonitor }) => { powerMonitor.emit("suspend"); powerMonitor.emit("lock-screen"); powerMonitor.emit("resume"); powerMonitor.emit("unlock-screen"); });
  await assertUnchanged(normal, "simulated-resume-unlock");
  await page.screenshot({ path: path.join(output, "normal-window.png") });
  const renderer = await page.evaluate(() => ({ fullscreen: document.documentElement.dataset.windowFullscreen,
    topbar: document.querySelector(".topbar").getBoundingClientRect().toJSON(), brand: document.querySelector(".brand-row").getBoundingClientRect().toJSON() }));
  assert.equal(renderer.fullscreen, "false"); assert.equal(renderer.topbar.top, 0); assert.equal(renderer.brand.top, 0); reports.push({ label: "content-layout", ...renderer });
  if (!process.argv.includes("--skip-idle")) { await page.waitForTimeout(45000); await client.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus()); await assertUnchanged(normal, "45-second-idle-return"); }

  const menuState = await client.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items || []).find(item => item.label === "Record window placement diagnostics");
    const windowMenu = Menu.getApplicationMenu().items.find(item => item.role === "windowmenu");
    return { checked: item?.checked, type: item?.type, nativeWindowMenuRetained: Boolean(windowMenu) };
  });
  assert.equal(menuState.checked, true); assert.equal(menuState.type, "checkbox"); assert.equal(menuState.nativeWindowMenuRetained, true);
  await client.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items || []).find(item => item.label === "Record window placement diagnostics");
    item.click(item);
  });
  await settle();
  assert.equal(JSON.parse(await fs.readFile(path.join(profile, "window-diagnostics.json"), "utf8")).enabled, false);
  const logs = (await fs.readFile(path.join(profile, "window-diagnostics", "placement.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(logs.filter(item => item.event === "corrected").length, 1, "Only the intentionally invalid work area should trigger a correction");
  assert.ok(logs.some(item => item.renderer?.topbar)); assert.deepEqual(errors, []);
  reports.push({ label: "diagnostics", ...menuState, disabledSuccessfully: true, corrections: 1, records: logs.length });
  console.log(JSON.stringify({ passed: true, cases: reports.length, reports, errors, physicalSuspendUnlockTested: false, physicalDisplayHotplugTested: false }, null, 2));
  await fs.writeFile(path.join(output, "result.json"), JSON.stringify({ passed: true, reports, errors }, null, 2));
} catch (error) {
  process.exitCode = 1; console.error(error);
  reports.push(await snapshot("failure-state").catch(() => ({ label: "failure-state-unavailable" })));
  await fs.copyFile(path.join(profile, "window-diagnostics", "placement.jsonl"), path.join(output, "failure-placement.jsonl")).catch(() => {});
  await page?.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  await fs.writeFile(path.join(output, "result.json"), JSON.stringify({ passed: false, reports, errors, error: error.stack }, null, 2));
} finally { await client.close(); await fs.rm(profile, { recursive: true, force: true }); }
