import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  Clock3,
  Cpu,
  Database,
  DatabaseBackup,
  Download,
  FolderOpen,
  HardDrive,
  Paperclip,
  RefreshCw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import type { AutoBackupSettings } from "../types";
import { useAppStore } from "../store";
import { intlLocale } from "../i18n";
import {
  announceAutoBackup,
  writeCompleteBackup,
} from "../lib/autoBackup";
import { getAutoBackupCopy } from "../lib/autoBackupCopy";
import { formatBytes, friendlyErrorMessage } from "../lib/utils";
import { estimateNoteStorageBytes, restoreLocalBackup, saveJsonBackup, saveMarkdownArchive } from "../lib/backup";
import { inspectLocalModel } from "../lib/localGemma";
import { db } from "../db";
import { useI18n } from "../hooks/useI18n";
import { SyncSettings } from "./SyncSettings";

type BusyAction = "local" | "";

export function AutoBackupSettingsPanel() {
  const language = useAppStore((state) => state.language);
  const text = useMemo(() => getAutoBackupCopy(language), [language]);
  const { t } = useI18n();
  const [localSettings, setLocalSettings] = useState<AutoBackupSettings | null>(null);
  const [busy, setBusy] = useState<BusyAction>("");
  const [notice, setNotice] = useState("");
  const [storage, setStorage] = useState({ notes: 0, attachments: 0, model: 0 });

  useEffect(() => {
    const localBridge = window.chengjing?.backups;
    if (localBridge) void localBridge.getSettings().then(setLocalSettings).catch(() => setNotice(text.desktopRequired));
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
    window.addEventListener("chengjing:auto-backup-status", localListener);
    return () => {
      window.removeEventListener("chengjing:auto-backup-status", localListener);
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

  async function importLocalBackup() {
    if (!window.chengjing) return;
    const result = await window.chengjing.files.open({ title: t("import.backupDialog"), filters: [{ name: t("import.backupFile"), extensions: ["json"] }] });
    if (result.canceled || !result.files[0]) return;
    try {
      const raw = new TextDecoder().decode(Uint8Array.from(atob(result.files[0].data), (character) => character.charCodeAt(0)));
      if (!await restoreLocalBackup(raw, result.files[0].path)) return;
      setNotice(t("settings.backupRestored"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("settings.backupFailed"));
    }
  }

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
        {window.chengjing?.sync && <SyncSettings />}

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
