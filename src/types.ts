export type CardKind =
  | "note"
  | "journal"
  | "web"
  | "pdf"
  | "image"
  | "audio"
  | "video"
  | "highlight"
  | "ai";

export type CardState = "inbox" | "active" | "archived" | "trash";
export type KnowledgeGroupKind = "area" | "topic";
export type BoardNodeKind = "card" | "text" | "section" | "mindmap";
export type ThemeMode = "system" | "light" | "dark" | "ink";
export type AIEngine = "openrouter" | "local-gemma" | "custom-provider";
export type AIProviderType = "openai-compatible" | "ollama";
export type OpenRouterRoutingMode = "balanced" | "speed" | "economy";
export type AppLanguage = "zh-TW" | "zh-CN" | "en" | "ja" | "ko";
export type BrainContentType = "card" | "board" | "fragment" | "task";
export type BrainEdgeOrigin = "manual" | "ai" | "heuristic";
export type BrainRelationType = "semantic" | "shared_context" | "possible_influence" | "goal_obstacle" | "sequence" | "contrast" | "reinforcement";
export type BrainShareStatus = "shared" | "deleted";
export type UpdateStatus = "available" | "current";
export type AppView =
  | "today"
  | "journal"
  | "boards"
  | "kanban"
  | "library"
  | "database"
  | "tasks"
  | "highlights"
  | "fragments"
  | "brain"
  | "settings";

export interface CardRecord {
  id: string;
  title: string;
  contentHtml: string;
  plainText: string;
  kind: CardKind;
  state: CardState;
  createdAt: number;
  updatedAt: number;
  journalDate?: string;
  journalTouched?: boolean;
  tagIds: string[];
  favorite: boolean;
  color: string;
  dueAt?: number;
  startAt?: number;
  sourceUrl?: string;
  attachmentIds: string[];
  properties: Record<string, string | number | boolean | string[] | null>;
  collectionId?: string;
  deletedAt?: number;
  searchTerms?: string[];
  taskSyncState?: "pending" | "synced";
}

export interface KnowledgeGroupRecord {
  id: string;
  name: string;
  kind: KnowledgeGroupKind;
  parentId?: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface BoardRecord {
  id: string;
  title: string;
  description: string;
  parentId?: string;
  favorite: boolean;
  tagIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface BoardNodeRecord {
  id: string;
  boardId: string;
  kind: BoardNodeKind;
  cardId?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  title?: string;
  text?: string;
  color?: string;
  parentNodeId?: string;
  mindmapRootId?: string;
  collapsed?: boolean;
}

export interface BoardEdgeRecord {
  id: string;
  boardId: string;
  source: string;
  target: string;
  label?: string;
  color?: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface KanbanBoardRecord {
  id: string;
  title: string;
  description: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface KanbanListRecord {
  id: string;
  boardId: string;
  title: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface KanbanPlacementRecord {
  id: string;
  boardId: string;
  listId: string;
  cardId: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface TagRecord {
  id: string;
  name: string;
  color: string;
  group?: string;
  createdAt: number;
}

export interface TaskRecord {
  id: string;
  title: string;
  done: boolean;
  cardId?: string;
  sourceTaskId?: string;
  conversionKey?: string;
  parentTaskId?: string;
  dueAt?: number;
  createdAt: number;
  updatedAt: number;
  searchTerms?: string[];
  doneKey?: "active" | "done";
  scheduleKey?: number;
}

export interface HighlightRecord {
  id: string;
  cardId: string;
  text: string;
  note: string;
  color: string;
  page?: number;
  createdAt: number;
}

export interface AttachmentRecord {
  id: string;
  name: string;
  mime: string;
  size: number;
  blob?: Blob;
  storage?: "indexeddb" | "file";
  relativePath?: string;
  sha256?: string;
  createdAt: number;
}

export interface ChatThreadRecord {
  id: string;
  title: string;
  contextType: "space" | "card" | "board" | "tutor";
  contextId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessageRecord {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  createdAt: number;
}

export interface CourseModule {
  id: string;
  title: string;
  summary: string;
  completed: boolean;
  cardIds: string[];
}

export interface CourseRecord {
  id: string;
  title: string;
  goal: string;
  level: "入門" | "進階" | "專精";
  modules: CourseModule[];
  createdAt: number;
  updatedAt: number;
}

export interface PreferenceRecord {
  key: string;
  value: unknown;
}

export interface CardVersionRecord {
  id: string;
  cardId: string;
  title: string;
  contentHtml: string;
  plainText: string;
  createdAt: number;
}

export interface FragmentRecord {
  id: string;
  text: string;
  pinned: boolean;
  tagIds: string[];
  createdAt: number;
  updatedAt: number;
  searchTerms?: string[];
  pinnedKey?: "pinned" | "normal";
}

export interface BrainEdgeRecord {
  id: string;
  sourceType: BrainContentType;
  sourceId: string;
  targetType: BrainContentType;
  targetId: string;
  origin: BrainEdgeOrigin;
  reason?: string;
  confidence?: number;
  relationType?: BrainRelationType;
  evidence?: string[];
  temporalDistanceDays?: number;
  createdAt: number;
}

export interface BrainReportRecord {
  id: string;
  date: string;
  content: string;
  model: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * 只保存「本機神經元 ↔ 公開神經元」的對照，不把陌生人的內容寫進
 * 私人第二大腦。這張表也是共享不可逆的本機證據：一旦共享，記錄只會
 * 維持 shared，或在連同原內容刪除後改為 deleted。
 */
export interface BrainShareRecord {
  id: string;
  localType: BrainContentType;
  localId: string;
  remoteId: string;
  status: BrainShareStatus;
  originRemoteId?: string;
  sharedAt: number;
  updatedAt: number;
}

export interface AISettings {
  engine: AIEngine;
  openRouterModel: string;
  openRouterRoutingMode: OpenRouterRoutingMode;
  customModel: string;
  customProviderId: string;
  customProviderName: string;
  customProviderModel: string;
  theme: ThemeMode;
  temperature: number;
  spaceSearch: boolean;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  contextLength: number;
  created: number;
  pricing: Record<string, string> | null;
  architecture: Record<string, unknown> | null;
}

export interface AIProviderProfile {
  id: string;
  name: string;
  type: AIProviderType;
  baseUrl: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  keyConfigured: boolean;
}

export interface AIProviderSettings {
  selectedProfileId: string;
  profiles: AIProviderProfile[];
}

export interface AIProviderModel {
  id: string;
  name: string;
}

export type McpAccessMode = "read-only" | "ask" | "allow";

export interface McpSettings {
  enabled: boolean;
  accessMode: McpAccessMode;
  port: number;
  running: boolean;
  endpoint: string;
  error: string;
  tokenStored: boolean;
}

export interface McpAuditEntry {
  id: string;
  tool: string;
  summary: string;
  outcome: "success" | "denied" | "error";
  createdAt: number;
}

export interface UpdateInfo {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  notes: string;
  publishedAt: string;
  htmlUrl: string;
  asset: null | { name: string; url: string; size: number; digest: string | null };
}

export interface UpdateProgress {
  state: string;
  received: number;
  total: number;
  percent: number;
}

export interface UpdateDownloadResult {
  opened: boolean;
  verified?: boolean;
  filePath?: string;
  latestVersion?: string;
  status?: UpdateStatus;
  currentVersion?: string;
}

export interface AutoBackupSettings {
  enabled: boolean;
  intervalDays: 1 | 3 | 7;
  retentionCount: number;
  directory: string;
  lastAttemptAt: number;
  lastSuccessAt: number;
  lastFilePath: string;
  lastError: string;
}

export interface AutoBackupWriteResult {
  filePath: string;
  filename: string;
  bytes: number;
  removedCount: number;
  copiedAssets?: number;
  reusedAssets?: number;
  settings: AutoBackupSettings;
}

export interface CloudBackupSettings {
  enabled: boolean;
  intervalMinutes: 15 | 30 | 60 | 180;
  accountName: string;
  accountEmail: string;
  deviceId: string;
  lastAttemptAt: number;
  lastSuccessAt: number;
  lastContentHash: string;
  lastKnownManifestId: string;
  lastError: string;
  conflict: boolean;
}

export interface CloudBackupSnapshot {
  id: string;
  snapshotAt: number;
  size: number;
  day: string;
}

export interface CloudBackupStatus {
  configured: boolean;
  connected: boolean;
  settings: CloudBackupSettings;
  current: CloudBackupSnapshot | null;
  previous: CloudBackupSnapshot | null;
  needsDecision: boolean;
}

export interface CloudBackupWriteResult {
  skipped: boolean;
  uploadedAssets: number;
  reusedAssets: number;
  settings: CloudBackupSettings;
  current: CloudBackupSnapshot | null;
  previous: CloudBackupSnapshot | null;
}

export interface CloudBackupDownloadResult {
  restoreId: string;
  data: string;
  backupFilePath: string;
  contentHash: string;
  baselineManifestId: string;
  snapshot: CloudBackupSnapshot;
}
