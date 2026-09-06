import { connectAndroid } from "./android-cdp.mjs";
import fs from "node:fs/promises";
import assert from "node:assert/strict";

const client=await connectAndroid();
const output="qa-artifacts/android";await fs.mkdir(output,{recursive:true});
async function screenshot(name){const data=await client.send("Page.captureScreenshot",{format:"png"});await fs.writeFile(`${output}/${name}.png`,Buffer.from(data.data,"base64"));}
async function until(expression){for(let i=0;i<80;i++){if(await client.evaluate(expression))return;await new Promise(r=>setTimeout(r,100))}throw Error(`UI did not settle: ${expression}`)}
try{
  await client.evaluate(`document.querySelector('.mobile-nav button').click()`);
  await until(`Boolean(document.querySelector('.view-fragments .mobile-capture-composer textarea'))`);
  await client.evaluate(`document.querySelector('.mobile-capture-composer textarea').focus()`);
  await client.send("Input.insertText",{text:"Android 驗收：靈光一閃，離線也能保存。"});
  await client.evaluate(`document.querySelector('.mobile-capture-composer footer button').click()`);
  await until(`document.querySelector('.mobile-thought-stream')?.textContent.includes('Android 驗收：靈光一閃')`);
  await client.evaluate(`document.activeElement.blur()`);
  await screenshot("capture");
  await client.evaluate(`document.querySelector('.capture-kind-switch button:nth-child(2)').click()`);
  await client.send("Input.insertText",{text:"Android 驗收：明天整理研究筆記"});
  await client.evaluate(`document.querySelector('.mobile-capture-composer footer button').click()`);
  await client.evaluate(`document.querySelector('.mobile-nav button:nth-child(2)').click()`);
  await until(`document.body.textContent.includes('Android 驗收：明天整理研究筆記')`);
  await screenshot("tasks");
  await client.evaluate(`document.querySelector('.mobile-nav button:nth-child(3)').click()`);
  await until(`Boolean(document.querySelector('.brain-mobile-bar'))`);
  assert.equal(await client.evaluate(`Boolean(document.querySelector('.brain-toolbar'))`),false);
  await screenshot("brain");
  await client.evaluate(`document.querySelector('.mobile-header button:last-child').click()`);
  await until(`Boolean(document.querySelector('.mobile-directory'))`);
  await new Promise(r=>setTimeout(r,400));
  await screenshot("directory");
  const geometry=await client.evaluate(`({width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,nav:getComputedStyle(document.querySelector('.mobile-nav')).backgroundColor,canvas:getComputedStyle(document.body).backgroundColor,menu:document.querySelector('.mobile-directory').getBoundingClientRect().width})`);
  assert.equal(geometry.overflow,0);
  console.log(JSON.stringify({captureSaved:true,taskSaved:true,brainToolsCollapsed:true,directoryVisible:true,geometry},null,2));
}finally{client.close()}
