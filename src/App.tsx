import { lazy, Suspense, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { db, pruneAllCardVersions, pruneLegacyDemoSourceCard, pruneUntouchedJournalDrafts, seedDatabase } from "./db";
import { getHealthCopy } from "./lib/healthCopy";
import { hasPersistedLanguagePreference, useAppStore } from "./store";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { Workspace } from "./components/Workspace";
import { CommandPalette } from "./components/CommandPalette";
import { GlobalContextMenu } from "./components/GlobalContextMenu";
import { UpdateManager } from "./components/UpdateManager";
import { AutoBackupManager } from "./components/AutoBackupManager";
import { CommunityNotificationManager } from "./components/CommunityNotificationManager";
import { SharedBrainSyncManager } from "./components/SharedBrainSyncManager";
import type { ThemeMode } from "./types";
import markUrl from "./assets/mark.svg";
import "dayjs/locale/zh-tw";
import "dayjs/locale/zh-cn";
import "dayjs/locale/ja";
import "dayjs/locale/ko";
import { useI18n } from "./hooks/useI18n";
import { syncPendingCardTasks } from "./lib/taskSync";
import { useUpdateStore } from "./updateStore";
import { initializeGlobalHistory, redoGlobalAction, runWithoutGlobalHistory, undoGlobalAction } from "./lib/globalHistory";
import { migrateLegacyAttachments } from "./lib/attachments";

let workspaceBootstrap: Promise<void> | null = null;
const CardEditorPanel = lazy(() => import("./components/CardEditorPanel").then((module) => ({ default: module.CardEditorPanel })));
const AIPanel = lazy(() => import("./components/AIPanel").then((module) => ({ default: module.AIPanel })));
const WishPoolPanel = lazy(() => import("./components/WishPoolPanel").then((module) => ({ default: module.WishPoolPanel })));
const CreateCardModal = lazy(() => import("./components/CreateCardModal").then((module) => ({ default: module.CreateCardModal })));
const ImportModal = lazy(() => import("./components/ImportModal").then((module) => ({ default: module.ImportModal })));

function prepareWorkspace() {
  if (!workspaceBootstrap) workspaceBootstrap = seedDatabase().then(async () => {
    const sweep = window.chengjing?.attachments?.sweepPending;
    const pending = await window.chengjing?.attachments?.pendingPaths?.().catch(() => []) || [];
    if (sweep && pending.length) {
      const paths = new Set(pending);
      const attachments = await db.attachments.where("storage").equals("file").filter((item) => Boolean(item.relativePath && paths.has(item.relativePath))).toArray();
      await sweep(attachments.map((item) => item.relativePath).filter(Boolean) as string[]).catch((error) => console.error("Attachment cleanup failed", error));
    }
  });
  return workspaceBootstrap;
}

function scheduleWorkspaceMaintenance() {
  const task = () => void (async () => {
    await migrateLegacyAttachments();
    await runWithoutGlobalHistory(() => pruneLegacyDemoSourceCard());
    await syncPendingCardTasks(40, true);
    const state = useAppStore.getState();
    await runWithoutGlobalHistory(() => pruneUntouchedJournalDrafts(state.view === "journal" ? state.journalDate : undefined));
    await pruneAllCardVersions();
  })().catch((error) => console.error("Workspace maintenance failed", error));
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(task, { timeout: 8_000 });
  else window.setTimeout(task, 1_200);
}

function applyTheme(theme: ThemeMode) {
  const resolved = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved === "light" ? "light" : "dark";
}

export function App() {
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState("");
  const theme = useAppStore((state) => state.theme);
  const language = useAppStore((state) => state.language);
  const fontScale = useAppStore((state) => state.fontScale);
  const rightPanel = useAppStore((state) => state.rightPanel);
  const view = useAppStore((state) => state.view);
  const selectedCardId = useAppStore((state) => state.selectedCardId);
  const createCardOpen = useAppStore((state) => state.createCardOpen);
  const importOpen = useAppStore((state) => state.importOpen);
  const [createCardLoaded, setCreateCardLoaded] = useState(false);
  const [importLoaded, setImportLoaded] = useState(false);
  const setCommandOpen = useAppStore((state) => state.setCommandOpen);
  const setCreateCardOpen = useAppStore((state) => state.setCreateCardOpen);
  const setImportOpen = useAppStore((state) => state.setImportOpen);
  const setLanguage = useAppStore((state) => state.setLanguage);
  const { t } = useI18n();
  const healthCopy = getHealthCopy(language);

  useEffect(() => {
    prepareWorkspace().then(initializeGlobalHistory).then(() => {
      setReady(true);
      scheduleWorkspaceMaintenance();
    }).catch((error) => setStartupError(error instanceof Error ? error.message : String(error)));
  }, []);

  useEffect(() => {
    if (!ready || !window.chengjing?.mcp) return;
    const dispose = window.chengjing.mcp.onWorkspaceRequest(async (request) => {
      try {
        const { handleMcpWorkspaceRequest } = await import("./lib/mcpWorkspace");
        const result = await handleMcpWorkspaceRequest(request);
        await window.chengjing?.mcp.respond({ requestId: request.requestId, result });
      } catch (error) {
        await window.chengjing?.mcp.respond({ requestId: request.requestId, error: error instanceof Error ? error.message : "mcp-workspace-failed" });
      }
    });
    const readyTimer = window.setTimeout(() => void window.chengjing?.mcp.rendererReady(), 650);
    return () => { window.clearTimeout(readyTimer); dispose(); };
  }, [ready]);

  useEffect(() => {
    if (hasPersistedLanguagePreference()) return;
    void window.chengjing?.app?.getPreferredLanguage?.().then((preferred) => setLanguage(preferred.language)).catch(() => {});
  }, [setLanguage]);

  useEffect(() => {
    applyTheme(theme);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => theme === "system" && applyTheme(theme);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--font-scale", String(fontScale));
    document.documentElement.dataset.fontScale = String(Math.round(fontScale * 100));
  }, [fontScale]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dataset.language = language;
    document.documentElement.dataset.platform = window.chengjing?.platform || "web";
    void window.chengjing?.app?.setLanguage?.(language);
  }, [language]);

  useEffect(() => {
    const apply = (value: { fullscreen: boolean }) => { document.documentElement.dataset.windowFullscreen = String(Boolean(value.fullscreen)); };
    void window.chengjing?.app?.getWindowState?.().then(apply).catch(() => apply({ fullscreen: false }));
    const dispose = window.chengjing?.app?.onWindowState?.(apply);
    return () => dispose?.();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const editing = Boolean(target?.isContentEditable || target?.closest("input, textarea, select, [contenteditable='true']"));
      const command = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (command && !event.altKey && key === "w") {
        event.preventDefault();
        void window.chengjing?.app?.closeMain?.();
        return;
      }
      if (command && !event.altKey && !editing && (key === "z" || key === "x")) {
        event.preventDefault();
        if (view === "boards") window.dispatchEvent(new CustomEvent("chengjing:board-history", { detail: key === "z" ? "undo" : "redo" }));
        else void (key === "z" ? undoGlobalAction() : redoGlobalAction());
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setCreateCardOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    const dispose = window.chengjing?.onShortcut?.((value) => {
      if (value === "new-card") setCreateCardOpen(true);
      if (value === "command") setCommandOpen(true);
      if (value === "export") setImportOpen(true);
      if (value === "check-update") {
        useAppStore.getState().setView("settings");
        window.setTimeout(() => document.getElementById("update-settings")?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
        void useUpdateStore.getState().check(false);
      }
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      dispose?.();
    };
  }, [setCommandOpen, setCreateCardOpen, setImportOpen, view]);

  useEffect(() => { if (createCardOpen) setCreateCardLoaded(true); }, [createCardOpen]);
  useEffect(() => { if (importOpen) setImportLoaded(true); }, [importOpen]);

  if (!ready) {
    return (
      <main className="launch-screen" aria-label={t("app.launchAria")}>
        <img src={markUrl} alt="" />
        <div>
          <strong>澄境</strong>
          <span>{startupError ? healthCopy.startupError : t("app.loading")}</span>
          {startupError && <><button type="button" className="primary-button" onClick={() => window.location.reload()}>{healthCopy.retry}</button><details className="launch-error-details"><summary>{healthCopy.details}</summary><p>{startupError}</p></details></>}
        </div>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <TopBar />
        <Workspace />
        <AnimatePresence>
          {selectedCardId && (
            <motion.section
              className="card-focus-layer"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <Suspense fallback={null}><CardEditorPanel /></Suspense>
            </motion.section>
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {rightPanel !== "none" && (
          <motion.aside
            className="right-panel"
            initial={{ x: 24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 20, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <Suspense fallback={null}>{rightPanel === "ai" ? <AIPanel /> : <WishPoolPanel />}</Suspense>
          </motion.aside>
        )}
      </AnimatePresence>
      <CommandPalette />
      {createCardLoaded && <Suspense fallback={null}><CreateCardModal /></Suspense>}
      {importLoaded && <Suspense fallback={null}><ImportModal /></Suspense>}
      <GlobalContextMenu />
      <UpdateManager />
      <AutoBackupManager />
      <CommunityNotificationManager />
      <SharedBrainSyncManager />
    </div>
  );
}
