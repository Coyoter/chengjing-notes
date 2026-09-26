import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SIDEBAR_ORDER, getVisibleSidebarOrder } from "./lib/sidebarOrder";
import { useAppStore } from "./store";

describe("local sidebar visibility preferences", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({ view: "boards", selectedBoardId: "keep-board", sidebarOrder: [...DEFAULT_SIDEBAR_ORDER], sidebarHiddenItems: [] });
  });

  it("hides the selected feature without closing it or changing its saved order", () => {
    useAppStore.getState().setSidebarItemHidden("boards", true);
    useAppStore.getState().setSidebarItemHidden("boards", true);
    expect(useAppStore.getState().sidebarHiddenItems).toEqual(["boards"]);
    expect(useAppStore.getState().view).toBe("boards");
    expect(useAppStore.getState().selectedBoardId).toBe("keep-board");
    expect(useAppStore.getState().sidebarOrder).toEqual(DEFAULT_SIDEBAR_ORDER);
    const persisted = JSON.parse(localStorage.getItem("chengjing-ui")!);
    expect(persisted.state.sidebarHiddenItems).toEqual(["boards"]);
    expect(persisted.state.view).toBeUndefined();
  });

  it("restores individual features or all features without altering the original order", () => {
    const reordered = ["tasks", ...DEFAULT_SIDEBAR_ORDER.filter(id => id !== "tasks")] as typeof DEFAULT_SIDEBAR_ORDER;
    useAppStore.getState().setSidebarOrder(reordered);
    useAppStore.getState().setSidebarItemHidden("boards", true);
    useAppStore.getState().setSidebarItemHidden("tasks", true);
    useAppStore.getState().setSidebarItemHidden("boards", false);
    expect(useAppStore.getState().sidebarHiddenItems).toEqual(["tasks"]);
    useAppStore.getState().showAllSidebarItems();
    expect(useAppStore.getState().sidebarHiddenItems).toEqual([]);
    expect(getVisibleSidebarOrder(useAppStore.getState().sidebarOrder, [])).toEqual(reordered);
  });

  it("does not hide settings and treats the legacy database alias as library", () => {
    useAppStore.getState().setSidebarItemHidden("settings", true);
    useAppStore.getState().setSidebarItemHidden("database", true);
    expect(useAppStore.getState().sidebarHiddenItems).toEqual(["library"]);
    useAppStore.getState().setSidebarItemHidden("database", false);
    expect(useAppStore.getState().sidebarHiddenItems).toEqual([]);
  });

  it("retains hidden choices after rehydrating from local storage", async () => {
    useAppStore.getState().setSidebarItemHidden("boards", true);
    const persisted = localStorage.getItem("chengjing-ui")!;
    useAppStore.setState({ sidebarHiddenItems: [] });
    localStorage.setItem("chengjing-ui", persisted);
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().sidebarHiddenItems).toEqual(["boards"]);
  });

  it("sanitizes malformed preferences and migrates old saved settings without hiding anything", async () => {
    localStorage.setItem("chengjing-ui", JSON.stringify({ state: { sidebarOrder: ["tasks", "bad"], sidebarHiddenItems: ["boards", "boards", "settings", "database"] }, version: 0 }));
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().sidebarOrder).toEqual(["tasks", ...DEFAULT_SIDEBAR_ORDER.filter(id => id !== "tasks")]);
    expect(useAppStore.getState().sidebarHiddenItems).toEqual(["boards", "library"]);
    localStorage.setItem("chengjing-ui", JSON.stringify({ state: { theme: "dark", sidebarOrder: "invalid" }, version: 0 }));
    await useAppStore.persist.rehydrate();
    expect(useAppStore.getState().sidebarOrder).toEqual(DEFAULT_SIDEBAR_ORDER);
    expect(useAppStore.getState().sidebarHiddenItems).toEqual([]);
    expect(useAppStore.getState().theme).toBe("dark");
  });
});
