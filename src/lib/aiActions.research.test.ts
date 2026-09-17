import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { planAIActions, parseAIActionPlan } from "./aiActions";
import { runAI } from "./ai";

vi.mock("./ai", () => ({ runAI: vi.fn() }));
const model = vi.mocked(runAI);
function response(value: object) { return { text: JSON.stringify(value), model: "mock", usage: null, finishReason: "stop" }; }
const options = { engine: "local-gemma" as const, model: "mock", prompt: "Analyze all fragments", context: "initial sample", readOnly: true };

describe("workspace research is paginated and read-only", () => {
  beforeAll(() => db.open());
  beforeEach(async () => {
    model.mockReset();
    await db.transaction("rw", db.tables, () => Promise.all(db.tables.map(table => table.clear())));
    await db.fragments.bulkAdd(Array.from({ length: 130 }, (_, i) => ({ id: String(i).padStart(3, "0"), text: `Fragment ${i}`, tagIds: [], pinned: false, createdAt: 1, updatedAt: 1 })));
  });
  it("continues past the first page and performs no writes during research", async () => {
    model.mockResolvedValueOnce(response({ summary: "Read", queries: [{ tool: "chengjing_list_records", arguments: { table: "fragments", limit: 100 } }], actions: [] }));
    model.mockResolvedValueOnce(response({ summary: "Continue", researchNotes: "Read 100 records", queries: [{ tool: "chengjing_list_records", arguments: { table: "fragments", after: "099", limit: 100 } }], actions: [] }));
    model.mockResolvedValueOnce(response({ summary: "Analyzed 130 fragments", actions: [] }));
    const result = await planAIActions(options);
    expect(result.summary).toBe("Analyzed 130 fragments");
    expect(model.mock.calls[2][0].prompt).toContain("Fragment 129");
    expect(await db.fragments.count()).toBe(130);
  });
  it("rejects a read-only response proposing writes", async () => {
    model.mockResolvedValueOnce(response({ summary: "Wrong", actions: [{ type: "delete_fragment", targetId: "000" }] }));
    await expect(planAIActions(options)).rejects.toThrow("ai-unrequested-changes");
    expect(await db.fragments.count()).toBe(130);
  });
  it("stops repeated queries and respects cancellation", async () => {
    const query = response({ summary: "Read", queries: [{ tool: "chengjing_status", arguments: {} }], actions: [] });
    model.mockResolvedValue(query);
    await expect(planAIActions(options)).rejects.toThrow("ai-repeated-query");
    expect(model).toHaveBeenCalledTimes(2);
    model.mockClear();
    await expect(planAIActions({ ...options, isCurrent: () => false })).rejects.toThrow("ai-request-cancelled");
    expect(model).not.toHaveBeenCalled();
  });
  it("accumulates large plans over multiple model responses without executing drafts", async () => {
    const actions = Array.from({ length: 60 }, (_, i) => ({ type: "create_task", title: `Task ${i}`, description: "create" }));
    model.mockResolvedValueOnce(response({ summary: "First batch", actions, moreActions: true }));
    model.mockResolvedValueOnce(response({ summary: "Ready", actions, moreActions: false }));
    const plan = await planAIActions({ ...options, readOnly: false });
    expect(plan.actions).toHaveLength(120);
    expect(await db.tasks.count()).toBe(0);
  });
  it("does not silently truncate long note bodies", () => {
    const content = "字".repeat(20_000);
    const plan = parseAIActionPlan(JSON.stringify({ summary: "long", actions: [{ type: "create_card", title: "Long", content }] }));
    expect(plan.actions[0].content).toBe(content);
  });
});
