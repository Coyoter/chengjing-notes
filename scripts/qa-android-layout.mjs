import { connectAndroid } from "./android-cdp.mjs";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const c=await connectAndroid();const out="qa-artifacts/android/ui-audit";await fs.mkdir(out,{recursive:true});
const state=`Object.values(await import(document.querySelector('link[href*="/store-"]').href)).find(v=>typeof v?.getState==='function'&&v.getState().setLanguage).getState()`;
const original=await c.evaluate(`(async()=>{const s=${state};return{theme:s.theme,fontScale:s.fontScale,view:s.view,language:s.language}})()`);
const results={navigation:{},settings:[],pages:[],failures:[]};
async function until(expression){for(let i=0;i<150;i++){if(await c.evaluate(expression))return;await new Promise(r=>setTimeout(r,80));}throw Error(`Not ready: ${expression}`);}
async function screenshot(name){const shot=await c.send("Page.captureScreenshot",{format:"png"});await fs.writeFile(`${out}/${name}.png`,Buffer.from(shot.data,"base64"));}
async function setView(view){await c.evaluate(`(async()=>{(${state}).setView(${JSON.stringify(view)})})()`);await until(`Boolean(document.querySelector('.view-${view} > :not(.workspace-lazy-placeholder)'))`);await new Promise(r=>setTimeout(r,260));}
try{
  await c.evaluate(`(async()=>{(${state}).setLanguage('zh-TW')})()`);
  await c.evaluate(`document.querySelector('.mobile-header button:last-child').click()`);
  await until(`Boolean(document.querySelector('.mobile-directory'))`);
  const top=await c.evaluate(`[...document.querySelectorAll('.mobile-directory-scroll button')].map(b=>b.querySelector('b')?.textContent||b.textContent)`);
  assert.equal(await c.evaluate(`document.querySelector('.mobile-directory header strong').textContent`),"全部功能");
  await c.evaluate(`document.querySelector('.mobile-directory header button').click()`);await until(`!document.querySelector('.mobile-directory')`);
  await c.evaluate(`document.querySelector('.mobile-nav button:last-child').click()`);await until(`Boolean(document.querySelector('.mobile-directory'))`);
  const bottom=await c.evaluate(`[...document.querySelectorAll('.mobile-directory-scroll button')].map(b=>b.querySelector('b')?.textContent||b.textContent)`);
  assert.deepEqual(top,bottom);assert.equal(top.length,12);assert.equal(top.filter(text=>text==='第二大腦').length,1);
  results.navigation={sameCompleteMenu:true,entries:top};
  await new Promise(r=>setTimeout(r,500));await screenshot("all-features");
  await c.evaluate(`document.querySelector('.mobile-directory header button').click()`);await until(`!document.querySelector('.mobile-directory')`);
  await setView("settings");
  for(const width of [320,360,411,600,820])for(const theme of ["light","dark","ink"])for(const scale of [1,1.2]){
    await c.send("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:true});
    await c.evaluate(`(async()=>{const s=${state};s.setTheme(${JSON.stringify(theme)});s.setFontScale(${scale})})()`);
    await new Promise(r=>setTimeout(r,120));
    const geometry=await c.evaluate(`(()=>{const scope=document.querySelector('.settings-page');const r=scope.getBoundingClientRect();const controls=[...scope.querySelectorAll('.theme-grid button,.theme-grid button span,.font-scale-setting button,.font-scale-setting > div,.language-grid button,.featured-models button,.settings-range,.api-key-form,.provider-api-mode')];const issues=controls.filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&(b.right>r.right+1||b.left<r.left-1||e.scrollWidth>e.clientWidth+2)}).map(e=>({className:e.className,text:e.textContent.slice(0,45),width:e.clientWidth,scroll:e.scrollWidth}));return{issues,themes:document.querySelectorAll('.theme-grid button').length,sizes:document.querySelectorAll('.font-scale-setting button').length}})()`);
    results.settings.push({width,theme,scale,...geometry});
    if(geometry.issues.length)results.failures.push({page:"settings",width,theme,scale,issues:geometry.issues});
    if(width===360&&scale===1.2&&theme!=="ink"){
      await c.evaluate(`document.querySelector('#appearance-settings').scrollIntoView({block:'start'})`);await screenshot(`appearance-${theme}-120`);
      await c.evaluate(`document.querySelector('#sync-settings').scrollIntoView({block:'start'})`);await screenshot(`sync-${theme}-120`);
    }
  }
  await c.send("Emulation.setDeviceMetricsOverride",{width:360,height:900,deviceScaleFactor:1,mobile:true});
  await c.evaluate(`(async()=>{const s=${state};s.setTheme('light');s.setFontScale(1)})()`);
  for(const page of ["fragments","tasks","journal","highlights","library","boards","kanban","database","brain","settings"]){
    await setView(page);
    const inventory=await c.evaluate(`(()=>{const root=document.querySelector('main.workspace');const r=root.getBoundingClientRect();const elements=[...root.querySelectorAll('button,input,select,textarea')].filter(e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return b.width>3&&b.height>3&&s.visibility!=='hidden'&&s.display!=='none'});return{count:elements.length,buttons:elements.filter(e=>e.tagName==='BUTTON').map(e=>({label:e.getAttribute('aria-label')||e.getAttribute('title')||e.textContent.trim().slice(0,80),width:e.offsetWidth,height:e.offsetHeight})),pageWidth:r.width,bodyOverflow:document.documentElement.scrollWidth-innerWidth}})()`);
    results.pages.push({page,...inventory});await screenshot(page);
    if(inventory.bodyOverflow>1)results.failures.push({page,overflow:inventory.bodyOverflow});
  }
}finally{
  await c.send("Emulation.clearDeviceMetricsOverride");
  await c.evaluate(`(async()=>{const s=${state};s.setTheme(${JSON.stringify(original.theme)});s.setFontScale(${original.fontScale});s.setLanguage(${JSON.stringify(original.language)});s.setView(${JSON.stringify(original.view)})})()`);
  await fs.writeFile(`${out}/report.json`,JSON.stringify(results,null,2));c.close();
}
console.log(JSON.stringify({navigation:results.navigation,settingsCases:results.settings.length,pages:results.pages.map(p=>({page:p.page,controls:p.count})),failures:results.failures},null,2));
assert.equal(results.failures.length,0,"Layout issues remain; inspect ui-audit/report.json");
