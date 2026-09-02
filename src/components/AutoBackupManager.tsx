import { useEffect } from "react";
import { announceAutoBackup, isAutoBackupDue, writeCompleteBackup } from "../lib/autoBackup";

const STARTUP_DELAY_MS = 25_000;
const IDLE_REQUIRED_MS = 30_000;
const ACTIVE_RETRY_MS = 60_000;
const PERIODIC_CHECK_MS = 30 * 60_000;

export function AutoBackupManager() {
  useEffect(() => {
    const bridge = window.chengjing?.backups;
    if (!bridge) return;
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
        const settings = await bridge.getSettings();
        announceAutoBackup(settings);
        if (!isAutoBackupDue(settings)) return;
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
          void writeCompleteBackup("scheduled")
            .then((result) => announceAutoBackup(result.settings))
            .catch(async () => announceAutoBackup(await bridge.getSettings()))
            .finally(() => { running = false; });
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
