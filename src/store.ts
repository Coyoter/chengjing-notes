import { create } from "zustand";
import { persist } from "zustand/middleware";
import dayjs from "dayjs";
import type { AIEngine, AppLanguage, AppView, OpenRouterRoutingMode, ThemeMode } from "./types";

interface AppState {
  view: AppView;
  selectedBoardId: string | null;
  selectedKanbanBoardId: string | null;
  selectedCardId: string | null;
  journalDate: string;
  rightPanel: "none" | "ai" | "wish";
  commandOpen: boolean;
  createCardOpen: boolean;
  createCardCollectionId: string | null;
  importOpen: boolean;
  sidebarCollapsed: boolean;
  showMiniMap: boolean;
  theme: ThemeMode;
  aiEngine: AIEngine;
  openRouterModel: string;
  openRouterRoutingMode: OpenRouterRoutingMode;
  customModel: string;
  customProviderId: string;
  customProviderName: string;
  customProviderModel: string;
  temperature: number;
  spaceSearch: boolean;
  fontScale: number;
  language: AppLanguage;
  aiDraft: string;
  aiActionRequest: { id: string; prompt: string } | null;
  setView: (view: AppView) => void;
  openBoard: (id: string) => void;
  openKanbanBoard: (id: string) => void;
  openCard: (id: string) => void;
  closeCard: () => void;
  closeRightPanel: () => void;
  openAI: () => void;
  openWishPool: () => void;
  openAIWithPrompt: (prompt: string) => void;
  openAIWithAction: (prompt: string) => void;
  consumeAIActionRequest: (id: string) => void;
  setAIDraft: (prompt: string) => void;
  setJournalDate: (date: string) => void;
  setCommandOpen: (open: boolean) => void;
  setCreateCardOpen: (open: boolean, collectionId?: string | null) => void;
  setImportOpen: (open: boolean) => void;
  setSidebarCollapsed: (value: boolean) => void;
  setShowMiniMap: (value: boolean) => void;
  setTheme: (theme: ThemeMode) => void;
  setAIEngine: (engine: AIEngine) => void;
  setOpenRouterModel: (model: string) => void;
  setOpenRouterRoutingMode: (mode: OpenRouterRoutingMode) => void;
  setCustomModel: (model: string) => void;
  setCustomProvider: (value: { id: string; name: string; model: string }) => void;
  setTemperature: (value: number) => void;
  setSpaceSearch: (value: boolean) => void;
  setFontScale: (value: number) => void;
  setLanguage: (language: AppLanguage) => void;
}

export function languageFromPreferences(preferredLanguages: string[] = []): AppLanguage {
  const primary = String(preferredLanguages[0] || "").trim().toLowerCase().replaceAll("_", "-");
  if (/^zh(?:-|$)/.test(primary)) {
    if (/(?:^|-)hant(?:-|$)|(?:^|-)(tw|hk|mo)(?:-|$)/.test(primary)) return "zh-TW";
    return "zh-CN";
  }
  if (/^ja(?:-|$)/.test(primary)) return "ja";
  if (/^ko(?:-|$)/.test(primary)) return "ko";
  return "en";
}

export function hasPersistedLanguagePreference() {
  if (typeof localStorage === "undefined") return false;
  try {
    const stored = JSON.parse(localStorage.getItem("chengjing-ui") || "null");
    return typeof stored?.state?.language === "string";
  } catch {
    return false;
  }
}

function initialLanguage() {
  if (typeof navigator === "undefined") return "en" as AppLanguage;
  return languageFromPreferences(navigator.languages?.length ? [...navigator.languages] : [navigator.language]);
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      view: "today",
      selectedBoardId: "board-welcome",
      selectedKanbanBoardId: null,
      selectedCardId: null,
      journalDate: dayjs().format("YYYY-MM-DD"),
      rightPanel: "none",
      commandOpen: false,
      createCardOpen: false,
      createCardCollectionId: null,
      importOpen: false,
      sidebarCollapsed: false,
      showMiniMap: false,
      theme: "system",
      aiEngine: "openrouter",
      openRouterModel: "openai/gpt-5.6-luna",
      openRouterRoutingMode: "balanced",
      customModel: "",
      customProviderId: "",
      customProviderName: "Custom Provider",
      customProviderModel: "",
      temperature: 0.55,
      spaceSearch: true,
      fontScale: 1,
      language: initialLanguage(),
      aiDraft: "",
      aiActionRequest: null,
      setView: (view) => set({ view, selectedCardId: null, rightPanel: "none" }),
      openBoard: (selectedBoardId) => set({ view: "boards", selectedBoardId, selectedCardId: null, rightPanel: "none" }),
      openKanbanBoard: (selectedKanbanBoardId) => set({ view: "kanban", selectedKanbanBoardId, selectedCardId: null, rightPanel: "none" }),
      openCard: (selectedCardId) => set((state) => ({ selectedCardId, rightPanel: state.rightPanel === "ai" ? "ai" : "none" })),
      closeCard: () => set({ selectedCardId: null }),
      closeRightPanel: () => set({ rightPanel: "none" }),
      openAI: () => set({ rightPanel: "ai", aiDraft: "" }),
      openWishPool: () => set({ rightPanel: "wish" }),
      openAIWithPrompt: (aiDraft) => set({ rightPanel: "ai", aiDraft }),
      openAIWithAction: (prompt) => set({ rightPanel: "ai", aiDraft: "", aiActionRequest: { id: crypto.randomUUID(), prompt } }),
      consumeAIActionRequest: (id) => set((state) => ({ aiActionRequest: state.aiActionRequest?.id === id ? null : state.aiActionRequest })),
      setAIDraft: (aiDraft) => set({ aiDraft }),
      setJournalDate: (journalDate) => set({ journalDate }),
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      setCreateCardOpen: (createCardOpen, createCardCollectionId = null) => set({ createCardOpen, createCardCollectionId }),
      setImportOpen: (importOpen) => set({ importOpen }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setShowMiniMap: (showMiniMap) => set({ showMiniMap }),
      setTheme: (theme) => set({ theme }),
      setAIEngine: (aiEngine) => set({ aiEngine }),
      setOpenRouterModel: (openRouterModel) => set({ openRouterModel }),
      setOpenRouterRoutingMode: (openRouterRoutingMode) => set({ openRouterRoutingMode }),
      setCustomModel: (customModel) => set({ customModel }),
      setCustomProvider: ({ id: customProviderId, name: customProviderName, model: customProviderModel }) => set({ customProviderId, customProviderName, customProviderModel }),
      setTemperature: (temperature) => set({ temperature }),
      setSpaceSearch: (spaceSearch) => set({ spaceSearch }),
      setFontScale: (fontScale) => set({ fontScale }),
      setLanguage: (language) => set({ language }),
    }),
    {
      name: "chengjing-ui",
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        showMiniMap: state.showMiniMap,
        theme: state.theme,
        aiEngine: state.aiEngine,
        openRouterModel: state.openRouterModel,
        openRouterRoutingMode: state.openRouterRoutingMode,
        customModel: state.customModel,
        customProviderId: state.customProviderId,
        customProviderName: state.customProviderName,
        customProviderModel: state.customProviderModel,
        temperature: state.temperature,
        spaceSearch: state.spaceSearch,
        fontScale: state.fontScale,
        language: state.language,
      }),
    },
  ),
);
