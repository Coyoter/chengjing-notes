import { connectAndroid } from "./android-cdp.mjs";
import assert from "node:assert/strict";
const client=await connectAndroid();const id=`editor-qa-${Date.now()}`;
const db=`Object.values(await import(document.querySelector('link[href*="/db-"]').href)).find(value=>value?.cards&&typeof value.table==="function")`;
const store=`Object.values(await import(document.querySelector('link[href*="/store-"]').href)).find(value=>typeof value?.getState==="function"&&value.getState().setLanguage)`;
async function until(expression){for(let i=0;i<100;i++){if(await client.evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error("Editor UI did not settle");}
try{
  await client.evaluate(`(async()=>{const db=${db};const state=(${store}).getState();const now=Date.now();await db.cards.put({id:${JSON.stringify(id)},title:'QA',contentHtml:'<p></p>',plainText:'',kind:'note',state:'active',tagIds:[],attachmentIds:[],properties:{},favorite:false,color:'slate',createdAt:now,updatedAt:now});state.setLanguage('zh-TW');state.openCard(${JSON.stringify(id)})})()`);
  await until(`Boolean(document.querySelector('.card-editor-panel .prose-editor'))`);
  await client.evaluate(`document.querySelector('.card-editor-panel .prose-editor').focus()`);
  await client.send("Input.insertText",{text:"剛打完，立刻離開，也必須保存。"});
  await client.evaluate(`(async()=>{(${store}).getState().closeCard()})()`);
  await until(`(async()=>{const row=await (${db}).cards.get(${JSON.stringify(id)});return row?.plainText.includes('立刻離開')})()`);
  await client.evaluate(`(async()=>{(${store}).getState().openCard(${JSON.stringify(id)})})()`);
  await until(`Boolean(document.querySelector('.card-title-input'))`);
  await client.evaluate(`document.querySelector('.card-title-input').focus();document.querySelector('.card-title-input').select()`);
  await client.send("Input.insertText",{text:"標題立即關閉測試"});
  await client.evaluate(`(async()=>{(${store}).getState().closeCard()})()`);
  await until(`(async()=>{const row=await (${db}).cards.get(${JSON.stringify(id)});return row?.title==='標題立即關閉測試'})()`);
  console.log(JSON.stringify({bodySavedOnImmediateClose:true,titleSavedOnImmediateClose:true},null,2));
}finally{
  await client.evaluate(`(async()=>{const db=${db};await db.cards.delete(${JSON.stringify(id)});await db.cardVersions.where('cardId').equals(${JSON.stringify(id)}).delete();(${store}).getState().setView('fragments')})()`);
  client.close();
}
