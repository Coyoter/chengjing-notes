import "fake-indexeddb/auto";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createCard, db } from "../db";
import { ACTION_RESPONSE_FORMAT, applyAIActionPlan, parseAIActionPlan, planAIActions, workspacePlanNeedsRepair } from "./aiActions";
import { runAI } from "./ai";
import { useAppStore } from "../store";
vi.mock("./ai", () => ({ runAI: vi.fn() }));
const model = vi.mocked(runAI);
const selection = { table: "workspace", all: true, permanent: false };
const reply = (actions: unknown[]) => ({ text: JSON.stringify({ summary: "清空工作內容", actions }), model: "mock", usage: null, finishReason: "stop" });
beforeAll(() => db.open());
beforeEach(async () => { model.mockReset(); localStorage.clear(); useAppStore.getState().setLanguage("zh-TW"); await db.transaction("rw", db.tables, () => Promise.all(db.tables.map(table => table.clear()))); });

it.each([
  { type: "workspace_tool", tool: "chengjing_delete_items", parameters: selection },
  { type: "workspace_tool", tool_name: "delete_items", args: selection },
  { type: "workspace_tool", tool: { name: "chengjing_delete_items", arguments: JSON.stringify(selection) } },
  { type: "workspace_tool", function: { name: "chengjing_delete_items", arguments: JSON.stringify(selection) } },
  { type: "workspace_tool", parameters: { tool: "chengjing_delete_items", arguments: selection } },
  { type: "chengjing_delete_items", arguments: JSON.stringify(selection) },
])("accepts common tool field variants without changing deletion scope: %j", async candidate => {
  const card = await createCard({ title: "isolated test" });
  await db.fragments.add({ id: "fragment", text: "test", pinned: false, tagIds: [], createdAt: 1, updatedAt: 1 });
  const plan = parseAIActionPlan(reply([candidate]).text);
  expect(plan.actions).toHaveLength(1);
  expect(workspacePlanNeedsRepair(plan)).toBe(false);
  expect(plan.actions[0]).toMatchObject({ type: "workspace_tool", tool: "chengjing_delete_items", arguments: selection });
  await applyAIActionPlan(plan, {});
  expect((await db.cards.get(card.id))?.state).toBe("trash");
  expect(await db.fragments.count()).toBe(0);
});

it("schema requires tool and arguments for workspace tools", () => {
  expect(ACTION_RESPONSE_FORMAT.json_schema.schema.properties.actions.items.anyOf[1].required).toEqual(["tool", "arguments"]);
});

it("repairs missing tool fields before returning a plan, without executing it", async () => {
  await createCard({ title: "keep until apply" });
  model.mockResolvedValueOnce(reply([{ type: "workspace_tool", description: "清空" }]));
  model.mockResolvedValueOnce(reply([{ type: "workspace_tool", description: "清空", tool: "chengjing_delete_items", arguments: selection }]));
  const plan = await planAIActions({ engine: "local-gemma", model: "mock", prompt: "清空全部工作內容", context: "test fixture" });
  expect(model).toHaveBeenCalledTimes(2);
  expect(model.mock.calls[1][0].prompt).toContain("repair_workspace_tool_fields");
  expect(workspacePlanNeedsRepair(plan)).toBe(false);
  expect(await db.cards.filter(card => card.state !== "trash").count()).toBe(1);
});

it("does not guess an operation from its description or broaden existing selectors during repair", async () => {
  const original = { type: "workspace_tool", description: "刪除全部", tool: "unknown_delete_tool", arguments: { table: "cards", ids: ["one"], permanent: false } };
  expect(workspacePlanNeedsRepair(parseAIActionPlan(reply([original]).text))).toBe(true);
  model.mockResolvedValueOnce(reply([original]));
  model.mockResolvedValueOnce(reply([{ ...original, tool: "chengjing_delete_items", arguments: { table: "workspace", all: true, permanent: true } }]));
  await expect(planAIActions({ engine: "local-gemma", model: "mock", prompt: "刪除 one", context: "test" })).rejects.toThrow("這次沒有變更資料");
});

it("malformed arguments stop before any writes, with no repeated repair loop", async () => {
  const card = await createCard({ title: "must survive" });
  const bad = { type: "workspace_tool", tool: "chengjing_delete_items", arguments: "not-json" };
  model.mockResolvedValue(reply([bad]));
  await expect(planAIActions({ engine: "local-gemma", model: "mock", prompt: "清空", context: "test" })).rejects.toThrow("這次沒有變更資料");
  expect(model).toHaveBeenCalledTimes(2);
  expect(await db.cards.get(card.id)).toBeDefined();
});
