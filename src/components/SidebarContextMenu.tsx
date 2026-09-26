import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeOff, RotateCcw } from "lucide-react";
import type { AppView } from "../types";
import type { getSidebarVisibilityCopy } from "../lib/sidebarVisibilityCopy";

export interface SidebarMenuRequest {
  x: number;
  y: number;
  view?: AppView;
}

interface Props {
  request: SidebarMenuRequest;
  title?: string;
  hidden: Array<{ view: AppView; label: string }>;
  copy: ReturnType<typeof getSidebarVisibilityCopy>;
  onHide: (view: AppView) => void;
  onShow: (view: AppView) => void;
  onShowAll: () => void;
  onClose: (restoreFocus?: boolean) => void;
}

export function SidebarContextMenu({ request, title, hidden, copy, onHide, onShow, onShowAll, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: request.x, y: request.y });

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    setPosition({ x: Math.max(8, Math.min(request.x, innerWidth - rect.width - 8)), y: Math.max(8, Math.min(request.y, innerHeight - rect.height - 8)) });
    (menu.querySelector<HTMLElement>('[role="menuitem"]') ?? menu).focus({ preventScroll: true });
  }, [request, hidden.length, copy]);

  useEffect(() => {
    const outside = (event: Event) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const close = () => onClose();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(true); }
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("chengjing:context-menu", close);
    window.addEventListener("keydown", escape);
    document.addEventListener("scroll", outside, true);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("chengjing:context-menu", close);
      window.removeEventListener("keydown", escape);
      document.removeEventListener("scroll", outside, true);
    };
  }, [onClose]);

  function run(action: () => void) { action(); onClose(true); }

  return createPortal(
    <div ref={ref} role="menu" tabIndex={-1} aria-label={title ?? copy.hidden}
      className="global-context-menu sidebar-context-menu" style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onKeyDown={(event) => {
        if (event.key === "Tab") { event.preventDefault(); onClose(true); return; }
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
        if (!items.length) return;
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}>
      {request.view && <>
        <header><b>{title}</b></header>
        <button type="button" role="menuitem" onClick={() => run(() => onHide(request.view!))}><EyeOff size={16} /><span>{copy.hide}</span></button>
        <p className="sidebar-menu-hint">{copy.hint}</p>
      </>}
      {(!request.view || hidden.length > 0) && <>
        {request.view && <div role="separator" className="sidebar-menu-divider" />}
        <header><span>{copy.hidden}</span></header>
        {hidden.length === 0 ? <p className="sidebar-menu-hint">{copy.empty}</p> : hidden.map((item) => (
          <button key={item.view} type="button" role="menuitem" aria-label={`${copy.show} ${item.label}`} onClick={() => run(() => onShow(item.view))}>
            <Eye size={16} /><span>{item.label}</span>
          </button>
        ))}
        {hidden.length > 1 && <>
          <div role="separator" className="sidebar-menu-divider" />
          <button type="button" role="menuitem" onClick={() => run(onShowAll)}><RotateCcw size={16} /><span>{copy.showAll}</span></button>
        </>}
      </>}
    </div>, document.body,
  );
}
