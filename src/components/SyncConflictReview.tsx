import { useRef, useState } from "react";
import { ChevronDown, CopyCheck } from "lucide-react";
import { db } from "../db";
import type { AppLanguage } from "../types";
import type { SyncRecord, SyncOperation } from "../lib/syncProtocol";
import { materializedHead, operationTime } from "../lib/syncProtocol";
import { syncRecordLabel, syncVersionText } from "../lib/syncConflictPresentation";

export function SyncConflictReview({ records, language, disabled = false, onBusyChange }: {
  records: SyncRecord[]; language: AppLanguage; disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const zh=language.startsWith("zh"); const [error,setError]=useState("");
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  if(!records.length)return null;
  async function choose(head: SyncOperation, record: SyncRecord) {
    if (disabled || busy || inFlight.current) return;
    if(!window.confirm(zh?"這是誤刪或內容被覆蓋時的救援工具，日常同步不需要使用。確定復原這個舊版本？目前內容也會保留，復原後會同步到其他裝置。":"This is a recovery tool for accidental deletion or overwritten content, not a routine sync step. Restore this older version? The current content will also be preserved and the restored content will sync to your other devices."))return;
    inFlight.current = true; setBusy(true); onBusyChange?.(true);
    try {
      let value=head.value;
      if(value && head.table==="attachments") {
        if(!window.chengjing?.sync)throw new Error(zh?"附件暫時無法下載，尚未套用變更。":"Attachment unavailable. No changes were applied.");
        value=await window.chengjing.sync.downloadAsset(value);
      }
      await db.transaction("rw",db.table(head.table),db.table("syncRecords"),async()=>{
        const current:SyncRecord|undefined=await db.table("syncRecords").get(record.id);
        if(!current||current.heads.map(h=>h.id).sort().join("|")!==record.heads.map(h=>h.id).sort().join("|"))throw new Error(zh?"內容剛有新的修改，請重新確認版本。":"Content changed while you were reviewing it. Please review the versions again.");
        // A restoration is a new edit, and must itself be reversible.
        await db.table("syncRecords").put({...current,recovery:[...new Map([...(current.recovery||[]),...current.heads].map(item=>[item.id,item])).values()]});
        if(value)await db.table(head.table).put({...value,updatedAt:Date.now()});else await db.table(head.table).delete(head.key);
      });
      setError("");
    } catch(error) { setError(error instanceof Error?error.message:String(error)); }
    finally { inFlight.current = false; setBusy(false); onBusyChange?.(false); }
  }
  return <details className="sync-conflict-review">
    <summary><CopyCheck size={19}/><span><b>{zh?"個別內容的較早版本":"Earlier item versions"}</b><small>{zh?"依內容項目查看保留的較早版本":"Review earlier versions saved for individual items"}</small></span><ChevronDown size={17}/></summary>
    <div><p className="sync-recovery-hint">{zh?"澄境已自動採用最新修改。只有發現重要內容遺失時，才需要從這裡找回舊版本。":"ChengJing has already applied the latest edits. Open an older version here only if important content is missing."}</p>{records.map(record=>{const label=syncRecordLabel(record,zh);const winner=materializedHead(record.heads);return <details className="sync-conflict" key={record.id}>
      <summary><span><b>{label.name}</b><small>{label.kind}</small></span><ChevronDown size={17}/></summary>
      {(record.recovery||[]).filter(head=>head.id!==winner.id).sort((a,b)=>operationTime(b)-operationTime(a)).map((head,index)=><article key={head.id}><header><b>{operationTime(head)>0?new Intl.DateTimeFormat(language,{dateStyle:"medium",timeStyle:"short"}).format(operationTime(head)):(zh?`舊版本 ${index+1}`:`Earlier version ${index+1}`)}</b></header><p>{syncVersionText(head,zh)}</p>
        {typeof head.value?.dueAt==="number"&&<small className="sync-version-detail">{zh?"截止時間":"Due"} · {new Intl.DateTimeFormat(language,{dateStyle:"medium",timeStyle:"short"}).format(head.value.dueAt)}</small>}
        {typeof head.value?.done==="boolean"&&<small className="sync-version-detail">{head.value.done?(zh?"已完成":"Completed"):(zh?"未完成":"Not completed")}</small>}
        <button type="button" className="secondary-button" disabled={disabled || busy} onClick={()=>void choose(head,record)}>{zh?"復原此版本":"Restore this version"}</button>
      </article>)}
    </details>})}{error&&<p role="alert" className="sync-error">{error}</p>}</div>
  </details>;
}
