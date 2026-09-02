import { describe, expect, it } from "vitest";
import { LOCAL_BRAIN_SEMANTIC_LIMITS, buildBrainGraph, buildBrainSemanticContext, journalBrainTitle, parseAIConnections, selectBrainViewportNodes } from "./brain";
import type { CardRecord } from "../types";

function card(id: string, title: string, text: string, createdAt = 1): CardRecord {
  return {
    id,
    title,
    plainText: text,
    contentHtml: `<p>${text}</p>`,
    kind: "note",
    state: "active",
    createdAt,
    updatedAt: createdAt,
    tagIds: [],
    favorite: false,
    color: "slate",
    attachmentIds: [],
    properties: {},
  };
}

describe("第二大腦資料整理", () => {
  it("日誌神經元使用內容而不是日期作為名稱", () => {
    expect(journalBrainTitle({ plainText: "今天我想做啥呢\n第一件事\n哈哈哈", journalDate: "2026-08-27" })).toBe("今天我想做啥呢");
    expect(journalBrainTitle({ plainText: "", journalDate: "2026-08-27" })).toBe("尚未寫下內容的日誌");
  });

  it("重複概念會提高相關神經元權重", () => {
    const graph = buildBrainGraph({
      cards: [card("a", "國巨觀察", "國巨股票與獲利"), card("b", "再次想到國巨", "國巨最近波動"), card("c", "散步", "晚上去河邊散步")],
      boards: [], fragments: [], tasks: [], boardNodes: [], tags: [], storedEdges: [],
    });
    expect(graph.concepts.some((concept) => concept.term === "國巨" && concept.count >= 2)).toBe(true);
    expect(graph.nodes.find((node) => node.id === "a")!.weight).toBeGreaterThan(graph.nodes.find((node) => node.id === "c")!.weight);
  });

  it("白板與其中的卡片會形成不可誤刪的結構線", () => {
    const graph = buildBrainGraph({
      cards: [card("a", "卡片", "內容")],
      boards: [{ id: "board", title: "研究白板", description: "", favorite: false, tagIds: [], createdAt: 1, updatedAt: 1 }],
      fragments: [], tasks: [], tags: [], storedEdges: [],
      boardNodes: [{ id: "node", boardId: "board", kind: "card", cardId: "a", x: 0, y: 0 }],
    });
    expect(graph.edges).toContainEqual(expect.objectContaining({ source: "board:board", target: "card:a", origin: "structure", persisted: false }));
  });

  it("只接受指向真實神經元且不重複的 AI JSON 連線", () => {
    const values = parseAIConnections("```json\n{\"connections\":[{\"source\":\"card:a\",\"target\":\"fragment:b\",\"relationType\":\"possible_influence\",\"reason\":\"兩段內容可能呈現事件與後續狀態的關聯\",\"evidence\":[\"A 提到外在事件\",\"B 提到後續狀態\"],\"confidence\":0.8},{\"source\":\"fragment:b\",\"target\":\"card:a\",\"reason\":\"重複\"},{\"source\":\"card:a\",\"target\":\"card:missing\"}]}\n```", new Set(["card:a", "fragment:b"]));
    expect(values).toEqual([{ source: "card:a", target: "fragment:b", relationType: "possible_influence", reason: "兩段內容可能呈現事件與後續狀態的關聯", evidence: ["A 提到外在事件", "B 提到後續狀態"], confidence: 0.8 }]);
  });

  it("會修復模型漏掉逗號或尾端截斷的連線 JSON", () => {
    const missingComma = '{"connections":[{"source":"card:a","target":"task:t","reason":"可能相關","evidence":["A","T"],"confidence":0.8}{"source":"task:t","target":"fragment:f","reason":"值得確認","evidence":["T","F"],"confidence":0.7}]}';
    expect(parseAIConnections(missingComma, new Set(["card:a", "task:t", "fragment:f"]))).toHaveLength(2);
    const truncated = '{"connections":[{"source":"card:a","target":"task:t","reason":"可能相關","evidence":["A","T"],"confidence":0.8},{"source":"task:t","target":"fragment:f","reason":"尚未輸出完';
    expect(parseAIConnections(truncated, new Set(["card:a", "task:t", "fragment:f"]))).toEqual([expect.objectContaining({ source: "card:a", target: "task:t" })]);
  });

  it("即使沒有相同詞，也會把時間相近的跨主題內容交給 AI 做語意判斷", () => {
    const now = new Date("2026-08-26T12:00:00+08:00").getTime();
    const graph = buildBrainGraph({
      cards: [
        card("event", "企劃方向臨時改變", "原定的提案被要求重新規劃", now - 4 * 86_400_000),
        card("state", "凌晨仍然清醒", "翻來覆去很久都沒有入睡", now - 2 * 86_400_000),
      ],
      boards: [], fragments: [], tasks: [], boardNodes: [], tags: [], storedEdges: [],
    });
    const semantic = buildBrainSemanticContext(graph.nodes, graph.edges, now);
    const candidate = semantic.candidates.find((item) => new Set([item.source, item.target]).has("card:event") && new Set([item.source, item.target]).has("card:state"));
    expect(candidate).toMatchObject({ temporalDistanceDays: 2, keywordOverlap: [] });
    expect(semantic.text).toContain('surface_overlap="none"');
    expect(semantic.text).toContain("candidate_pairs are broad review hints, not proven links");
    expect(semantic.nodeKeys).toEqual(new Set(["card:event", "card:state"]));
  });

  it("本機第二大腦只建立有上限的安全脈絡", () => {
    const now = Date.now();
    const graph = buildBrainGraph({
      cards: Array.from({ length: 40 }, (_, index) => card(`local-${index}`, `本機神經元 ${index}`, `這是一段很長的本機測試內容 ${index} ${"資料".repeat(180)}`, now - index * 3_600_000)),
      boards: [], fragments: [], tasks: [], boardNodes: [], tags: [], storedEdges: [],
    });
    const semantic = buildBrainSemanticContext(
      graph.nodes,
      graph.edges,
      now,
      LOCAL_BRAIN_SEMANTIC_LIMITS.nodeLimit,
      LOCAL_BRAIN_SEMANTIC_LIMITS.contentLimit,
      LOCAL_BRAIN_SEMANTIC_LIMITS.candidateLimit,
      LOCAL_BRAIN_SEMANTIC_LIMITS.existingEdgeLimit,
    );
    expect(semantic.selectedNodes).toHaveLength(LOCAL_BRAIN_SEMANTIC_LIMITS.nodeLimit);
    expect(semantic.candidates.length).toBeLessThanOrEqual(LOCAL_BRAIN_SEMANTIC_LIMITS.candidateLimit);
    expect(semantic.text.length).toBeLessThan(16_000);
    expect(semantic.text).not.toContain("資料".repeat(100));
  });

  it("獨立待辦與編輯器待辦都會成為可連結的神經元", () => {
    const graph = buildBrainGraph({
      cards: [card("source", "專案規劃", "整理發佈工作")], boards: [], fragments: [], boardNodes: [], tags: [], storedEdges: [],
      tasks: [
        { id: "direct", title: "確認發佈日期", done: false, createdAt: 10, updatedAt: 10 },
        { id: "editor", title: "整理簡報", done: true, cardId: "source", sourceTaskId: "source-1", createdAt: 11, updatedAt: 12 },
      ],
    });
    expect(graph.nodes.filter((node) => node.type === "task").map((node) => node.key)).toEqual(["task:direct", "task:editor"]);
    expect(graph.nodes.find((node) => node.key === "task:editor")?.text).toContain("專案規劃");
  });

  it("主項目與子項目會保留不可誤刪的結構關係", () => {
    const graph = buildBrainGraph({
      cards: [], boards: [], fragments: [], boardNodes: [], tags: [], storedEdges: [],
      tasks: [
        { id: "parent", title: "完成產品提案", done: false, createdAt: 1, updatedAt: 1 },
        { id: "child", title: "整理研究資料", done: false, parentTaskId: "parent", createdAt: 2, updatedAt: 2 },
      ],
    });
    expect(graph.edges).toContainEqual(expect.objectContaining({ source: "task:parent", target: "task:child", origin: "structure", persisted: false }));
  });

  it("私人神經元依視野焦點最多渲染 200 顆", () => {
    const graph = buildBrainGraph({
      cards: Array.from({ length: 260 }, (_, index) => card(`viewport-${index}`, `神經元 ${index}`, `內容 ${index}`, index + 1)),
      boards: [], fragments: [], tasks: [], boardNodes: [], tags: [], storedEdges: [],
    });
    const first = selectBrainViewportNodes(graph.nodes, [0, 0, 0], 200);
    const moved = selectBrainViewportNodes(graph.nodes, [18, 8, 18], 200);
    expect(first).toHaveLength(200);
    expect(moved).toHaveLength(200);
    expect(new Set(first.map((node) => node.key))).not.toEqual(new Set(moved.map((node) => node.key)));
  });
});
