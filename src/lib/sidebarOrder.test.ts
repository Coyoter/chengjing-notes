import { expect, it } from "vitest";
import { DEFAULT_SIDEBAR_ORDER, getVisibleSidebarOrder, moveSidebarItem, normalizeSidebarHiddenItems, normalizeSidebarOrder } from "./sidebarOrder";
it("moves without losing or duplicating navigation entries", () => {
  const order = moveSidebarItem(DEFAULT_SIDEBAR_ORDER, "tasks", "today");
  expect(order[0]).toBe("tasks");
  expect(new Set(order).size).toBe(DEFAULT_SIDEBAR_ORDER.length);
  expect(DEFAULT_SIDEBAR_ORDER[0]).toBe("today");
});
it("normalizes old settings and appends newly available entries", () => {
  expect(normalizeSidebarOrder(["brain", "brain", "invalid"])[0]).toBe("brain");
  expect(normalizeSidebarOrder(undefined)).toEqual(DEFAULT_SIDEBAR_ORDER);
  expect(normalizeSidebarOrder(["brain"]).length).toBe(DEFAULT_SIDEBAR_ORDER.length);
});
it("accepts only primary navigation items and normalizes the legacy library alias", () => {
  expect(normalizeSidebarHiddenItems(["boards", "boards", "database", "library", "settings", "invalid", null, {}, 1])).toEqual(["boards", "library"]);
  for (const value of [undefined, null, "boards", { boards: true }]) expect(normalizeSidebarHiddenItems(value)).toEqual([]);
});
it("filters hidden entries without removing their saved positions", () => {
  const order = moveSidebarItem(DEFAULT_SIDEBAR_ORDER, "tasks", "today");
  expect(getVisibleSidebarOrder(order, ["tasks", "boards"])).toEqual(order.filter(id => id !== "tasks" && id !== "boards"));
  expect(getVisibleSidebarOrder(order, [])).toEqual(order);
  expect(order[0]).toBe("tasks");
  expect(order).toContain("boards");
});
it("can hide every primary feature and still restore the complete original order", () => {
  expect(getVisibleSidebarOrder(DEFAULT_SIDEBAR_ORDER, DEFAULT_SIDEBAR_ORDER)).toEqual([]);
  expect(getVisibleSidebarOrder(undefined, undefined)).toEqual(DEFAULT_SIDEBAR_ORDER);
});
it("keeps hidden entries while visible navigation is reordered", () => {
  const order = moveSidebarItem(DEFAULT_SIDEBAR_ORDER, "tasks", "today");
  expect(getVisibleSidebarOrder(order, ["boards"])).not.toContain("boards");
  expect(getVisibleSidebarOrder(order, [])).toEqual(order);
  expect(order.indexOf("boards")).toBe(DEFAULT_SIDEBAR_ORDER.indexOf("boards") + 1);
});
