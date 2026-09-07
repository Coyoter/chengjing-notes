import type { AppLanguage, ThemeMode } from "../types";
import { useAppStore } from "../store";
import { createAndroidSyncRecoveryBridge } from "./androidSyncRecovery";

declare global {
  interface Window {
    ChengJingNative?: { postMessage: (value: string) => void };
    __chengjingNativeReply?: (reply: { id: string; value: unknown; error?: string }) => void;
  }
}
const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
export function androidCall<T = any>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!window.ChengJingNative) { reject(new Error("Android native bridge unavailable")); return; }
    const id = crypto.randomUUID();
    const timeout = method === "local.download" ? 35 * 60_000 : method === "google.connect" || method.startsWith("files.") || method === "backup.chooseFolder" ? 15 * 60_000 : 240_000;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Android operation timed out")); }, timeout);
    pending.set(id, { resolve, reject, timer });
    window.ChengJingNative.postMessage(JSON.stringify({ id, method, args }));
  });
}
export async function initializeAndroid() {
  if (!window.ChengJingNative) return;
  window.__chengjingNativeReply = ({ id, value, error }) => {
    const request = pending.get(id); if (!request) return;
    clearTimeout(request.timer); pending.delete(id);
    error ? request.reject(new Error(error)) : request.resolve(value);
  };
  const info = await androidCall<{ version: string; language: AppLanguage; systemDark: boolean; distributionChannel?: string; qaIsolated?: boolean; themeMode?: ThemeMode; uiLanguage?: AppLanguage; fontScale?: number }>("app.info");
  document.documentElement.dataset.distributionChannel=info.distributionChannel || "play";
  if(info.themeMode&&["system","light","dark","ink"].includes(info.themeMode))useAppStore.getState().setTheme(info.themeMode);
  if(info.uiLanguage&&["zh-TW","zh-CN","en","ja","ko"].includes(info.uiLanguage))useAppStore.getState().setLanguage(info.uiLanguage);
  if(info.fontScale&&[.9,1,1.1,1.2].includes(info.fontScale))useAppStore.getState().setFontScale(info.fontScale);
  document.documentElement.dataset.systemTheme=info.systemDark?"dark":"light";
  window.addEventListener("chengjing:android-system-theme",event=>{
    document.documentElement.dataset.systemTheme=(event as CustomEvent<{dark:boolean}>).detail.dark?"dark":"light";
    window.dispatchEvent(new Event("chengjing:system-theme"));
  });
  const subscribe = (name: string, callback: (value: any) => void) => {
    const listener = (event: Event) => callback((event as CustomEvent).detail);
    window.addEventListener(name, listener); return () => window.removeEventListener(name, listener);
  };
  window.chengjing = {
    platform: "android",
    sync: {
      stage: (packet) => androidCall("sync.stage", { packet }),
      uploadAsset: (asset) => androidCall("sync.uploadAsset", asset), downloadAsset: (asset) => androidCall("sync.downloadAsset", asset),
      list: async () => { await androidCall("google.refresh"); return androidCall("sync.list"); }, get: (id) => androidCall("sync.get", { id }), put: (id, data) => androidCall("sync.put", { id, data }),
    },
    app: {
      getPreferredLanguage: async () => ({ language: info.language, preferredLanguages: [info.language] }),
      setLanguage: async (language) => ({ language }),
      getSystemVersion: async () => ({ platform: "android", arch: "arm64", version: info.version }),
      getMenuSnapshot: async () => [],
      quit: async () => { await androidCall("app.close"); return { quitting: true }; },
      closeMain: () => androidCall("app.close"),
    },
    onShortcut: (callback) => subscribe("chengjing:shortcut", callback),
    ai: {
      keyStatus: () => androidCall("ai.keyStatus"), setKey: (value) => androidCall("ai.setKey", { value }), clearKey: () => androidCall("ai.clearKey"),
      testOpenRouter: () => androidCall("ai.testOpenRouter"),
      listModels: async () => (await androidCall<any[]>("ai.listModels")).map((item) => ({ ...item, contextLength: item.context_length })),
      openRouterChat: (request) => androidCall("ai.openRouterChat", request),
      providerSettings: () => androidCall("ai.providerSettings"), upsertProvider: (request) => androidCall("ai.upsertProvider", request),
      selectProvider: (id) => androidCall("ai.selectProvider", { id }), removeProvider: (id) => androidCall("ai.removeProvider", { id }),
      listProviderModels: (id) => androidCall("ai.listProviderModels", { id }), testProvider: (id) => androidCall("ai.testProvider", { id }),
      providerChat: (request) => androidCall("ai.providerChat", request),
    },
    files: { open: (request) => androidCall("files.open", request), save: (request) => androidCall("files.save", request) },
    attachments: {
      importPath: (request) => androidCall("attachments.importPath", request), importData: (request) => androidCall("attachments.importData", request),
      readData: (path) => androidCall("attachments.readData", { path }), remove: (path) => androidCall("attachments.remove", { path }),
      stats: () => androidCall("attachments.stats"), pendingPaths: () => androidCall("attachments.pendingPaths"),
      sweepPending: (keep) => androidCall("attachments.sweepPending", { keep }),
      cleanup: (keep) => androidCall("attachments.sweepPending", { keep }),
      restoreFromBackup: (request) => androidCall("attachments.restoreFromBackup", request),
    },
    clipboard: { write: (request) => androidCall("clipboard.write", request), read: () => androidCall("clipboard.read") },
    web: { read: async (url) => {
      const result = await androidCall<{ html: string }>("web.fetch", { url });
      const { Readability } = await import("@mozilla/readability");
      const doc = new DOMParser().parseFromString(result.html, "text/html");
      const article = new Readability(doc).parse();
      if (!article) throw new Error("無法辨識文章內容");
      return { title: article.title || url, byline: article.byline || "", excerpt: article.excerpt || "", content: article.content || "", textContent: article.textContent || "", siteName: article.siteName || "", url };
    } },
    backups: {
      getSettings: () => androidCall("backup.settings"), updateSettings: (request) => androidCall("backup.update", request),
      chooseFolder: () => androidCall("backup.chooseFolder"),
      write: (request) => androidCall("backup.write", request), writeSafety: (request) => androidCall("backup.write", { ...request, reason: "safety" }),
    },
    syncRecovery: createAndroidSyncRecoveryBridge(androidCall),
    cloudBackups: {
      getLocalStatus: () => androidCall("cloud.localStatus"),
      getStatus: async () => { const local=await androidCall("google.status");if(local.connected)await androidCall("google.refresh");return androidCall("cloud.status"); },
      connect: async () => { await androidCall("google.connect"); return androidCall("cloud.init"); },
      disconnect: async () => { localStorage.removeItem("chengjing-sync-enabled");await androidCall("google.disconnect"); return androidCall("cloud.localStatus"); },
      updateSettings: (patch) => androidCall("cloud.update",patch),
      write: async (request) => { await androidCall("google.refresh");return androidCall("cloud.write",request); },
      download: (slot) => androidCall("cloud.download",{slot}),
      completeRestore: (request) => androidCall("cloud.completeRestore",request),
      cancelRestore: () => androidCall("cloud.cancelRestore"),
      adoptCurrentForOverwrite: () => androidCall("cloud.adopt"),
    },
  } as NonNullable<Window["chengjing"]>;
  if(info.qaIsolated) {
    document.documentElement.dataset.qaIsolated="true";
    window.chengjing.sync=undefined;
    window.chengjing.syncRecovery=undefined;
    window.chengjing.cloudBackups=undefined;
  }
  document.documentElement.dataset.platform = "android";
  document.documentElement.dataset.mobile = "true";
  new MutationObserver(() => {
    const dark = document.documentElement.dataset.theme !== "light";
    const color = getComputedStyle(document.documentElement).getPropertyValue("--canvas").trim();
    const state=useAppStore.getState();
    void androidCall("app.theme", { mode:state.theme, fontScale:state.fontScale, language:state.language, dark, color: /^#[0-9a-f]{6}$/i.test(color) ? color : dark ? "#111816" : "#f2f0e8" }).catch(() => {});
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme","data-language","style"] });
}
