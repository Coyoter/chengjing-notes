import type { SyncOperation, SyncRecord } from "./syncProtocol";
import { materializedHead } from "./syncProtocol";
const kinds: Record<string, [string,string]> = {
  cards:["卡片","Card"], boards:["白板","Board"], boardNodes:["白板項目","Board item"], boardEdges:["白板連線","Board link"],
  kanbanBoards:["看板","Kanban board"],kanbanLists:["看板欄位","Kanban list"],kanbanPlacements:["看板項目","Kanban item"],
  tags:["標籤","Tag"],tasks:["待辦","Task"],highlights:["劃記","Highlight"],attachments:["附件","Attachment"],fragments:["片語","Fragment"],
  knowledgeGroups:["知識分類","Collection"],chatThreads:["AI 對話","AI conversation"],chatMessages:["對話訊息","Message"],
  cardVersions:["卡片歷史","Card history"],brainEdges:["神經元連結","Neuron link"],brainReports:["AI 反思","Reflection"],brainShares:["共享內容","Shared content"],
};
export function syncRecordLabel(record: SyncRecord, zh: boolean) {
  const value=materializedHead(record.heads).value || record.recovery?.find(head=>head.value)?.value || record.heads.find(head=>head.value)?.value;
  const kind=(kinds[record.heads[0].table] || ["內容","Content"])[zh?0:1];
  const name=[value?.title,value?.name,value?.text,value?.plainText].find(item=>typeof item==="string"&&item.trim());
  return {kind,name:typeof name==="string"?name.replace(/\s+/g," ").trim().slice(0,100):kind};
}
export function syncVersionText(head: SyncOperation, zh: boolean) {
  if(!head.value)return zh?"此版本已刪除內容。":"Content was deleted in this version.";
  const value=head.value;
  const content=[value.plainText,value.text,value.content].find(item=>typeof item==="string"&&item.trim());
  if(typeof content==="string")return content;
  if(typeof value.contentHtml==="string")return new DOMParser().parseFromString(value.contentHtml,"text/html").body.textContent || (zh?"此版本沒有文字內容。":"This version has no text content.");
  const name=[value.title,value.name].find(item=>typeof item==="string"&&item.trim());
  return typeof name==="string"?name:(zh?"這個版本的排列、連結或設定不同。":"This version has different placement, links, or settings.");
}
