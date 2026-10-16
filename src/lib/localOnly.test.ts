import { afterEach, beforeEach, expect, it, vi } from "vitest";

const original = window.chengjing;
beforeEach(() => { vi.resetModules(); localStorage.clear(); });
afterEach(() => { window.chengjing = original; });
function bridge(enabled: boolean) {
  let changed: (state: { enabled: boolean; revision: number }) => void = () => {};
  window.chengjing = { privacy: { initial: { enabled, revision: 0 }, onChanged: (callback: typeof changed) => { changed = callback; return () => {}; }, setLocalOnly: vi.fn() } } as unknown as NonNullable<Window["chengjing"]>;
  return (value: boolean) => changed({ enabled: value, revision: 1 });
}
it("uses native startup policy before managers mount; cannot be overridden by localStorage", async () => {
  bridge(true);
  localStorage.setItem("chengjing-ui", JSON.stringify({ state: { localOnly: false }, version: 0 }));
  const policy = await import("./localOnly");
  expect(policy.isLocalOnly()).toBe(true);
  expect(() => policy.assertCloudAvailable()).toThrow("local-only-mode");
});
it("blocks cloud navigation/actions while retaining local navigation and the sync preference", async () => {
  bridge(true);
  localStorage.setItem("chengjing-sync-enabled", "true");
  const { useAppStore } = await import("../store");
  const { syncEnabled } = await import("./syncJournal");
  useAppStore.getState().setView("brain");
  useAppStore.getState().openAI();
  useAppStore.getState().openAIWithAction("change something");
  useAppStore.getState().openWishPool();
  expect(useAppStore.getState().view).toBe("today");
  expect(useAppStore.getState().rightPanel).toBe("none");
  expect(useAppStore.getState().aiActionRequest).toBeNull();
  expect(syncEnabled()).toBe(false);
  expect(localStorage.getItem("chengjing-sync-enabled")).toBe("true");
  useAppStore.getState().setView("library");
  expect(useAppStore.getState().view).toBe("library");
});
it("receives native changes without changing note data or deleting synchronization state", async () => {
  const change = bridge(false);
  const policy = await import("./localOnly");
  expect(policy.isLocalOnly()).toBe(false);
  change(true);
  expect(policy.isLocalOnly()).toBe(true);
  expect(document.documentElement.dataset.localOnly).toBe("true");
  change(false);
  expect(() => policy.assertCloudAvailable()).not.toThrow();
});
