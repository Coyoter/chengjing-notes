import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { motion } from "framer-motion";
import { useAppStore } from "../store";
import type { AppView } from "../types";

function lazyView<T extends Record<string, ComponentType>>(loader: () => Promise<T>, name: keyof T) {
  return lazy(async () => ({ default: (await loader())[name] }));
}

const views: Record<AppView, LazyExoticComponent<ComponentType>> = {
  today: lazyView(() => import("../views/TodayView"), "TodayView"),
  journal: lazyView(() => import("../views/JournalView"), "JournalView"),
  boards: lazyView(() => import("../views/BoardView"), "BoardView"),
  kanban: lazyView(() => import("../views/KanbanView"), "KanbanView"),
  library: lazyView(() => import("../views/LibraryView"), "LibraryView"),
  database: lazyView(() => import("../views/DatabaseView"), "DatabaseView"),
  tasks: lazyView(() => import("../views/TasksView"), "TasksView"),
  highlights: lazyView(() => import("../views/HighlightsView"), "HighlightsView"),
  fragments: lazyView(() => import("../views/FragmentsView"), "FragmentsView"),
  brain: lazyView(() => import("../views/SecondBrainView"), "SecondBrainView"),
  settings: lazyView(() => import("../views/SettingsView"), "SettingsView"),
};

export function Workspace() {
  const view = useAppStore((state) => state.view);
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
