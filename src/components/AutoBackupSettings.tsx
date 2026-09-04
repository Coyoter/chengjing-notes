import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock3,
  Cloud,
  Cpu,
  Database,
  DatabaseBackup,
  Download,
  FolderOpen,
  HardDrive,
  Link2Off,
  LockKeyhole,
  Paperclip,
  RefreshCw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import type { AutoBackupSettings, CloudBackupStatus, CloudBackupWriteResult } from "../types";
import { useAppStore } from "../store";
import { intlLocale } from "../i18n";
import {
  announceAutoBackup,
  prepareCompleteBackup,
  writeCloudBackup,
  writeCompleteBackup,
  writeRestoreSafetyBackup,
} from "../lib/autoBackup";
import { getAutoBackupCopy } from "../lib/autoBackupCopy";
import { formatBytes, friendlyErrorMessage } from "../lib/utils";
import { estimateNoteStorageBytes, restoreBackup, saveJsonBackup, saveMarkdownArchive } from "../lib/backup";
import { inspectLocalModel } from "../lib/localGemma";
import { db } from "../db";
import { useI18n } from "../hooks/useI18n";
// Google 官方預先核准的 Android + Web 中性 SVG 圖示；按鈕本體由澄境繪製。
// Source: https://developers.google.com/identity/branding-guidelines
import googleGMark from "../assets/google-g-neutral-square.svg";

type BusyAction = "connect" | "cloud" | "local" | "restore-current" | "restore-previous" | "replace" | "disconnect" | "";

export function AutoBackupSettingsPanel() {
  const language = useAppStore((state) => state.language);
  const text = useMemo(() => getAutoBackupCopy(language), [language]);
  const { t } = useI18n();
  const [localSettings, setLocalSettings] = useState<AutoBackupSettings | null>(null);
  const [cloudStatus, setCloudStatus] = useState<CloudBackupStatus | null>(null);
  const [busy, setBusy] = useState<BusyAction>("");
  const [notice, setNotice] = useState("");
  const [storage, setStorage] = useState({ notes: 0, attachments: 0, model: 0 });

  useEffect(() => {
    const localBridge = window.chengjing?.backups;
    const cloudBridge = window.chengjing?.cloudBackups;
    if (localBridge) void localBridge.getSettings().then(setLocalSettings).catch(() => setNotice(text.desktopRequired));
    if (cloudBridge) {
      void cloudBridge.getStatus().then(setCloudStatus).catch(async (error) => {
        const local = await cloudBridge.getLocalStatus().catch(() => null);
        if (local) setCloudStatus(local);
        setNotice(friendlyErrorMessage(error, text.desktopRequired));
      });
    }
    const attachmentStats = window.chengjing?.attachments?.stats ? window.chengjing.attachments.stats() : Promise.resolve({ bytes: 0, count: 0 });
    void Promise.all([
      estimateNoteStorageBytes(),
      Promise.all([attachmentStats, db.attachments.toArray()]),
      inspectLocalModel(),
    ]).then(([notes, [files, attachmentRecords], model]) => {
      const legacyBytes = attachmentRecords.filter((attachment) => attachment.storage !== "file").reduce((sum, attachment) => sum + attachment.size, 0);
      setStorage({ notes, attachments: files.bytes + legacyBytes, model: model.cached ? model.size : 0 });
    }).catch(() => {});
    const localListener = (event: Event) => setLocalSettings((event as CustomEvent<AutoBackupSettings>).detail);
    const cloudListener = (event: Event) => setCloudStatus((current) => {
      const result = (event as CustomEvent<CloudBackupWriteResult>).detail;
      if (!current || !result) return current;
      return { ...current, connected: true, settings: result.settings, current: result.current, previous: result.previous, needsDecision: false };
    });
    window.addEventListener("chengjing:auto-backup-status", localListener);
    window.addEventListener("chengjing:cloud-backup-status", cloudListener);
    return () => {
      window.removeEventListener("chengjing:auto-backup-status", localListener);
      window.removeEventListener("chengjing:cloud-backup-status", cloudListener);
    };
  }, [text.desktopRequired]);

  function formatTimestamp(timestamp: number | undefined, fallback: string) {
    return timestamp
      ? new Intl.DateTimeFormat(intlLocale[language], { dateStyle: "medium", timeStyle: "short" }).format(timestamp)
      : fallback;
  }

  function localSettingsChanged(next: AutoBackupSettings) {
    setLocalSettings(next);
    announceAutoBackup(next);
    window.dispatchEvent(new Event("chengjing:auto-backup-settings-changed"));
  }

  function cloudSettingsChanged(settings: CloudBackupStatus["settings"]) {
    setCloudStatus((current) => current ? { ...current, settings, needsDecision: settings.conflict } : current);
    window.dispatchEvent(new Event("chengjing:auto-backup-settings-changed"));
  }

  function cloudWriteCompleted(result: CloudBackupWriteResult) {
    setCloudStatus((current) => current ? {
      ...current,
      connected: true,
      settings: result.settings,
      current: result.current,
      previous: result.previous,
      needsDecision: false,
    } : current);
    window.dispatchEvent(new CustomEvent("chengjing:cloud-backup-status", { detail: result }));
  }

  async function chooseFolder() {
    const bridge = window.chengjing?.backups;
    if (!bridge) { setNotice(text.desktopRequired); return null; }
    try {
      const result = await bridge.chooseFolder();
      if (!result.canceled) {
        localSettingsChanged(result.settings);
        setNotice("");
        return result.settings;
      }
    } catch (error) {
      setNotice(friendlyErrorMessage(error, text.folderRequired));
    }
    return null;
  }

  async function updateLocalSettings(patch: Partial<Pick<AutoBackupSettings, "enabled" | "intervalDays" | "retentionCount">>) {
    const bridge = window.chengjing?.backups;
    if (!bridge) { setNotice(text.desktopRequired); return; }
    try {
      const next = await bridge.updateSettings(patch);
      localSettingsChanged(next);
      setNotice("");
    } catch (error) {
      setNotice(friendlyErrorMessage(error, text.folderRequired));
    }
  }

  async function toggleLocal() {
    if (!localSettings?.directory && !localSettings?.enabled) {
      await chooseFolder();
      return;
    }
    await updateLocalSettings({ enabled: !localSettings?.enabled });
  }

  async function runLocalNow() {
    let current = localSettings;
    if (!current?.directory) current = await chooseFolder();
    if (!current?.directory) return;
    setBusy("local");
    setNotice(text.localRunning);
    try {
      const result = await writeCompleteBackup("manual");
      localSettingsChanged(result.settings);
      setNotice(text.localReady);
    } catch (error) {
      setNotice(friendlyErrorMessage(error, text.folderRequired));
      const fresh = await window.chengjing?.backups.getSettings().catch(() => null);
      if (fresh) setLocalSettings(fresh);
    } finally {
      setBusy("");
    }
  }

  async function connectGoogle() {
    const bridge = window.chengjing?.cloudBackups;
    if (!bridge) { setNotice(text.desktopRequired); return; }
    setBusy("connect");
    setNotice(text.connecting);
    try {
      const status = await bridge.connect();
      setCloudStatus(status);
      setNotice("");
      if (!status.current && status.settings.enabled) {
        const result = await writeCloudBackup("manual");
        cloudWriteCompleted(result);
        setNotice(text.cloudReady);
      }
    } catch (error) {
      setNotice(friendlyErrorMessage(error, text.desktopRequired));
    } finally {
      setBusy("");
    }
  }

  async function disconnectGoogle() {
    const bridge = window.chengjing?.cloudBackups;
    if (!bridge) return;
    setBusy("disconnect");
    try {
      setCloudStatus(await bridge.disconnect());
      setNotice("");
    } catch (error) {
      setNotice(friendlyErrorMessage(error, text.desktopRequired));
    } finally {
      setBusy("");
    }
  }

  async function updateCloudSettings(patch: Partial<Pick<CloudBackupStatus["settings"], "enabled" | "intervalMinutes">>) {
    const bridge = window.chengjing?.cloudBackups;
    if (!bridge) return;
    try {
      cloudSettingsChanged(await bridge.updateSettings(patch));
      setNotice("");
    } catch (error) {
      setNotice(friendlyErrorMessage(error, text.desktopRequired));
    }
  }

  async function runCloudNow(force = false) {
    setBusy(force ? "replace" : "cloud");
    setNotice(text.cloudRunning);
    try {
      const result = await writeCloudBackup("manual", undefined, force);
      cloudWriteCompleted(result);
      setNotice(text.cloudReady);
    } catch (error) {
      setNotice(friendlyErrorMessage(error, text.desktopRequired));
      const status = await window.chengjing?.cloudBackups.getLocalStatus().catch(() => null);
      if (status) setCloudStatus(status);
    } finally {
      setBusy("");
    }
  }

  async function replaceCloudWithThisDevice() {
    if (!window.confirm(text.replaceCloudConfirm)) return;
    await runCloudNow(true);
  }

  async function restoreCloud(slot: "current" | "previous") {
    const bridge = window.chengjing?.cloudBackups;
    if (!bridge) return;
    const confirmation = slot === "previous" ? text.restoreYesterdayConfirm : text.restoreLatestConfirm;
    if (!window.confirm(confirmation)) return;
    setBusy(slot === "previous" ? "restore-previous" : "restore-current");
    setNotice(slot === "previous" ? text.emergencyWarning : text.safetyCopy);
    try {
      const safetyPayload = await prepareCompleteBackup();
      await writeRestoreSafetyBackup(safetyPayload);
      const downloaded = await bridge.download(slot);
      try {
        await restoreBackup(downloaded.data, downloaded.backupFilePath);
        const settings = await bridge.completeRestore({
          baselineManifestId: downloaded.baselineManifestId,
          contentHash: downloaded.contentHash,
        });
        cloudSettingsChanged(settings);
        if (slot === "previous") {
          const restoredPayload = await prepareCompleteBackup();
          const synced = await writeCloudBackup("manual", restoredPayload);
          cloudWriteCompleted(synced);
        }
      } finally {
        await bridge.cancelRestore().catch(() => {});
      }
      window.alert(text.restoreDone);
      window.location.reload();
    } catch (error) {
      await bridge.cancelRestore().catch(() => {});
      setNotice(friendlyErrorMessage(error, text.desktopRequired));
    } finally {
      setBusy("");
    }
  }

  async function importLocalBackup() {
    if (!window.chengjing) return;
    const result = await window.chengjing.files.open({ title: t("import.backupDialog"), filters: [{ name: t("import.backupFile"), extensions: ["json"] }] });
    if (result.canceled || !result.files[0]) return;
    try {
      const raw = new TextDecoder().decode(Uint8Array.from(atob(result.files[0].data), (character) => character.charCodeAt(0)));
      await restoreBackup(raw, result.files[0].path);
      setNotice(t("settings.backupRestored"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("settings.backupFailed"));
    }
  }

  const accountLabel = cloudStatus?.settings.accountEmail || cloudStatus?.settings.accountName || text.connected;
  const cloudLast = formatTimestamp(cloudStatus?.current?.snapshotAt, text.noCloudBackup);
  const previousLast = formatTimestamp(cloudStatus?.previous?.snapshotAt, text.noPrevious);
  const localLast = formatTimestamp(localSettings?.lastSuccessAt, text.never);
  const isBusy = Boolean(busy);

  return (
    <div className="backup-hub">
      <header className="backup-hub-heading">
        <span><ShieldCheck size={14} /> {text.eyebrow}</span>
        <h3>{text.title}</h3>
        <p>{text.description}</p>
      </header>

      <div className="backup-method-grid">
        <article className="backup-method-card cloud-method">
          <header>
            <i className="backup-method-icon"><Cloud size={20} /></i>
            <span><h4>{text.cloudTitle}</h4><p>{text.cloudDescription}</p></span>
            {cloudStatus?.connected && <em><Check size={13} />{text.connected}</em>}
          </header>

          <div className="backup-privacy-note"><LockKeyhole size={16} /><span>{text.cloudPrivacy}<a href="https://techtarian.com/chengjing/privacy/" target="_blank" rel="noreferrer">{text.privacyPolicy || "Privacy policy"}</a></span></div>

          {!cloudStatus?.connected ? (
            <div className="cloud-connect-state">
              {!cloudStatus?.configured && <p>{text.servicePending}</p>}
              <button type="button" className="google-connect-button" aria-label={text.connectGoogle} aria-busy={busy === "connect"} disabled={isBusy || !cloudStatus?.configured} onClick={() => void connectGoogle()}>
                <img className="google-connect-mark" src={googleGMark} alt="" width={40} height={40} />
                <span className="google-connect-label">{busy === "connect" ? text.connecting : text.connectGoogle}</span>
              </button>
            </div>
          ) : (
            <>
              <div className="backup-account-row">
                <span><b>{accountLabel}</b><small>{text.latestCloud} · {cloudLast}</small></span>
                <button type="button" className="text-button" disabled={isBusy} onClick={() => void disconnectGoogle()}><Link2Off size={14} />{text.disconnect}</button>
              </div>

              {cloudStatus.needsDecision ? (
                <div className="cloud-decision-card" role="alert">
                  <AlertTriangle size={18} />
                  <span><b>{text.cloudExistingTitle}</b><small>{text.cloudExistingHint}</small></span>
                  <div>
                    <button type="button" className="primary-button" disabled={isBusy} onClick={() => void restoreCloud("current")}>{text.useCloudCopy}</button>
                    <button type="button" className="secondary-button" disabled={isBusy} onClick={() => void replaceCloudWithThisDevice()}>{text.replaceCloud}</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="backup-toggle-row">
                    <span><b>{text.automaticCloud}</b><small>{cloudStatus.settings.enabled ? text.cloudEnabled : text.cloudDisabled}</small></span>
                    <label className="backup-switch">
                      <input type="checkbox" checked={cloudStatus.settings.enabled} disabled={isBusy} onChange={() => void updateCloudSettings({ enabled: !cloudStatus.settings.enabled })} aria-label={text.automaticCloud} />
                      <i />
                    </label>
                  </div>

                  <label className="backup-frequency-row">
                    <span>{text.intervalLabel}</span>
                    <select value={cloudStatus.settings.intervalMinutes} disabled={isBusy} onChange={(event) => void updateCloudSettings({ intervalMinutes: Number(event.target.value) as 15 | 30 | 60 | 180 })}>
                      <option value={15}>{text.every15Minutes}</option>
                      <option value={30}>{text.every30Minutes} · {text.recommended}</option>
                      <option value={60}>{text.hourly}</option>
                      <option value={180}>{text.every3Hours}</option>
                    </select>
                  </label>

                  <div className="backup-primary-actions">
                    <button type="button" className="primary-button" disabled={isBusy} onClick={() => void runCloudNow()}><RefreshCw size={15} className={busy === "cloud" ? "spin" : ""} />{busy === "cloud" ? text.cloudRunning : text.runCloudNow}</button>
                    <button type="button" className="secondary-button" disabled={isBusy || !cloudStatus.current} onClick={() => void restoreCloud("current")}><Download size={15} />{text.restoreLatest}</button>
                  </div>
                </>
              )}

              <details className="emergency-restore">
                <summary><span><AlertTriangle size={16} /><i><b>{text.emergencyTitle}</b><small>{text.emergencySummary}</small></i></span><ChevronDown size={16} /></summary>
                <div>
                  <p>{text.emergencyWarning}</p>
                  <span><b>{text.previousLabel}</b><small>{previousLast}</small></span>
                  <button type="button" className="emergency-button" disabled={isBusy || !cloudStatus.previous} onClick={() => void restoreCloud("previous")}><AlertTriangle size={15} />{text.restoreYesterday}</button>
                  <small><LockKeyhole size={13} />{text.safetyCopy}</small>
                </div>
              </details>
            </>
          )}
        </article>

        <article className="backup-method-card local-method">
          <header>
            <i className="backup-method-icon"><HardDrive size={20} /></i>
            <span><h4>{text.localTitle}</h4><p>{text.localDescription}</p></span>
            <label className="backup-switch">
              <input type="checkbox" checked={Boolean(localSettings?.enabled)} disabled={isBusy} onChange={() => void toggleLocal()} aria-label={text.automaticLocal} />
              <i />
            </label>
          </header>

          <div className="backup-folder-row">
            <FolderOpen size={17} />
            <span><b>{text.folderLabel}</b><code title={localSettings?.directory || text.noFolder}>{localSettings?.directory || text.noFolder}</code></span>
            <button type="button" className="secondary-button" disabled={isBusy} onClick={() => void chooseFolder()}>{localSettings?.directory ? text.changeFolder : text.chooseFolder}</button>
          </div>

          <div className="backup-toggle-copy"><Clock3 size={16} /><span><b>{text.automaticLocal}</b><small>{localSettings?.enabled ? text.localEnabled : text.localDisabled}</small></span></div>
          <div className="local-frequency" aria-label={text.intervalLabel}>
            {([{ value: 1, label: text.daily }, { value: 3, label: text.everyThreeDays }, { value: 7, label: text.weekly }] as const).map((option) => (
              <button type="button" key={option.value} disabled={isBusy} className={localSettings?.intervalDays === option.value ? "is-active" : ""} onClick={() => void updateLocalSettings({ intervalDays: option.value })}>{option.label}</button>
            ))}
          </div>
          <p className="local-retention">{text.retention}</p>

          <div className="backup-local-footer">
            <span><b>{text.lastSuccess}</b><small>{localLast}</small></span>
            <button type="button" className="primary-button" disabled={isBusy} onClick={() => void runLocalNow()}><RefreshCw size={15} className={busy === "local" ? "spin" : ""} />{busy === "local" ? text.localRunning : text.runLocalNow}</button>
          </div>

          <details className="local-backup-tools">
            <summary><span><b>{text.otherLocalTools}</b><small>{text.otherLocalToolsHint}</small></span><ChevronDown size={16} /></summary>
            <div className="backup-file-actions">
              <button type="button" onClick={() => void saveJsonBackup()}><DatabaseBackup size={18} /><span><b>{t("settings.jsonBackup")}</b><small>{t("settings.jsonHint")}</small></span><Download size={14} /></button>
              <button type="button" onClick={() => void saveMarkdownArchive()}><HardDrive size={18} /><span><b>{t("settings.markdownBackup")}</b><small>{t("settings.markdownHint")}</small></span><Download size={14} /></button>
              <button type="button" onClick={() => void importLocalBackup()}><Upload size={18} /><span><b>{t("settings.restoreBackup")}</b><small>{t("settings.restoreHint")}</small></span><Upload size={14} /></button>
            </div>

            <section className="storage-usage-summary" aria-label={text.storageTitle}>
              <header><b>{text.storageTitle}</b><small>{text.storageHint}</small></header>
              <div>
                <span><Database size={16} /><i><b>{formatBytes(storage.notes)}</b><small>{text.notesStorage}</small></i></span>
                <span><Paperclip size={16} /><i><b>{formatBytes(storage.attachments)}</b><small>{text.attachmentsStorage}</small></i></span>
                <span><Cpu size={16} /><i><b>{formatBytes(storage.model)}</b><small>{text.modelStorage}</small></i></span>
              </div>
            </section>
          </details>
        </article>
      </div>

      {notice && <div className="backup-notice" role="status">{notice}</div>}
    </div>
  );
}
