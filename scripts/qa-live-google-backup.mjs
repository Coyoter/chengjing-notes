import { _electron as electron } from "playwright";
import electronPath from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const projectRoot = path.resolve(".");
const packagedExecutable = String(process.env.CHENGJING_PACKAGED_APP || "");
const userData = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-live-google-backup-"));
await fs.writeFile(path.join(userData, "google-cloud-backup-settings.json"), JSON.stringify({
  enabled: false,
  intervalMinutes: 30,
  accountName: "",
  accountEmail: "",
  deviceId: "qa-live-google-backup-device-2026",
  lastAttemptAt: 0,
  lastSuccessAt: 0,
  lastContentHash: "",
  lastKnownManifestId: "",
  lastError: "",
  conflict: false,
}, null, 2));
let electronApp;
let page;
let remoteCreated = false;
let authorized = false;

async function cleanup() {
  if (page && !page.isClosed()) {
    if (authorized) {
      await page.evaluate(async () => {
        await window.chengjing?.cloudBackups?.qaCleanup?.();
        await window.chengjing?.cloudBackups?.disconnect?.();
      }).catch(() => {});
    }
  }
  await electronApp?.close().catch(() => {});
  await fs.rm(userData, { recursive: true, force: true }).catch(() => {});
}

try {
  electronApp = await electron.launch({
    executablePath: packagedExecutable || electronPath,
    args: packagedExecutable ? [] : [projectRoot, "--dev"],
    cwd: projectRoot,
    env: {
      ...process.env,
      CHENGJING_SMOKE: "1",
      CHENGJING_SMOKE_USER_DATA: userData,
      LANG: "zh_TW.UTF-8",
    },
  });
  page = await electronApp.firstWindow();
  page.setDefaultTimeout(30_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") pageErrors.push(message.text()); });
  await page.waitForFunction(() => document.body.innerText.includes("設定"));
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const panel = page.locator(".backup-hub");
  await panel.getByRole("heading", { name: "備份與復原", exact: true }).waitFor();
  const connect = panel.getByRole("button", { name: "連結 Google 帳號", exact: true });
  await connect.click();
  console.log(JSON.stringify({ phase: "oauth-opened", isolatedUserData: true }));

  await page.waitForFunction(async () => Boolean((await window.chengjing?.cloudBackups?.getLocalStatus?.())?.connected), null, { timeout: 5 * 60_000 });
  const connectedStatus = await page.evaluate(() => window.chengjing.cloudBackups.getStatus());
  authorized = connectedStatus.connected;
  if (connectedStatus.needsDecision) throw new Error("Google App Data 已有非本次測試建立的備份；已停止，沒有覆寫。");
  await page.waitForFunction(async () => Boolean((await window.chengjing?.cloudBackups?.getStatus?.())?.current), null, { timeout: 2 * 60_000 });
  const uploadedStatus = await page.evaluate(() => window.chengjing.cloudBackups.getStatus());
  remoteCreated = Boolean(uploadedStatus.current);
  if (!remoteCreated) throw new Error("沒有建立雲端測試快照。");
  const tokenEnvelope = JSON.parse(await fs.readFile(path.join(userData, "google-drive-token.vault"), "utf8"));

  page.on("dialog", async (dialog) => dialog.accept());
  const reload = page.waitForEvent("load", { timeout: 2 * 60_000 });
  await panel.getByRole("button", { name: "復原最新雲端備份", exact: true }).click();
  await reload;
  await page.waitForFunction(() => Boolean(window.chengjing?.cloudBackups));
  const safetyDirectory = path.join(userData, "Restore Safety");
  const safetyEntries = await fs.readdir(safetyDirectory);
  const safetyBackupCreated = safetyEntries.some((name) => /^ChengJing-AutoBackup-.*\.json$/.test(name));

  const cleanupResult = await page.evaluate(async () => {
    const removed = await window.chengjing.cloudBackups.qaCleanup();
    const disconnected = await window.chengjing.cloudBackups.disconnect();
    return { removed, disconnected };
  });
  remoteCreated = false;
  const tokenVaultRemoved = await fs.stat(path.join(userData, "google-drive-token.vault")).then(() => false).catch((error) => error?.code === "ENOENT");
  const report = {
    connected: connectedStatus.connected,
    scopeConfigured: connectedStatus.configured,
    currentSnapshotCreated: Boolean(uploadedStatus.current),
    previousSnapshotInitiallyAbsent: uploadedStatus.previous === null,
    safetyBackupCreated,
    removedTestManifests: cleanupResult.removed.removedManifests,
    disconnected: !cleanupResult.disconnected.connected,
    tokenVaultRemoved,
    tokenBackend: tokenEnvelope.backend,
    pageErrors,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.connected || !report.scopeConfigured || !report.currentSnapshotCreated || !report.previousSnapshotInitiallyAbsent || !report.safetyBackupCreated || report.removedTestManifests < 1 || !report.disconnected || !report.tokenVaultRemoved || report.tokenBackend !== "app-local-aes-256-gcm" || report.pageErrors.length) process.exitCode = 1;
} catch (error) {
  const debugLog = await fs.readFile(path.join(userData, "cloud-backup-qa.log"), "utf8").catch(() => "");
  if (debugLog) console.error(debugLog.trim());
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await cleanup();
}
