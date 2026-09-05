import { lazy, Suspense, useEffect, useState, useTransition, type ComponentType, type LazyExoticComponent } from "react";
import { motion } from "framer-motion";
import { useAppStore } from "../store";
import type { AppView } from "../types";

type WorkspaceViewModule = { default: ComponentType };
type WorkspaceViewLoader = () => Promise<WorkspaceViewModule>;

const viewLoaders: Record<AppView, WorkspaceViewLoader> = {
  today: () => import("../views/TodayView").then((module) => ({ default: module.TodayView })),
  journal: () => import("../views/JournalView").then((module) => ({ default: module.JournalView })),
  boards: () => import("../views/BoardView").then((module) => ({ default: module.BoardView })),
  kanban: () => import("../views/KanbanView").then((module) => ({ default: module.KanbanView })),
  library: () => import("../views/LibraryView").then((module) => ({ default: module.LibraryView })),
  database: () => import("../views/DatabaseView").then((module) => ({ default: module.DatabaseView })),
  tasks: () => import("../views/TasksView").then((module) => ({ default: module.TasksView })),
  highlights: () => import("../views/HighlightsView").then((module) => ({ default: module.HighlightsView })),
  fragments: () => import("../views/FragmentsView").then((module) => ({ default: module.FragmentsView })),
  brain: () => import("../views/SecondBrainView").then((module) => ({ default: module.SecondBrainView })),
  settings: () => import("../views/SettingsView").then((module) => ({ default: module.SettingsView })),
};
const viewModuleCache = new Map<AppView, Promise<WorkspaceViewModule>>();

function loadWorkspaceView(view: AppView) {
  const cached = viewModuleCache.get(view);
  if (cached) return cached;
  const pending = viewLoaders[view]().catch((error) => {
    viewModuleCache.delete(view);
    throw error;
  });
  viewModuleCache.set(view, pending);
  return pending;
}

export function preloadWorkspaceView(view: AppView) {
  return loadWorkspaceView(view);
}

const views: Record<AppView, LazyExoticComponent<ComponentType>> = {
  today: lazy(() => loadWorkspaceView("today")),
  journal: lazy(() => loadWorkspaceView("journal")),
  boards: lazy(() => loadWorkspaceView("boards")),
  kanban: lazy(() => loadWorkspaceView("kanban")),
  library: lazy(() => loadWorkspaceView("library")),
  database: lazy(() => loadWorkspaceView("database")),
  tasks: lazy(() => loadWorkspaceView("tasks")),
  highlights: lazy(() => loadWorkspaceView("highlights")),
  fragments: lazy(() => loadWorkspaceView("fragments")),
  brain: lazy(() => loadWorkspaceView("brain")),
  settings: lazy(() => loadWorkspaceView("settings")),
};

export function Workspace() {
  const requestedView = useAppStore((state) => state.view);
  const [view, setView] = useState(requestedView);
  const [, startViewTransition] = useTransition();
  useEffect(() => {
    let active = true;
    void loadWorkspaceView(requestedView)
      .catch(() => undefined)
      .then(() => {
        if (active) startViewTransition(() => setView(requestedView));
      });
    return () => { active = false; };
  }, [requestedView]);
  const View = views[view];
  return (
    <motion.main
      key={view}
      className={`workspace view-${view}`}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16 }}
    >
      <Suspense fallback={<div className="workspace-lazy-placeholder" aria-hidden="true"><i /><i /><i /></div>}>
        <View />
      </Suspense>
    </motion.main>
  );
}
