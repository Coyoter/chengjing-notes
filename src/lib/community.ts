import type { BrainContentType } from "../types";

export const COMMUNITY_ENDPOINT = "https://chengjing-wish-pool.coyoter.workers.dev";
export const COMMUNITY_IDENTITY_STORAGE_KEY = "chengjing-community-identity-v1";
const COMMUNITY_DISCOVERY_STORAGE_KEY = "chengjing-community-discovery-v1";
export const COMMUNITY_OPEN_NEURON_KEY = "chengjing-community-open-neuron-v1";

export type SharedIntention = "share" | "perspective" | "help";
export type CommunityReportReason = "harmful" | "privacy" | "spam" | "other";

export interface CommunityIdentity {
  id: string;
  displayName: string;
  token: string;
  seal: string;
  pattern?: number;
}

export interface SharedNeuronSummary {
  id: string;
  title: string;
  sourceType: BrainContentType;
  authorName: string;
  seal: string;
  authorPattern: number;
  intention: SharedIntention;
  commentCount: number;
  createdAt: number;
  originNeuronId?: string;
  isOwn: boolean;
}

export interface SharedNeuronComment {
  id: string;
  neuronId: string;
  authorName: string;
  seal: string;
  authorPattern: number;
  body: string;
  isAuthor: boolean;
  isAdmin: boolean;
  isOwn: boolean;
  createdAt: number;
}

export interface SharedNeuronDetail extends SharedNeuronSummary {
  body: string;
  comments: SharedNeuronComment[];
  commentCursor: string | null;
}

export interface CommunityReport {
  id: string;
  targetType: "neuron" | "comment";
  targetId: string;
  reason: CommunityReportReason;
  detail: string;
  reporterName: string;
  createdAt: number;
  targetTitle: string;
  targetExcerpt: string;
}

export interface CommunityNotification {
  id: string;
  neuronId: string;
  neuronTitle: string;
  authorName: string;
  seal: string;
  authorPattern: number;
  body: string;
  isAdmin: boolean;
  createdAt: number;
}

export class CommunityApiError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
    this.name = "CommunityApiError";
  }
}

function storedJson(storage: Storage, key: string): unknown {
  try { return JSON.parse(storage.getItem(key) || "null"); } catch { return null; }
}

export function isCommunityIdentity(value: unknown): value is CommunityIdentity {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<CommunityIdentity>;
  return typeof item.id === "string" && item.id.length >= 20
    && typeof item.displayName === "string" && item.displayName.length >= 2
    && typeof item.token === "string" && item.token.length >= 40
    && typeof item.seal === "string" && /^#[0-9a-f]{6}$/i.test(item.seal);
}

export function getCommunityIdentity(storage: Storage = localStorage): CommunityIdentity | null {
  const value = storedJson(storage, COMMUNITY_IDENTITY_STORAGE_KEY);
  if (!isCommunityIdentity(value)) return null;
  return { ...value, pattern: Number.isInteger(value.pattern) ? value.pattern : communityIdentityPattern(value.id) };
}

export function saveCommunityIdentity(identity: CommunityIdentity, storage: Storage = localStorage): void {
  storage.setItem(COMMUNITY_IDENTITY_STORAGE_KEY, JSON.stringify(identity));
}

export function clearCommunityIdentity(storage: Storage = localStorage): void {
  storage.removeItem(COMMUNITY_IDENTITY_STORAGE_KEY);
}

export function getCommunityDiscoveryEnabled(storage: Storage = localStorage): boolean {
  try { return storage.getItem(COMMUNITY_DISCOVERY_STORAGE_KEY) === "true"; } catch { return false; }
}

export function setCommunityDiscoveryEnabled(enabled: boolean, storage: Storage = localStorage): void {
  try { storage.setItem(COMMUNITY_DISCOVERY_STORAGE_KEY, String(enabled)); } catch {}
}

export type IdentityValidationError = "required" | "length" | "characters" | "reserved" | null;

export function normalizeCommunityDisplayName(value: string): string {
  return value.normalize("NFC").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim().replace(/\s+/g, " ");
}

export function communityIdentityPattern(id: string): number {
  let value = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    value ^= id.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export function validateCommunityDisplayName(value: string): IdentityValidationError {
  const name = normalizeCommunityDisplayName(value);
  if (!name) return "required";
  const graphemes = typeof Intl.Segmenter === "function"
    ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name)].length
    : Array.from(name).length;
  if (graphemes < 2 || graphemes > 20) return "length";
  if (!/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}A-Za-z ]+$/u.test(name)) return "characters";
  const reserved = new Set(["管理員", "管理员", "官方", "澄境", "chengjing", "admin", "administrator", "system", "official"]);
  return reserved.has(name.toLocaleLowerCase()) ? "reserved" : null;
}

interface RequestOptions {
  identity?: CommunityIdentity | null;
  adminToken?: string;
  timeoutMs?: number;
}

async function requestJson<T>(path: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), options.timeoutMs || 12_000);
  try {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    if (options.identity) headers.set("X-ChengJing-Identity", options.identity.token);
    if (options.adminToken) headers.set("Authorization", `Bearer ${options.adminToken}`);
    const response = await fetch(`${COMMUNITY_ENDPOINT}${path}`, { ...init, headers, signal: controller.signal });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : "request-failed";
      throw new CommunityApiError(code, response.status);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof CommunityApiError) throw error;
    throw new CommunityApiError(error instanceof DOMException && error.name === "AbortError" ? "timeout" : "offline", 0);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

const encoded = (value: string) => encodeURIComponent(value);

export const communityApi = {
  register(displayName: string): Promise<{ identity: CommunityIdentity }> {
    return requestJson("/v1/community/identity", { method: "POST", body: JSON.stringify({ displayName: normalizeCommunityDisplayName(displayName) }) });
  },
  identity(identity: CommunityIdentity): Promise<{ identity: Omit<CommunityIdentity, "token"> }> {
    return requestJson("/v1/community/identity", {}, { identity });
  },
  rename(identity: CommunityIdentity, displayName: string): Promise<{ identity: Omit<CommunityIdentity, "token"> }> {
    return requestJson("/v1/community/identity", { method: "PATCH", body: JSON.stringify({ displayName: normalizeCommunityDisplayName(displayName) }) }, { identity });
  },
  discover(identity: CommunityIdentity | null, pool = 0): Promise<{ items: SharedNeuronSummary[]; refreshAt: number }> {
    const epoch = Math.floor(Date.now() / 300_000);
    return requestJson(`/v1/community/neurons/discover?epoch=${epoch}&pool=${Math.max(0, Math.min(7, pool))}`, {}, { identity, timeoutMs: 8_000 });
  },
  neuron(id: string, identity: CommunityIdentity | null, cursor = ""): Promise<{ item: SharedNeuronDetail }> {
    return requestJson(`/v1/community/neurons/${encoded(id)}${cursor ? `?cursor=${encoded(cursor)}` : ""}`, {}, { identity });
  },
  share(identity: CommunityIdentity, input: { sourceType: BrainContentType; title: string; body: string; intention: SharedIntention }): Promise<{ item: SharedNeuronDetail }> {
    return requestJson("/v1/community/neurons", { method: "POST", body: JSON.stringify(input) }, { identity });
  },
  updateNeuron(identity: CommunityIdentity, id: string, input: { title: string; body: string }): Promise<{ updated: true }> {
    return requestJson(`/v1/community/neurons/${encoded(id)}`, { method: "PATCH", body: JSON.stringify(input) }, { identity });
  },
  fork(identity: CommunityIdentity, id: string): Promise<{ item: SharedNeuronDetail }> {
    return requestJson(`/v1/community/neurons/${encoded(id)}/fork`, { method: "POST", body: "{}" }, { identity });
  },
  deleteNeuron(id: string, identity: CommunityIdentity | null, adminToken = ""): Promise<{ deleted: true }> {
    return requestJson(`/v1/community/neurons/${encoded(id)}`, { method: "DELETE" }, { identity, adminToken });
  },
  comment(identity: CommunityIdentity | null, id: string, body: string, adminToken = ""): Promise<{ item: SharedNeuronComment }> {
    return requestJson(`/v1/community/neurons/${encoded(id)}/comments`, { method: "POST", body: JSON.stringify({ body }) }, { identity, adminToken });
  },
  comments(id: string, identity: CommunityIdentity | null, cursor: string): Promise<{ items: SharedNeuronComment[]; nextCursor: string | null }> {
    return requestJson(`/v1/community/neurons/${encoded(id)}/comments?cursor=${encoded(cursor)}`, {}, { identity });
  },
  deleteComment(id: string, identity: CommunityIdentity | null, adminToken = ""): Promise<{ deleted: true }> {
    return requestJson(`/v1/community/comments/${encoded(id)}`, { method: "DELETE" }, { identity, adminToken });
  },
  report(identity: CommunityIdentity, input: { targetType: "neuron" | "comment"; targetId: string; reason: CommunityReportReason; detail?: string }): Promise<{ reported: true }> {
    return requestJson("/v1/community/reports", { method: "POST", body: JSON.stringify(input) }, { identity });
  },
  reports(adminToken: string): Promise<{ items: CommunityReport[] }> {
    return requestJson("/v1/admin/community/reports", {}, { adminToken });
  },
  dismissReport(adminToken: string, id: string): Promise<{ resolved: true }> {
    return requestJson(`/v1/admin/community/reports/${encoded(id)}`, { method: "PATCH", body: JSON.stringify({ action: "dismiss" }) }, { adminToken });
  },
  notifications(identity: CommunityIdentity, since: number): Promise<{ items: CommunityNotification[] }> {
    return requestJson(`/v1/community/notifications?since=${Math.max(0, Math.floor(since))}`, {}, { identity, timeoutMs: 8_000 });
  },
};
