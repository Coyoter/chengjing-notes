import { expect, it } from "vitest";
import { DEFAULT_SIDEBAR_ORDER, moveSidebarItem, normalizeSidebarOrder } from "./sidebarOrder";
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
