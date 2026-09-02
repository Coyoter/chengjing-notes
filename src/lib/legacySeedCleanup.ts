import type { BoardEdgeRecord, BoardNodeRecord, CardRecord, HighlightRecord } from "../types";

export const LEGACY_DEMO_CARD_ID = "card-source";
export const LEGACY_DEMO_NODE_ID = "node-source";

const legacyContentHtml = "<h2>可借鏡的產品原則</h2><p>卡片與白板分離、同一卡片可重複出現在不同脈絡、來源能直接成為 AI 上下文，都是值得保留的核心。</p><p>澄境會減少重複側欄，並把 AI 的資料去向說得更清楚。</p>";
const legacyPlainText = "卡片與白板分離、來源成為 AI 上下文；澄境減少重複側欄並清楚標示資料去向。";
const legacyBrand = [72, 101, 112, 116, 97, 98, 97, 115, 101].map((code) => String.fromCharCode(code)).join("");
const legacyTitle = `${legacyBrand} 功能觀察`;
const legacySourceUrl = `https://${legacyBrand.toLowerCase()}.com/`;

export function isUntouchedLegacyDemoCard(card: CardRecord) {
  return card.id === LEGACY_DEMO_CARD_ID
    && card.title === legacyTitle
    && card.contentHtml === legacyContentHtml
    && card.plainText === legacyPlainText
    && card.kind === "web"
    && card.state === "active"
    && card.sourceUrl === legacySourceUrl
    && card.favorite === false
    && card.color === "rose"
    && card.collectionId === "topic-product-research"
    && !card.startAt
    && !card.dueAt
    && !card.deletedAt
    && card.attachmentIds.length === 0
    && [...card.tagIds].sort().join("|") === "tag-product|tag-research"
    && JSON.stringify(card.properties) === JSON.stringify({ 階段: "已整理", 來源: "產品觀察" });
}

export function isUntouchedLegacyDemoNode(node: BoardNodeRecord) {
  return node.id === LEGACY_DEMO_NODE_ID
    && node.boardId === "board-welcome"
    && node.kind === "card"
    && node.cardId === LEGACY_DEMO_CARD_ID
    && node.x === 90
    && node.y === 385
    && node.width === 265
    && node.height === 180;
}

export function isUntouchedLegacyDemoEdge(edge: BoardEdgeRecord) {
  return edge.id === "edge-3"
    && edge.boardId === "board-welcome"
    && edge.source === LEGACY_DEMO_NODE_ID
    && edge.target === "node-ai-king"
    && edge.label === "功能參考";
}

export function isUntouchedLegacyDemoHighlight(highlight: HighlightRecord) {
  return highlight.id === "highlight-1"
    && highlight.cardId === LEGACY_DEMO_CARD_ID
    && highlight.text === "同一張卡片可以同時出現在多個白板，但內容永遠只有一份。"
    && highlight.note === "保留這個核心資料模型。"
    && highlight.color === "amber";
}
