import {chromium} from 'playwright';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec=promisify(execFile),adb='/Users/coyoter/Library/Android/sdk/platform-tools/adb';
const out='qa-artifacts/android/startup';await fs.mkdir(out,{recursive:true});
async function connect(){for(let i=0;i<40;i++){try{const {stdout}=await exec(adb,['shell','pidof','tw.techtarian.chengjing']);await exec(adb,['forward','tcp:9223',`localabstract:webview_devtools_remote_${stdout.trim()}`]);return await chromium.connectOverCDP('http://127.0.0.1:9223',{noDefaults:true,timeout:1000});}catch{await new Promise(r=>setTimeout(r,150));}}throw Error('App did not reopen');}
let browser=await connect();let page=browser.contexts()[0].pages()[0];
const state=async(p)=>p.evaluate(async()=>Object.values(await import(document.querySelector('link[href*="/store-"]').href)).find(v=>v?.getState&&v.getState().setTheme).getState().theme);
const originalTheme=await state(page);const originalNight=(await exec(adb,['shell','cmd','uimode','night'])).stdout.match(/Night mode: (\w+)/)?.[1];
assert.ok(['yes','no','auto','custom'].includes(originalNight));const results=[];
try{
 for(const test of[{name:'light',theme:'light',system:'no',expected:'light'},{name:'dark',theme:'dark',system:'no',expected:'dark'},{name:'system-dark',theme:'system',system:'yes',expected:'dark'}]){
  await page.evaluate(async theme=>Object.values(await import(document.querySelector('link[href*="/store-"]').href)).find(v=>v?.getState&&v.getState().setTheme).getState().setTheme(theme),test.theme);
  await page.waitForTimeout(350);await browser.close();
  await exec(adb,['shell','am','force-stop','tw.techtarian.chengjing']);await exec(adb,['shell','cmd','uimode','night',test.system]);
  const remote=`/sdcard/chengjing-start-${test.name}.mp4`;const recording=spawn(adb,['shell','screenrecord','--time-limit','5','--bit-rate','2500000',remote]);
  const recorded=new Promise((resolve,reject)=>recording.on('exit',code=>code===0?resolve():reject(Error('Screen recording failed'))));
  await new Promise(r=>setTimeout(r,250));const start=Date.now();
  await exec(adb,['shell','am','start','-n','tw.techtarian.chengjing/.MainActivity']);
  // Attaching a debugger during navigation can pause the WebView. Capture the
  // user-visible launch first, then attach for assertions (not a speed benchmark).
  await recorded;await exec(adb,['pull',remote,`${out}/${test.name}.mp4`]);
  browser=await connect();page=browser.contexts()[0].pages()[0];
  await page.locator('.mobile-capture-page textarea').waitFor({timeout:15000});
  const result=await page.evaluate(()=>({theme:document.documentElement.dataset.theme,extraLogo:!!document.querySelector('.launch-screen img'),color:getComputedStyle(document.body).backgroundColor,ready:!!document.querySelector('.mobile-capture-page textarea')}));
  assert.equal(result.theme,test.expected);assert.equal(result.extraLogo,false);results.push({name:test.name,...result,verificationMs:Date.now()-start,measurement:"Debugger attached after the 5-second recording; not a startup benchmark"});
  await exec('/opt/homebrew/bin/ffmpeg',['-hide_banner','-loglevel','error','-y','-i',`${out}/${test.name}.mp4`,'-vf','fps=4,scale=216:-1,tile=5x4','-frames:v','1',`${out}/${test.name}-frames.png`]);
 }
 await fs.writeFile(`${out}/report.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{
 await exec(adb,['shell','cmd','uimode','night',originalNight]);
 if(page&&!page.isClosed())await page.evaluate(async theme=>Object.values(await import(document.querySelector('link[href*="/store-"]').href)).find(v=>v?.getState&&v.getState().setTheme).getState().setTheme(theme),originalTheme).catch(()=>{});
 await browser?.close().catch(()=>{});
}
