import { useLiveQuery } from "dexie-react-hooks";
import { Cloud, Command, Download, PanelRightOpen, Redo2, Search, ShieldCheck, Sparkles, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { db } from "../db";
import { useAppStore } from "../store";
import type { AppView } from "../types";
import { useI18n } from "../hooks/useI18n";
import type { MessageKey } from "../i18n";
import { redoGlobalAction, undoGlobalAction, useGlobalHistoryState } from "../lib/globalHistory";
import { isWindows, primaryShortcut } from "../lib/platform";

const titles: Record<AppView, { eyebrow: MessageKey; title: MessageKey }> = {
  today: { eyebrow: "top.workspace", title: "nav.today" },
  journal: { eyebrow: "top.dailyThoughts", title: "nav.journal" },
  boards: { eyebrow: "top.visualThinking", title: "nav.boards" },
  kanban: { eyebrow: "top.projectFlow", title: "nav.kanban" },
  library: { eyebrow: "top.allContent", title: "nav.library" },
  database: { eyebrow: "top.structured", title: "nav.database" },
  tasks: { eyebrow: "top.nextStep", title: "nav.tasks" },
  highlights: { eyebrow: "top.sourceExcerpts", title: "nav.highlights" },
  fragments: { eyebrow: "top.captureThoughts", title: "nav.fragments" },
  brain: { eyebrow: "top.memoryNetwork", title: "nav.brain" },
  settings: { eyebrow: "top.yourSpace", title: "nav.settings" },
};

export function TopBar() {
  const view = useAppStore((state) => state.view);
  const selectedBoardId = useAppStore((state) => state.selectedBoardId);
  const selectedKanbanBoardId = useAppStore((state) => state.selectedKanbanBoardId);
  const aiEngine = useAppStore((state) => state.aiEngine);
  const openRouterModel = useAppStore((state) => state.openRouterModel);
  const customModel = useAppStore((state) => state.customModel);
  const setCommandOpen = useAppStore((state) => state.setCommandOpen);
  const setView = useAppStore((state) => state.setView);
  const setImportOpen = useAppStore((state) => state.setImportOpen);
  const openAI = useAppStore((state) => state.openAI);
  const board = useLiveQuery(() => selectedBoardId ? db.boards.get(selectedBoardId) : undefined, [selectedBoardId]);
  const kanbanBoard = useLiveQuery(() => selectedKanbanBoardId ? db.kanbanBoards.get(selectedKanbanBoardId) : undefined, [selectedKanbanBoardId]);
  const { t } = useI18n();
  const globalHistory = useGlobalHistoryState();
  const [boardHistory, setBoardHistory] = useState({ canUndo: false, canRedo: false, restoring: false, index: -1, length: 0, nodeCounts: [] as number[] });
  useEffect(() => {
    const update = (event: Event) => { const detail = (event as CustomEvent<{ canUndo: boolean; canRedo: boolean; restoring?: boolean; index?: number; length?: number; nodeCounts?: number[] }>).detail; setBoardHistory({ canUndo: detail.canUndo, canRedo: detail.canRedo, restoring: Boolean(detail.restoring), index: detail.index ?? -1, length: detail.length ?? 0, nodeCounts: detail.nodeCounts || [] }); };
    window.addEventListener("chengjing:board-history-state", update);
    return () => window.removeEventListener("chengjing:board-history-state", update);
  }, []);
  const title = view === "boards" && board
    ? { eyebrow: t("top.visualThinking"), title: board.title }
    : view === "kanban" && kanbanBoard
      ? { eyebrow: t("top.projectFlow"), title: kanbanBoard.title }
    : { eyebrow: t(titles[view].eyebrow), title: t(titles[view].title) };
  const modelName = customModel.trim() || openRouterModel;
  const historyState = view === "boards" ? boardHistory : globalHistory;
  const windows = isWindows();

  function runHistory(direction: "undo" | "redo") {
    if (view === "boards") window.dispatchEvent(new CustomEvent("chengjing:board-history", { detail: direction }));
    else void (direction === "undo" ? undoGlobalAction() : redoGlobalAction());
  }

  function openAISettings() {
    setView("settings");
    window.setTimeout(() => document.getElementById("ai-settings")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }

  return (
    <header className="topbar">
      <div className="topbar-title">
        <span>{title.eyebrow}</span>
        <h1>{title.title}</h1>
      </div>
      <div className="global-history-controls" aria-label={t("history.actions")} data-history-mode="delta" data-history-entries={globalHistory.entryCount} data-history-changed-records={globalHistory.changedRecordCount} data-history-hooked-tables={globalHistory.hookedTableCount} data-board-history-index={boardHistory.index} data-board-history-length={boardHistory.length} data-board-history-node-counts={boardHistory.nodeCounts.join(",")}>
        <button type="button" disabled={!historyState.canUndo || historyState.restoring} onClick={() => runHistory("undo")} aria-label={t("history.undo")} data-tooltip={`${t("history.undo")} · ${primaryShortcut("Z")}`}><Undo2 size={16} /></button>
        <button type="button" disabled={!historyState.canRedo || historyState.restoring} onClick={() => runHistory("redo")} aria-label={t("history.redo")} data-tooltip={`${t("history.redo")} · ${primaryShortcut("X")}`}><Redo2 size={16} /></button>
      </div>
      <button className="search-trigger" type="button" aria-label={t("top.searchPlaceholder")} title={t("top.searchPlaceholder")} onClick={() => setCommandOpen(true)}>
        <Search size={16} />
        <span>{t("top.searchPlaceholder")}</span>
        <kbd>{windows ? "Ctrl K" : <><Command size={12} />K</>}</kbd>
      </button>
      <div className="topbar-actions">
        <button className="engine-status" type="button" onClick={openAISettings} aria-label={aiEngine === "openrouter" ? t("top.openRouterSettings") : t("top.gemmaSettings")} title={aiEngine === "openrouter" ? modelName : "Gemma 4 E2B"}>
          {aiEngine === "openrouter" ? <Cloud size={14} /> : <ShieldCheck size={14} />}
          <span>{aiEngine === "openrouter" ? "OpenRouter" : t("top.localGemma")}</span>
        </button>
        <button className="icon-button" type="button" onClick={() => setImportOpen(true)} aria-label={t("top.importBackup")}><Download size={17} /></button>
        <button className="ai-button" type="button" onClick={openAI}>
          <Sparkles size={16} />
          <span>{t("top.askAI")}</span>
          <PanelRightOpen size={14} />
        </button>
      </div>
    </header>
  );
}
