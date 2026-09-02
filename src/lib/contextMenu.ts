import type { MouseEvent as ReactMouseEvent } from "react";

export type ContextTarget =
  | { kind: "card"; id: string }
  | { kind: "task"; id: string }
  | { kind: "highlight"; id: string }
  | { kind: "fragment"; id: string }
  | { kind: "board"; id: string }
  | { kind: "tag"; id: string };

export interface ContextMenuRequest {
  target: ContextTarget;
  x: number;
  y: number;
}

export function showContextMenu(target: ContextTarget, x: number, y: number) {
  window.dispatchEvent(new CustomEvent<ContextMenuRequest>("chengjing:context-menu", {
    detail: { target, x, y },
  }));
}

export function showContextMenuFromPointer(
  event: ReactMouseEvent<HTMLElement>,
  target: ContextTarget,
) {
  event.preventDefault();
  event.stopPropagation();
  showContextMenu(target, event.clientX, event.clientY);
}

export function showContextMenuFromButton(
  event: ReactMouseEvent<HTMLElement>,
  target: ContextTarget,
) {
  event.preventDefault();
  event.stopPropagation();
  const rect = event.currentTarget.getBoundingClientRect();
  showContextMenu(target, rect.right - 6, rect.bottom + 5);
}
