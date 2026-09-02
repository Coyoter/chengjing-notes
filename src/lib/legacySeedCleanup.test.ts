import { describe, expect, it } from "vitest";
import {
  isUntouchedLegacyDemoCard,
  isUntouchedLegacyDemoEdge,
  isUntouchedLegacyDemoHighlight,
  isUntouchedLegacyDemoNode,
} from "./legacySeedCleanup";
import type { BoardEdgeRecord, BoardNodeRecord, CardRecord, HighlightRecord } from "../types";

const legacyBrand = [72, 101, 112, 116, 97, 98, 97, 115, 101].map((code) => String.fromCharCode(code)).join("");
const legacyCard: CardRecord = {
  id: "card-source",
  title: `${legacyBrand} 功能觀察`,
  contentHtml: "<h2>可借鏡的產品原則</h2><p>卡片與白板分離、同一卡片可重複出現在不同脈絡、來源能直接成為 AI 上下文，都是值得保留的核心。</p><p>澄境會減少重複側欄，並把 AI 的資料去向說得更清楚。</p>",
  plainText: "卡片與白板分離、來源成為 AI 上下文；澄境減少重複側欄並清楚標示資料去向。",
  kind: "web",
  state: "active",
  createdAt: 1,
  updatedAt: 2,
  tagIds: ["tag-research", "tag-product"],
  favorite: false,
  color: "rose",
  sourceUrl: `https://${legacyBrand.toLowerCase()}.com/`,
  attachmentIds: [],
  properties: { 階段: "已整理", 來源: "產品觀察" },
  collectionId: "topic-product-research",
};

const legacyNode: BoardNodeRecord = { id: "node-source", boardId: "board-welcome", kind: "card", cardId: "card-source", x: 90, y: 385, width: 265, height: 180 };
const legacyEdge: BoardEdgeRecord = { id: "edge-3", boardId: "board-welcome", source: "node-source", target: "node-ai-king", label: "功能參考" };
const legacyHighlight: HighlightRecord = { id: "highlight-1", cardId: "card-source", text: "同一張卡片可以同時出現在多個白板，但內容永遠只有一份。", note: "保留這個核心資料模型。", color: "amber", createdAt: 1 };

describe("舊版內建競品研究卡片清理", () => {
  it("只辨認完全未修改的舊內建卡片", () => {
    expect(isUntouchedLegacyDemoCard(legacyCard)).toBe(true);
    expect(isUntouchedLegacyDemoCard({ ...legacyCard, title: "我的研究筆記" })).toBe(false);
    expect(isUntouchedLegacyDemoCard({ ...legacyCard, favorite: true })).toBe(false);
    expect(isUntouchedLegacyDemoCard({ ...legacyCard, contentHtml: `${legacyCard.contentHtml}<p>我的補充</p>` })).toBe(false);
  });

  it("白板與劃記也必須維持舊版原樣", () => {
    expect(isUntouchedLegacyDemoNode(legacyNode)).toBe(true);
    expect(isUntouchedLegacyDemoNode({ ...legacyNode, x: 91 })).toBe(false);
    expect(isUntouchedLegacyDemoEdge(legacyEdge)).toBe(true);
    expect(isUntouchedLegacyDemoEdge({ ...legacyEdge, label: "我的連結" })).toBe(false);
    expect(isUntouchedLegacyDemoHighlight(legacyHighlight)).toBe(true);
    expect(isUntouchedLegacyDemoHighlight({ ...legacyHighlight, note: "我的註解" })).toBe(false);
  });
});
