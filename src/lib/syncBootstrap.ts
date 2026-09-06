import { db } from "../db";
import { validateBackup } from "./backupValidation";
import { prepareCompleteBackup, writeRestoreSafetyBackup } from "./autoBackup";
import { restoreFileAttachment } from "./attachments";
import { applySyncPacket, initializeSyncBaseline } from "./syncEngine";
import { SYNC_TABLES, type SyncOperation } from "./syncProtocol";
import type { AttachmentRecord } from "../types";

export async function importBackupForSync() {
  const bridge=window.chengjing?.cloudBackups;
  if(!bridge)throw new Error("Cloud backup unavailable");
  await writeRestoreSafetyBackup(await prepareCompleteBackup());
  const backup=await bridge.download("current");
  const parsed=validateBackup(JSON.parse(backup.data));
  if(parsed.version!==2)throw new Error("A current complete backup is required");
  // Local edits made before sync was enabled must participate in conflict checks.
  await initializeSyncBaseline();
  const operations:SyncOperation[]=[];
  const actor=`backup-${backup.baselineManifestId}`;
  for(const table of SYNC_TABLES){
    for(const record of (parsed.data[table]||[]) as Record<string,unknown>[]){
      let value=record;
      if(table==="attachments")value=await restoreFileAttachment(record as unknown as AttachmentRecord,backup.backupFilePath) as unknown as Record<string,unknown>;
      operations.push({id:`${actor}:${table}:${value.id}`,table,key:String(value.id),clock:{[actor]:1},value});
    }
  }
  for(let index=0;index<operations.length;index+=100){
    const batch=operations.slice(index,index+100);
    await applySyncPacket({protocol:"chengjing-sync-v1",id:`${actor}-${index}`,operations:batch},{list:async()=>[],get:async()=>"",put:async()=>{},downloadAsset:async(asset)=>asset});
    await db.table("syncOutbox").bulkPut(batch);
  }
  return operations.length;
}
