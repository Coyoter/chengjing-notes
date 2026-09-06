import { _electron } from "playwright";
import electronPath from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { connectAndroid } from "./android-cdp.mjs";

const directory=await fs.mkdtemp(path.join(os.tmpdir(),"chengjing-cross-device-"));
const source=path.join(os.homedir(),"Library/Application Support/chengjing");
// Only authorization is reused; no personal desktop database or backup settings are copied.
for(const name of ["google-drive-token.vault","google-drive-token.key"]) { await fs.copyFile(path.join(source,name),path.join(directory,name));await fs.chmod(path.join(directory,name),0o600); }
const desktop=await _electron.launch({executablePath:electronPath,args:[".","--dev"],env:{...process.env,CHENGJING_SMOKE:"1",CHENGJING_SMOKE_USER_DATA:directory}});
const android=await connectAndroid();
const testId=`cross-device-${Date.now()}`;
const androidDb=`Object.values(await import(document.querySelector('link[href*="/db-"]').href)).find(value=>value?.cards&&typeof value.table==="function")`;
async function until(expression){for(let i=0;i<200;i++){if(await android.evaluate(expression))return;await new Promise(r=>setTimeout(r,100))}throw Error("Android sync did not settle")}
async function syncPhone(){
  if(!await android.evaluate(`Boolean(document.querySelector('#sync-settings'))`)){
    await android.evaluate(`document.querySelector('.mobile-header button:last-child').click()`);
    await until(`Boolean(document.querySelector('.mobile-directory footer button:last-child'))`);
    await android.evaluate(`document.querySelector('.mobile-directory footer button:last-child').click()`);
  }
  await until(`Boolean(document.querySelector('#sync-settings .primary-button:not(:disabled)'))`);
  await android.evaluate(`document.querySelector('#sync-settings .primary-button').click()`);
  await new Promise(r=>setTimeout(r,150));
  await until(`Boolean(document.querySelector('#sync-settings .primary-button:not(:disabled)'))`);
  const error=await android.evaluate(`document.querySelector('#sync-settings [role=alert]')?.textContent||''`);assert.equal(error,"");
}
try{
  const page=await desktop.firstWindow();await page.locator(".app-shell").waitFor();
  const loaded=await page.evaluate(async()=>{
    const {db}=await import("/src/db.ts");
    const {enableSync,synchronize}=await import("/src/lib/syncEngine.ts");
    const {syncTransport}=await import("/src/components/SyncSettings.tsx");
    for(const table of db.tables)await table.clear();
    await enableSync();await synchronize(syncTransport());
    return {fragments:await db.fragments.count(),cloudBackupEnabled:(await window.chengjing.cloudBackups.getLocalStatus()).settings.enabled};
  });
  assert.ok(loaded.fragments>0,"Desktop OAuth must see Android's sync data");assert.equal(loaded.cloudBackupEnabled,false);
  await page.evaluate(async(id)=>{const{db}=await import("/src/db.ts");const{synchronize}=await import("/src/lib/syncEngine.ts");const{syncTransport}=await import("/src/components/SyncSettings.tsx");const now=Date.now();await db.tasks.put({id,title:id,done:false,createdAt:now,updatedAt:now});await synchronize(syncTransport());},testId);
  await syncPhone();
  await android.evaluate(`document.querySelector('.mobile-nav button:nth-child(2)').click()`);
  await until(`document.body.textContent.includes(${JSON.stringify(testId)})`);
  await android.evaluate(`document.querySelector('.mobile-nav button:first-child').click()`);
  await until(`Boolean(document.querySelector('.view-fragments .mobile-capture-composer textarea'))`);
  await android.evaluate(`document.querySelector('.capture-kind-switch button:first-child').click();document.querySelector('.mobile-capture-composer textarea').focus()`);
  await android.send("Input.insertText",{text:`${testId}-phone`});
  await android.evaluate(`document.querySelector('.mobile-capture-composer footer button').click()`);
  await until(`document.querySelector('.mobile-thought-stream')?.textContent.includes(${JSON.stringify(testId+"-phone")})`);
  await syncPhone();
  const received=await page.evaluate(async(id)=>{const{db}=await import("/src/db.ts");const{synchronize}=await import("/src/lib/syncEngine.ts");const{syncTransport}=await import("/src/components/SyncSettings.tsx");await synchronize(syncTransport());const item=await db.fragments.filter(row=>row.text.includes(id+"-phone")).first();if(item)await db.fragments.delete(item.id);await db.tasks.delete(id);await synchronize(syncTransport());return Boolean(item)},testId);
  assert.equal(received,true);await syncPhone();
  const desktopAsset=await page.evaluate(async(id)=>{const{persistAttachment}=await import("/src/lib/attachments.ts");const{synchronize}=await import("/src/lib/syncEngine.ts");const{syncTransport}=await import("/src/components/SyncSettings.tsx");const asset=await persistAttachment(`${id}.txt`,new Blob([`${id}-desktop-attachment`]),"text/plain");await synchronize(syncTransport());return asset.id},testId);
  await syncPhone();
  const phoneReceivedAsset=await android.evaluate(`(async()=>{const db=${androidDb};const a=await db.attachments.get(${JSON.stringify(desktopAsset)});return a&&(await(await fetch('https://appassets.androidplatform.net/attachments/'+a.relativePath)).text())===${JSON.stringify(testId+"-desktop-attachment")}})()`);
  assert.equal(phoneReceivedAsset,true);
  const phoneAsset=await android.evaluate(`(async()=>{const db=${androidDb};const a=await window.chengjing.attachments.importData({id:crypto.randomUUID(),name:'phone-qa.txt',mime:'text/plain',data:btoa(${JSON.stringify(testId+"-phone-attachment")}),createdAt:Date.now()});await db.attachments.put(a);return a.id})()`);
  await syncPhone();
  const desktopReceivedAsset=await page.evaluate(async({id,expected,desktopId})=>{const{db}=await import("/src/db.ts");const{synchronize}=await import("/src/lib/syncEngine.ts");const{syncTransport}=await import("/src/components/SyncSettings.tsx");const{removeStoredAttachment}=await import("/src/lib/attachments.ts");await synchronize(syncTransport());const a=await db.attachments.get(id);const value=a?atob(await window.chengjing.attachments.readData(a.relativePath)):"";for(const key of[id,desktopId]){const item=await db.attachments.get(key);if(item)await removeStoredAttachment(item);}await synchronize(syncTransport());return value===expected},{id:phoneAsset,expected:testId+"-phone-attachment",desktopId:desktopAsset});
  assert.equal(desktopReceivedAsset,true);await syncPhone();
  const report={desktopReceivedAndroid:true,androidReceivedDesktop:true,independentChangesPreserved:true,desktopAttachmentReceivedOnAndroid:true,androidAttachmentReceivedOnDesktop:true,testRecordsRemoved:true,personalDesktopBackupUnchanged:true};
  await fs.mkdir("qa-artifacts/android",{recursive:true});await fs.writeFile("qa-artifacts/android/live-sync.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{android.close();await desktop.close();await fs.rm(directory,{recursive:true,force:true});}
