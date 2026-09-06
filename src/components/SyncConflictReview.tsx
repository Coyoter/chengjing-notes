import { useState } from "react";
import { ChevronDown, CopyCheck } from "lucide-react";
import { db } from "../db";
import type { AppLanguage } from "../types";
import type { SyncRecord, SyncOperation } from "../lib/syncProtocol";
import { syncRecordLabel, syncVersionText } from "../lib/syncConflictPresentation";

export function SyncConflictReview({ records, language }: { records: SyncRecord[]; language: AppLanguage }) {
  const zh=language.startsWith("zh"); const [error,setError]=useState("");
  if(!records.length)return null;
  async function choose(head: SyncOperation, record: SyncRecord) {
    if(!window.confirm(zh?"確定採用這個版本？兩個版本目前都已保留；採用後會以選定內容繼續同步。":"Use this version? Both versions are currently preserved. Your choice becomes the content used for future sync."))return;
    try {
      let value=head.value;
      if(value && head.table==="attachments") {
        if(!window.chengjing?.sync)throw new Error(zh?"附件暫時無法下載，尚未套用變更。":"Attachment unavailable. No changes were applied.");
        value=await window.chengjing.sync.downloadAsset(value);
      }
      await db.transaction("rw",db.table(head.table),db.table("syncRecords"),async()=>{
        const current:SyncRecord|undefined=await db.table("syncRecords").get(record.id);
        if(!current||current.heads.map(h=>h.id).sort().join("|")!==record.heads.map(h=>h.id).sort().join("|"))throw new Error(zh?"內容剛有新的修改，請重新確認版本。":"Content changed while you were reviewing it. Please review the versions again.");
        if(value)await db.table(head.table).put(value);else await db.table(head.table).delete(head.key);
      });
      setError("");
    } catch(error) { setError(error instanceof Error?error.message:String(error)); }
  }
  return <details className="sync-conflict-review">
    <summary><CopyCheck size={19}/><span><b>{zh?`有 ${records.length} 項內容需要確認`:`${records.length} items need review`}</b><small>{zh?"不同裝置的修改都已保留":"Changes from both devices are preserved"}</small></span><ChevronDown size={17}/></summary>
    <div>{records.map(record=>{const label=syncRecordLabel(record,zh);return <details className="sync-conflict" key={record.id}>
      <summary><span><b>{label.name}</b><small>{label.kind}</small></span><ChevronDown size={17}/></summary>
      {record.heads.map((head,index)=><article key={head.id}><header><b>{zh?`版本 ${index+1}`:`Version ${index+1}`}</b></header><p>{syncVersionText(head,zh)}</p>
        {typeof head.value?.dueAt==="number"&&<small className="sync-version-detail">{zh?"截止時間":"Due"} · {new Intl.DateTimeFormat(language,{dateStyle:"medium",timeStyle:"short"}).format(head.value.dueAt)}</small>}
        {typeof head.value?.done==="boolean"&&<small className="sync-version-detail">{head.value.done?(zh?"已完成":"Completed"):(zh?"未完成":"Not completed")}</small>}
        <button type="button" className="secondary-button" onClick={()=>void choose(head,record)}>{zh?"採用此版本":"Use this version"}</button>
      </article>)}
    </details>})}{error&&<p role="alert" className="sync-error">{error}</p>}</div>
  </details>;
}
