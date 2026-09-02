import { create } from "zustand";
import type { UpdateInfo, UpdateProgress } from "./types";
import { friendlyErrorMessage } from "./lib/utils";
import { translate } from "./i18n";
import { useAppStore } from "./store";
import { markUpdatesCheckedToday } from "./lib/dailyUpdateCheck";

type UpdatePhase = "idle" | "checking" | "available" | "downloading" | "opening" | "opened" | "error";

interface UpdateState {
  phase: UpdatePhase;
  info: UpdateInfo | null;
  progress: UpdateProgress | null;
  error: string;
  showPrompt: boolean;
  check: (silent?: boolean) => Promise<UpdateInfo | null>;
  download: () => Promise<void>;
  dismiss: () => void;
}

let removeProgressListener: (() => void) | null = null;

function language() {
  return useAppStore.getState().language || "zh-TW";
}

function bindProgress(set: (patch: Partial<UpdateState>) => void) {
  if (removeProgressListener || !window.chengjing?.updates) return;
  removeProgressListener = window.chengjing.updates.onProgress((progress) => {
    set({ progress, phase: progress.state === "completed" ? "opening" : "downloading", showPrompt: true });
  });
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  phase: "idle",
  info: null,
  progress: null,
  error: "",
  showPrompt: false,
  check: async (silent = false) => {
    if (!window.chengjing?.updates) {
      if (!silent) set({ phase: "error", error: translate(language(), "update.noDesktop"), showPrompt: true });
      return null;
    }
    set({ phase: "checking", error: "", showPrompt: silent ? get().showPrompt : true });
    try {
      const info = await window.chengjing.updates.check(!silent);
      markUpdatesCheckedToday(window.localStorage);
      set({
        info,
        phase: info.status === "available" ? "available" : "idle",
        showPrompt: info.status === "available",
      });
      return info;
    } catch (error) {
      const message = friendlyErrorMessage(error, translate(language(), "update.checkFailed"));
      set({ info: null, phase: silent ? "idle" : "error", error: message, showPrompt: silent ? false : true });
      return null;
    }
  },
  download: async () => {
    if (!window.chengjing?.updates) {
      set({ phase: "error", error: translate(language(), "update.noDesktop"), showPrompt: true });
      return;
    }
    bindProgress(set);
    set({ phase: "downloading", progress: { state: "progressing", received: 0, total: get().info?.asset?.size || 0, percent: 0 }, error: "", showPrompt: true });
    try {
      const result = await window.chengjing.updates.download();
      if (result.opened || result.verified) set({ phase: "opened", progress: { state: "completed", received: get().info?.asset?.size || 0, total: get().info?.asset?.size || 0, percent: 100 }, showPrompt: true });
      else set({ phase: "idle", showPrompt: false });
    } catch (error) {
      set({ phase: "error", error: friendlyErrorMessage(error, translate(language(), "update.checkFailed")), showPrompt: true });
    }
  },
  dismiss: () => set({ showPrompt: false }),
}));
