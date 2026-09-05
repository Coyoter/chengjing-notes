import { useEffect, useRef } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Archive,
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

const nav: Array<{ view: AppView; label: MessageKey; icon: typeof Archive; badge?: "tasks" }> = [
  { view: "today", label: "nav.today", icon: LayoutDashboard },
  { view: "fragments", label: "nav.fragments", icon: Feather },
  { view: "journal", label: "nav.journal", icon: CalendarDays },
  { view: "boards", label: "nav.boards", icon: Columns3 },
  { view: "kanban", label: "nav.kanban", icon: SquareKanban },
  { view: "brain", label: "nav.brain", icon: BrainCircuit },
  { view: "library", label: "nav.library", icon: FileStack },
  { view: "database", label: "nav.database", icon: Archive },
  { view: "tasks", label: "nav.tasks", icon: CircleCheckBig, badge: "tasks" },
  { view: "highlights", label: "nav.highlights", icon: Highlighter },
];

export function Sidebar() {
  const boards = useLiveQuery(() => db.boards.orderBy("updatedAt").reverse().limit(5).toArray(), [], []);
  const taskCount = useLiveQuery(async () => {
    const trash = new Set(await db.cards.where("state").equals("trash").primaryKeys());
    return db.tasks.where("doneKey").equals("active").filter((task) => !task.cardId || !trash.has(task.cardId)).count();
  }, [], 0);
  const view = useAppStore((state) => state.view);
  const selectedBoardId = useAppStore((state) => state.selectedBoardId);
  const collapsed = useAppStore((state) => state.sidebarCollapsed);
  const rightPanel = useAppStore((state) => state.rightPanel);
  const language = useAppStore((state) => state.language);
  const setView = useAppStore((state) => state.setView);
  const openBoard = useAppStore((state) => state.openBoard);
  const setCollapsed = useAppStore((state) => state.setSidebarCollapsed);
  const setCreateCardOpen = useAppStore((state) => state.setCreateCardOpen);
  const { t } = useI18n();
  const wishCopy = getWishPoolCopy(language);
  const preloadTimer = useRef<number | null>(null);

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
    <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`}>
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
        {nav.map((item) => {
          const Icon = item.icon;
          const label = t(item.label);
          const badge = item.badge === "tasks" ? taskCount : 0;
          return (
            <button
              key={item.view}
              type="button"
              className={view === item.view ? "is-active" : ""}
              onPointerEnter={() => prepareView(item.view)}
              onPointerLeave={cancelPrepareView}
              onPointerDown={() => prepareViewNow(item.view)}
              onFocus={() => prepareViewNow(item.view)}
              onClick={() => setView(item.view)}
              aria-current={view === item.view ? "page" : undefined}
              aria-label={label}
              title={collapsed ? label : undefined}
            >
              <Icon size={17} />
              {!collapsed && <span>{label}</span>}
              {!collapsed && badge > 0 && <b className="nav-badge">{badge}</b>}
            </button>
          );
        })}
      </nav>

      {!collapsed && (
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
    </aside>
  );
}
