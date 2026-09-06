import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const browser=await chromium.connectOverCDP("http://127.0.0.1:9223",{noDefaults:true});const page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(15000);
const out="qa-artifacts/android/sync-ui";await fs.mkdir(out,{recursive:true});
const original=await page.evaluate(async()=>{window.__qaStore=Object.values(await import(document.querySelector('link[href*="/store-"]').href)).find(v=>v?.getState&&v.getState().setView);const s=window.__qaStore.getState();s.setLanguage('zh-TW');s.setView('settings');s.setTheme('dark');s.setFontScale(1.2);return{theme:s.theme,scale:s.fontScale,view:s.view};});
const results={};
try{
  await page.locator('#sync-settings .primary-button:not(:disabled)').waitFor();
  await page.evaluate(()=>{window.__qaOriginalList=window.chengjing.sync.list;window.chengjing.sync.list=()=>new Promise((resolve,reject)=>{window.__qaResolveList=resolve;window.__qaRejectList=reject;});});
  const last=await page.evaluate(()=>localStorage.getItem('chengjing-sync-last-success'));
  await page.locator('#sync-settings .primary-button').click();await page.locator('.sync-state.is-working').waitFor();
  assert.equal(await page.locator('.sync-state b').innerText(),"正在同步");
  await page.locator('#sync-settings').screenshot({path:`${out}/working.png`});results.workingState=true;
  await page.locator('.sync-pause-button').click();await page.evaluate(()=>window.__qaResolveList({files:[]}));
  await page.locator('.sync-state.is-paused').waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('chengjing-sync-last-success')),last);results.pauseDoesNotFakeSuccess=true;
  await page.evaluate(()=>{window.chengjing.sync.list=window.__qaOriginalList;});
  await page.locator('#sync-settings .primary-button').click();await page.locator('#sync-settings .primary-button:not(:disabled)').waitFor({timeout:60000});
  await page.evaluate(()=>{delete window.__qaRejectList;window.chengjing.sync.list=()=>new Promise((resolve,reject)=>{window.__qaRejectList=reject;});});
  await page.locator('#sync-settings .primary-button').click();await page.waitForFunction(()=>typeof window.__qaRejectList==='function');
  await page.evaluate(()=>window.__qaRejectList(new Error('測試：網路暫時無法連線，資料仍在本機。')));await page.locator('.sync-state.is-error').waitFor();
  await page.locator('#sync-settings').screenshot({path:`${out}/error.png`});results.errorState=true;
  await page.evaluate(()=>{window.chengjing.sync.list=window.__qaOriginalList;});await page.locator('#sync-settings .primary-button').click();await page.locator('#sync-settings .primary-button:not(:disabled)').waitFor({timeout:60000});
  const alignment=await page.locator('#sync-settings .primary-button').evaluate(button=>{const bounds=button.getBoundingClientRect();const boxes=[...button.children].map(e=>e.getBoundingClientRect());const left=Math.min(...boxes.map(b=>b.left)),right=Math.max(...boxes.map(b=>b.right)),top=Math.min(...boxes.map(b=>b.top)),bottom=Math.max(...boxes.map(b=>b.bottom));return{x:Math.abs((left+right)/2-(bounds.left+bounds.right)/2),y:Math.abs((top+bottom)/2-(bounds.top+bounds.bottom)/2)}});
  assert.ok(alignment.x<1&&alignment.y<1);results.buttonCentered=alignment;
  assert.equal(await page.locator('#sync-settings .backup-import-tools').count(),0);assert.equal(await page.locator('#backup-settings .backup-import-tools').count(),1);results.importSeparatedFromSync=true;
  assert.ok(!/knowledgeGroups:|tags:tag-|highlights:highlight-/.test(await page.locator('#sync-settings').innerText()));results.noInternalIds=true;
  await page.locator('#sync-settings').screenshot({path:`${out}/ready.png`});
  await fs.writeFile(`${out}/report.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{
  await page.evaluate(original=>{if(window.__qaOriginalList)window.chengjing.sync.list=window.__qaOriginalList;const s=window.__qaStore.getState();s.setTheme(original.theme);s.setFontScale(original.scale);s.setView(original.view);delete window.__qaOriginalList;delete window.__qaStore;delete window.__qaResolveList;delete window.__qaRejectList;},original);await browser.close();
}
