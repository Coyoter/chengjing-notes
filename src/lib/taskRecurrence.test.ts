import { describe, expect, it } from "vitest";
import { firstRecurringDate, nextRecurringDate } from "./taskRecurrence";
import { localDateKey, timestampForLocalDateKey } from "./taskTimeline";

const day = (key: string) => timestampForLocalDateKey(key);
const next = (rule: Parameters<typeof nextRecurringDate>[0], key: string) => localDateKey(nextRecurringDate(rule, day(key)));
describe("recurring task calendar rules", () => {
  it("moves daily across months and leap days", () => {
    expect(next({frequency:"daily"}, "2028-02-28")).toBe("2028-02-29");
    expect(next({frequency:"daily"}, "2027-12-31")).toBe("2028-01-01");
  });
  it("uses chosen weekday without repeating the same day", () => {
    expect(next({frequency:"weekly",weekday:1}, "2026-11-16")).toBe("2026-11-23");
    expect(next({frequency:"weekly",weekday:5}, "2026-11-16")).toBe("2026-11-20");
  });
  it("repeats monthly on the 20th", () => {
    expect(next({frequency:"monthly",day:20}, "2026-11-20")).toBe("2026-12-20");
    expect(next({frequency:"monthly",day:20}, "2026-12-20")).toBe("2027-01-20");
    expect(localDateKey(firstRecurringDate({frequency:"monthly",day:20},day("2026-11-16")))).toBe("2026-11-20");
  });
  it("clamps month end but restores the selected date", () => {
    expect(next({frequency:"monthly",day:31}, "2027-01-31")).toBe("2027-02-28");
    expect(next({frequency:"monthly",day:31}, "2027-02-28")).toBe("2027-03-31");
    expect(next({frequency:"monthly",day:29}, "2028-01-29")).toBe("2028-02-29");
  });
  it("rejects invalid dates", () => {
    expect(() => nextRecurringDate({frequency:"monthly",day:32},Date.now())).toThrow();
    expect(() => nextRecurringDate({frequency:"weekly",weekday:7},Date.now())).toThrow();
  });
});
