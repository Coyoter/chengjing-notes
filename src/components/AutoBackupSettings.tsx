import { useEffect, useMemo, useState } from "react";
import { Check, Clock3, Cloud, Cpu, Database, FolderOpen, Paperclip, RefreshCw, ShieldCheck } from "lucide-react";
import type { AutoBackupSettings } from "../types";
import { useAppStore } from "../store";
import { intlLocale } from "../i18n";
import { announceAutoBackup, writeCompleteBackup } from "../lib/autoBackup";
import { getAutoBackupCopy } from "../lib/autoBackupCopy";
import { formatBytes, friendlyErrorMessage } from "../lib/utils";
import { estimateNoteStorageBytes } from "../lib/backup";
import { inspectLocalModel } from "../lib/localGemma";
import { db } from "../db";

export function AutoBackupSettingsPanel() {
  const language = useAppStore((state) => state.language);
  const text = useMemo(() => getAutoBackupCopy(language), [language]);
  const [settings, setSettings] = useState<AutoBackupSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [storage, setStorage] = useState({ notes: 0, attachments: 0, model: 0 });

  useEffect(() => {
    const bridge = window.chengjing?.backups;
    if (!bridge) return;
    void bridge.getSettings().then(setSettings).catch(() => setNotice(text.desktopRequired));
    const attachmentStats = window.chengjing?.attachments?.stats ? window.chengjing.attachments.stats() : Promise.resolve({ bytes: 0, count: 0 });
    void Promise.all([
      estimateNoteStorageBytes(),
      Promise.all([attachmentStats, db.attachments.toArray()]),
      inspectLocalModel(),
    ]).then(([notes, [files, attachmentRecords], model]) => {
      const legacyBytes = attachmentRecords.filter((attachment) => attachment.storage !== "file").reduce((sum, attachment) => sum + attachment.size, 0);
      setStorage({ notes, attachments: files.bytes + legacyBytes, model: model.cached ? model.size : 0 });
    }).catch(() => {});
    const listener = (event: Event) => setSettings((event as CustomEvent<AutoBackupSettings>).detail);
    window.addEventListener("chengjing:auto-backup-status", listener);
    return () => window.removeEventListener("chengjing:auto-backup-status", listener);
  }, [text.desktopRequired]);

  function settingsChanged(next: AutoBackupSettings) {
    setSettings(next);
    announceAutoBackup(next);
    window.dispatchEvent(new Event("chengjing:auto-backup-settings-changed"));
  }

  async function chooseFolder() {
    const bridge = window.chengjing?.backups;
    if (!bridge) { setNotice(text.desktopRequired); return null; }
    try {
      const result = await bridge.chooseFolder();
      if (!result.canceled) {
        settingsChanged(result.settings);
        setNotice("");
        return result.settings;
      }
    } catch (error) {
      setNotice(friendlyErrorMessage(error, text.folderRequired));
    }
    return null;
  }

  async function updateSettings(patch: Partial<Pick<AutoBackupSettings, "enabled" | "intervalDays" | "retentionCount">>) {
    const bridge = window.chengjing?.backups;
    if (!bridge) { setNotice(text.desktopRequired); return; }
    try {
      const next = await bridge.updateSettings(patch);
      settingsChanged(next);
      setNotice("");
    } catch (error) {
      setNotice(friendlyErrorMessage(error, text.folderRequired));
    }
  }

  async function toggleEnabled() {
    if (!settings?.directory && !settings?.enabled) {
      await chooseFolder();
      return;
    }
    await updateSettings({ enabled: !settings?.enabled });
  }

  async function runNow() {
    let current = settings;
    if (!current?.directory) current = await chooseFolder();
    if (!current?.directory) return;
    setBusy(true);
    setNotice(text.running);
    try {
      const result = await writeCompleteBackup("manual");
      settingsChanged(result.settings);
      setNotice(text.ready);
    } catch (error) {
      setNotice(friendlyErrorMessage(error, text.folderRequired));
      const fresh = await window.chengjing?.backups.getSettings().catch(() => null);
      if (fresh) setSettings(fresh);
    } finally {
      setBusy(false);
    }
  }

  const formattedLastSuccess = settings?.lastSuccessAt
    ? new Intl.DateTimeFormat(intlLocale[language], { dateStyle: "medium", timeStyle: "short" }).format(settings.lastSuccessAt)
    : text.never;

  return (
    <div className="auto-backup-panel">
      <header>
        <div><span><ShieldCheck size={14} /> {text.eyebrow}</span><h3>{text.title}</h3><p>{text.description}</p></div>
        <label className="auto-backup-switch">
          <input type="checkbox" checked={Boolean(settings?.enabled)} onChange={() => void toggleEnabled()} aria-label={text.enableTitle} />
          <i />
        </label>
      </header>

      <div className="auto-backup-folder">
        <FolderOpen size={18} />
        <span><b>{text.folderLabel}</b><code title={settings?.directory || text.noFolder}>{settings?.directory || text.noFolder}</code></span>
        <button type="button" className="secondary-button" onClick={() => void chooseFolder()}>{settings?.directory ? text.changeFolder : text.chooseFolder}</button>
      </div>

      <section className="storage-usage-summary" aria-label={text.storageTitle}>
        <header><b>{text.storageTitle}</b><small>{text.storageHint}</small></header>
        <div>
          <span><Database size={16} /><i><b>{formatBytes(storage.notes)}</b><small>{text.notesStorage}</small></i></span>
          <span><Paperclip size={16} /><i><b>{formatBytes(storage.attachments)}</b><small>{text.attachmentsStorage}</small></i></span>
          <span><Cpu size={16} /><i><b>{formatBytes(storage.model)}</b><small>{text.modelStorage}</small></i></span>
        </div>
      </section>

      <div className="auto-backup-controls">
        <div className="auto-backup-state"><Clock3 size={17} /><span><b>{text.enableTitle}</b><small>{settings?.enabled ? text.enabledHint : text.disabledHint}</small></span></div>
        <div className="auto-backup-interval" aria-label={text.intervalLabel}>
          {([{ value: 1, label: text.daily }, { value: 3, label: text.everyThreeDays }, { value: 7, label: text.weekly }] as const).map((option) => (
            <button type="button" key={option.value} className={settings?.intervalDays === option.value ? "is-active" : ""} onClick={() => void updateSettings({ intervalDays: option.value })}>{option.label}</button>
          ))}
        </div>
      </div>
      <p className="auto-backup-retention">{text.retention}</p>

      <div className="cloud-backup-note"><Cloud size={18} /><span><b>{text.cloudTitle}</b><small>{text.cloudHint}</small></span></div>

      <footer>
        <span>{settings?.lastSuccessAt ? <Check size={14} /> : <Clock3 size={14} />}<b>{text.lastSuccess}</b> · {formattedLastSuccess}{settings?.lastError && <small>{settings.lastError}</small>}</span>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void runNow()}><RefreshCw size={15} className={busy ? "spin" : ""} />{busy ? text.running : text.runNow}</button>
      </footer>
      {notice && <div className="auto-backup-notice" role="status">{notice}</div>}
    </div>
  );
}
