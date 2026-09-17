import { useRef, useState } from "react";
import { ArrowDownToLine, ChevronDown, LoaderCircle } from "lucide-react";
import { useI18n } from "../hooks/useI18n";

/** One-time migration belongs with recovery tools, not everyday sync controls. */
export function CloudBackupImport({ disabled = false, onBusyChange }: {
  disabled?: boolean; onBusyChange?: (busy: boolean) => void;
} = {}) {
  const { language } = useI18n(); const zh = language.startsWith("zh");
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  async function bringBackup() {
    if (disabled || busy || inFlight.current) return;
    if (!window.confirm(zh ? "從 Google 備份加入資料？目前內容會保留；不同版本會列出供你確認。開始前會先保存本機安全副本。" : "Add data from your Google backup? Current content is preserved, conflicts are kept for review, and a local safety copy is saved first.")) return;
    inFlight.current = true; setBusy(true); setNotice(""); onBusyChange?.(true);
    try {
      const bridge = window.chengjing?.cloudBackups;
      if (!bridge) throw new Error(zh ? "這個版本尚未提供 Google 備份。" : "Google backup is unavailable in this build.");
      if (!(await bridge.getLocalStatus()).connected) await bridge.connect();
      const { importBackupForSync } = await import("../lib/syncBootstrap");
      await importBackupForSync();
      window.dispatchEvent(new Event("chengjing:sync-dirty"));
      setNotice(zh ? "資料已帶入。原有內容已保留，不同版本可在同步區確認。" : "Data imported. Existing content was kept; review any different versions in Sync.");
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { inFlight.current = false; setBusy(false); onBusyChange?.(false); }
  }
  return <details className="backup-import-tools">
    <summary><ArrowDownToLine size={19}/><span><b>{zh ? "舊版 Google 備份搬移" : "Legacy Google backup import"}</b><small>{zh ? "僅供舊版備份資料一次性帶入" : "One-time import for backups created by older versions"}</small></span><ChevronDown size={17}/></summary>
    <div><p>{zh ? "如果你曾使用舊版 Google 備份，可在這裡把資料加入目前內容。這是一次性相容工具，日常請直接使用 Google 同步。" : "If you used Google backup in an older version, import that data here without replacing current content. For everyday use, use Google Sync instead."}</p>
      <button type="button" className="secondary-button" disabled={disabled || busy} onClick={()=>void bringBackup()}>{busy ? <LoaderCircle size={17} className="spin"/> : <ArrowDownToLine size={17}/>}<span>{busy ? (zh ? "正在帶入…" : "Importing…") : (zh ? "從 Google 備份帶入" : "Import Google backup")}</span></button>
      {notice && <p className="backup-import-notice" role="status">{notice}</p>}
    </div>
  </details>;
}
