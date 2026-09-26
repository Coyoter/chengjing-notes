import { getHiddenTaskIds } from "../lib/activeContent";
import { useCallback, useEffect, useRef, useState, type MouseEvent, type KeyboardEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { getVisibleSidebarOrder, moveSidebarItem, normalizeSidebarOrder } from "../lib/sidebarOrder";
import { useLiveQuery } from "dexie-react-hooks";
import {
  BrainCircuit,
  BookOpenText,
  CalendarDays,
  ChevronsLeft,
  ChevronsRight,
  CircleCheckBig,
  Columns3,
  Droplets,
  FileStack,
  Feather,
  Highlighter,
  LayoutDashboard,
  Plus,
  Settings,
  SquareKanban,
  Sparkles,
} from "lucide-react";
import { db } from "../db";
import { useAppStore } from "../store";
import type { AppView } from "../types";
import markUrl from "../assets/mark.svg";
import { showContextMenuFromPointer } from "../lib/contextMenu";
import { useI18n } from "../hooks/useI18n";
import type { MessageKey } from "../i18n";
import { getWishPoolCopy } from "../lib/wishPoolCopy";
import { primaryShortcut } from "../lib/platform";
import { preloadWorkspaceView } from "./Workspace";
import { SidebarContextMenu, type SidebarMenuRequest } from "./SidebarContextMenu";
import { getSidebarVisibilityCopy } from "../lib/sidebarVisibilityCopy";

const nav: Array<{ view: AppView; label: MessageKey; icon: typeof FileStack; badge?: "tasks" }> = [
  { view: "today", label: "nav.today", icon: LayoutDashboard },
  { view: "fragments", label: "nav.fragments", icon: Feather },
  { view: "journal", label: "nav.journal", icon: CalendarDays },
  { view: "boards", label: "nav.boards", icon: Columns3 },
  { view: "kanban", label: "nav.kanban", icon: SquareKanban },
  { view: "brain", label: "nav.brain", icon: BrainCircuit },
  { view: "library", label: "nav.library", icon: FileStack },
  { view: "tasks", label: "nav.tasks", icon: CircleCheckBig, badge: "tasks" },
  { view: "highlights", label: "nav.highlights", icon: Highlighter },
];

export function Sidebar() {
  const boards = useLiveQuery(() => db.boards.orderBy("updatedAt").reverse().limit(5).toArray(), [], []);
  const taskCount = useLiveQuery(async () => {
    const hidden = await getHiddenTaskIds();
    return db.tasks.where("doneKey").equals("active").filter((task) => !hidden.has(task.id)).count();
  }, [], 0);
  const view = useAppStore((state) => state.view);
  const selectedBoardId = useAppStore((state) => state.selectedBoardId);
  const collapsed = useAppStore((state) => state.sidebarCollapsed);
  const sidebarOrder = useAppStore(state => state.sidebarOrder);
  const setSidebarOrder = useAppStore(state => state.setSidebarOrder);
  const sidebarHiddenItems = useAppStore(state => state.sidebarHiddenItems);
  const setSidebarItemHidden = useAppStore(state => state.setSidebarItemHidden);
  const showAllSidebarItems = useAppStore(state => state.showAllSidebarItems);
  const desktop = window.chengjing?.platform !== "android";
  const reducedMotion = useReducedMotion();
  const dragSource = useRef<AppView | null>(null);
  const [dropTarget, setDropTarget] = useState<AppView | null>(null);
  const fullOrder = normalizeSidebarOrder(desktop ? sidebarOrder : undefined);
  const visibleOrder = getVisibleSidebarOrder(fullOrder, desktop ? sidebarHiddenItems : []);
  const orderedNav = visibleOrder.map(id => nav.find(item => item.view === id)!);
  const rightPanel = useAppStore((state) => state.rightPanel);
  const language = useAppStore((state) => state.language);
  const setView = useAppStore((state) => state.setView);
  const openBoard = useAppStore((state) => state.openBoard);
  const setCollapsed = useAppStore((state) => state.setSidebarCollapsed);
  const setCreateCardOpen = useAppStore((state) => state.setCreateCardOpen);
  const { t } = useI18n();
  const wishCopy = getWishPoolCopy(language);
  const visibilityCopy = getSidebarVisibilityCopy(language);
  const preloadTimer = useRef<number | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [menu, setMenu] = useState<SidebarMenuRequest | null>(null);
  const menuTrigger = useRef<HTMLElement | null>(null);
  const hiddenNav = fullOrder.filter(id => !visibleOrder.includes(id)).map(id => ({ view: id, label: t(nav.find(item => item.view === id)!.label) }));
  const closeMenu = useCallback((restoreFocus = false) => {
    setMenu(null);
    if (restoreFocus) requestAnimationFrame(() => {
      const trigger = menuTrigger.current;
      (trigger?.isConnected ? trigger : sidebarRef.current)?.focus({ preventScroll: true });
    });
  }, []);

  function openMenu(event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, targetView?: AppView) {
    if (!desktop) return;
    event.preventDefault();
    event.stopPropagation();
    cancelPrepareView();
    window.dispatchEvent(new Event("chengjing:sidebar-context-menu"));
    menuTrigger.current = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    const pointer = "clientX" in event && (event.clientX !== 0 || event.clientY !== 0);
    setMenu({ view: targetView, x: pointer ? event.clientX : rect.left + 12, y: pointer ? event.clientY : rect.top + Math.min(rect.height, 44) });
  }

  function isContextKey(event: KeyboardEvent<HTMLElement>) {
    return event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
  }

  useEffect(() => () => {
    if (preloadTimer.current !== null) window.clearTimeout(preloadTimer.current);
  }, []);

  function prepareView(nextView: AppView) {
    if (nextView === view) return;
    if (preloadTimer.current !== null) window.clearTimeout(preloadTimer.current);
    preloadTimer.current = window.setTimeout(() => {
      preloadTimer.current = null;
      void preloadWorkspaceView(nextView).catch(() => {});
    }, 80);
  }

  function cancelPrepareView() {
    if (preloadTimer.current !== null) window.clearTimeout(preloadTimer.current);
    preloadTimer.current = null;
  }

  function prepareViewNow(nextView: AppView) {
    cancelPrepareView();
    if (nextView !== view) void preloadWorkspaceView(nextView).catch(() => {});
  }

  return (
    <aside ref={sidebarRef} className={`sidebar ${collapsed ? "is-collapsed" : ""}`}
      tabIndex={desktop ? 0 : undefined} aria-label={t("nav.primary")}
      onContextMenu={(event) => {
        if ((event.target as Element).closest("button, a, input, textarea, [contenteditable]")) return;
        openMenu(event);
      }}
      onKeyDown={(event) => { if (event.target === event.currentTarget && isContextKey(event)) openMenu(event); }}>
      <div className="window-drag-region" />
      <div className="brand-row">
        <img src={markUrl} alt="" />
        {!collapsed && (
          <div className="brand-copy">
            <strong>澄境</strong>
            <span>ChengJing</span>
          </div>
        )}
      </div>

      <button className="quick-create" type="button" onClick={() => setCreateCardOpen(true)}>
        <Plus size={17} />
        {!collapsed && <span>{t("nav.quickCapture")}</span>}
        {!collapsed && <kbd>{primaryShortcut("N")}</kbd>}
      </button>

      <nav className="primary-nav" aria-label={t("nav.primary")}>
        {orderedNav.map((item) => {
          const Icon = item.icon;
          const label = t(item.label);
          const badge = item.badge === "tasks" ? taskCount : 0;
          return (
            <motion.button
              layout="position"
              transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 450, damping: 35 }}
              key={item.view}
              type="button"
              className={`${view === item.view ? "is-active" : ""}${dropTarget === item.view ? " is-reorder-target" : ""}`}
              draggable={desktop}
              data-nav-id={item.view}
              onDragStartCapture={(event) => { if (!desktop) return; cancelPrepareView(); dragSource.current = item.view; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/x-chengjing-navigation", item.view); }}
              onDragOver={(event) => { if (!desktop || !dragSource.current) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(item.view); }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(event) => { if (!desktop || !dragSource.current) return; event.preventDefault(); setSidebarOrder(moveSidebarItem(sidebarOrder, dragSource.current, item.view)); dragSource.current = null; setDropTarget(null); }}
              onDragEndCapture={() => { dragSource.current = null; setDropTarget(null); }}
              onContextMenu={(event) => openMenu(event, item.view)}
              onKeyDown={(event) => {
                if (isContextKey(event)) { openMenu(event, item.view); return; }
                if (!desktop || !event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
                event.preventDefault();
                const index = visibleOrder.indexOf(item.view);
                const target = visibleOrder[index + (event.key === "ArrowUp" ? -1 : 1)];
                if (target) setSidebarOrder(moveSidebarItem(fullOrder, item.view, target));
              }}
              onPointerEnter={() => { if (!dragSource.current) prepareView(item.view); }}
              onPointerLeave={cancelPrepareView}
              onPointerDown={() => { if (!desktop) prepareViewNow(item.view); }}
              onFocus={() => prepareViewNow(item.view)}
              onClick={() => setView(item.view)}
              aria-current={view === item.view ? "page" : undefined}
              aria-label={label}
              aria-haspopup={desktop ? "menu" : undefined}
              aria-expanded={desktop ? menu?.view === item.view : undefined}
              title={collapsed ? label : desktop ? `${label} · ${visibilityCopy.navigationHint}` : undefined}
            >
              <Icon size={17} />
              {!collapsed && <span>{label}</span>}
              {!collapsed && badge > 0 && <b className="nav-badge">{badge}</b>}
            </motion.button>
          );
        })}
      </nav>

      {!collapsed && visibleOrder.includes("boards") && (
        <section className="sidebar-boards">
          <header>
            <span>{t("nav.recentBoards")}</span>
            <button type="button" className="bare-button" onPointerEnter={() => prepareView("boards")} onPointerLeave={cancelPrepareView} onPointerDown={() => prepareViewNow("boards")} onFocus={() => prepareViewNow("boards")} onClick={() => setView("boards")} aria-label={t("nav.viewAllBoards")}><BookOpenText size={14} /></button>
          </header>
          {boards.map((board) => (
            <button
              type="button"
              key={board.id}
              className={view === "boards" && selectedBoardId === board.id ? "is-active" : ""}
              onPointerEnter={() => prepareView("boards")}
              onPointerLeave={cancelPrepareView}
              onPointerDown={() => prepareViewNow("boards")}
              onFocus={() => prepareViewNow("boards")}
              onClick={() => openBoard(board.id)}
              onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "board", id: board.id })}
            >
              <i aria-hidden="true" />
              <span>{board.title}</span>
            </button>
          ))}
        </section>
      )}

      <div className="sidebar-footer">
        <button type="button" onClick={() => useAppStore.getState().openAI()} title={collapsed ? t("nav.ai") : undefined}>
          <Sparkles size={17} />
          {!collapsed && <span>{t("nav.ai")}</span>}
        </button>
        <button type="button" className={rightPanel === "wish" ? "is-active" : ""} onClick={() => useAppStore.getState().openWishPool()} title={collapsed ? wishCopy.nav : undefined}>
          <Droplets size={17} />
          {!collapsed && <span>{wishCopy.nav}</span>}
        </button>
        <button type="button" className={view === "settings" ? "is-active" : ""} onPointerEnter={() => prepareView("settings")} onPointerLeave={cancelPrepareView} onPointerDown={() => prepareViewNow("settings")} onFocus={() => prepareViewNow("settings")} onClick={() => setView("settings")} title={collapsed ? t("nav.settings") : undefined}>
          <Settings size={17} />
          {!collapsed && <span>{t("nav.settings")}</span>}
        </button>
        <button className="sidebar-collapse" type="button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? t("nav.expand") : t("nav.collapse")} title={collapsed ? t("nav.expand") : undefined}>
          {collapsed ? <ChevronsRight size={17} /> : <ChevronsLeft size={17} />}
          {!collapsed && <span>{t("nav.collapse")}</span>}
        </button>
      </div>
      {menu && <SidebarContextMenu request={menu} title={menu.view ? t(nav.find(item => item.view === menu.view)!.label) : undefined}
        hidden={hiddenNav} copy={visibilityCopy} onHide={(id) => setSidebarItemHidden(id, true)} onShow={(id) => setSidebarItemHidden(id, false)}
        onShowAll={showAllSidebarItems} onClose={closeMenu} />}
    </aside>
  );
}
