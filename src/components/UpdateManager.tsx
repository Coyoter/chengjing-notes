import { useEffect } from "react";
import { Check, Download, RefreshCw, Sparkles, X } from "lucide-react";
import { useI18n } from "../hooks/useI18n";
import { userFacingReleaseNotes } from "../lib/releaseNotes";
import { markUpdatesCheckedToday, shouldCheckForUpdatesToday } from "../lib/dailyUpdateCheck";
import { useUpdateStore } from "../updateStore";
import { getWindowsUpdateCopy } from "../lib/updatePlatformCopy";

let dailyCheckScheduled = false;

export function UpdateManager() {
  const { language, t } = useI18n();
  const platformCopy = getWindowsUpdateCopy(language);
  const phase = useUpdateStore((state) => state.phase);
  const info = useUpdateStore((state) => state.info);
  const progress = useUpdateStore((state) => state.progress);
  const error = useUpdateStore((state) => state.error);
  const showPrompt = useUpdateStore((state) => state.showPrompt);
  const check = useUpdateStore((state) => state.check);
  const download = useUpdateStore((state) => state.download);
  const dismiss = useUpdateStore((state) => state.dismiss);

  useEffect(() => {
    if (dailyCheckScheduled || !shouldCheckForUpdatesToday(window.localStorage)) return;
    dailyCheckScheduled = true;
    let started = false;
    const timer = window.setTimeout(() => {
      if (!shouldCheckForUpdatesToday(window.localStorage)) {
        dailyCheckScheduled = false;
        return;
      }
      started = true;
      void check(true).then((result) => {
        if (result) markUpdatesCheckedToday(window.localStorage);
        else dailyCheckScheduled = false;
      });
    }, 1400);
    return () => {
      window.clearTimeout(timer);
      if (!started) dailyCheckScheduled = false;
    };
  }, [check]);

  if (!showPrompt) return null;
  const isBusy = phase === "checking" || phase === "downloading" || phase === "opening";
  const isOpened = phase === "opened";
  const isError = phase === "error";
  const releaseNotes = userFacingReleaseNotes(info?.notes || "");

  async function quitForReplacement() {
    if (!window.chengjing?.app?.quit) {
      dismiss();
      return;
    }
    await window.chengjing.app.quit();
  }

  return (
    <div className="update-backdrop" onMouseDown={() => !isBusy && dismiss()}>
      <section className="update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div className={`update-symbol ${isOpened ? "is-done" : isError ? "is-error" : ""}`}>{isOpened ? <Check size={22} /> : isError ? <RefreshCw size={21} /> : <Sparkles size={22} />}</div>
          <div><span>{t("update.eyebrow")}</span><h2 id="update-title">{isOpened ? (platformCopy?.openedTitle || t("update.openedTitle")) : isError ? t("update.errorTitle") : t("update.availableTitle", { version: info?.latestVersion || "" })}</h2>{info && !isOpened && <p>{t("update.currentVersion", { version: info.currentVersion })}</p>}</div>
          {!isBusy && <button type="button" className="bare-button" aria-label={t("common.close")} onClick={dismiss}><X size={17} /></button>}
        </header>

        {isOpened ? <p className="update-finish-copy">{platformCopy?.quitDescription || t("update.quitDescription")}</p> : isError ? <p className="update-error-copy">{error}</p> : <div className="update-notes"><b>{t("update.releaseNotes")}</b><p>{releaseNotes || t("update.noNotes")}</p></div>}

        {(phase === "downloading" || phase === "opening") && <div className="update-progress" aria-live="polite"><div><i style={{ width: `${progress?.percent || 0}%` }} /></div><span>{phase === "opening" ? (platformCopy?.opening || t("update.opening")) : progress && progress.percent > 0 ? t("update.progress", { progress: progress.percent.toFixed(0) }) : (platformCopy?.downloading || t("update.downloading"))}</span></div>}

        <footer>
          {!isBusy && !isOpened && <button type="button" className="secondary-button" onClick={dismiss}>{t("update.later")}</button>}
          {isError ? <button type="button" className="primary-button" onClick={() => void check(false)}><RefreshCw size={15} />{t("update.retry")}</button> : isOpened ? <button type="button" className="primary-button" onClick={() => void quitForReplacement()}><Check size={15} />{platformCopy?.quitForReplace || t("update.quitForReplace")}</button> : <button type="button" className="primary-button" disabled={isBusy} onClick={() => void download()}>{phase === "downloading" || phase === "opening" ? <RefreshCw size={15} className="spin" /> : <Download size={15} />}{phase === "downloading" ? (platformCopy?.downloading || t("update.downloading")) : phase === "opening" ? (platformCopy?.opening || t("update.opening")) : t("update.downloadManual")}</button>}
        </footer>
      </section>
    </div>
  );
}
