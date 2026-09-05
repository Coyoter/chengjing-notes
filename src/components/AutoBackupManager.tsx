import { useEffect } from "react";
import { announceAutoBackup, isAutoBackupDue, isCloudBackupDue, prepareCompleteBackup } from "../lib/autoBackup";

const STARTUP_DELAY_MS = 25_000;
const IDLE_REQUIRED_MS = 30_000;
const ACTIVE_RETRY_MS = 60_000;
const PERIODIC_CHECK_MS = 5 * 60_000;

export function AutoBackupManager() {
  useEffect(() => {
    const bridge = window.chengjing?.backups;
    const cloudBridge = window.chengjing?.cloudBackups;
    if (!bridge && !cloudBridge) return;
    let disposed = false;
    let running = false;
    let queued = false;
    let lastActivityAt = Date.now();
    let retryTimer = 0;

    const noteActivity = () => { lastActivityAt = Date.now(); };
    const retryLater = () => {
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => void check(), ACTIVE_RETRY_MS);
    };
    const runDuringIdle = (task: () => void) => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(task, { timeout: 10_000 });
      } else {
        globalThis.setTimeout(task, 1_500);
      }
    };
    const check = async () => {
      if (disposed || running || queued) return;
      try {
        const [settings, cloudStatus] = await Promise.all([
          bridge?.getSettings() || null,
          cloudBridge?.getLocalStatus() || null,
        ]);
        if (settings) announceAutoBackup(settings);
        const localDue = Boolean(settings && isAutoBackupDue(settings));
        const cloudDue = Boolean(cloudStatus && isCloudBackupDue(cloudStatus.settings));
        if (!localDue && !cloudDue) return;
        if (Date.now() - lastActivityAt < IDLE_REQUIRED_MS) {
          retryLater();
          return;
        }
        queued = true;
        runDuringIdle(() => {
          queued = false;
          if (disposed || running) return;
          if (Date.now() - lastActivityAt < IDLE_REQUIRED_MS) {
            retryLater();
            return;
          }
          running = true;
          void (async () => {
            const payload = await prepareCompleteBackup();
            if (localDue && bridge) {
              await bridge.write({ ...payload, reason: "scheduled" })
                .then((result) => announceAutoBackup(result.settings))
                .catch(async () => announceAutoBackup(await bridge.getSettings()));
            }
            if (cloudDue && cloudBridge) {
              await cloudBridge.write({ ...payload, reason: "scheduled" })
                .then((result) => window.dispatchEvent(new CustomEvent("chengjing:cloud-backup-status", { detail: result })))
                .catch(() => {});
            }
          })().catch((error) => {
            console.error("Automatic backup preparation failed", error);
            retryLater();
          }).finally(() => { running = false; });
        });
      } catch {
        // 設定讀取失敗時不打擾使用者；下一個低頻檢查週期會再嘗試。
      }
    };
    const onSettingsChanged = () => {
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => void check(), 1_000);
    };
    const activityEvents: Array<keyof WindowEventMap> = ["keydown", "pointerdown", "touchstart", "wheel", "input"];
    activityEvents.forEach((name) => window.addEventListener(name, noteActivity, { capture: true, passive: true }));
    window.addEventListener("chengjing:auto-backup-settings-changed", onSettingsChanged);
    const startupTimer = window.setTimeout(() => void check(), STARTUP_DELAY_MS);
    const periodicTimer = window.setInterval(() => void check(), PERIODIC_CHECK_MS);
    return () => {
      disposed = true;
      window.clearTimeout(startupTimer);
      window.clearTimeout(retryTimer);
      window.clearInterval(periodicTimer);
      activityEvents.forEach((name) => window.removeEventListener(name, noteActivity, { capture: true }));
      window.removeEventListener("chengjing:auto-backup-settings-changed", onSettingsChanged);
    };
  }, []);

  return null;
}
