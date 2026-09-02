import type { TaskRecord } from "../types";

export interface TaskDateGroup {
  key: string;
  date: number;
  tasks: TaskRecord[];
  distanceDays: number;
}

export interface TaskTimeline {
  todayKey: string;
  today: TaskRecord[];
  overdue: TaskDateGroup[];
  future: TaskDateGroup[];
  noDate: TaskRecord[];
  completed: TaskRecord[];
}

export function localDateKey(value: number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function timestampForLocalDateKey(key: string) {
  const matched = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return 0;
  const date = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]), 12);
  if (date.getFullYear() !== Number(matched[1]) || date.getMonth() !== Number(matched[2]) - 1 || date.getDate() !== Number(matched[3])) return 0;
  return date.getTime();
}

function utcDayNumber(key: string) {
  const matched = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return Number.NaN;
  return Math.floor(Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3])) / 86_400_000);
}

export function calendarDayDistance(fromKey: string, toKey: string) {
  return utcDayNumber(toKey) - utcDayNumber(fromKey);
}

function taskOrder(left: TaskRecord, right: TaskRecord) {
  return left.createdAt - right.createdAt || left.title.localeCompare(right.title);
}

function buildDateGroups(tasks: TaskRecord[], todayKey: string) {
  const groups = new Map<string, TaskRecord[]>();
  tasks.forEach((task) => {
    const key = localDateKey(task.dueAt!);
    if (!key) return;
    groups.set(key, [...(groups.get(key) || []), task]);
  });
  return [...groups.entries()]
    .map(([key, items]) => ({ key, date: timestampForLocalDateKey(key), tasks: items.sort(taskOrder), distanceDays: calendarDayDistance(todayKey, key) }))
    .sort((left, right) => left.date - right.date);
}

export function groupTasksByTimeline(tasks: TaskRecord[], now = Date.now()): TaskTimeline {
  const todayKey = localDateKey(now);
  const active = tasks.filter((task) => !task.done);
  const dated = active.filter((task) => task.dueAt && Number.isFinite(task.dueAt) && localDateKey(task.dueAt));
  const today = dated.filter((task) => localDateKey(task.dueAt!) === todayKey).sort(taskOrder);
  const overdueTasks = dated.filter((task) => localDateKey(task.dueAt!) < todayKey);
  const futureTasks = dated.filter((task) => localDateKey(task.dueAt!) > todayKey);
  const noDate = active.filter((task) => !task.dueAt || !Number.isFinite(task.dueAt) || !localDateKey(task.dueAt)).sort((left, right) => right.updatedAt - left.updatedAt);
  const completed = tasks.filter((task) => task.done).sort((left, right) => right.updatedAt - left.updatedAt);
  return {
    todayKey,
    today,
    overdue: buildDateGroups(overdueTasks, todayKey),
    future: buildDateGroups(futureTasks, todayKey),
    noDate,
    completed,
  };
}
