import { COMMUNITY_ENDPOINT, type CommunityIdentity } from "./community";

export const WISH_POOL_ENDPOINT = COMMUNITY_ENDPOINT;
const ADMIN_SESSION_KEY = "chengjing-wish-admin-session-v1";

export interface WishReply {
  id: string;
  wishId: string;
  authorName: string;
  authorSeal?: string;
  authorPattern?: number;
  body: string;
  isAdmin: boolean;
  createdAt: number;
}

export interface WishItem {
  id: string;
  authorName: string;
  authorSeal?: string;
  authorPattern?: number;
  body: string;
  isAdmin: boolean;
  createdAt: number;
  replyCount: number;
  replies: WishReply[];
  replyCursor: string | null;
}

export interface WishListResponse {
  items: WishItem[];
  nextCursor: string | null;
}

export interface ReplyListResponse {
  items: WishReply[];
  nextCursor: string | null;
}

export class WishPoolApiError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
    this.name = "WishPoolApiError";
  }
}

export function getWishAdminSession(storage: Storage = sessionStorage): string {
  try { return storage.getItem(ADMIN_SESSION_KEY) || ""; } catch { return ""; }
}

export function setWishAdminSession(token: string, storage: Storage = sessionStorage): void {
  try {
    if (token) storage.setItem(ADMIN_SESSION_KEY, token);
    else storage.removeItem(ADMIN_SESSION_KEY);
  } catch {}
}

async function requestJson<T>(path: string, init: RequestInit = {}, token = "", identity: CommunityIdentity | null = null): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (identity) headers.set("X-ChengJing-Identity", identity.token);
    const response = await fetch(`${WISH_POOL_ENDPOINT}${path}`, { ...init, headers, signal: controller.signal });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : "request-failed";
      throw new WishPoolApiError(code, response.status);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof WishPoolApiError) throw error;
    throw new WishPoolApiError(error instanceof DOMException && error.name === "AbortError" ? "timeout" : "offline", 0);
  } finally {
    window.clearTimeout(timeout);
  }
}

function encoded(value: string) { return encodeURIComponent(value); }

export const wishPoolApi = {
  list(cursor = ""): Promise<WishListResponse> {
    return requestJson(`/v1/wishes?limit=20${cursor ? `&cursor=${encoded(cursor)}` : ""}`);
  },
  create(identity: CommunityIdentity, body: string): Promise<{ item: WishItem }> {
    return requestJson("/v1/wishes", { method: "POST", body: JSON.stringify({ body }) }, "", identity);
  },
  listReplies(wishId: string, cursor: string): Promise<ReplyListResponse> {
    return requestJson(`/v1/wishes/${encoded(wishId)}/replies?limit=20${cursor ? `&cursor=${encoded(cursor)}` : ""}`);
  },
  reply(wishId: string, identity: CommunityIdentity | null, body: string, token = ""): Promise<{ item: WishReply }> {
    return requestJson(`/v1/wishes/${encoded(wishId)}/replies`, { method: "POST", body: JSON.stringify({ body }) }, token, identity);
  },
  login(password: string): Promise<{ token: string; expiresAt: number }> {
    return requestJson("/v1/admin/login", { method: "POST", body: JSON.stringify({ password }) });
  },
  status(token: string): Promise<{ admin: boolean }> {
    return requestJson("/v1/admin/status", {}, token);
  },
  deleteWish(wishId: string, token: string): Promise<{ deleted: true }> {
    return requestJson(`/v1/wishes/${encoded(wishId)}`, { method: "DELETE" }, token);
  },
  deleteReply(replyId: string, token: string): Promise<{ deleted: true }> {
    return requestJson(`/v1/replies/${encoded(replyId)}`, { method: "DELETE" }, token);
  },
};
