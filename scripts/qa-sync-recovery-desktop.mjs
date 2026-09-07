import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { _electron } from "playwright";

const require = createRequire(import.meta.url);
const root = process.cwd();
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-recovery-desktop-qa-"));
await fs.writeFile(path.join(profile, "QA_ONLY"), "isolated-recovery-ui-test", { mode: 0o600 });
const output = await fs.mkdtemp(path.join(profile, "screenshots-"));
const report = { profile, output, cases: [], failures: [], pageErrors: [], consoleErrors: [] };
const assets = await fs.readdir(path.join(root, "dist/assets"));
function assetUrl(prefix) {
  const matches = assets.filter(name => name.startsWith(prefix + "-") && name.endsWith(".js"));
  assert.equal(matches.length, 1, `Expected one built ${prefix} module`);
  return pathToFileURL(path.join(root, "dist/assets", matches[0])).href;
}
const storeUrl = assetUrl("store");
const dbUrl = assetUrl("db");
let electronApp, page, processLog = "";

try {
  const env = { ...process.env, CHENGJING_RECOVERY_QA_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  electronApp = await _electron.launch({
    executablePath: require("electron"),
    args: [path.join(root, "scripts/qa-sync-recovery-desktop-main.cjs")],
    cwd: root, env, timeout: 30_000, locale: "zh-TW", colorScheme: "dark",
  });
  const child = electronApp.process();
  child.stdout?.on("data", chunk => { processLog += chunk; });
  child.stderr?.on("data", chunk => { processLog += chunk; });
  page = await electronApp.firstWindow();
  page.setDefaultTimeout(15_000);
  page.on("pageerror", error => report.pageErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("dialog", async dialog => {
    report.lastDialog = dialog.message();
    await dialog.dismiss();
  });

  await page.context().addInitScript(() => {
    if (location.protocol !== "file:") return;
    localStorage.setItem("chengjing-ui", JSON.stringify({
      state: {
        language: "zh-TW", theme: "dark", fontScale: 1,
        sidebarCollapsed: false, view: "settings", rightPanel: "none",
      },
      version: 0,
    }));
    localStorage.setItem("chengjing-sync-enabled", "true");
    localStorage.setItem("chengjing-sync-tracking", "true");

    const packets = new Map();
    const calls = { status: 0, create: 0, download: 0, legacyWrite: 0, backupWrite: 0 };
    let missingYesterday = false;
    const point = offset => {
      const date = new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
      return {
        id: `qa-snapshot-${date}`, day: date,
        snapshotAt: Date.parse(`${date}T00:00:00Z`),
        size: 512, contentHash: "a".repeat(64),
      };
    };
    const status = () => ({
      dayBasis: "UTC", today: point(0),
      yesterday: missingYesterday ? null : point(1), dayBeforeYesterday: point(2),
    });
    const local = {
      enabled: false, intervalDays: 1, retentionCount: 10,
      directory: "/QA-only/澄境本機備份", lastAttemptAt: 0,
      lastSuccessAt: 0, lastFilePath: "", lastError: "",
    };
    const cloud = {
      configured: true, connected: true, current: null, previous: null,
      needsDecision: false,
      settings: {
        enabled: false, intervalMinutes: 30, accountName: "UI QA",
        accountEmail: "qa@example.invalid", deviceId: "qa-isolated-device",
        lastAttemptAt: 0, lastSuccessAt: 0, lastContentHash: "",
        lastKnownManifestId: "", lastError: "", conflict: false,
      },
    };
    const blocked = async () => { throw new Error("qa-action-not-permitted"); };
    const unsubscribe = () => () => {};

    window.__syncRecoveryQa = {
      calls: () => ({ ...calls }),
      missingYesterday: value => { missingYesterday = value; },
    };
    window.chengjing = {
      platform: "darwin",
      version: "0.10.1",
      app: {
        getPreferredLanguage: async () => ({ language: "zh-TW" }),
        setLanguage: async language => ({ language }),
        getWindowState: async () => ({ fullscreen: false, maximized: false }),
        onWindowState: unsubscribe,
        getSystemVersion: async () => ({ platform: "darwin", version: "27.0.0", arch: "arm64" }),
        closeMain: blocked, quit: blocked,
      },
      onShortcut: unsubscribe,
      ai: {
        keyStatus: async () => ({ configured: false, encrypted: true, storage: "qa" }),
        providerSettings: async () => ({ selectedProfileId: "", profiles: [] }),
        listModels: async () => [],
      },
      updates: {
        check: async () => ({
          status: "current", currentVersion: "0.10.1", latestVersion: "0.10.1",
          releaseName: "QA", notes: "", assets: [],
        }),
        download: blocked, onProgress: unsubscribe,
      },
      attachments: {
        stats: async () => ({ bytes: 0, count: 0 }),
        pendingPaths: async () => [],
        sweepPending: async () => ({ removed: 0 }),
        importData: blocked, importPath: blocked, restoreFromBackup: blocked,
        readData: blocked, remove: blocked,
      },
      backups: {
        getSettings: async () => ({ ...local }),
        chooseFolder: blocked, updateSettings: blocked,
        write: async () => { calls.backupWrite++; return blocked(); },
        writeSafety: blocked,
      },
      cloudBackups: {
        getLocalStatus: async () => cloud,
        getStatus: async () => cloud,
        connect: blocked, disconnect: blocked, updateSettings: blocked,
        write: async () => { calls.legacyWrite++; return blocked(); },
        download: blocked, completeRestore: blocked,
        cancelRestore: async () => ({ cleaned: true }),
      },
      sync: {
        list: async () => ({ files: [...packets.keys()].map(id => ({ id, name: id })) }),
        get: async id => packets.get(id),
        put: async (id, data) => { packets.set(id, data); },
        uploadAsset: blocked, downloadAsset: blocked,
      },
      syncRecovery: {
        getStatus: async () => { calls.status++; return status(); },
        setEnabled: async enabled => ({ enabled }),
        createDaily: async () => { calls.create++; return blocked(); },
        download: async () => { calls.download++; return blocked(); },
        releaseDownload: async () => ({ cleaned: true }),
      },
    };
  });

  await page.goto(pathToFileURL(path.join(root, "dist/index.html")).href);
  await page.locator("#sync-settings").waitFor({ state: "visible", timeout: 30_000 });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.platform), "darwin");

  await page.evaluate(async url => {
    const module = await import(url);
    const database = Object.values(module).find(value =>
      value && typeof value.table === "function" && typeof value.transaction === "function");
    if (!database) throw new Error("Built database export not found");
    await database.table("syncRecords").put({
      id: "fragments:qa-history",
      heads: [{
        id: "qa-current", table: "fragments", key: "qa-history",
        clock: { qa: 2 }, changedAt: 2,
        value: { id: "qa-history", text: "桌面排版驗收用內容", updatedAt: 2 },
      }],
      recovery: [{
        id: "qa-earlier", table: "fragments", key: "qa-history",
        clock: { qa: 1 }, changedAt: 1,
        value: { id: "qa-history", text: "這是隔離測試中的較早版本，不是使用者筆記。", updatedAt: 1 },
      }],
    });
  }, dbUrl);

  const card = page.locator("#sync-settings");
  const disclosure = card.locator(":scope > .sync-recovery");
  const summary = disclosure.locator(":scope > summary");
  assert.equal(await disclosure.evaluate(element => element.open), false);
  assert.equal(await page.locator(".backup-method-grid > .backup-method-card").count(), 2);
  assert.equal(await page.locator("#backup-settings > .backup-import-tools").count(), 0);
  assert.equal(await disclosure.locator(".backup-import-tools").count(), 1);

  async function configure({ width, theme, font, language = "zh-TW" }) {
    await electronApp.evaluate(({ BrowserWindow }, width) => {
      BrowserWindow.getAllWindows()[0].setContentSize(width, 980);
    }, width);
    await page.waitForFunction(width => innerWidth === width, width);
    await page.evaluate(async ({ url, theme, font, language }) => {
      const module = await import(url);
      const store = Object.values(module).find(value => typeof value?.getState === "function"
        && typeof value.getState()?.setFontScale === "function");
      if (!store) throw new Error("Built UI store export not found");
      const state = store.getState();
      state.setTheme(theme);
      state.setFontScale(font);
      state.setLanguage(language);
      state.setView("settings");
    }, { url: storeUrl, theme, font, language });
    await page.waitForFunction(({ theme, font, language }) =>
      document.documentElement.dataset.theme === theme
      && document.documentElement.dataset.fontScale === String(Math.round(font * 100))
      && document.documentElement.dataset.language === language,
    { theme, font, language });
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.waitForTimeout(160);
  }

  async function measure(label) {
    const result = await card.evaluate(card => {
      const failures = [];
      const rect = element => element.getBoundingClientRect();
      const visible = element => element.checkVisibility();
      const outer = rect(card);
      const recovery = card.querySelector(":scope > .sync-recovery");
      const recoveryRect = rect(recovery);
      const inset = {
        left: recoveryRect.left - outer.left,
        right: outer.right - recoveryRect.right,
      };
      if (inset.left < 15 || inset.right < 15) failures.push("recovery-divider-too-close-to-card");
      if (card.scrollWidth > card.clientWidth + 1) failures.push("card-horizontal-overflow");

      const gaps = [];
      for (const summary of card.querySelectorAll(
        ".sync-recovery > summary, .sync-conflict-review > summary, .backup-import-tools > summary",
      )) {
        if (!visible(summary)) continue;
        const children = [...summary.children];
        if (children.length !== 3) { failures.push("summary-structure"); continue; }
        const [icon, text, arrow] = children.map(rect);
        const box = rect(summary);
        const gap = {
          iconText: text.left - icon.right,
          textArrow: arrow.left - text.right,
          arrowCard: outer.right - arrow.right,
        };
        gaps.push(gap);
        if (gap.iconText < 8 || gap.textArrow < 8 || gap.arrowCard < 15) {
          failures.push("summary-icon-text-arrow-collision");
        }
        for (const child of children) {
          const childRect = rect(child);
          if (childRect.top < box.top - 1 || childRect.bottom > box.bottom + 1) {
            failures.push("summary-vertical-clipping");
          }
        }
      }
      for (const element of card.querySelectorAll(
        ".sync-recovery-label, .sync-recovery-point-copy, .sync-recovery-description,"
        + " .sync-recovery-date-note, .sync-state > div, header > span",
      )) {
        if (visible(element) && element.clientWidth > 0
          && element.scrollWidth > element.clientWidth + 1) failures.push("text-horizontal-clipping");
      }
      for (const point of card.querySelectorAll(".sync-recovery-point")) {
        if (!visible(point)) continue;
        const box = rect(point);
        for (const child of point.children) {
          const childRect = rect(child);
          if (childRect.left < box.left - 1 || childRect.right > box.right + 1
            || childRect.top < box.top - 1 || childRect.bottom > box.bottom + 1) {
            failures.push("point-control-outside-row");
          }
        }
      }
      return {
        viewport: { width: innerWidth, height: innerHeight },
        card: { width: outer.width, height: outer.height },
        inset, gaps, failures: [...new Set(failures)],
      };
    });
    report.cases.push({ label, ...result });
    if (result.failures.length) report.failures.push({ label, errors: result.failures });
    await card.screenshot({
      path: path.join(output, `${label}.png`), animations: "disabled",
    });
    console.log(`${result.failures.length ? "FAIL" : "PASS"} ${label} | card ${Math.round(result.card.width)}px | inset ${result.inset.left}/${result.inset.right}px`);
  }

  const cases = [
    { width: 1440, theme: "dark", font: 1 },
    { width: 1440, theme: "light", font: 1 },
    { width: 1440, theme: "dark", font: 1.2 },
    { width: 1440, theme: "light", font: 1.2 },
    { width: 1440, theme: "ink", font: 1.2 },
    { width: 1100, theme: "dark", font: 1.2 },
    { width: 1100, theme: "light", font: 1.2 },
    { width: 1100, theme: "ink", font: 1.2 },
    { width: 900, theme: "dark", font: 1.2 },
    { width: 900, theme: "light", font: 1.2 },
    { width: 800, theme: "dark", font: 1.2 },
    { width: 1100, theme: "dark", font: 1.2, language: "en" },
  ];
  for (let index = 0; index < cases.length; index++) {
    const item = cases[index];
    await configure(item);
    if (await disclosure.evaluate(element => element.open)) await summary.click();
    const label = `${item.width}-${item.theme}-${Math.round(item.font * 100)}-${item.language || "zh-TW"}`;
    await measure(label + "-collapsed");
    if (index % 2) { await summary.focus(); await summary.press("Enter"); }
    else await summary.click();
    await page.waitForFunction(() => {
      const buttons = [...document.querySelectorAll("#sync-settings .sync-recovery-point > button")];
      return buttons.length === 2 && buttons.every(button => !button.disabled);
    });
    assert.equal(await disclosure.evaluate(element => element.open), true);
    await measure(label + "-expanded");
  }

  await configure({ width: 1440, theme: "dark", font: 1.2 });
  report.lastDialog = "";
  await card.locator(".sync-recovery-point > button").first().click();
  await page.waitForFunction(() => document.querySelector(".sync-recovery-panel"));
  assert.ok(report.lastDialog.includes("新增的內容也會移除"), "Restore confirmation must explain removal");
  assert.ok(report.lastDialog.includes("本機安全副本"), "Restore confirmation must explain safety copy");
  assert.equal((await page.evaluate(() => window.__syncRecoveryQa.calls())).download, 0);

  const callsBeforeNested = await page.evaluate(() => window.__syncRecoveryQa.calls().status);
  await disclosure.locator(".sync-conflict-review > summary").click();
  await disclosure.locator(".sync-conflict > summary").first().click();
  await disclosure.locator(".backup-import-tools > summary").click();
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__syncRecoveryQa.calls().status), callsBeforeNested,
    "Nested disclosure must not refresh the entire recovery panel");
  await measure("1440-dark-120-all-recovery-tools");

  await page.evaluate(() => window.__syncRecoveryQa.missingYesterday(true));
  await card.locator(".sync-recovery-refresh").click();
  await page.waitForFunction(() => {
    const buttons = [...document.querySelectorAll("#sync-settings .sync-recovery-point > button")];
    return buttons.length === 2 && buttons[0].disabled && !buttons[1].disabled;
  });
  assert.ok((await card.innerText()).includes("這一天沒有可用的復原點"));

  await card.locator(".sync-pause-button").click();
  await page.waitForFunction(() => localStorage.getItem("chengjing-sync-enabled") === null);
  assert.equal(await card.locator(".sync-recovery-point > button:enabled").count(), 0);
  report.calls = await page.evaluate(() => window.__syncRecoveryQa.calls());
  assert.equal(report.calls.create, 0);
  assert.equal(report.calls.download, 0);
  assert.equal(report.calls.legacyWrite, 0);
  assert.equal(report.calls.backupWrite, 0);
  report.blockedOrigins = await electronApp.evaluate(() =>
    [...new Set(globalThis.__recoveryQaBlockedOrigins)]);
  if (report.pageErrors.length) report.failures.push({ errors: report.pageErrors });
  report.passed = report.failures.length === 0;
} catch (error) {
  report.passed = false;
  report.failures.push({ error: error.message, stack: error.stack });
  if (page) {
    report.visibleText = await page.locator("body").innerText().catch(() => "");
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  }
  console.error(error);
} finally {
  if (electronApp) {
    try { await electronApp.close(); }
    catch {
      const child = electronApp.process();
      if (child.exitCode === null) child.kill("SIGTERM");
    }
  }
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(output, "electron.log"), processLog);
  console.log("\nSCREENSHOTS: " + output);
  console.log("REPORT: " + path.join(output, "report.json"));
  console.log("MEASURED_CASES: " + report.cases.length);
  console.log("PAGE_ERRORS: " + JSON.stringify(report.pageErrors));
  console.log("FAILURES: " + JSON.stringify(report.failures, null, 2));
  if (report.calls) console.log("MOCK_SERVICE_CALLS: " + JSON.stringify(report.calls));
  console.log(report.passed ? "DESKTOP_ELECTRON_VISUAL_QA_OK" : "DESKTOP_ELECTRON_VISUAL_QA_FAILED");
  if (!report.passed) process.exitCode = 1;
}
