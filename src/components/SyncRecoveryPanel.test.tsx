import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  SyncRecoveryPanel, recoveryHistoryRows, type SyncRecoveryPanelProps,
} from "./SyncRecoveryPanel";
import type { AppLanguage, SyncRecoverySnapshot } from "../types";
import type { RecoveryRestoreResult } from "../lib/syncRecoveryController";

const now = Date.parse("2026-09-09T23:50:00Z");
const point = (day: string): SyncRecoverySnapshot => ({
  id: `snapshot-${day}`, day, snapshotAt: Date.parse(`${day}T08:00:00Z`),
  contentHash: "a".repeat(64), size: 100,
});

let root: Root;
let host: HTMLDivElement;
let props: SyncRecoveryPanelProps;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    language: "zh-TW", enabled: true, available: true, now,
    state: {
      phase: "idle", error: "", warning: "", lastRestore: null,
      status: { dayBasis: "UTC", today: point("2026-09-09"),
        yesterday: point("2026-09-08"), dayBeforeYesterday: point("2026-09-07") },
    },
    onRefresh: vi.fn(async () => {}),
    onRestore: vi.fn(async () => ({
      restoredItems: 2, deletedItems: 1, safetyCopyPath: "/test/safety.json", syncPending: false,
    })),
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const render = () => act(async () => root.render(<SyncRecoveryPanel {...props} />));
const buttons = () => [...host.querySelectorAll<HTMLButtonElement>(".sync-recovery-point > button")];

it("shows exactly yesterday and the day before, without exposing a third current-backup control", async () => {
  await render();
  expect(host.querySelectorAll(".sync-recovery-point")).toHaveLength(2);
  expect(host.textContent).toContain("昨天");
  expect(host.textContent).toContain("前天");
  expect(buttons()[0].getAttribute("aria-label")).toContain("2026-09-08");
  expect(buttons()[1].getAttribute("aria-label")).toContain("2026-09-07");
  expect(host.textContent).toContain("UTC");
  expect(props.onRefresh).not.toHaveBeenCalled();
  expect(props.onRestore).not.toHaveBeenCalled();
});

it("does not invent a point for a missing date or relabel an old snapshot", async () => {
  props.state.status!.yesterday = null;
  props.state.status!.dayBeforeYesterday = point("2026-09-01");
  await render();
  expect(buttons().every(button => button.disabled)).toBe(true);
  expect(host.textContent).toContain("這一天沒有可用的復原點");
});

it("moves known snapshots to their real dates after a UTC date change", () => {
  const rows = recoveryHistoryRows(props.state.status, now + 86_400_000);
  expect(rows[0].day).toBe("2026-09-09");
  expect(rows[0].snapshot?.id).toBe("snapshot-2026-09-09");
  expect(rows[1].snapshot?.id).toBe("snapshot-2026-09-08");
});

it("does not allow restore before explicit confirmation of the full rollback", async () => {
  vi.mocked(window.confirm).mockReturnValue(false);
  await render();
  await act(async () => buttons()[0].click());
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("所有已同步內容"));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("新增的內容也會移除"));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("本機安全副本"));
  expect(props.onRestore).not.toHaveBeenCalled();
});

it("passes the selected immutable snapshot to the tested recovery controller", async () => {
  await render();
  await act(async () => buttons()[0].click());
  expect(props.onRestore).toHaveBeenCalledTimes(1);
  expect(props.onRestore).toHaveBeenCalledWith(point("2026-09-08"));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("UTC"));
});

it("guards double clicks while an asynchronous restoration is pending", async () => {
  let finish!: () => void;
  props.onRestore = vi.fn(() => new Promise<RecoveryRestoreResult>(resolve => {
    finish = () => resolve({
      restoredItems: 2, deletedItems: 1, safetyCopyPath: "/test/safety.json", syncPending: false,
    });
  }));
  await render();
  await act(async () => { buttons()[0].click(); buttons()[0].click(); });
  expect(props.onRestore).toHaveBeenCalledTimes(1);
  expect(buttons().every(button => button.disabled)).toBe(true);
  await act(async () => finish());
});

it("paused sync can refresh metadata but cannot restore", async () => {
  props.enabled = false;
  await render();
  expect(buttons().every(button => button.disabled)).toBe(true);
  await act(async () => host.querySelector<HTMLButtonElement>(".sync-recovery-refresh")!.click());
  expect(props.onRefresh).toHaveBeenCalledTimes(1);
  expect(props.onRestore).not.toHaveBeenCalled();
});

it("other active recovery tools block all daily-point actions", async () => {
  props.blocked = true;
  await render();
  expect([...host.querySelectorAll<HTMLButtonElement>("button")].every(button => button.disabled)).toBe(true);
});

it("reports local restoration success separately from pending synchronization", async () => {
  props.state.error = "sync-recovery-restored-sync-pending";
  props.state.lastRestore = {
    restoredItems: 2, deletedItems: 1, safetyCopyPath: "/test/safety.json", syncPending: true,
  };
  await render();
  expect(host.textContent).toContain("內容已在本機復原");
  expect(host.textContent).toContain("不需要重複復原");
  expect(host.querySelector("code")?.textContent).toBe("/test/safety.json");
});

it("never displays raw transport secrets or stack traces", async () => {
  props.state.error = "Bearer private-secret /Users/private/credentials";
  await render();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).not.toContain("private-secret");
  expect(host.textContent).not.toContain("/Users/private");
});

it("an unavailable platform does not pretend that daily recovery works", async () => {
  props.available = false;
  await render();
  expect(host.querySelectorAll("button")).toHaveLength(0);
  expect(host.textContent).toContain("此平台尚未提供");
});

for (const [language, heading] of [
  ["zh-CN", "每日恢复点"], ["en", "Daily recovery points"],
  ["ja", "毎日の復元ポイント"], ["ko", "일일 복원 지점"],
] as Array<[AppLanguage, string]>) {
  it(`localizes daily recovery controls for ${language}`, async () => {
    props.language = language;
    await render();
    expect(host.querySelector("h5")?.textContent).toBe(heading);
    expect(buttons()).toHaveLength(2);
  });
}
