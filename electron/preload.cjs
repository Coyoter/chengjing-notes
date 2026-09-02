const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("chengjing", {
  app: {
    getPreferredLanguage: () => ipcRenderer.invoke("app:get-preferred-language"),
    setLanguage: (language) => ipcRenderer.invoke("app:set-language", language),
    getMenuSnapshot: () => ipcRenderer.invoke("app:get-menu-snapshot"),
    getSystemVersion: () => ipcRenderer.invoke("app:get-system-version"),
    getWindowState: () => ipcRenderer.invoke("app:get-window-state"),
    closeMain: () => ipcRenderer.invoke("app:close-main"),
    onWindowState: (callback) => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on("app:window-state", listener);
      return () => ipcRenderer.removeListener("app:window-state", listener);
    },
    quit: () => ipcRenderer.invoke("app:quit"),
  },
  updates: {
    check: (force = false) => ipcRenderer.invoke("update:check", { force }),
    download: () => ipcRenderer.invoke("update:download"),
    onProgress: (callback) => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on("update:progress", listener);
      return () => ipcRenderer.removeListener("update:progress", listener);
    },
  },
  backups: {
    getSettings: () => ipcRenderer.invoke("backup:get-settings"),
    chooseFolder: () => ipcRenderer.invoke("backup:choose-folder"),
    updateSettings: (patch) => ipcRenderer.invoke("backup:update-settings", patch),
    write: (request) => ipcRenderer.invoke("backup:write", request),
  },
  ai: {
    keyStatus: () => ipcRenderer.invoke("ai:key-status"),
    setKey: (value) => ipcRenderer.invoke("ai:set-key", value),
    clearKey: () => ipcRenderer.invoke("ai:clear-key"),
    testOpenRouter: () => ipcRenderer.invoke("ai:test-openrouter"),
    listModels: () => ipcRenderer.invoke("ai:list-models"),
    openRouterChat: (request) => ipcRenderer.invoke("ai:openrouter-chat", request),
  },
  web: {
    read: (url) => ipcRenderer.invoke("web:read", url),
  },
  files: {
    save: (options) => ipcRenderer.invoke("file:save", options),
    open: (options) => ipcRenderer.invoke("file:open", options),
  },
  attachments: {
    importPath: (request) => ipcRenderer.invoke("attachment:import-path", request),
    importData: (request) => ipcRenderer.invoke("attachment:import-data", request),
    remove: (relativePath) => ipcRenderer.invoke("attachment:remove", { relativePath }),
    stats: () => ipcRenderer.invoke("attachment:stats"),
    readData: (relativePath) => ipcRenderer.invoke("attachment:read-data", { relativePath }),
    cleanup: (keep) => ipcRenderer.invoke("attachment:cleanup", { keep }),
    restoreFromBackup: (request) => ipcRenderer.invoke("attachment:restore-from-backup", request),
  },
  clipboard: {
    write: (request) => ipcRenderer.invoke("clipboard:write", request),
    read: () => ipcRenderer.invoke("clipboard:read"),
  },
  quickCapture: {
    getSettings: () => ipcRenderer.invoke("quick-capture:get-settings"),
    setShortcut: (shortcut) => ipcRenderer.invoke("quick-capture:set-shortcut", shortcut),
    setRecording: (recording) => ipcRenderer.invoke("quick-capture:set-recording", recording),
    setOpenAtLogin: (enabled) => ipcRenderer.invoke("quick-capture:set-open-at-login", enabled),
    hide: () => ipcRenderer.invoke("quick-capture:hide"),
    show: () => ipcRenderer.invoke("quick-capture:show"),
    showMain: () => ipcRenderer.invoke("quick-capture:show-main"),
    nativeSubmitResult: (succeeded) => ipcRenderer.invoke("quick-capture:native-submit-result", succeeded),
    onNativeSubmit: (callback) => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on("quick-capture:native-submit", listener);
      return () => ipcRenderer.removeListener("quick-capture:native-submit", listener);
    },
    onFocus: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("quick-capture:focus", listener);
      return () => ipcRenderer.removeListener("quick-capture:focus", listener);
    },
  },
  onShortcut: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("shortcut", listener);
    return () => ipcRenderer.removeListener("shortcut", listener);
  },
  platform: process.platform,
});
