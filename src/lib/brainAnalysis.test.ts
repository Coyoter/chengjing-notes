import { describe, expect, it } from "vitest";
import { buildBrainGraph } from "./brain";
import { ANALYSIS_BATCH, brainFingerprint, planBrainAnalysis } from "./brainAnalysis";
import type { CardRecord } from "../types";
describe("incremental brain analysis", () => {
  const cards = Array.from({ length: 100 }, (_, i) => ({ id: String(i), title: `研究${i}`, plainText: `工作研究${i}`, contentHtml: "", state: "active", kind: "note", tagIds: [], updatedAt: i, createdAt: i } as unknown as CardRecord));
  const nodes = buildBrainGraph({ cards, tasks: [], boards: [], boardNodes: [], fragments: [], storedEdges: [], tags: [] }).nodes;
  it("bounds each request and does not repeatedly analyze unchanged seeds", () => {
    const first = planBrainAnalysis(nodes, [], {});
    expect(first.seeds.length).toBe(12); expect(first.selectedNodes.length).toBe(ANALYSIS_BATCH.nodes);
    const receipts = Object.fromEntries(first.seeds.map((node) => [node.key, brainFingerprint(node)]));
    const second = planBrainAnalysis(nodes, [], receipts);
    expect(second.pending).toBe(88); expect(second.seeds.some((node) => first.seedKeys.has(node.key))).toBe(false);
  });
  it("rechecks edited notes and retains old related context", () => {
    const receipts = Object.fromEntries(nodes.map((node) => [node.key, brainFingerprint(node)]));
    expect(planBrainAnalysis(nodes, [], receipts).seeds).toHaveLength(0);
    const edited = nodes.map((node, i) => i === 0 ? { ...node, text: "changed" } : node);
    expect(planBrainAnalysis(edited, [], receipts).seedKeys.has(nodes[0].key)).toBe(true);
  });
});
