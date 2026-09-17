import { useEffect, useState } from "react";
import { announceAutoBackup, isAutoBackupDue, prepareCompleteBackup } from "../lib/autoBackup";
import { useAppStore } from "../store";
import { getAutoBackupCopy } from "../lib/autoBackupCopy";

export function AutoBackupManager() {
  const [quitting, setQuitting] = useState(false);
  const language = useAppStore((state) => state.language);

  useEffect(() => {
    const local = window.chengjing?.backups;
    const lifecycle = window.chengjing?.cloudBackups;
    if (!local) return;
    const backupBridge = local;

    let disposed = false;
    let lastChange = 0;
    let retryAfter = 0;
    let operation: Promise<void> | null = null;
    let exiting = false;
    let debounce = 0;

    async function check(exit = false): Promise<void> {
      if (operation) {
        try { await operation; } catch (error) { if (exit) throw error; }
        if (exit) return check(true);
        return;
      }

      if (disposed || (!exit && exiting)) return;
      if (!exit && Date.now() < retryAfter) return;

      operation = (async () => {
        const settings = await backupBridge.getSettings();
        const localDue = Boolean(
          settings &&
          isAutoBackupDue(settings) &&
          (exit || Date.now() - lastChange >= 30_000)
        );

        if (!localDue) return;

        const payload = await prepareCompleteBackup();
        const result = await backupBridge.write({ ...payload, reason: "scheduled" });
        announceAutoBackup(result.settings);
      })();

      try {
        await operation;
        retryAfter = 0;
      } catch (error) {
        retryAfter = Date.now() + 60_000;
        if (exit) throw error;
      } finally {
        operation = null;
      }
    }

    const changed = () => {
      lastChange = Date.now();
      clearTimeout(debounce);
      debounce = window.setTimeout(() => void check(), 30_000);
    };

    const settingsChanged = () => void check();
    const cancelExit = () => {
      exiting = false;
      setQuitting(false);
    };

    const disposeExit = lifecycle?.onBeforeQuit?.(async () => {
      exiting = true;
      (document.activeElement as HTMLElement | null)?.blur();
      window.dispatchEvent(new Event("chengjing:flush-editors"));
      setQuitting(true);

      try {
        await new Promise((resolve) => setTimeout(resolve, 750));
        await check(true);
      } finally {
        exiting = false;
        setQuitting(false);
      }
    });

    window.addEventListener("chengjing:backup-changed", changed);
    window.addEventListener("online", settingsChanged);
    window.addEventListener("chengjing:quit-backup-cancelled", cancelExit);
    window.addEventListener("chengjing:auto-backup-settings-changed", settingsChanged);

    const startup = window.setTimeout(() => void check(), 2_000);
    const periodic = window.setInterval(() => void check(), 5_000);

    return () => {
      disposed = true;
      clearTimeout(startup);
      clearTimeout(debounce);
      clearInterval(periodic);
      disposeExit?.();

      window.removeEventListener("chengjing:backup-changed", changed);
      window.removeEventListener("online", settingsChanged);
      window.removeEventListener("chengjing:quit-backup-cancelled", cancelExit);
      window.removeEventListener("chengjing:auto-backup-settings-changed", settingsChanged);
    };
  }, []);

  return quitting ? (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100000,
        display: "grid",
        placeItems: "center",
        background: "var(--canvas)",
        color: "var(--text-1)",
      }}
    >
      {getAutoBackupCopy(language).localRunning}
    </div>
  ) : null;
}
