import { describe, expect, it } from "vitest";
import { DAILY_UPDATE_CHECK_KEY, localCalendarDay, markUpdatesCheckedToday, shouldCheckForUpdatesToday } from "./dailyUpdateCheck";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("每日首次更新檢查", () => {
  it("使用本機日曆日而不是固定 24 小時", () => {
    expect(localCalendarDay(new Date(2026, 7, 27, 0, 1))).toBe("2026-08-27");
    expect(localCalendarDay(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });

  it("同一天成功檢查後不重複，隔天重新檢查", () => {
    const storage = memoryStorage();
    const firstDay = new Date(2026, 7, 27, 8, 0);
    expect(shouldCheckForUpdatesToday(storage, firstDay)).toBe(true);
    markUpdatesCheckedToday(storage, firstDay);
    expect(storage.getItem(DAILY_UPDATE_CHECK_KEY)).toBe("2026-08-27");
    expect(shouldCheckForUpdatesToday(storage, new Date(2026, 7, 27, 23, 59))).toBe(false);
    expect(shouldCheckForUpdatesToday(storage, new Date(2026, 7, 28, 0, 1))).toBe(true);
  });
});
