import { describe, expect, it } from "vitest";
import type { BrainNodeView } from "./brain";
import { onlyOwnedNodesForAI, selectDiscoveryBatch, sharedNeuronSceneNodes } from "./sharedBrain";
import type { SharedNeuronSummary } from "./community";

const localNode: BrainNodeView = { key: "card:mine", type: "card", id: "mine", title: "自己的內容", text: "只允許這段進入 AI", sourceKind: "note", keywords: ["自己"], weight: 1, radius: 0.5, position: [0, 0, 0], createdAt: 1, observedAt: 1, updatedAt: 1 };

function remote(index: number, author = `陌生人${index}`): SharedNeuronSummary {
  const authorPattern = [...author].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return { id: `n-${index}`, title: `遠端 ${index}`, sourceType: "fragment", authorName: author, seal: "#718a9a", authorPattern, intention: "share", commentCount: 0, createdAt: index, isOwn: false };
}

describe("共享大腦資料邊界", () => {
  it("遠端神經元即使已載入場景，也不會進入 AI 輸入集合", () => {
    const scene = sharedNeuronSceneNodes([remote(1)]);
    expect(scene).toHaveLength(1);
    expect(onlyOwnedNodesForAI([localNode, ...scene])).toEqual([localNode]);
  });

  it("每批最多二十顆且每位作者最多兩顆", () => {
    const items = Array.from({ length: 30 }, (_, index) => remote(index, index < 5 ? "同一人" : `作者${index}`));
    const selected = selectDiscoveryBatch(items);
    expect(selected).toHaveLength(20);
    expect(selected.filter((item) => item.authorName === "同一人")).toHaveLength(2);
  });

  it("自己的公開神經元留在本機中心，不重複出現在陌生人外圍", () => {
    const selected = selectDiscoveryBatch([{ ...remote(1), isOwn: true }, remote(2)], true);
    expect(selected.map((item) => item.id)).toEqual(["n-2"]);
  });
});
