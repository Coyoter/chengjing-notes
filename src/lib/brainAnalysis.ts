import { buildBrainSemanticContext, type BrainNodeView, type BrainEdgeView } from "./brain";

export const ANALYSIS_BATCH = { seeds: 12, nodes: 32, links: 12, outputTokens: 6000, retryTokens: 9000 };
export function brainFingerprint(node: BrainNodeView) {
  const text = JSON.stringify([node.title, node.text, node.updatedAt, node.keywords]);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${hash >>> 0}`;
}
export function planBrainAnalysis(nodes: BrainNodeView[], edges: BrainEdgeView[], receipts: Record<string, string>, maxNodes = ANALYSIS_BATCH.nodes) {
  const pending = nodes.filter((node) => receipts[node.key] !== brainFingerprint(node)).sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key));
  const seeds = pending.slice(0, Math.min(ANALYSIS_BATCH.seeds, Math.floor(maxNodes / 2)));
  const seedKeys = new Set(seeds.map((node) => node.key));
  const words = new Set(seeds.flatMap((node) => node.keywords));
  const neighbours = new Set(edges.filter((edge) => seedKeys.has(edge.source) || seedKeys.has(edge.target)).flatMap((edge) => [edge.source, edge.target]));
  const rank = (node: BrainNodeView) => Number(neighbours.has(node.key)) * 10 + node.keywords.reduce((sum, word) => sum + Number(words.has(word)), 0);
  const context = nodes.filter((node) => !seedKeys.has(node.key)).sort((a, b) => rank(b) - rank(a) || b.updatedAt - a.updatedAt).slice(0, maxNodes - seeds.length);
  const selected = [...seeds, ...context];
  return { seeds, seedKeys, pending: pending.length, ...buildBrainSemanticContext(selected, edges, Date.now(), maxNodes, 480, 24, 24) };
}
