import { chromium } from "playwright";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const browser=await chromium.connectOverCDP("http://127.0.0.1:9223",{noDefaults:true});
const page=browser.contexts()[0].pages().find(p=>p.url().includes("appassets.androidplatform.net"));
page.setDefaultTimeout(9000);
const touch=await page.context().newCDPSession(page);
const prefix=`手機功能驗收-${Date.now()}`;const created=[];const results={};
const out="qa-artifacts/android/core";await fs.mkdir(out,{recursive:true});
const original=await page.evaluate(async()=>{
  if(document.documentElement.dataset.qaIsolated!=="true")throw Error("Refusing to run mutation tests outside the isolated QA workspace");
  window.__qaDB=Object.values(await import(document.querySelector('link[href*="/db-"]').href)).find(v=>v?.cards&&v.table);
  window.__qaStore=Object.values(await import(document.querySelector('link[href*="/store-"]').href)).find(v=>v?.getState&&v.getState().setView);
  const state=window.__qaStore.getState();const sync=localStorage.getItem("chengjing-sync-enabled");
  const protectedIds=(await Promise.all(window.__qaDB.tables.map(table=>table.toCollection().primaryKeys()))).flat().map(String);
  const cloud=await window.chengjing.cloudBackups?.getLocalStatus();const local=await window.chengjing.backups.getSettings();
  if(cloud?.settings.enabled||local.enabled)throw Error("QA requires automatic backup disabled in the isolated test workspace");
  localStorage.removeItem("chengjing-sync-enabled");
  state.setLanguage("zh-TW");return{sync,protectedIds,view:state.view,language:state.language,board:state.selectedBoardId,kanban:state.selectedKanbanBoardId};
});
async function tap(locator){await locator.waitFor({state:"visible"});for(let attempt=0;;attempt++){try{await locator.scrollIntoViewIfNeeded();break;}catch(error){if(attempt>=2||!error.message.includes("not attached"))throw error;await page.waitForTimeout(100);}}const r=await locator.boundingBox();assert.ok(r&&r.width&&r.height,"Touchable control exists");const x=r.x+r.width/2,y=r.y+r.height/2;await touch.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y}]});await touch.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});}
async function view(name){await page.evaluate(view=>window.__qaStore.getState().setView(view),name);await page.locator(`.view-${name}`).waitFor();await page.waitForTimeout(260);}
async function back(){await page.evaluate(()=>window.dispatchEvent(new Event("chengjing:android-back")));await page.waitForTimeout(300);}
async function saved(table,field,value){await page.waitForFunction(async({table,field,value})=>Boolean(await window.__qaDB.table(table).filter(r=>r[field]===value).first()),{table,field,value});const row=await page.evaluate(async({table,field,value})=>window.__qaDB.table(table).filter(r=>r[field]===value).first(),{table,field,value});if(!created.some(r=>r.id===row.id))created.push({table,id:row.id});return row;}
try{
  await view("fragments");await page.locator('.mobile-capture-composer textarea').fill(prefix+"-片語");await tap(page.locator('.mobile-capture-composer footer button'));
  const fragment=await saved("fragments","text",prefix+"-片語");
  const thought=page.locator('.mobile-thought-stream article').filter({hasText:prefix+"-片語"});await tap(thought.locator('button'));
  await tap(page.locator('[data-menu-action="edit"]'));await page.locator('[data-content-edit="fragment"] textarea').fill(prefix+"-已編輯");
  await tap(page.locator('[data-content-edit="fragment"] button[type="submit"]'));await saved("fragments","text",prefix+"-已編輯");results.fragmentCreateEdit=true;
  await tap(page.locator('.mobile-thought-stream article').filter({hasText:prefix+"-已編輯"}).locator('button'));await tap(page.locator('[data-menu-action="to-task"]'));
  const task=await saved("tasks","title",prefix+"-已編輯");results.fragmentToTask=true;
  await view("tasks");const taskRow=page.locator(`[data-task-id="${task.id}"]`);await tap(taskRow.locator('.task-check'));
  await page.waitForFunction(async id=>(await window.__qaDB.tasks.get(id)).done,task.id);await page.locator(`.is-done[data-task-id="${task.id}"]`).waitFor();await tap(taskRow.locator('.task-more'));
  await tap(page.locator('[data-menu-action="add-child"]'));await page.locator('[data-content-edit="task-child"] input').fill(prefix+"-子待辦");await tap(page.locator('[data-content-edit="task-child"] button[type="submit"]'));
  const child=await saved("tasks","title",prefix+"-子待辦");assert.equal(child.parentTaskId,task.id);results.tasksCompleteAndHierarchy=true;
  await view("library");await tap(page.locator('.mobile-section-picker'));await page.locator('.library-organizer.is-open').waitFor();await back();assert.equal(await page.locator('.library-organizer.is-open').count(),0);results.collectionPickerBack=true;
  await tap(page.locator('.library-content .page-intro .primary-button'));await page.locator('.create-card-modal').waitFor();
  await page.locator('.create-card-title').fill(prefix+"-卡片");await page.locator('.create-card-fields textarea').fill("這段文字要保存在卡片，不是片語。\n手機也能完整編輯。");
  await tap(page.locator('.create-card-modal button[type="submit"]'));const card=await saved("cards","title",prefix+"-卡片");
  await page.locator('.card-editor-panel').waitFor();assert.match(card.plainText,/手機也能完整編輯/);results.libraryCreatesCard=true;
  await page.locator('.card-editor-panel .prose-editor').fill("重新編輯後立即返回，最後一段仍要保留。");await back();await page.waitForFunction(async id=>(await window.__qaDB.cards.get(id)).plainText.includes("最後一段"),card.id);results.cardEditBackSaves=true;
  await tap(page.locator('.mobile-header button:first-child'));await page.locator('.command-input input').fill(prefix);await page.locator('.command-results').getByText(prefix+"-卡片",{exact:true}).waitFor();await back();await page.locator('.command-palette').waitFor({state:'detached'});results.searchAndBack=true;
  await view("database");await page.locator('.database-tools input').fill(prefix+"-卡片");await page.locator('.data-table tbody tr').filter({hasText:prefix+"-卡片"}).waitFor();await tap(page.locator('.mobile-section-picker'));await page.locator('.database-sidebar.is-open').waitFor();await back();results.databaseSearchAndPicker=true;
  await view("kanban");
  if(await page.locator('.project-kanban-empty').count())await tap(page.locator('.project-kanban-empty .primary-button'));
  else await tap(page.locator('.project-kanban-sidebar > header button'));
  await page.getByPlaceholder("看板名稱").fill(prefix+"-看板");await tap(page.locator('.project-kanban-empty form button[type="submit"],.project-kanban-inline-form button[type="submit"]'));
  const kanban=await saved("kanbanBoards","title",prefix+"-看板");await page.locator('.project-kanban-board').waitFor();
  const list=page.locator('.project-kanban-board > section:not(.project-kanban-add-list)').first();await tap(list.locator('footer button').first());await list.locator('textarea').fill(prefix+"-看板卡片");await tap(list.locator('button[type="submit"]'));
  const kanbanCard=await saved("cards","title",prefix+"-看板卡片");await tap(list.locator('article').filter({hasText:prefix+"-看板卡片"}));await page.locator('.project-kanban-inspector').waitFor();await back();assert.equal(await page.locator('.project-kanban-inspector').count(),0);results.kanbanCreateCardAndBack=true;
  await view("boards");
  if(await page.locator('.board-empty').count())await tap(page.locator('.board-empty .primary-button'));
  else {await tap(page.locator('.board-switcher-trigger'));await tap(page.locator('.board-switcher-menu').getByRole('button',{name:"新增白板",exact:true}));}
  await page.waitForFunction(protectedIds=>{const id=window.__qaStore.getState().selectedBoardId;return id&&!protectedIds.includes(id);},original.protectedIds);
  const boardId=await page.evaluate(()=>window.__qaStore.getState().selectedBoardId);assert.ok(!original.protectedIds.includes(boardId));created.push({table:"boards",id:boardId});
  if(!await page.locator('.board-title-form input').count())await tap(page.getByRole('button',{name:"重新命名白板",exact:true}));await page.locator('.board-title-form input').fill(prefix+"-白板");await page.locator('.board-title-form input').press('Enter');
  await tap(page.locator('.board-toolbar').getByRole('button',{name:"新增卡片",exact:true}));await page.waitForFunction(async id=>(await window.__qaDB.boardNodes.where('boardId').equals(id).count())>0,boardId);
  for(const title of["新增文字","新增區段","新增心智圖"]){await tap(page.locator('.board-toolbar').getByRole('button',{name:title,exact:true}));await page.waitForTimeout(150);}
  const nodeKinds=await page.evaluate(async id=>(await window.__qaDB.boardNodes.where('boardId').equals(id).toArray()).map(n=>n.kind),boardId);assert.ok(nodeKinds.includes('card')&&nodeKinds.includes('text')&&nodeKinds.includes('section')&&nodeKinds.includes('mindmap'));results.boardCreatesAllNodeTypes=true;
  await page.screenshot({path:`${out}/board.png`});await view("journal");await tap(page.locator('.journal-date-picker button').first());await page.locator('.task-calendar-popover').waitFor();await back();assert.equal(await page.locator('.task-calendar-popover').count(),0);results.journalDatePickerBack=true;
  await fs.writeFile(`${out}/report.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}catch(error){await page.screenshot({path:`${out}/failure.png`});await fs.writeFile(`${out}/report.json`,JSON.stringify({...results,error:error.message},null,2));throw error;}finally{
  await page.evaluate(async({created,original,prefix})=>{
    const db=window.__qaDB;const protectedIds=new Set(original.protectedIds);const owned=created.filter(r=>!protectedIds.has(r.id));const ids=new Set(owned.map(r=>r.id));
    for(const row of owned.filter(r=>r.table==='boards')){const nodes=await db.boardNodes.where('boardId').equals(row.id).toArray();for(const n of nodes){if(protectedIds.has(n.id))throw Error('Refusing to remove a pre-existing node');ids.add(n.id);if(n.cardId&&!protectedIds.has(n.cardId)){ids.add(n.cardId);await db.cards.delete(n.cardId);}}const edges=await db.boardEdges.where('boardId').equals(row.id).toArray();edges.forEach(e=>ids.add(e.id));await db.boardNodes.where('boardId').equals(row.id).delete();await db.boardEdges.where('boardId').equals(row.id).delete();}
    for(const row of owned.filter(r=>r.table==='kanbanBoards')){for(const table of['kanbanLists','kanbanPlacements']){const rows=await db.table(table).where('boardId').equals(row.id).toArray();if(rows.some(r=>protectedIds.has(r.id)))throw Error('Refusing to remove pre-existing Kanban content');rows.forEach(r=>ids.add(r.id));await db.table(table).bulkDelete(rows.map(r=>r.id));}}
    for(const row of owned)await db.table(row.table).delete(row.id);
    const versions=await db.cardVersions.filter(v=>ids.has(v.cardId)).toArray();versions.forEach(v=>ids.add(v.id));await db.cardVersions.bulkDelete(versions.map(v=>v.id));
    await db.table('syncOutbox').filter(op=>ids.has(op.key)).delete();await db.table('syncRecords').filter(r=>r.heads.some(h=>ids.has(h.key))).delete();
    if(original.sync)localStorage.setItem('chengjing-sync-enabled',original.sync);
    const s=window.__qaStore.getState();s.closeCard();s.setCommandOpen(false);s.setCreateCardOpen(false);s.setLanguage(original.language);if(original.board)s.openBoard(original.board);if(original.kanban)s.openKanbanBoard(original.kanban);s.setView(original.view);
    delete window.__qaDB;delete window.__qaStore;
  },{created,original,prefix});await browser.close();
}
