import type { BrainNodeView } from "./brain";
import type { SharedNeuronSummary } from "./community";

export interface SharedNeuronSceneNode {
  kind: "shared-remote";
  id: string;
  title: string;
  authorName: string;
  seal: string;
  authorPattern: number;
  intention: SharedNeuronSummary["intention"];
  commentCount: number;
  position: [number, number, number];
  radius: number;
}

function hash(value: string, salt: string) {
  let result = 2166136261;
  const source = `${salt}:${value}`;
  for (let index = 0; index < source.length; index += 1) {
    result ^= source.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function unit(value: string, salt: string) {
  return (hash(value, salt) % 100_000) / 100_000;
}

export function sharedNeuronSceneNodes(items: SharedNeuronSummary[]): SharedNeuronSceneNode[] {
  return items.filter((item) => !item.isOwn).slice(0, 20).map((item, index) => {
    const angle = unit(item.id, "angle") * Math.PI * 2 + index * 0.37;
    const radius = 29 + unit(item.id, "distance") * 15;
    const height = (unit(item.id, "height") - 0.5) * 15;
    return {
      kind: "shared-remote" as const,
      id: item.id,
      title: item.title,
      authorName: item.authorName,
      seal: item.seal,
      authorPattern: item.authorPattern,
      intention: item.intention,
      commentCount: item.commentCount,
      position: [Math.cos(angle) * radius, height, Math.sin(angle) * radius] as [number, number, number],
      radius: 0.43 + unit(item.id, "size") * 0.18,
    };
  });
}

/**
 * 即使遠端神經元已經載入 3D 場景，也必須先經過這個邊界，AI 才能
 * 取得輸入。外人的節點有明確 kind，永遠不會被送進整理連結、索引或反思。
 */
export function onlyOwnedNodesForAI(nodes: Array<BrainNodeView | SharedNeuronSceneNode>): BrainNodeView[] {
  return nodes.filter((node): node is BrainNodeView => !("kind" in node && node.kind === "shared-remote"));
}

export function selectDiscoveryBatch(items: SharedNeuronSummary[], ownIdentityIdKnown = false): SharedNeuronSummary[] {
  const perAuthor = new Map<string, number>();
  const result: SharedNeuronSummary[] = [];
  for (const item of items) {
    if (item.isOwn && ownIdentityIdKnown) continue;
    const authorKey = `${item.authorName}:${item.authorPattern}`;
    if ((perAuthor.get(authorKey) || 0) >= 2) continue;
    perAuthor.set(authorKey, (perAuthor.get(authorKey) || 0) + 1);
    result.push(item);
    if (result.length >= 20) break;
  }
  return result;
}
