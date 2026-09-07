import { useEffect, useState, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Cloud, CloudCheck, RefreshCw, AlertTriangle, Pause, Clock3 } from "lucide-react";
import { db } from "../db";
import { androidCall } from "../platform/android";
import { enableSync, synchronize, stagePendingSync } from "../lib/syncEngine";
import { syncEnabled } from "../lib/syncJournal";
import type { SyncRecord } from "../lib/syncProtocol";
import { useI18n } from "../hooks/useI18n";
import { getSyncActivity, subscribeSyncActivity, reportSyncActivity, syncStatusKind } from "../lib/syncActivity";
import "./sync-settings.css";
import { SyncConflictReview } from "./SyncConflictReview";

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
      reportSyncActivity("syncing");
      void synchronize(syncTransport()).then(() => reportSyncActivity("idle","",syncEnabled())).catch((error) => reportSyncActivity("error", error.message));
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
  const activity = useSyncExternalStore(subscribeSyncActivity, getSyncActivity);
  const pending = useLiveQuery(() => db.table("syncOutbox").count(), [], 0);
  const conflicts = useLiveQuery(() => db.table("syncRecords").filter((row: SyncRecord) => Boolean(row.recovery?.length)).toArray() as Promise<SyncRecord[]>, [], []);
  const working = busy || activity.phase === "syncing";
  const message = error || (activity.phase === "error" ? activity.error : "");
  const kind = syncStatusKind(enabled, working, message, pending, activity.lastSuccessAt);
  const labels = zh ? {
    working:["正在同步", ""], error:["同步尚未完成", "資料仍保存在這台裝置，請稍後再試。"],
    paused:["同步已暫停", ""], pending:["等待同步", "內容已保存在這台裝置。"],
    ready:["已同步", ""], waiting:["準備同步", "首次同步尚未完成。"],
  } : {
    working:["Syncing", ""], error:["Sync is incomplete", "Your data remains on this device. Please try again."],
    paused:["Sync is paused", ""], pending:["Waiting to sync", "Your changes are saved on this device."],
    ready:["Synced", ""], waiting:["Ready to sync", "The first sync has not completed yet."],
  };
  const StatusIcon = kind === "working" ? RefreshCw : kind === "error" ? AlertTriangle : kind === "paused" ? Pause : kind === "ready" ? CloudCheck : Clock3;
  async function connect() {
    setBusy(true); setError("");
    try {
      if(window.chengjing?.platform==="android") await androidCall("google.connect");
      else { const status=await window.chengjing?.cloudBackups?.getLocalStatus(); if(!status?.connected)await window.chengjing?.cloudBackups?.connect(); }
      if(window.chengjing?.platform==="android")await androidCall("sync.resume");
      await enableSync();setEnabled(true);reportSyncActivity("syncing");await synchronize(syncTransport());reportSyncActivity("idle","",syncEnabled());
    } catch(error) { const detail=error instanceof Error?error.message:String(error);setError(detail);reportSyncActivity("error",detail); } finally{setBusy(false)}
  }
  async function run() { setBusy(true);setError("");reportSyncActivity("syncing");try{await synchronize(syncTransport());reportSyncActivity("idle","",syncEnabled())}catch(error){const detail=error instanceof Error?error.message:String(error);setError(detail);reportSyncActivity("error",detail)}finally{setBusy(false)} }
  async function pause() {
    localStorage.removeItem("chengjing-sync-enabled");setEnabled(false);setError("");
    try { if(window.chengjing?.platform==="android")await androidCall("sync.pause"); }
    catch(error) { setError(error instanceof Error?error.message:String(error)); }
  }
  return <article className="backup-method-card cloud-method sync-settings" id="sync-settings">
    <header>
    <i className="backup-method-icon"><Cloud size={20} /></i>
    <span>
      <h4>{zh?"Google 同步":"Google Sync"}</h4>
      <p>{zh?"登入同一個 Google 帳號，在不同裝置間接續內容。首次同步會合併資料；同一筆內容自動採用最新修改。":"Sign in to the same Google account to continue across devices. First sync combines your data; the latest edit is used for each item."}</p>
    </span>
  </header>
    <div className={`sync-state is-${kind}`} role="status" aria-live="polite" aria-busy={working}>
      <StatusIcon size={21} className={working?"spin":""}/><div><b>{labels[kind][0]}</b>{labels[kind][1]&&<p>{labels[kind][1]}</p>}{activity.lastSuccessAt>0&&<small>{zh?"上次完成":"Last completed"} · {new Intl.DateTimeFormat(language,{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(activity.lastSuccessAt)}</small>}</div>
    </div>
    <div className="sync-actions"><button type="button" className="primary-button" disabled={working} onClick={()=>void(enabled?run():connect())}><RefreshCw size={17} className={working?"spin":""}/><span>{working?(zh?"正在同步…":"Syncing…"):enabled?(zh?"立即同步":"Sync now"):(zh?"啟用 Google 同步":"Enable Google sync")}</span></button>
      {enabled&&<button type="button" className="sync-pause-button" onClick={()=>void pause()}><Pause size={15}/><span>{zh?"暫停同步":"Pause sync"}</span></button>}
    </div>
    {message&&<div className="sync-error" role="alert"><AlertTriangle size={16}/><p>{message}</p></div>}
    <SyncConflictReview records={conflicts} language={language}/>
  </article>;
}
