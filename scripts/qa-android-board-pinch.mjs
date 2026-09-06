import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223',{noDefaults:true});
const page=browser.contexts()[0].pages().find(p=>p.url().includes('appassets.androidplatform.net'));
const c=await page.context().newCDPSession(page);const id=`pinch-qa-${crypto.randomUUID()}`;const results={};
const out='qa-artifacts/android/pinch';await fs.mkdir(out,{recursive:true});let original;
async function viewport(){return page.locator('.react-flow__viewport').evaluate(el=>{const m=new DOMMatrix(getComputedStyle(el).transform);return{x:m.e,y:m.f,zoom:m.a}})}
async function touches(type,points){await c.send('Input.dispatchTouchEvent',{type,touchPoints:points.map((p,i)=>({id:p.id??i+1,x:p.x,y:p.y,radiusX:4,radiusY:4}))});await page.waitForTimeout(32);}
async function pinch(center,from,to){await touches('touchStart',[{x:center.x-from,y:center.y},{x:center.x+from,y:center.y}]);for(let i=1;i<=8;i++){const d=from+(to-from)*i/8;await touches('touchMove',[{x:center.x-d,y:center.y},{x:center.x+d,y:center.y}]);}await touches('touchEnd',[]);await page.waitForTimeout(300);}
async function fit(){await page.locator('.board-toolbar button').nth(8).click();await page.waitForTimeout(600);}
async function nodeCenter(index){const r=await page.locator(`.react-flow__node[data-id="${id}-n${index}"]`).boundingBox();return{x:r.x+r.width/2,y:r.y+r.height*.65}}
try {
  original=await page.evaluate(async id=>{
    if(document.documentElement.dataset.qaIsolated!=='true')throw Error('Isolated QA workspace required');
    window.__pinchDb=Object.values(await import(document.querySelector('link[href*="/db-"]').href)).find(v=>v?.cards&&v.table);
    window.__pinchStore=Object.values(await import(document.querySelector('link[href*="/store-"]').href)).find(v=>v?.getState&&v.getState().setView);
    const s=window.__pinchStore.getState(),now=Date.now();const before={view:s.view,board:s.selectedBoardId,language:s.language};
    const sample={kind:'note',state:'active',tagIds:[],favorite:false,color:'',attachmentIds:[],properties:{}};
    await window.__pinchDb.boards.put({id,title:'雙指手勢驗收',description:'',favorite:false,tagIds:[],createdAt:now,updatedAt:now});
    for(let i=0;i<2;i++){await window.__pinchDb.cards.put({...sample,id:`${id}-c${i}`,title:`測試卡片 ${i+1}`,contentHtml:'<p>雙指縮放不能拖動這張卡片。</p>',plainText:'雙指縮放不能拖動這張卡片。',createdAt:now,updatedAt:now});await window.__pinchDb.boardNodes.put({id:`${id}-n${i}`,boardId:id,kind:'card',cardId:`${id}-c${i}`,x:i*350,y:0,width:265,height:190});}
    s.setLanguage('zh-TW');s.openBoard(id);return before;
  },id);
  await page.locator(`[data-id="${id}-n1"]`).waitFor();await page.waitForTimeout(700);
  const area=await page.locator('.react-flow').boundingBox();const blank={x:area.x+area.width/2,y:area.y+area.height*.23};
  const initial=await viewport();await pinch(blank,30,60);const spread=await viewport();assert.ok(spread.zoom>initial.zoom*1.6);results.emptyCanvasPinch=true;
  await pinch(blank,60,30);assert.ok((await viewport()).zoom<spread.zoom*.7);results.pinchBothDirections=true;
  await touches('touchStart',[{x:blank.x-25,y:blank.y},{x:blank.x+25,y:blank.y}]);await touches('touchMove',[{x:blank.x-40,y:blank.y},{x:blank.x+40,y:blank.y}]);
  const twoFingerEnd=await viewport();await touches('touchEnd',[{id:1,x:blank.x-40,y:blank.y}]);await touches('touchMove',[{id:1,x:blank.x-10,y:blank.y+25}]);
  assert.deepEqual(await viewport(),twoFingerEnd);await touches('touchEnd',[]);await page.waitForTimeout(300);results.remainingFingerDoesNotJump=true;
  await fit();const beforeNodes=await page.evaluate(id=>window.__pinchDb.boardNodes.where('boardId').equals(id).toArray(),id);
  const center=await nodeCenter(0),before=await viewport();await pinch(center,20,45);assert.ok((await viewport()).zoom>before.zoom*1.5);
  const afterNodes=await page.evaluate(id=>window.__pinchDb.boardNodes.where('boardId').equals(id).toArray(),id);assert.deepEqual(afterNodes,beforeNodes);results.pinchOverCardDoesNotMoveCard=true;
  await touches('touchStart',[{x:blank.x-25,y:blank.y},{x:blank.x+25,y:blank.y}]);await touches('touchCancel',[]);await page.waitForTimeout(300);results.cancelGestureHandled=true;
  await fit();const panStart=await viewport();await touches('touchStart',[blank]);await touches('touchMove',[{x:blank.x+36,y:blank.y+20}]);await touches('touchEnd',[]);const panned=await viewport();assert.ok(Math.abs(panned.x-panStart.x)>20);assert.ok(Math.abs(panned.zoom-panStart.zoom)<.01);results.oneFingerPanPreserved=true;
  await fit();const header=await page.locator(`[data-id="${id}-n0"] .flow-card header`).boundingBox();const origin={x:header.x+header.width/2,y:header.y+header.height/2};
  await touches('touchStart',[origin]);for(let i=1;i<=5;i++)await touches('touchMove',[{x:origin.x+i*6,y:origin.y+i*3}]);await touches('touchEnd',[]);
  await page.waitForFunction(async id=>(await window.__pinchDb.boardNodes.get(`${id}-n0`)).x>10,id);results.oneFingerNodeDragPreserved=true;
  await fit();await page.locator('.board-toolbar button').nth(1).click();await page.locator(`[data-id="${id}-n0"] .flow-card header`).click();await page.locator(`[data-id="${id}-n1"] .flow-card header`).click();
  await page.waitForFunction(async id=>(await window.__pinchDb.boardEdges.where('boardId').equals(id).count())===1,id);results.tapToConnectPreserved=true;
  await page.locator('.board-toolbar button').first().click();const title=page.locator(`[data-id="${id}-n0"] .board-card-title`);await title.fill('縮放後仍可編輯');await page.locator('.board-toolbar button').first().click();await page.waitForFunction(async id=>(await window.__pinchDb.cards.get(`${id}-c0`)).title==='縮放後仍可編輯',id);results.inlineEditingPreserved=true;
  await page.screenshot({path:`${out}/board.png`});await fs.writeFile(`${out}/report.json`,JSON.stringify(results,null,2));console.log(results);
}catch(error){await page.screenshot({path:`${out}/failure.png`});throw error;}finally{
  await touches('touchCancel',[]).catch(()=>{});
  if(original)await page.evaluate(async({id,original})=>{const db=window.__pinchDb;await db.boardEdges.where('boardId').equals(id).delete();await db.boardNodes.bulkDelete([`${id}-n0`,`${id}-n1`]);await db.cards.bulkDelete([`${id}-c0`,`${id}-c1`]);await db.cardVersions.filter(row=>row.cardId===`${id}-c0`||row.cardId===`${id}-c1`).delete();await db.boards.delete(id);const s=window.__pinchStore.getState();if(original.board)s.openBoard(original.board);s.setView(original.view);s.setLanguage(original.language);delete window.__pinchDb;delete window.__pinchStore;},{id,original});
  await browser.close();
}
