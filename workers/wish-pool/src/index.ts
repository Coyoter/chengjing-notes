import { DurableObject } from "cloudflare:workers";
import { communityIdentityFromRequest, communityIdentityPattern, communityRoute, resolveCommunityNames } from "./community";

const FIRST_SHARD_MONTH = "2026-08";
const ROOT_PAGE_LIMIT = 20;
const REPLY_PAGE_LIMIT = 20;
const INITIAL_REPLY_LIMIT = 3;
const MAX_SHARDS_PER_PAGE = 4;
const MAX_REQUEST_BYTES = 16 * 1024;
const WISH_BODY_LIMIT = 800;
const REPLY_BODY_LIMIT = 500;
const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;
const PUBLIC_WRITE_LIMIT = 8;
const PUBLIC_WRITE_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_LOGIN_LIMIT = 5;
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;

type JsonObject = Record<string, unknown>;

export interface PublicReply {
  id: string;
  wishId: string;
  authorName: string;
  authorSeal: string;
  authorPattern: number;
  body: string;
  isAdmin: boolean;
  createdAt: number;
}

export interface PublicWish {
  id: string;
  authorName: string;
  authorSeal: string;
  authorPattern: number;
  body: string;
  isAdmin: boolean;
  createdAt: number;
  replyCount: number;
  replies: PublicReply[];
  replyCursor: string | null;
}

interface WishRow extends Record<string, SqlStorageValue> {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  is_admin: number;
  created_at: number;
  reply_count: number;
}

interface ReplyRow extends Record<string, SqlStorageValue> {
  id: string;
  wish_id: string;
  author_id: string;
  author_name: string;
  body: string;
  is_admin: number;
  created_at: number;
}

interface RankedReplyRow extends ReplyRow {
  reply_rank: number;
}

interface ShardListInput {
  limit: number;
  beforeAt?: number;
  beforeId?: string;
}

interface ShardReply extends Omit<PublicReply, "authorSeal" | "authorPattern"> {
  authorId: string;
}

interface ShardWish {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  isAdmin: boolean;
  createdAt: number;
  replyCount: number;
  replies: ShardReply[];
  replyBeforeAt?: number;
  replyBeforeId?: string;
}

interface ShardListResult {
  items: ShardWish[];
  hasMore: boolean;
  nextBeforeAt?: number;
  nextBeforeId?: string;
}

interface ShardReplyResult {
  items: ShardReply[];
  hasMore: boolean;
  nextBeforeAt?: number;
  nextBeforeId?: string;
}

interface PublicAuthorInput {
  authorId: string;
  authorName: string;
  body: string;
}

interface CreateWishInput extends PublicAuthorInput {
  month: string;
  subjectHash: string;
  now: number;
}

interface CreateReplyInput extends PublicAuthorInput {
  wishId: string;
  month: string;
  subjectHash: string;
  now: number;
  isAdmin: boolean;
}

type CreateWishResult = { ok: true; item: ShardWish } | { ok: false; error: "rate-limited" };
type CreateReplyResult = { ok: true; item: ShardReply } | { ok: false; error: "rate-limited" | "wish-not-found" };
type DeleteKind = "wish" | "reply";

interface RootCursor {
  kind: "wishes";
  month: string;
  at?: number;
  id?: string;
}

interface ReplyCursor {
  kind: "replies";
  wishId: string;
  at: number;
  id: string;
}

interface AdminTokenPayload {
  exp: number;
  nonce: string;
}

function shardReply(row: ReplyRow): ShardReply {
  return {
    id: row.id,
    wishId: row.wish_id,
    authorId: row.author_id,
    authorName: row.author_name,
    body: row.body,
    isAdmin: row.is_admin === 1,
    createdAt: row.created_at,
  };
}

export class WishShard extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);
    const currentVersion = this.ctx.storage.sql
      .exec<{ version: number }>("SELECT COALESCE(MAX(id), 0) AS version FROM _sql_schema_migrations")
      .one().version;
    if (currentVersion >= 1) return;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS wishes (
        id TEXT PRIMARY KEY,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        body TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        reply_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_wishes_created ON wishes(created_at DESC, id DESC);
      CREATE TABLE IF NOT EXISTS replies (
        id TEXT PRIMARY KEY,
        wish_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        body TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_replies_wish_created ON replies(wish_id, created_at DESC, id DESC);
      CREATE TABLE IF NOT EXISTS rate_limits (
        action TEXT NOT NULL,
        subject_hash TEXT NOT NULL,
        bucket INTEGER NOT NULL,
        count INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY(action, subject_hash, bucket)
      );
      CREATE INDEX IF NOT EXISTS idx_rate_limits_expiry ON rate_limits(expires_at);
      CREATE TABLE IF NOT EXISTS maintenance (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      );
      INSERT INTO _sql_schema_migrations (id, applied_at) VALUES (1, ${Date.now()});
    `);
  }

  private consumeRateLimit(action: string, subjectHash: string, limit: number, windowMs: number, now: number): boolean {
    const bucket = Math.floor(now / windowMs);
    const row = this.ctx.storage.sql.exec<{ count: number }>(`
      INSERT INTO rate_limits(action, subject_hash, bucket, count, expires_at)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(action, subject_hash, bucket)
      DO UPDATE SET count = count + 1, expires_at = excluded.expires_at
      RETURNING count
    `, action, subjectHash, bucket, now + windowMs * 2).one();

    const lastCleanup = this.ctx.storage.sql
      .exec<{ value: number }>("SELECT value FROM maintenance WHERE key = 'rate-cleanup'")
      .toArray()[0]?.value ?? 0;
    if (now - lastCleanup >= 60 * 60 * 1000) {
      this.ctx.storage.sql.exec("DELETE FROM rate_limits WHERE expires_at < ?", now);
      this.ctx.storage.sql.exec(`
        INSERT INTO maintenance(key, value) VALUES ('rate-cleanup', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `, now);
    }
    return row.count <= limit;
  }

  async checkRateLimit(action: string, subjectHash: string, limit: number, windowMs: number, now: number): Promise<boolean> {
    return this.consumeRateLimit(action, subjectHash, limit, windowMs, now);
  }

  async listWishes(input: ShardListInput): Promise<ShardListResult> {
    const limit = Math.max(1, Math.min(ROOT_PAGE_LIMIT, Math.floor(input.limit)));
    const cursorSql = input.beforeAt && input.beforeId
      ? "WHERE (created_at < ? OR (created_at = ? AND id < ?))"
      : "";
    const rows = this.ctx.storage.sql.exec<WishRow>(`
      SELECT id, author_id, author_name, body, is_admin, created_at, reply_count
      FROM wishes
      ${cursorSql}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `, ...(cursorSql ? [input.beforeAt, input.beforeAt, input.beforeId] : []), limit + 1).toArray();
    const hasMore = rows.length > limit;
    const visible = rows.slice(0, limit);
    if (visible.length === 0) return { items: [], hasMore: false };

    const placeholders = visible.map(() => "?").join(", ");
    const ids = visible.map((item) => item.id);
    const replyRows = this.ctx.storage.sql.exec<RankedReplyRow>(`
      SELECT id, wish_id, author_id, author_name, body, is_admin, created_at, reply_rank
      FROM (
        SELECT id, wish_id, author_id, author_name, body, is_admin, created_at,
          ROW_NUMBER() OVER (PARTITION BY wish_id ORDER BY created_at DESC, id DESC) AS reply_rank
        FROM replies
        WHERE wish_id IN (${placeholders})
      )
      WHERE reply_rank <= ?
      ORDER BY wish_id ASC, created_at ASC, id ASC
    `, ...ids, INITIAL_REPLY_LIMIT).toArray();
    const repliesByWish = new Map<string, ShardReply[]>();
    for (const row of replyRows) {
      const list = repliesByWish.get(row.wish_id) ?? [];
      list.push(shardReply(row));
      repliesByWish.set(row.wish_id, list);
    }

    const items = visible.map((row): ShardWish => {
      const replies = repliesByWish.get(row.id) ?? [];
      const oldestReply = replies[0];
      return {
        id: row.id,
        authorId: row.author_id,
        authorName: row.author_name,
        body: row.body,
        isAdmin: row.is_admin === 1,
        createdAt: row.created_at,
        replyCount: row.reply_count,
        replies,
        ...(row.reply_count > replies.length && oldestReply ? { replyBeforeAt: oldestReply.createdAt, replyBeforeId: oldestReply.id } : {}),
      };
    });
    const last = visible.at(-1);
    return {
      items,
      hasMore,
      ...(hasMore && last ? { nextBeforeAt: last.created_at, nextBeforeId: last.id } : {}),
    };
  }

  async listReplies(wishId: string, input: ShardListInput): Promise<ShardReplyResult> {
    const limit = Math.max(1, Math.min(REPLY_PAGE_LIMIT, Math.floor(input.limit)));
    const cursorSql = input.beforeAt && input.beforeId
      ? "AND (created_at < ? OR (created_at = ? AND id < ?))"
      : "";
    const rows = this.ctx.storage.sql.exec<ReplyRow>(`
      SELECT id, wish_id, author_id, author_name, body, is_admin, created_at
      FROM replies
      WHERE wish_id = ? ${cursorSql}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `, wishId, ...(cursorSql ? [input.beforeAt, input.beforeAt, input.beforeId] : []), limit + 1).toArray();
    const hasMore = rows.length > limit;
    const visible = rows.slice(0, limit);
    const last = visible.at(-1);
    return {
      items: visible.reverse().map(shardReply),
      hasMore,
      ...(hasMore && last ? { nextBeforeAt: last.created_at, nextBeforeId: last.id } : {}),
    };
  }

  async createWish(input: CreateWishInput): Promise<CreateWishResult> {
    if (!this.consumeRateLimit("wish", input.subjectHash, PUBLIC_WRITE_LIMIT, PUBLIC_WRITE_WINDOW_MS, input.now)) {
      return { ok: false, error: "rate-limited" };
    }
    const id = `w_${input.month.replace("-", "")}_${crypto.randomUUID()}`;
    this.ctx.storage.sql.exec(`
      INSERT INTO wishes(id, author_id, author_name, body, is_admin, created_at, reply_count)
      VALUES (?, ?, ?, ?, 0, ?, 0)
    `, id, input.authorId, input.authorName, input.body, input.now);
    return {
      ok: true,
      item: {
        id,
        authorId: input.authorId,
        authorName: input.authorName,
        body: input.body,
        isAdmin: false,
        createdAt: input.now,
        replyCount: 0,
        replies: [],
      },
    };
  }

  async createReply(input: CreateReplyInput): Promise<CreateReplyResult> {
    const wish = this.ctx.storage.sql.exec<{ id: string }>("SELECT id FROM wishes WHERE id = ?", input.wishId).toArray()[0];
    if (!wish) return { ok: false, error: "wish-not-found" };
    if (!input.isAdmin && !this.consumeRateLimit("reply", input.subjectHash, PUBLIC_WRITE_LIMIT, PUBLIC_WRITE_WINDOW_MS, input.now)) {
      return { ok: false, error: "rate-limited" };
    }
    const id = `r_${input.month.replace("-", "")}_${crypto.randomUUID()}`;
    this.ctx.storage.sql.exec(`
      INSERT INTO replies(id, wish_id, author_id, author_name, body, is_admin, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, id, input.wishId, input.authorId, input.authorName, input.body, input.isAdmin ? 1 : 0, input.now);
    this.ctx.storage.sql.exec("UPDATE wishes SET reply_count = reply_count + 1 WHERE id = ?", input.wishId);
    return {
      ok: true,
      item: { id, wishId: input.wishId, authorId: input.authorId, authorName: input.authorName, body: input.body, isAdmin: input.isAdmin, createdAt: input.now },
    };
  }

  async deleteComment(kind: DeleteKind, id: string): Promise<boolean> {
    if (kind === "wish") {
      const exists = this.ctx.storage.sql.exec<{ id: string }>("SELECT id FROM wishes WHERE id = ?", id).toArray()[0];
      if (!exists) return false;
      this.ctx.storage.sql.exec("DELETE FROM replies WHERE wish_id = ?", id);
      this.ctx.storage.sql.exec("DELETE FROM wishes WHERE id = ?", id);
      return true;
    }
    const reply = this.ctx.storage.sql.exec<{ wish_id: string }>("SELECT wish_id FROM replies WHERE id = ?", id).toArray()[0];
    if (!reply) return false;
    this.ctx.storage.sql.exec("DELETE FROM replies WHERE id = ?", id);
    this.ctx.storage.sql.exec("UPDATE wishes SET reply_count = MAX(0, reply_count - 1) WHERE id = ?", reply.wish_id);
    return true;
  }
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBody(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  const length = Array.from(normalized).length;
  if (length < 2 || length > maxLength) return null;
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) return null;
  if ((normalized.match(/https?:\/\//gi) ?? []).length > 5) return null;
  return normalized;
}

function normalizePublicAuthor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").trim();
  if (!/^匿名[\p{Script=Han}A-Za-z0-9·・（）()\- ]{2,38}$/u.test(name)) return null;
  if (name.includes("管理員")) return null;
  return name;
}

function normalizeAuthorId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

async function readBoundedJson(request: Request): Promise<unknown> {
  if (!request.body) return null;
  const statedLength = Number(request.headers.get("content-length") || 0);
  if (statedLength > MAX_REQUEST_BYTES) throw new Error("payload-too-large");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new Error("payload-too-large");
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(joined));
  } catch {
    throw new Error("invalid-json");
  }
}

function monthKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function previousMonth(value: string): string {
  const [yearValue, monthValue] = value.split("-");
  const year = Number(yearValue);
  const month = Number(monthValue);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return monthKey(date);
}

function validMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
    && value >= FIRST_SHARD_MONTH && value <= monthKey();
}

function monthFromCommentId(id: string): string | null {
  const match = id.match(/^[wr]_(\d{4})(\d{2})_[0-9a-f-]+$/i);
  if (!match) return null;
  const month = `${match[1]}-${match[2]}`;
  return validMonth(month) ? month : null;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeCursor(value: RootCursor | ReplyCursor): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeCursor(value: string | null): RootCursor | ReplyCursor | null {
  if (!value || value.length > 600) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlDecode(value)));
    if (!isRecord(parsed)) return null;
    if (parsed.kind === "wishes" && validMonth(parsed.month)
      && (parsed.at === undefined || typeof parsed.at === "number")
      && (parsed.id === undefined || typeof parsed.id === "string")) {
      return { kind: "wishes", month: parsed.month, ...(typeof parsed.at === "number" ? { at: parsed.at } : {}), ...(typeof parsed.id === "string" ? { id: parsed.id } : {}) };
    }
    if (parsed.kind === "replies" && typeof parsed.wishId === "string" && typeof parsed.at === "number" && typeof parsed.id === "string") {
      return { kind: "replies", wishId: parsed.wishId, at: parsed.at, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

function shard(env: Env, month: string): DurableObjectStub<WishShard> {
  return env.WISH_SHARD.getByName(`wish:${month}`, { locationHint: "apac" });
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function timingSafeStringEqual(provided: string, expected: string): Promise<boolean> {
  const [providedHash, expectedHash] = await Promise.all([digest(provided), digest(expected)]);
  return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
}

async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function issueAdminToken(secret: string, now: number): Promise<{ token: string; expiresAt: number }> {
  const payload: AdminTokenPayload = { exp: now + ADMIN_SESSION_MS, nonce: crypto.randomUUID() };
  const encoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = base64UrlEncode(await hmac(secret, encoded));
  return { token: `${encoded}.${signature}`, expiresAt: payload.exp };
}

async function verifyAdminToken(secret: string, token: string | null, now: number): Promise<boolean> {
  if (!token || token.length > 1_000) return false;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) return false;
  try {
    const expected = await hmac(secret, encoded);
    const provided = base64UrlDecode(signature);
    if (!crypto.subtle.timingSafeEqual(await digest(base64UrlEncode(provided)), await digest(base64UrlEncode(expected)))) return false;
    const payload: unknown = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded)));
    return isRecord(payload) && typeof payload.exp === "number" && payload.exp > now && payload.exp <= now + ADMIN_SESSION_MS;
  } catch {
    return false;
  }
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

async function subjectHash(request: Request, env: Env): Promise<string> {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const bytes = await digest(`rate:${env.WISH_SIGNING_SECRET}:${ip}`);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" } });
}

function errorResponse(error: string, status: number): Response {
  return json({ error }, status);
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-ChengJing-Identity");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function resolveWishItems(env: Env, items: ShardWish[]): Promise<PublicWish[]> {
  const names = await resolveCommunityNames(env, items.flatMap((item) => [item.authorId, ...item.replies.map((reply) => reply.authorId)]));
  return items.map((item) => ({
    id: item.id,
    authorName: names.get(item.authorId)?.displayName || item.authorName,
    authorSeal: item.isAdmin ? "#5fae98" : names.get(item.authorId)?.seal || "#7f8981",
    authorPattern: names.get(item.authorId)?.pattern ?? communityIdentityPattern(item.isAdmin ? "admin" : item.authorId),
    body: item.body,
    isAdmin: item.isAdmin,
    createdAt: item.createdAt,
    replyCount: item.replyCount,
    replies: item.replies.map((reply) => ({
      id: reply.id,
      wishId: reply.wishId,
      authorName: names.get(reply.authorId)?.displayName || reply.authorName,
      authorSeal: reply.isAdmin ? "#5fae98" : names.get(reply.authorId)?.seal || "#7f8981",
      authorPattern: names.get(reply.authorId)?.pattern ?? communityIdentityPattern(reply.isAdmin ? "admin" : reply.authorId),
      body: reply.body,
      isAdmin: reply.isAdmin,
      createdAt: reply.createdAt,
    })),
    replyCursor: item.replyBeforeAt && item.replyBeforeId
      ? encodeCursor({ kind: "replies", wishId: item.id, at: item.replyBeforeAt, id: item.replyBeforeId })
      : null,
  }));
}

async function listWishes(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") || "20", 10);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(ROOT_PAGE_LIMIT, requestedLimit)) : ROOT_PAGE_LIMIT;
  const decoded = decodeCursor(url.searchParams.get("cursor"));
  let month = decoded?.kind === "wishes" && validMonth(decoded.month) ? decoded.month : monthKey();
  let beforeAt = decoded?.kind === "wishes" && typeof decoded.at === "number" ? decoded.at : undefined;
  let beforeId = decoded?.kind === "wishes" && typeof decoded.id === "string" ? decoded.id : undefined;
  const items: ShardWish[] = [];
  let nextCursor: string | null = null;

  for (let attempt = 0; attempt < MAX_SHARDS_PER_PAGE && month >= FIRST_SHARD_MONTH && items.length < limit; attempt += 1) {
    const result = await shard(env, month).listWishes({ limit: limit - items.length, beforeAt, beforeId });
    items.push(...result.items);
    if (result.hasMore && result.nextBeforeAt && result.nextBeforeId) {
      nextCursor = encodeCursor({ kind: "wishes", month, at: result.nextBeforeAt, id: result.nextBeforeId });
      break;
    }
    const older = previousMonth(month);
    nextCursor = older >= FIRST_SHARD_MONTH ? encodeCursor({ kind: "wishes", month: older }) : null;
    if (items.length >= limit || older < FIRST_SHARD_MONTH) break;
    month = older;
    beforeAt = undefined;
    beforeId = undefined;
  }
  return json({ items: await resolveWishItems(env, items), nextCursor });
}

async function createWish(request: Request, env: Env): Promise<Response> {
  const payload = await readBoundedJson(request);
  if (!isRecord(payload)) return errorResponse("invalid-payload", 400);
  const communityIdentity = await communityIdentityFromRequest(request, env);
  const authorId = communityIdentity?.id || normalizeAuthorId(payload.authorId);
  const authorName = communityIdentity?.displayName || normalizePublicAuthor(payload.authorName);
  const body = normalizeBody(payload.body, WISH_BODY_LIMIT);
  if (!authorId || !authorName || !body) return errorResponse("invalid-payload", 400);
  const now = Date.now();
  const month = monthKey(new Date(now));
  const result = await shard(env, month).createWish({ authorId, authorName, body, month, subjectHash: await subjectHash(request, env), now });
  if (!result.ok) return errorResponse(result.error, 429);
  const [item] = await resolveWishItems(env, [result.item]);
  return json({ item }, 201);
}

async function listReplies(request: Request, env: Env, wishId: string): Promise<Response> {
  const month = monthFromCommentId(wishId);
  if (!month || !wishId.startsWith("w_")) return errorResponse("invalid-wish", 400);
  const url = new URL(request.url);
  const decoded = decodeCursor(url.searchParams.get("cursor"));
  if (decoded && (decoded.kind !== "replies" || decoded.wishId !== wishId)) return errorResponse("invalid-cursor", 400);
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") || "20", 10);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(REPLY_PAGE_LIMIT, requestedLimit)) : REPLY_PAGE_LIMIT;
  const result = await shard(env, month).listReplies(wishId, { limit, beforeAt: decoded?.at, beforeId: decoded?.id });
  const nextCursor = result.hasMore && result.nextBeforeAt && result.nextBeforeId
    ? encodeCursor({ kind: "replies", wishId, at: result.nextBeforeAt, id: result.nextBeforeId })
    : null;
  const names = await resolveCommunityNames(env, result.items.map((item) => item.authorId));
  return json({ items: result.items.map((item): PublicReply => ({
    id: item.id,
    wishId: item.wishId,
    authorName: names.get(item.authorId)?.displayName || item.authorName,
    authorSeal: item.isAdmin ? "#5fae98" : names.get(item.authorId)?.seal || "#7f8981",
    authorPattern: names.get(item.authorId)?.pattern ?? communityIdentityPattern(item.isAdmin ? "admin" : item.authorId),
    body: item.body,
    isAdmin: item.isAdmin,
    createdAt: item.createdAt,
  })), nextCursor });
}

async function createReply(request: Request, env: Env, wishId: string): Promise<Response> {
  const month = monthFromCommentId(wishId);
  if (!month || !wishId.startsWith("w_")) return errorResponse("invalid-wish", 400);
  const payload = await readBoundedJson(request);
  if (!isRecord(payload)) return errorResponse("invalid-payload", 400);
  const body = normalizeBody(payload.body, REPLY_BODY_LIMIT);
  if (!body) return errorResponse("invalid-payload", 400);
  const token = bearerToken(request);
  const isAdmin = token ? await verifyAdminToken(env.WISH_SIGNING_SECRET, token, Date.now()) : false;
  if (token && !isAdmin) return errorResponse("admin-session-expired", 401);
  const communityIdentity = isAdmin ? null : await communityIdentityFromRequest(request, env);
  const authorId = isAdmin ? "admin" : communityIdentity?.id || normalizeAuthorId(payload.authorId);
  const authorName = isAdmin ? "管理員" : communityIdentity?.displayName || normalizePublicAuthor(payload.authorName);
  if (!authorId || !authorName) return errorResponse("invalid-payload", 400);
  const now = Date.now();
  const result = await shard(env, month).createReply({
    wishId,
    authorId,
    authorName,
    body,
    month,
    subjectHash: await subjectHash(request, env),
    now,
    isAdmin,
  });
  if (!result.ok) return errorResponse(result.error, result.error === "rate-limited" ? 429 : 404);
  return json({ item: {
    id: result.item.id,
    wishId: result.item.wishId,
    authorName: communityIdentity?.displayName || result.item.authorName,
    authorSeal: isAdmin ? "#5fae98" : communityIdentity?.seal || "#7f8981",
    authorPattern: communityIdentity?.pattern ?? communityIdentityPattern(isAdmin ? "admin" : authorId),
    body: result.item.body,
    isAdmin: result.item.isAdmin,
    createdAt: result.item.createdAt,
  } }, 201);
}

async function loginAdmin(request: Request, env: Env): Promise<Response> {
  const now = Date.now();
  const rateHash = await subjectHash(request, env);
  const allowed = await shard(env, monthKey(new Date(now))).checkRateLimit("admin-login", rateHash, ADMIN_LOGIN_LIMIT, ADMIN_LOGIN_WINDOW_MS, now);
  if (!allowed) return errorResponse("rate-limited", 429);
  const payload = await readBoundedJson(request);
  if (!isRecord(payload) || typeof payload.password !== "string" || payload.password.length > 200) return errorResponse("invalid-admin-password", 401);
  if (!await timingSafeStringEqual(payload.password, env.WISH_ADMIN_PASSWORD)) return errorResponse("invalid-admin-password", 401);
  return json(await issueAdminToken(env.WISH_SIGNING_SECRET, now));
}

async function requireAdmin(request: Request, env: Env): Promise<boolean> {
  return verifyAdminToken(env.WISH_SIGNING_SECRET, bearerToken(request), Date.now());
}

async function deleteComment(request: Request, env: Env, kind: DeleteKind, id: string): Promise<Response> {
  if (!await requireAdmin(request, env)) return errorResponse("admin-session-expired", 401);
  const month = monthFromCommentId(id);
  if (!month || (kind === "wish" ? !id.startsWith("w_") : !id.startsWith("r_"))) return errorResponse("invalid-comment", 400);
  const deleted = await shard(env, month).deleteComment(kind, id);
  return deleted ? json({ deleted: true }) : errorResponse("comment-not-found", 404);
}

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Cache-Control": "public, max-age=86400" } });
  if (url.pathname === "/health" && request.method === "GET") return json({ ok: true, service: "chengjing-community", storage: "monthly-sqlite-durable-objects+d1" });
  const community = await communityRoute(request, env, ctx);
  if (community) return community;
  if (url.pathname === "/v1/wishes" && request.method === "GET") return listWishes(request, env);
  if (url.pathname === "/v1/wishes" && request.method === "POST") return createWish(request, env);
  if (url.pathname === "/v1/admin/login" && request.method === "POST") return loginAdmin(request, env);
  if (url.pathname === "/v1/admin/status" && request.method === "GET") return json({ admin: await requireAdmin(request, env) });

  const wishReplies = url.pathname.match(/^\/v1\/wishes\/([^/]+)\/replies$/);
  if (wishReplies?.[1] && request.method === "GET") return listReplies(request, env, decodeURIComponent(wishReplies[1]));
  if (wishReplies?.[1] && request.method === "POST") return createReply(request, env, decodeURIComponent(wishReplies[1]));
  const wishDelete = url.pathname.match(/^\/v1\/wishes\/([^/]+)$/);
  if (wishDelete?.[1] && request.method === "DELETE") return deleteComment(request, env, "wish", decodeURIComponent(wishDelete[1]));
  const replyDelete = url.pathname.match(/^\/v1\/replies\/([^/]+)$/);
  if (replyDelete?.[1] && request.method === "DELETE") return deleteComment(request, env, "reply", decodeURIComponent(replyDelete[1]));
  return errorResponse("not-found", 404);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return withCors(await route(request, env, ctx));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === "payload-too-large" ? 413 : message === "invalid-json" ? 400 : 500;
      console.error(JSON.stringify({ message: "Wish pool request failed", error: message, method: request.method, path: new URL(request.url).pathname }));
      return withCors(errorResponse(status === 500 ? "internal-error" : message, status));
    }
  },
} satisfies ExportedHandler<Env>;
