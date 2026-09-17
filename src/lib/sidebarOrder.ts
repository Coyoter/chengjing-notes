import type { AppView } from "../types";
export const DEFAULT_SIDEBAR_ORDER: AppView[] = ["today", "fragments", "journal", "boards", "kanban", "brain", "library", "tasks", "highlights"];
export function normalizeSidebarOrder(value: unknown): AppView[] {
  const input = Array.isArray(value) ? value.map(id => id === "database" ? "library" : id) : [];
  return [...new Set([...input.filter((id): id is AppView => DEFAULT_SIDEBAR_ORDER.includes(id)), ...DEFAULT_SIDEBAR_ORDER])];
}
export function moveSidebarItem(order: unknown, source: AppView, target: AppView): AppView[] {
  const next = normalizeSidebarOrder(order);
  const from = next.indexOf(source), to = next.indexOf(target);
  if (from < 0 || to < 0 || from === to) return next;
  next.splice(from, 1); next.splice(to, 0, source);
  return next;
}
