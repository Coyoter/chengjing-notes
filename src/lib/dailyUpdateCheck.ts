export const DAILY_UPDATE_CHECK_KEY = "chengjing-last-successful-update-check-day";

export function localCalendarDay(value = new Date()) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function shouldCheckForUpdatesToday(storage: Pick<Storage, "getItem">, now = new Date()) {
  try { return storage.getItem(DAILY_UPDATE_CHECK_KEY) !== localCalendarDay(now); }
  catch { return true; }
}

export function markUpdatesCheckedToday(storage: Pick<Storage, "setItem">, now = new Date()) {
  storage.setItem(DAILY_UPDATE_CHECK_KEY, localCalendarDay(now));
}
