/// <reference types="vite/client" />

type AIMessage = { role: "system" | "user" | "assistant"; content: string };

interface Window {
  chengjing?: {
    app: {
      getPreferredLanguage?: () => Promise<{ language: import("./types").AppLanguage; preferredLanguages: string[] }>;
      setLanguage: (language: import("./types").AppLanguage) => Promise<{ language: import("./types").AppLanguage }>;
      getMenuSnapshot: () => Promise<Array<{ label: string; role: string; submenu: Array<{ label: string; role: string; type: string; hasIcon: boolean }> }>>;
      getSystemVersion: () => Promise<{ platform: string; arch: string; version: string }>;
      getWindowState?: () => Promise<{ exists?: boolean; visible?: boolean; fullscreen: boolean; maximized: boolean; bounds?: { x: number; y: number; width: number; height: number } | null }>;
      closeMain?: () => Promise<{ closed: boolean }>;
      onWindowState?: (callback: (value: { fullscreen: boolean; maximized: boolean }) => void) => () => void;
      quit: () => Promise<{ quitting: boolean }>;
    };
    updates: {
      check: (force?: boolean) => Promise<import("./types").UpdateInfo>;
      download: () => Promise<import("./types").UpdateDownloadResult>;
      onProgress: (callback: (value: import("./types").UpdateProgress) => void) => () => void;
    };
    backups: {
      getSettings: () => Promise<import("./types").AutoBackupSettings>;
      chooseFolder: () => Promise<{ canceled: boolean; settings: import("./types").AutoBackupSettings }>;
      updateSettings: (patch: Partial<Pick<import("./types").AutoBackupSettings, "enabled" | "intervalDays" | "retentionCount">>) => Promise<import("./types").AutoBackupSettings>;
      write: (request: { data: string; reason: "scheduled" | "manual"; assets?: Array<{ relativePath: string; sha256: string; size: number }> }) => Promise<import("./types").AutoBackupWriteResult>;
      writeSafety: (request: { data: string; assets?: Array<{ relativePath: string; sha256: string; size: number }> }) => Promise<{ filePath: string; filename: string; bytes: number }>;
    };
    cloudBackups: {
      getLocalStatus: () => Promise<import("./types").CloudBackupStatus>;
      getStatus: () => Promise<import("./types").CloudBackupStatus>;
      connect: () => Promise<import("./types").CloudBackupStatus>;
      disconnect: () => Promise<import("./types").CloudBackupStatus>;
      updateSettings: (patch: Partial<Pick<import("./types").CloudBackupSettings, "enabled" | "intervalMinutes">>) => Promise<import("./types").CloudBackupSettings>;
      write: (request: { data: string; reason: "scheduled" | "manual"; force?: boolean; assets?: Array<{ relativePath: string; sha256: string; size: number }> }) => Promise<import("./types").CloudBackupWriteResult>;
      download: (slot: "current" | "previous") => Promise<import("./types").CloudBackupDownloadResult>;
      completeRestore: (request: { baselineManifestId: string; contentHash: string }) => Promise<import("./types").CloudBackupSettings>;
      cancelRestore: () => Promise<{ cleaned: boolean }>;
      adoptCurrentForOverwrite: () => Promise<import("./types").CloudBackupSettings>;
      qaCleanup?: () => Promise<{ removedManifests: number; removedAssets: number; settings: import("./types").CloudBackupSettings }>;
    };
    mcp: {
      getSettings: () => Promise<import("./types").McpSettings>;
      updateSettings: (patch: Partial<Pick<import("./types").McpSettings, "enabled" | "accessMode" | "port">>) => Promise<import("./types").McpSettings>;
      regenerateToken: () => Promise<import("./types").McpSettings>;
      copySetup: (target: "codex" | "claude") => Promise<{ copied: boolean; target: "codex" | "claude" }>;
      getAudit: () => Promise<import("./types").McpAuditEntry[]>;
      rendererReady: () => Promise<{ ready: boolean }>;
      respond: (response: { requestId: string; result?: unknown; error?: string }) => Promise<{ accepted: boolean }>;
      onWorkspaceRequest: (callback: (request: import("./lib/mcpWorkspace").McpWorkspaceRequest) => void | Promise<void>) => () => void;
    };
    ai: {
      keyStatus: () => Promise<{ configured: boolean; encrypted: boolean; storage: "app-local-aes-256-gcm"; error?: string }>;
      setKey: (value: string) => Promise<{ configured: boolean; encrypted: boolean; storage: "app-local-aes-256-gcm" }>;
      clearKey: () => Promise<{ configured: boolean; encrypted: boolean; storage: "app-local-aes-256-gcm" }>;
      testOpenRouter: () => Promise<{ ok: boolean; label: string; limitRemaining: number | null; usage: number | null }>;
      listModels: () => Promise<Array<{
        id: string;
        name: string;
        contextLength: number;
        created: number;
        pricing: Record<string, string> | null;
        architecture: Record<string, unknown> | null;
      }>>;
      openRouterChat: (request: {
        model: string;
        messages: AIMessage[];
        temperature?: number;
        maxTokens?: number;
        responseFormat?: Record<string, unknown>;
        routingMode?: import("./types").OpenRouterRoutingMode;
      }) => Promise<{ text: string; model: string; usage: Record<string, number> | null; finishReason: string | null }>;
      providerSettings: () => Promise<import("./types").AIProviderSettings>;
      upsertProvider: (input: { id?: string; name: string; type: import("./types").AIProviderType; baseUrl: string; model: string; apiKey?: string; select?: boolean }) => Promise<import("./types").AIProviderSettings>;
      selectProvider: (id: string) => Promise<import("./types").AIProviderSettings>;
      removeProvider: (id: string) => Promise<import("./types").AIProviderSettings>;
      testProvider: (id: string) => Promise<{ ok: boolean; models: import("./types").AIProviderModel[]; modelAvailable: boolean }>;
      listProviderModels: (id: string) => Promise<import("./types").AIProviderModel[]>;
      providerChat: (request: {
        profileId?: string;
        model: string;
        messages: AIMessage[];
        temperature?: number;
        maxTokens?: number;
        responseFormat?: Record<string, unknown>;
      }) => Promise<{ text: string; model: string; usage: Record<string, number> | null; finishReason: string | null }>;
    };
    web: {
      read: (url: string) => Promise<{
        title: string;
        byline: string;
        excerpt: string;
        content: string;
        textContent: string;
        siteName: string;
        url: string;
      }>;
    };
    files: {
      save: (options: {
        title?: string;
        defaultPath?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
        data: string;
        encoding?: "utf8" | "base64";
      }) => Promise<{ canceled: boolean; filePath?: string }>;
      open: (options: {
        title?: string;
        multiple?: boolean;
        metadataOnly?: boolean;
        filters?: Array<{ name: string; extensions: string[] }>;
      }) => Promise<{ canceled: boolean; files: Array<{ name: string; path: string; data: string }> }>;
    };
    attachments: {
      importPath: (request: { id?: string; sourcePath: string; name: string; mime: string; createdAt?: number }) => Promise<import("./types").AttachmentRecord>;
      importData: (request: { id?: string; data: string; name: string; mime: string; createdAt?: number }) => Promise<import("./types").AttachmentRecord>;
      remove: (relativePath: string) => Promise<{ removed: boolean }>;
      stats: () => Promise<{ bytes: number; count: number }>;
      readData: (relativePath: string) => Promise<string>;
      cleanup: (keep: string[]) => Promise<{ removed: number }>;
      restoreFromBackup: (request: { id: string; backupFilePath: string; sha256: string; name: string; mime: string; createdAt?: number }) => Promise<import("./types").AttachmentRecord>;
    };
    clipboard: {
      write: (request: { text: string; payload: Record<string, unknown> | null }) => Promise<{ written: boolean }>;
      read: () => Promise<{ text: string; payload: Record<string, unknown> | null }>;
    };
    quickCapture?: {
      getSettings: () => Promise<{ shortcut: string; defaultShortcut: string; registered: boolean; shortcutBackend?: "native-appkit" | "native-carbon" | "electron" | "none"; inputBackend?: "native-nstextview" | "electron-textarea"; openAtLogin: boolean; loginStatus?: string; wasOpenedAtLogin?: boolean; trayReady?: boolean; trayImageEmpty?: boolean; trayImageSize?: { width: number; height: number }; trayBounds?: { x: number; y: number; width: number; height: number } | null; windowReady?: boolean; windowVisible?: boolean; windowNativeVisible?: boolean; windowWarm?: boolean; windowOpacity?: number; windowFocused?: boolean; appActive?: boolean; imeReady?: boolean; windowAlwaysOnTop?: boolean; windowVisibleOnAllWorkspaces?: boolean; windowHasShadow?: boolean; windowBounds?: { x: number; y: number; width: number; height: number } | null }>;
      setShortcut: (shortcut: string) => Promise<{ shortcut: string; registered: boolean; shortcutBackend?: "native-appkit" | "native-carbon" | "electron" | "none" }>;
      setRecording: (recording: boolean) => Promise<{ suspended: boolean; registered?: boolean }>;
      setOpenAtLogin: (enabled: boolean) => Promise<{ openAtLogin: boolean; status?: string }>;
      hide: () => Promise<{ hidden: boolean }>;
      show: () => Promise<{ shown: boolean; latencyMs?: number }>;
      showMain: () => Promise<{ shown: boolean }>;
      nativeSubmitResult: (succeeded: boolean) => Promise<{ acknowledged: boolean }>;
      onNativeSubmit: (callback: (value: string) => void | Promise<void>) => () => void;
      onFocus: (callback: () => void) => () => void;
    };
    onShortcut: (callback: (value: string) => void) => () => void;
    platform: string;
  };
}
