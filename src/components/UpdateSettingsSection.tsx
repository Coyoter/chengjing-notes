import { Check, Download, RefreshCw } from "lucide-react";
import { useI18n } from "../hooks/useI18n";
import { useUpdateStore } from "../updateStore";
import { getWindowsUpdateCopy } from "../lib/updatePlatformCopy";

export function UpdateSettingsSection() {
  const { language, t } = useI18n();
  const platformCopy = getWindowsUpdateCopy(language);
  const phase = useUpdateStore((state) => state.phase);
  const info = useUpdateStore((state) => state.info);
  const error = useUpdateStore((state) => state.error);
  const check = useUpdateStore((state) => state.check);
  const download = useUpdateStore((state) => state.download);
  const busy = phase === "checking" || phase === "downloading" || phase === "opening";

  return (
    <section className="settings-section update-settings" id="update-settings">
      <header><span>{t("update.settingsEyebrow")}</span><h2>{t("update.settingsTitle")}</h2><p>{platformCopy?.dailyDescription || t("update.dailyDescription")}</p></header>
      <div className="update-version-grid">
        <div><span>{t("update.current")}</span><b>{info?.currentVersion || "—"}</b></div>
        <div><span>{t("update.latest")}</span><b>{info?.latestVersion || "—"}</b></div>
        <div className={info?.status === "available" ? "is-available" : ""}><span>{t("update.dailyAutoCheck")}</span><b>{info?.status === "available" ? t("update.available") : info ? t("update.upToDate") : error ? t("update.errorTitle") : phase === "checking" ? t("update.checking") : t("update.checkNow")}</b></div>
      </div>
      {error && <p className="update-settings-error">{error}</p>}
      <footer>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void check(false)}><RefreshCw size={15} className={phase === "checking" ? "spin" : ""} />{phase === "checking" ? t("update.checking") : t("update.checkNow")}</button>
        {info?.status === "available" && <button type="button" className="primary-button" disabled={busy} onClick={() => void download()}>{busy ? <RefreshCw size={15} className="spin" /> : <Download size={15} />}{phase === "downloading" ? (platformCopy?.downloading || t("update.downloading")) : t("update.downloadManual")}</button>}
        {info?.status === "current" && <span><Check size={14} />{t("update.upToDate")}</span>}
      </footer>
    </section>
  );
}
