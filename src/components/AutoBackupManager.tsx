import { useEffect, useState } from "react";
import { announceAutoBackup, isAutoBackupDue, prepareCompleteBackup } from "../lib/autoBackup";
import { useAppStore } from "../store";
import { flushPendingSync } from "../lib/syncEngine";
import { syncEnabled } from "../lib/syncJournal";
import { reportSyncActivity } from "../lib/syncActivity";

const QUIT_MESSAGES = {
  "zh-TW": ["正在儲存最後變更…", "正在儲存並完成同步…"],
  "zh-CN": ["正在保存最后更改…", "正在保存并完成同步…"],
  en: ["Saving your latest changes…", "Saving and finishing sync…"],
  ja: ["最新の変更を保存しています…", "保存と同期を完了しています…"],
  ko: ["최근 변경 사항을 저장하는 중…", "저장 및 동기화를 완료하는 중…"],
};

export function AutoBackupManager() {
  const [quitting, setQuitting] = useState(false);
  const language = useAppStore((state) => state.language);

  useEffect(() => {
    const local = window.chengjing?.backups;
    const lifecycle = window.chengjing?.cloudBackups;
    if (!local && !lifecycle?.onBeforeQuit) return;
    const backupBridge = local;

    let disposed = false;
    let lastChange = 0;
    let retryAfter = 0;
    let operation: Promise<void> | null = null;
    let exiting = false;
    let debounce = 0;
    let quitOperation: Promise<void> | null = null;

    async function check(exit = false): Promise<void> {
      if (operation) {
        try { await operation; } catch (error) { if (exit) throw error; }
        if (exit) return check(true);
        return;
      }

      if (disposed || (!exit && exiting)) return;
      if (!backupBridge) return;
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

    const disposeExit = lifecycle?.onBeforeQuit?.(() => {
      if (quitOperation) return quitOperation;
      quitOperation = (async () => {
        exiting = true;
        (document.activeElement as HTMLElement | null)?.blur();
        window.dispatchEvent(new Event("chengjing:flush-editors"));
        setQuitting(true);

        try {
          await new Promise((resolve) => setTimeout(resolve, 750));
          const sync = async () => {
            if (!syncEnabled()) return;
            const bridge = window.chengjing?.sync;
            if (!bridge) throw new Error("sync-bridge-unavailable");
            try {
              await flushPendingSync({
                list: async () => (await bridge.list()).files,
                get: bridge.get, put: bridge.put, stage: bridge.stage,
                uploadAsset: bridge.uploadAsset, downloadAsset: bridge.downloadAsset,
              });
            } catch (error) {
              reportSyncActivity("error", error instanceof Error ? error.message : String(error));
              throw error;
            }
          };
          // Each destination remains independent: a failed cloud upload must not
          // prevent a due local backup from finishing, or vice versa.
          const results = await Promise.allSettled([check(true), sync()]);
          const failure = results.find(result => result.status === "rejected");
          if (failure?.status === "rejected") throw failure.reason;
        } finally {
          exiting = false;
          quitOperation = null;
          setQuitting(false);
        }
      })();
      return quitOperation;
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
      {QUIT_MESSAGES[language][syncEnabled() ? 1 : 0]}
    </div>
  ) : null;
}
