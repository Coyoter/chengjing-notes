import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import electronPath from "electron";
import { chromium } from "playwright";

function freePort() { return new Promise((resolve, reject) => { const server = net.createServer(); server.on("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(address.port)); }); }); }

const port = await freePort();
const userData = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-menu-bar-"));
const packagedExecutable = process.env.CHENGJING_PACKAGED_APP || "";
const executable = packagedExecutable || electronPath;
const args = packagedExecutable ? ["--background", `--remote-debugging-port=${port}`] : [".", "--dev", "--background", `--remote-debugging-port=${port}`];
const child = spawn(executable, args, { cwd: process.cwd(), env: { ...process.env, CHENGJING_SMOKE_USER_DATA: userData }, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); }); child.stderr.on("data", (chunk) => { output += chunk.toString(); });
let browser;
try {
  const endpoint = `http://127.0.0.1:${port}`;
  const started = Date.now();
  while (true) { try { if ((await fetch(`${endpoint}/json/version`)).ok) break; } catch {} if (Date.now() - started > 15_000) throw new Error(`選單列模式啟動逾時：${output.slice(-1000)}`); await new Promise((resolve) => setTimeout(resolve, 150)); }
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  let pages = context.pages();
  const quick = pages.find((page) => page.url().includes("quick-capture")) || await context.waitForEvent("page");
  await quick.getByPlaceholder("此刻腦中閃過什麼？").waitFor();
  pages = context.pages();
  const backgroundStartsWithoutMain = pages.every((page) => page.url().includes("quick-capture"));
  let initialSettings = await quick.evaluate(() => window.chengjing.quickCapture.getSettings());
  for (let attempt = 0; attempt < 20 && !(initialSettings.trayBounds?.width > 0 && initialSettings.trayBounds?.height > 0); attempt += 1) {
    await quick.waitForTimeout(100);
    initialSettings = await quick.evaluate(() => window.chengjing.quickCapture.getSettings());
  }
  const trayAndShortcutReady = initialSettings.trayReady && !initialSettings.trayImageEmpty
    && initialSettings.trayImageSize?.width === 16 && initialSettings.trayImageSize?.height === 16
    && initialSettings.trayBounds?.width > 0 && initialSettings.trayBounds?.height > 0
    && initialSettings.windowReady && initialSettings.registered && initialSettings.shortcut === initialSettings.defaultShortcut;
  const nativeHotkeyBackend = initialSettings.shortcutBackend === "native-appkit" && initialSettings.inputBackend === "native-nstextview";
  const quickWindowPrewarmed = initialSettings.windowVisible === false
    && initialSettings.windowWarm === true && initialSettings.windowOpacity === 0 && initialSettings.windowFocused === false;
  const shown = await quick.evaluate(() => window.chengjing.quickCapture.show());
  await quick.waitForTimeout(80);
  const shownSettings = await quick.evaluate(() => window.chengjing.quickCapture.getSettings());
  const quickVisual = await quick.evaluate(() => {
    const card = document.querySelector(".quick-capture-card").getBoundingClientRect();
    const style = getComputedStyle(document.querySelector(".quick-capture-card"));
    return { innerWidth, innerHeight, card: { x: card.x, y: card.y, width: card.width, height: card.height, right: card.right, bottom: card.bottom }, boxShadow: style.boxShadow };
  });
  const quickPanelBehavior = shownSettings.windowFocused && shownSettings.windowAlwaysOnTop && shownSettings.windowVisibleOnAllWorkspaces
    && shownSettings.windowHasShadow === true && shownSettings.windowOpacity === 1
    && shownSettings.windowBounds?.width === 554 && shownSettings.windowBounds?.height === 164
    && shownSettings.imeReady === true && shownSettings.inputBackend === "native-nstextview";
  const quickShadowHasSafeMargin = shownSettings.inputBackend === "native-nstextview"
    || (quickVisual.innerWidth === 618 && quickVisual.innerHeight === 228
      && quickVisual.card.x === 32 && quickVisual.card.y === 32 && quickVisual.card.width === 554 && quickVisual.card.height === 164
      && quickVisual.boxShadow !== "none");
  const warmLatency = await quick.evaluate(async () => {
    await window.chengjing.quickCapture.hide();
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const startedAt = performance.now();
    const result = await window.chengjing.quickCapture.show();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { ipcMs: result.latencyMs, paintedMs: performance.now() - startedAt, focused: document.hasFocus(), visibility: document.visibilityState };
  });
  const quickCaptureInstant = warmLatency.ipcMs < 60 && warmLatency.paintedMs < 200
    && (shownSettings.inputBackend === "native-nstextview" || (warmLatency.focused && warmLatency.visibility === "visible"));
  await quick.getByPlaceholder("此刻腦中閃過什麼？").fill("背景選單列真實測試");
  await quick.getByPlaceholder("此刻腦中閃過什麼？").press("Enter");
  await quick.waitForTimeout(500);
  const saved = await quick.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open("chengjing"); request.onerror = () => reject(request.error); request.onsuccess = () => { const query = request.result.transaction("fragments", "readonly").objectStore("fragments").getAll(); query.onsuccess = () => resolve(query.result.some((item) => item.text === "背景選單列真實測試")); }; }));
  const afterSave = await quick.evaluate(() => window.chengjing.quickCapture.getSettings());
  const custom = await quick.evaluate(() => window.chengjing.quickCapture.setShortcut("CommandOrControl+Alt+Shift+9"));
  const restored = await quick.evaluate((value) => window.chengjing.quickCapture.setShortcut(value), initialSettings.defaultShortcut);
  await quick.evaluate(() => window.chengjing.clipboard.write({ text: "剪貼簿真實測試", payload: { kind: "fragment-ref", fragmentId: "qa" } }));
  const clipboard = await quick.evaluate(() => window.chengjing.clipboard.read());
  await quick.evaluate(() => window.chengjing.quickCapture.showMain());
  const main = context.pages().find((page) => !page.url().includes("quick-capture")) || await context.waitForEvent("page");
  await main.getByRole("button", { name: "今日", exact: true }).waitFor();
  const mainCanOpenOnDemand = true;
  const nativeMenuSnapshot = await main.evaluate(() => window.chengjing.app.getMenuSnapshot());
  const nativeCommandWMenu = nativeMenuSnapshot.find((item) => item.label === "檔案")?.submenu.some((item) => item.label === "關閉視窗") === true;
  const readWindowedMetrics = () => main.evaluate(() => {
    const toRect = (rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom });
    const brand = document.querySelector(".brand-row").getBoundingClientRect();
    const top = document.querySelector(".topbar").getBoundingClientRect();
    const logo = document.querySelector(".brand-row > img").getBoundingClientRect();
    const sidebar = document.querySelector(".sidebar").getBoundingClientRect();
    const safeArea = navigator.windowControlsOverlay?.getTitlebarAreaRect?.();
    return { brand: toRect(brand), top: toRect(top), logo: toRect(logo), sidebar: toRect(sidebar), safeArea: safeArea ? toRect(safeArea) : null, innerWidth, innerHeight };
  });
  const windowedMetrics = await readWindowedMetrics();
  const nativeTopAlignment = Boolean(windowedMetrics.safeArea)
    && Math.abs(windowedMetrics.brand.height - windowedMetrics.top.height) <= 0.5
    && Math.abs(windowedMetrics.brand.y - windowedMetrics.top.y) <= 0.5
    && windowedMetrics.logo.x >= windowedMetrics.safeArea.x + 10
    && windowedMetrics.logo.right <= windowedMetrics.safeArea.x + windowedMetrics.safeArea.width;
  await main.getByRole("button", { name: "收合側欄", exact: true }).click();
  await main.waitForTimeout(280);
  const collapsedMetrics = await readWindowedMetrics();
  const collapsedLogoAvoidsTrafficLights = Boolean(collapsedMetrics.safeArea)
    && collapsedMetrics.logo.x >= collapsedMetrics.safeArea.x + 10
    && collapsedMetrics.logo.right <= collapsedMetrics.sidebar.right - 8
    && collapsedMetrics.sidebar.width >= collapsedMetrics.safeArea.x + collapsedMetrics.logo.width + 18;
  await main.getByRole("button", { name: "展開側欄", exact: true }).click();
  await main.waitForTimeout(280);
  const diagnosticsDir = path.resolve("qa-artifacts/menu-bar");
  await fs.mkdir(diagnosticsDir, { recursive: true });
  await main.getByRole("button", { name: "設定", exact: true }).click();
  const quickCaptureSettings = main.locator("#quick-capture-settings");
  await quickCaptureSettings.scrollIntoViewIfNeeded();
  const readSettingsSurface = () => main.evaluate(() => {
    const toRect = (rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom });
    const page = document.querySelector(".settings-page");
    const section = document.querySelector("#quick-capture-settings");
    const workspace = document.querySelector(".workspace");
    const style = getComputedStyle(page);
    return {
      page: toRect(page.getBoundingClientRect()),
      section: toRect(section.getBoundingClientRect()),
      scrollTop: page.scrollTop,
      scrollHeight: page.scrollHeight,
      clientHeight: page.clientHeight,
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      transform: style.transform,
      workspaceChildren: workspace?.children.length || 0,
      workspaceScrollTop: workspace?.scrollTop || 0,
      centerElement: document.elementFromPoint(innerWidth * 0.58, innerHeight * 0.55)?.className || "",
    };
  });
  const settingsBeforeToggle = await readSettingsSurface();
  await main.screenshot({ path: path.join(diagnosticsDir, "before-login-toggle.png") });
  const beforeLoginToggle = await main.evaluate(async () => ({ state: await window.chengjing.app.getWindowState(), innerWidth, innerHeight }));
  const requestedLoginValue = !initialSettings.openAtLogin;
  const loginCheckbox = quickCaptureSettings.locator(".quick-capture-login-row input");
  await loginCheckbox.click({ force: true });
  await main.waitForTimeout(650);
  const loginToggle = await main.evaluate(() => window.chengjing.quickCapture.getSettings());
  const afterLoginToggle = await main.evaluate(async () => ({ state: await window.chengjing.app.getWindowState(), innerWidth, innerHeight }));
  const settingsAfterToggle = await readSettingsSurface();
  await main.screenshot({ path: path.join(diagnosticsDir, "after-login-toggle.png") });
  await main.evaluate((enabled) => window.chengjing.quickCapture.setOpenAtLogin(enabled), initialSettings.openAtLogin);
  const sameBounds = JSON.stringify(beforeLoginToggle.state.bounds) === JSON.stringify(afterLoginToggle.state.bounds);
  const loginToggleKeepsWindowWhole = sameBounds && beforeLoginToggle.innerWidth === afterLoginToggle.innerWidth && beforeLoginToggle.innerHeight === afterLoginToggle.innerHeight;
  const loginSettingResponds = loginToggle.openAtLogin === requestedLoginValue || loginToggle.status === "requires-approval";
  const loginToggleKeepsSettingsVisible = settingsAfterToggle.page.y >= 67 && settingsAfterToggle.workspaceScrollTop === 0
    && settingsAfterToggle.section.width > 0 && settingsAfterToggle.section.height > 0
    && settingsAfterToggle.section.bottom > settingsAfterToggle.page.y && settingsAfterToggle.section.y < settingsAfterToggle.page.bottom
    && settingsAfterToggle.display !== "none" && settingsAfterToggle.visibility !== "hidden" && settingsAfterToggle.opacity !== "0";
  await main.bringToFront();
  await main.keyboard.press("Meta+w");
  await main.waitForTimeout(350);
  const commandWState = await quick.evaluate(() => window.chengjing.app.getWindowState());
  const commandWHidesMainWithoutDestroying = commandWState.exists === true && commandWState.visible === false && !main.isClosed();
  const hiddenMainLatency = await quick.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const startedAt = performance.now();
    const result = await window.chengjing.quickCapture.show();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const paintedMs = performance.now() - startedAt;
    await window.chengjing.quickCapture.hide();
    return { ipcMs: result.latencyMs, paintedMs, focused: document.hasFocus(), visibility: document.visibilityState };
  });
  const hiddenMainQuickInstant = hiddenMainLatency.ipcMs < 60 && hiddenMainLatency.paintedMs < 200;
  await quick.evaluate(() => window.chengjing.quickCapture.showMain());
  await main.waitForTimeout(350);
  const restoredMainState = await quick.evaluate(() => window.chengjing.app.getWindowState());
  const hiddenMainRestores = restoredMainState.exists === true && restoredMainState.visible === true;
  const quickWindowReturnsToWarmStandby = afterSave.windowVisible === false && afterSave.windowWarm === true && afterSave.windowOpacity === 0;
  const report = { packagedApp: Boolean(packagedExecutable), backgroundStartsWithoutMain, trayAndShortcutReady, nativeHotkeyBackend, quickWindowPrewarmed, trayDetails: initialSettings, shownSettings, quickVisual, warmLatency, hiddenMainLatency, quickWindowShows: shown.shown, quickPanelBehavior, imeForegroundReady: shownSettings.imeReady === true && shownSettings.inputBackend === "native-nstextview", quickShadowHasSafeMargin, quickCaptureInstant, quickCaptureSaved: saved, quickWindowHidesAfterSave: afterSave.windowVisible === false, quickWindowReturnsToWarmStandby, customShortcutWorks: custom.registered && restored.registered, clipboardBridgeWorks: clipboard.text === "剪貼簿真實測試" && clipboard.payload?.kind === "fragment-ref", mainCanOpenOnDemand, nativeCommandWMenu, commandWHidesMainWithoutDestroying, hiddenMainQuickInstant, hiddenMainRestores, nativeTopAlignment, collapsedLogoAvoidsTrafficLights, loginToggleKeepsWindowWhole, loginSettingResponds, loginToggleKeepsSettingsVisible, settingsBeforeToggle, settingsAfterToggle, beforeLoginToggle, afterLoginToggle, commandWState, restoredMainState, windowedMetrics, collapsedMetrics, errors: output.includes("UnhandledPromiseRejection") ? [output.slice(-800)] : [] };
  console.log(JSON.stringify(report, null, 2));
  if ([backgroundStartsWithoutMain, trayAndShortcutReady, nativeHotkeyBackend, quickWindowPrewarmed, shown.shown, quickPanelBehavior, quickShadowHasSafeMargin, quickCaptureInstant, saved, afterSave.windowVisible === false, quickWindowReturnsToWarmStandby, custom.registered && restored.registered, clipboard.text === "剪貼簿真實測試" && clipboard.payload?.kind === "fragment-ref", mainCanOpenOnDemand, nativeCommandWMenu, commandWHidesMainWithoutDestroying, hiddenMainQuickInstant, hiddenMainRestores, nativeTopAlignment, collapsedLogoAvoidsTrafficLights, loginToggleKeepsWindowWhole, loginSettingResponds, loginToggleKeepsSettingsVisible].some((value) => value !== true) || report.errors.length) process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (!child.killed) child.kill("SIGTERM");
  if (child.exitCode === null && child.signalCode === null) await new Promise((resolve) => child.once("exit", resolve));
  await fs.rm(userData, { recursive: true, force: true }).catch(() => {});
}
