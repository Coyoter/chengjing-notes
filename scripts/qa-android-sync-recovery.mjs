// Uses only the isolated WebView profile; never connects to Google or personal content.
import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const browser=await chromium.connectOverCDP("http://127.0.0.1:9223",{noDefaults:true});
const page=browser.contexts()[0].pages().find(p=>p.url().includes("appassets.androidplatform.net"));
const id=`isolated-recovery-${crypto.randomUUID()}`;
const out="qa-artifacts/android/recovery";await fs.mkdir(out,{recursive:true});
let original;
try {
  original=await page.evaluate(async id=>{
    if(document.documentElement.dataset.qaIsolated!=="true")throw Error("Isolated workspace required");
    window.__qaDb=Object.values(await import(document.querySelector('link[href*="/db-"]').href)).find(v=>v?.cards&&v.table);
    window.__qaStore=Object.values(await import(document.querySelector('link[href*="/store-"]').href)).find(v=>v?.getState&&v.getState().setView);
    const state=window.__qaStore.getState();const previous={view:state.view,language:state.language,theme:state.theme,scale:state.fontScale,tracking:localStorage.getItem('chengjing-sync-tracking')};
    localStorage.removeItem('chengjing-sync-enabled');localStorage.setItem('chengjing-sync-tracking','true');
    const value={id,text:"最新內容已自動使用",pinned:false,tagIds:[],createdAt:1000,updatedAt:3000};
    await window.__qaDb.fragments.put(value);
    await window.__qaDb.table('syncRecords').put({id:`fragments:${id}`,heads:[{id:`${id}-latest`,table:'fragments',key:id,clock:{phone:1},changedAt:3000,value}],recovery:[{id:`${id}-earlier`,table:'fragments',key:id,clock:{mac:1},changedAt:2000,value:{...value,text:"需要時才復原這段舊內容",updatedAt:2000}}]});
    window.__qaBridge=window.chengjing.sync;window.chengjing.sync={list:async()=>{throw Error('No network allowed in isolated QA')}};
    state.setLanguage('zh-TW');state.setTheme('dark');state.setFontScale(1.2);state.setView('settings');return previous;
  },id);
  const review=page.locator('.sync-conflict-review');await review.waitFor();
  assert.equal(await review.getAttribute('open'),null);
  assert.ok(!/需要確認|採用此版本/.test(await page.locator('#sync-settings').innerText()));
  await review.locator(':scope > summary').click();await review.locator('.sync-conflict > summary').filter({hasText:'最新內容'}).click();
  await review.screenshot({path:`${out}/recovery.png`});
  page.once('dialog',dialog=>{assert.match(dialog.message(),/日常同步不需要使用/);void dialog.accept()});
  await review.getByRole('button',{name:'復原此版本',exact:true}).click();
  await page.waitForFunction(async id=>(await window.__qaDb.fragments.get(id)).text==='需要時才復原這段舊內容',id);
  const record=await page.evaluate(id=>window.__qaDb.table('syncRecords').get(`fragments:${id}`),id);
  assert.equal(record.heads.length,1);assert.ok(record.heads[0].changedAt>3000);
  assert.ok(record.recovery.some(head=>head.value?.text==='最新內容已自動使用'));
  const result={isolated:true,collapsedByDefault:true,noRoutineVersionPrompt:true,confirmedRecoveryWorks:true,currentContentRetainedAfterRestore:true};
  await fs.writeFile(`${out}/report.json`,JSON.stringify(result,null,2));console.log(result);
} finally {
  if(original)await page.evaluate(async({id,original})=>{
    await window.__qaDb.fragments.delete(id);
    await window.__qaDb.table('syncRecords').delete(`fragments:${id}`);
    await window.__qaDb.table('syncOutbox').filter(op=>op.key===id).delete();
    window.chengjing.sync=window.__qaBridge;
    if(original.tracking)localStorage.setItem('chengjing-sync-tracking',original.tracking);else localStorage.removeItem('chengjing-sync-tracking');
    const s=window.__qaStore.getState();s.setView(original.view);s.setLanguage(original.language);s.setTheme(original.theme);s.setFontScale(original.scale);
    delete window.__qaDb;delete window.__qaStore;delete window.__qaBridge;
  },{id,original});
  await browser.close();
}
