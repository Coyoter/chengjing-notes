import { useEffect, useState } from "react";
import { Cloud, RefreshCw, AlertTriangle } from "lucide-react";
import { db } from "../db";
import { androidCall } from "../platform/android";
import { enableSync, synchronize, stagePendingSync } from "../lib/syncEngine";
import { syncEnabled } from "../lib/syncJournal";
import type { SyncRecord } from "../lib/syncProtocol";
import { useI18n } from "../hooks/useI18n";

export function syncTransport() {
  const bridge = window.chengjing?.sync;
  if (!bridge) throw new Error("Sync bridge unavailable");
  return { list: async () => (await bridge.list()).files, get: bridge.get, put: bridge.put, stage: bridge.stage, uploadAsset: bridge.uploadAsset, downloadAsset: bridge.downloadAsset };
}
export function SyncManager() {
  useEffect(() => {
    let quiet: ReturnType<typeof setTimeout> | undefined;
    let staging: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      if (!syncEnabled() || !window.chengjing?.sync) return;
      void synchronize(syncTransport()).then(() => window.dispatchEvent(new CustomEvent("chengjing:sync-status", { detail: "" }))).catch((error) => window.dispatchEvent(new CustomEvent("chengjing:sync-status", { detail: error.message })));
    };
    const startup = setTimeout(run, 3000); const interval = setInterval(run, 60_000);
    const pause=()=>{
      if(!syncEnabled()||!window.chengjing?.sync?.stage)return;
      window.dispatchEvent(new Event("chengjing:flush-editors"));
      void stagePendingSync(syncTransport()).catch(console.error);
    };
    const changed = () => {
      clearTimeout(quiet); quiet = setTimeout(run, 5000);
      clearTimeout(staging); staging = setTimeout(() => {
        if (syncEnabled() && window.chengjing?.sync?.stage) void stagePendingSync(syncTransport()).catch(console.error);
      }, 200);
    };
    window.addEventListener("online", run); window.addEventListener("chengjing:android-resume", run);window.addEventListener("chengjing:android-pause",pause);window.addEventListener("chengjing:sync-dirty",changed);
    return () => { clearTimeout(startup);clearTimeout(quiet);clearTimeout(staging); clearInterval(interval); window.removeEventListener("online", run); window.removeEventListener("chengjing:android-resume", run);window.removeEventListener("chengjing:android-pause",pause);window.removeEventListener("chengjing:sync-dirty",changed); };
  }, []);
  return null;
}
export function SyncSettings() {
  const { language } = useI18n(); const zh = language.startsWith("zh");
  const [enabled, setEnabled] = useState(syncEnabled); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [conflicts, setConflicts] = useState<SyncRecord[]>([]);
  const [pending, setPending] = useState(0);
  async function refresh() { setPending(await db.table("syncOutbox").count()); setConflicts(await db.table("syncRecords").filter((row: SyncRecord) => row.heads.length > 1).toArray()); }
  useEffect(() => { void refresh(); const timer=setInterval(()=>void refresh(),3000); const status=(event: Event)=>setError((event as CustomEvent<string>).detail);window.addEventListener("chengjing:sync-status",status);return()=>{clearInterval(timer);window.removeEventListener("chengjing:sync-status",status)}; }, []);
  async function connect() {
    setBusy(true); setError("");
    try {
      if(window.chengjing?.platform==="android") await androidCall("google.connect");
      else { const status=await window.chengjing?.cloudBackups?.getLocalStatus(); if(!status?.connected)await window.chengjing?.cloudBackups?.connect(); }
      if(window.chengjing?.platform==="android")await androidCall("sync.resume");
      await enableSync();setEnabled(true);await synchronize(syncTransport());await refresh();
    } catch(error) { setError(error instanceof Error?error.message:String(error)); } finally{setBusy(false)}
  }
  async function run() { setBusy(true);setError("");try{await synchronize(syncTransport());await refresh()}catch(error){setError(error instanceof Error?error.message:String(error))}finally{setBusy(false)} }
  async function bringBackup() {
    if(!window.confirm(zh?"將既有 Google 備份加入這台裝置；現有內容保留，不同版本會列為衝突。開始前會先保存本機安全副本。":"Add the existing Google backup to this device? Local content is preserved and different versions are kept as conflicts. A local safety copy is created first."))return;
    setBusy(true);setError("");
    try{const{importBackupForSync}=await import("../lib/syncBootstrap");await importBackupForSync();await enableSync();setEnabled(true);await synchronize(syncTransport());await refresh()}catch(error){setError(error instanceof Error?error.message:String(error))}finally{setBusy(false)}
  }
  return <section className="settings-section" id="sync-settings"><header><span><Cloud size={17} /> Google</span><h2>{zh?"跨裝置同步":"Cross-device sync"}</h2><p>{zh?"手機、Mac 與 Windows 共用內容。離線仍可編輯；同一筆內容衝突時保留兩份供你選擇。":"Use the same content on Android, Mac and Windows. Offline edits are kept, and conflicting versions remain available."}</p></header>
    <p>{enabled?(pending?`${pending} ${zh?"筆變更待上傳":"changes pending"}`:(zh?"已存本機・沒有待上傳變更":"Saved locally · no pending uploads")):(zh?"尚未啟用":"Not enabled")}</p>
    <button className="primary-button" disabled={busy} onClick={()=>void(enabled?run():connect())}><RefreshCw size={17} />{busy?(zh?"正在同步…":"Syncing…"):enabled?(zh?"立即同步":"Sync now"):(zh?"連結 Google 並啟用同步":"Connect Google and enable sync")}</button>
    {enabled&&<button className="text-button" onClick={()=>{localStorage.removeItem("chengjing-sync-enabled");if(window.chengjing?.platform==="android")void androidCall("sync.pause");setEnabled(false)}}>{zh?"暫停同步":"Pause sync"}</button>}
    {error&&<p role="alert"><AlertTriangle size={16} />{error}</p>}
    {enabled&&<details><summary>{zh?"從舊版電腦備份開始":"Start from a desktop backup"}</summary><p>{zh?"若電腦仍使用只有備份功能的版本，可以先帶入現有資料；雙向同步需要兩台都使用支援同步的版本。":"Import existing data if your desktop version only supports backups. Both devices need a sync-enabled release for two-way sync."}</p><button className="secondary-button" disabled={busy} onClick={()=>void bringBackup()}>{zh?"帶入現有 Google 備份":"Import existing Google backup"}</button></details>}
    {conflicts.map((record)=><details key={record.id}><summary>{zh?"需要整理的不同版本":"Versions to review"} · {String(record.heads.find(h=>h.value)?.value?.title || record.id)}</summary>{record.heads.map(head=><article key={head.id}><p>{head.value?String(head.value.plainText || head.value.text || head.value.title || JSON.stringify(head.value)):(zh?"此裝置已刪除":"Deleted on this device")}</p><button className="secondary-button" onClick={async()=>{if(!window.confirm(zh?"確定採用這個版本？其他版本仍保留在雲端操作紀錄。":"Use this version? Other versions remain in the cloud operation log."))return;if(head.value)await db.table(head.table).put(head.value);else await db.table(head.table).delete(head.key);await refresh()}}>{zh?"採用此版本":"Use this version"}</button></article>)}</details>)}
  </section>;
}
