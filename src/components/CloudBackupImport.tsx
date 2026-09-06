import { useState } from "react";
import { ArrowDownToLine, ChevronDown, LoaderCircle } from "lucide-react";
import { useI18n } from "../hooks/useI18n";

/** One-time migration belongs with recovery tools, not everyday sync controls. */
export function CloudBackupImport() {
  const { language } = useI18n(); const zh = language.startsWith("zh");
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  async function bringBackup() {
    if (!window.confirm(zh ? "從 Google 備份加入資料？目前內容會保留；不同版本會列出供你確認。開始前會先保存本機安全副本。" : "Add data from your Google backup? Current content is preserved, conflicts are kept for review, and a local safety copy is saved first.")) return;
    setBusy(true); setNotice("");
    try {
      const bridge = window.chengjing?.cloudBackups;
      if (!bridge) throw new Error(zh ? "這個版本尚未提供 Google 備份。" : "Google backup is unavailable in this build.");
      if (!(await bridge.getLocalStatus()).connected) await bridge.connect();
      const { importBackupForSync } = await import("../lib/syncBootstrap");
      await importBackupForSync();
      window.dispatchEvent(new Event("chengjing:sync-dirty"));
      setNotice(zh ? "資料已帶入。原有內容已保留，不同版本可在同步區確認。" : "Data imported. Existing content was kept; review any different versions in Sync.");
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <details className="backup-import-tools">
    <summary><ArrowDownToLine size={19}/><span><b>{zh ? "資料搬移" : "Move your data"}</b><small>{zh ? "換裝置時，從已有的備份帶入內容" : "Bring existing backup content to a new device"}</small></span><ChevronDown size={17}/></summary>
    <div><p>{zh ? "從 Google 備份加入資料，不取代目前內容。這是一次性的搬移工具，日常同步不需要操作。" : "Add content from a Google backup without replacing current data. This one-time migration tool is not needed for everyday sync."}</p>
      <button type="button" className="secondary-button" disabled={busy} onClick={()=>void bringBackup()}>{busy ? <LoaderCircle size={17} className="spin"/> : <ArrowDownToLine size={17}/>}<span>{busy ? (zh ? "正在帶入…" : "Importing…") : (zh ? "從 Google 備份帶入" : "Import Google backup")}</span></button>
      {notice && <p className="backup-import-notice" role="status">{notice}</p>}
    </div>
  </details>;
}
