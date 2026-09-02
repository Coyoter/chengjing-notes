const MAX_REQUEST_BYTES = 20 * 1024;
const IDENTITY_NAME_LIMIT = 20;
const NEURON_TITLE_LIMIT = 120;
const NEURON_BODY_LIMIT = 6_000;
const COMMENT_BODY_LIMIT = 800;
const REPORT_DETAIL_LIMIT = 500;
const DISCOVERY_LIMIT = 20;
const DISCOVERY_CANDIDATE_LIMIT = 64;
const DISCOVERY_EPOCH_MS = 5 * 60 * 1000;
const PUBLIC_WRITE_LIMIT = 8;
const PUBLIC_WRITE_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;

type JsonObject = Record<string, unknown>;
type IdentityStatus = "active" | "blocked";
type SharedIntention = "share" | "perspective" | "help";
type CommunityReportReason = "harmful" | "privacy" | "spam" | "other";

interface IdentityRow {
  id: string;
  display_name: string;
  token_hash: string;
  seal: string;
  status: IdentityStatus;
  created_at: number;
  updated_at: number;
}

interface NeuronRow {
  id: string;
  author_id: string;
  source_type: "card" | "board" | "fragment" | "task";
  title: string;
  body: string;
  intention: SharedIntention;
  origin_neuron_id: string | null;
  comment_count: number;
  created_at: number;
  display_name: string;
  seal: string;
}

type NeuronSummaryRow = Omit<NeuronRow, "body">;

interface CommentRow {
  id: string;
  neuron_id: string;
  author_id: string;
  body: string;
  is_admin: number;
  created_at: number;
  display_name: string;
  seal: string;
  neuron_author_id: string;
}

export interface VerifiedCommunityIdentity {
  id: string;
  displayName: string;
  seal: string;
  pattern: number;
  status: IdentityStatus;
}

export function communityIdentityPattern(id: string): number {
  let value = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    value ^= id.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(data: unknown, status = 200, cacheControl = "no-store"): Response {
  return Response.json(data, { status, headers: { "Cache-Control": cacheControl, "Content-Type": "application/json; charset=utf-8" } });
}

function errorResponse(error: string, status: number): Response {
  return json({ error }, status);
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
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("invalid-json"); }
}

function normalizeBody(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  const length = Array.from(normalized).length;
  if (length < 2 || length > maxLength) return null;
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) return null;
  return normalized;
}

function normalizeTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.normalize("NFC").replace(/\s+/g, " ").trim();
  const length = Array.from(title).length;
  return length >= 2 && length <= NEURON_TITLE_LIMIT ? title : null;
}

function graphemeLength(value: string): number {
  return typeof Intl.Segmenter === "function"
    ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].length
    : Array.from(value).length;
}

export function normalizeCommunityDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim().replace(/\s+/g, " ");
  const length = graphemeLength(name);
  if (length < 2 || length > IDENTITY_NAME_LIMIT) return null;
  if (!/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}A-Za-z ]+$/u.test(name)) return null;
  const reserved = new Set(["管理員", "管理员", "官方", "澄境", "chengjing", "admin", "administrator", "system", "official"]);
  return reserved.has(name.toLocaleLowerCase()) ? null : name;
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

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function digestHex(value: string): Promise<string> {
  return Array.from(await digest(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
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
  } catch { return false; }
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

function identityToken(request: Request): string | null {
  const token = request.headers.get("x-chengjing-identity")?.trim() || "";
  return token.length >= 40 && token.length <= 220 ? token : null;
}

export async function communityIdentityFromRequest(request: Request, env: Env): Promise<VerifiedCommunityIdentity | null> {
  const token = identityToken(request);
  if (!token) return null;
  const separator = token.indexOf(".");
  const id = separator > 0 ? token.slice(0, separator) : "";
  const secret = separator > 0 ? token.slice(separator + 1) : "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || secret.length < 32) return null;
  const row = await env.COMMUNITY_DB.prepare(`
    SELECT id, display_name, token_hash, seal, status, created_at, updated_at
    FROM community_identities WHERE id = ? LIMIT 1
  `).bind(id).first<IdentityRow>();
  if (!row || row.status !== "active") return null;
  const provided = await digestHex(secret);
  if (!crypto.subtle.timingSafeEqual(await digest(provided), await digest(row.token_hash))) return null;
  return { id: row.id, displayName: row.display_name, seal: row.seal, pattern: communityIdentityPattern(row.id), status: row.status };
}

export async function resolveCommunityNames(env: Env, authorIds: string[]): Promise<Map<string, { displayName: string; seal: string; pattern: number }>> {
  const unique = [...new Set(authorIds.filter((id) => id && id !== "admin"))].slice(0, 100);
  if (!unique.length) return new Map();
  const placeholders = unique.map(() => "?").join(",");
  const result = await env.COMMUNITY_DB.prepare(`SELECT id, display_name, seal FROM community_identities WHERE status = 'active' AND id IN (${placeholders})`).bind(...unique).all<{ id: string; display_name: string; seal: string }>();
  return new Map(result.results.map((row) => [row.id, { displayName: row.display_name, seal: row.seal, pattern: communityIdentityPattern(row.id) }]));
}

async function subjectHash(request: Request, env: Env, identity?: VerifiedCommunityIdentity | null): Promise<string> {
  if (identity) return digestHex(`identity:${identity.id}`);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  return digestHex(`rate:${env.WISH_SIGNING_SECRET}:${ip}`);
}

async function consumeRateLimit(env: Env, action: string, subject: string, limit: number, windowMs: number, now: number): Promise<boolean> {
  const bucket = Math.floor(now / windowMs);
  const row = await env.COMMUNITY_DB.prepare(`
    INSERT INTO community_rate_limits(action, subject_hash, bucket, count, expires_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(action, subject_hash, bucket)
    DO UPDATE SET count = count + 1, expires_at = excluded.expires_at
    RETURNING count
  `).bind(action, subject, bucket, now + windowMs * 2).first<{ count: number }>();
  return Boolean(row && row.count <= limit);
}

function randomSampleKey(): number {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return (value[0] || 0) % 1_000_000;
}

function stableAnchor(epoch: number, pool: number): number {
  let hash = 2166136261;
  const value = `${epoch}:${pool}:chengjing-community`;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) % 1_000_000;
}

const SEAL_COLORS = ["#5f9f8c", "#6f948f", "#7e9277", "#8e8f73", "#9a856f", "#8c817d", "#718a9a", "#75809a", "#8b7f94", "#9a7f7b", "#7c9185", "#8f8a73"];

function identitySeal(id: string): string {
  let value = 0;
  for (const character of id) value = (value * 31 + character.charCodeAt(0)) >>> 0;
  return SEAL_COLORS[value % SEAL_COLORS.length] || "#718a84";
}

function publicSummary(row: NeuronSummaryRow, identity: VerifiedCommunityIdentity | null) {
  return {
    id: row.id,
    title: row.title,
    sourceType: row.source_type,
    authorName: row.display_name,
    seal: row.seal,
    authorPattern: communityIdentityPattern(row.author_id),
    intention: row.intention,
    commentCount: row.comment_count,
    createdAt: row.created_at,
    ...(row.origin_neuron_id ? { originNeuronId: row.origin_neuron_id } : {}),
    isOwn: identity?.id === row.author_id,
  };
}

function publicComment(row: CommentRow, identity: VerifiedCommunityIdentity | null = null) {
  return {
    id: row.id,
    neuronId: row.neuron_id,
    authorName: row.is_admin ? "管理員" : row.display_name,
    seal: row.is_admin ? "#5fae98" : row.seal,
    authorPattern: communityIdentityPattern(row.is_admin ? "admin" : row.author_id),
    body: row.body,
    isAuthor: row.author_id === row.neuron_author_id,
    isAdmin: row.is_admin === 1,
    isOwn: identity?.id === row.author_id,
    createdAt: row.created_at,
  };
}

async function requireIdentity(request: Request, env: Env): Promise<VerifiedCommunityIdentity | Response> {
  const identity = await communityIdentityFromRequest(request, env);
  return identity || errorResponse("identity-required", 401);
}

async function registerIdentity(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const payload = await readBoundedJson(request);
  const displayName = isRecord(payload) ? normalizeCommunityDisplayName(payload.displayName) : null;
  if (!displayName) return errorResponse("invalid-display-name", 400);
  const now = Date.now();
  const subject = await subjectHash(request, env);
  if (!await consumeRateLimit(env, "identity-register", subject, 4, 60 * 60 * 1000, now)) return errorResponse("rate-limited", 429);
  const id = crypto.randomUUID();
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const secret = base64UrlEncode(tokenBytes);
  const seal = identitySeal(id);
  await env.COMMUNITY_DB.prepare(`
    INSERT INTO community_identities(id, display_name, token_hash, seal, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).bind(id, displayName, await digestHex(secret), seal, now, now).run();
  if (Math.floor(now / PUBLIC_WRITE_WINDOW_MS) % 16 === 0) ctx.waitUntil(env.COMMUNITY_DB.prepare("DELETE FROM community_rate_limits WHERE expires_at < ?").bind(now).run().then(() => undefined));
  return json({ identity: { id, displayName, token: `${id}.${secret}`, seal, pattern: communityIdentityPattern(id) } }, 201);
}

async function getOrRenameIdentity(request: Request, env: Env): Promise<Response> {
  const identity = await requireIdentity(request, env);
  if (identity instanceof Response) return errorResponse("identity-session-invalid", 401);
  if (request.method === "PATCH") {
    const payload = await readBoundedJson(request);
    const displayName = isRecord(payload) ? normalizeCommunityDisplayName(payload.displayName) : null;
    if (!displayName) return errorResponse("invalid-display-name", 400);
    await env.COMMUNITY_DB.prepare("UPDATE community_identities SET display_name = ?, updated_at = ? WHERE id = ? AND status = 'active'").bind(displayName, Date.now(), identity.id).run();
    return json({ identity: { id: identity.id, displayName, seal: identity.seal, pattern: identity.pattern } });
  }
  return json({ identity: { id: identity.id, displayName: identity.displayName, seal: identity.seal, pattern: identity.pattern } });
}

async function discoveryRows(env: Env, epoch: number, pool: number): Promise<NeuronSummaryRow[]> {
  const anchor = stableAnchor(epoch, pool);
  const select = `
    SELECT n.id, n.author_id, n.source_type, n.title, n.intention, n.origin_neuron_id,
      n.comment_count, n.created_at, i.display_name, i.seal
    FROM shared_neurons n
    JOIN community_identities i ON i.id = n.author_id AND i.status = 'active'
    WHERE n.status = 'active' AND n.sample_key >= ?
    ORDER BY n.sample_key ASC, n.created_at DESC
    LIMIT ?
  `;
  const first = await env.COMMUNITY_DB.prepare(select).bind(anchor, DISCOVERY_CANDIDATE_LIMIT).all<NeuronSummaryRow>();
  const rows = [...first.results];
  if (rows.length < DISCOVERY_CANDIDATE_LIMIT) {
    const remaining = DISCOVERY_CANDIDATE_LIMIT - rows.length;
    const wrapped = await env.COMMUNITY_DB.prepare(select.replace("n.sample_key >= ?", "n.sample_key < ?")).bind(anchor, remaining).all<NeuronSummaryRow>();
    rows.push(...wrapped.results);
  }
  const perAuthor = new Map<string, number>();
  return rows.filter((row) => {
    const count = perAuthor.get(row.author_id) || 0;
    if (count >= 2) return false;
    perAuthor.set(row.author_id, count + 1);
    return true;
  }).slice(0, DISCOVERY_LIMIT);
}

async function discoverNeurons(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const currentEpoch = Math.floor(Date.now() / DISCOVERY_EPOCH_MS);
  const requestedEpoch = Number.parseInt(url.searchParams.get("epoch") || "", 10);
  const epoch = Number.isFinite(requestedEpoch) && Math.abs(requestedEpoch - currentEpoch) <= 1 ? requestedEpoch : currentEpoch;
  const requestedPool = Number.parseInt(url.searchParams.get("pool") || "0", 10);
  const pool = Number.isFinite(requestedPool) ? Math.max(0, Math.min(7, requestedPool)) : 0;
  const cache = caches.default;
  const cacheKey = new Request(`https://community-cache.invalid/v1/discovery/${epoch}/${pool}`);
  const identity = await communityIdentityFromRequest(request, env);
  let rows: NeuronSummaryRow[];
  const cached = await cache.match(cacheKey);
  if (cached) {
    const payload = await cached.json<{ rows: NeuronSummaryRow[] }>();
    rows = payload.rows;
  } else {
    rows = await discoveryRows(env, epoch, pool);
    const cacheResponse = json({ rows }, 200, "public, max-age=300");
    ctx.waitUntil(cache.put(cacheKey, cacheResponse));
  }
  const currentAuthors = await resolveCommunityNames(env, rows.map((row) => row.author_id));
  const currentRows = rows.flatMap((row) => {
    const author = currentAuthors.get(row.author_id);
    return author ? [{ ...row, display_name: author.displayName, seal: author.seal }] : [];
  });
  return json({ items: currentRows.map((row) => publicSummary(row, identity)), refreshAt: (epoch + 1) * DISCOVERY_EPOCH_MS }, 200, "private, max-age=60");
}

async function createNeuronRecord(env: Env, identity: VerifiedCommunityIdentity, input: { sourceType: string; title: string; body: string; intention: string; originNeuronId?: string }, now: number): Promise<NeuronRow> {
  const id = `n_${crypto.randomUUID()}`;
  await env.COMMUNITY_DB.prepare(`
    INSERT INTO shared_neurons(id, author_id, source_type, title, body, intention, origin_neuron_id, sample_key, status, comment_count, report_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, 0, ?, ?)
  `).bind(id, identity.id, input.sourceType, input.title, input.body, input.intention, input.originNeuronId || null, randomSampleKey(), now, now).run();
  return { id, author_id: identity.id, source_type: input.sourceType as NeuronRow["source_type"], title: input.title, body: input.body, intention: input.intention as SharedIntention, origin_neuron_id: input.originNeuronId || null, comment_count: 0, created_at: now, display_name: identity.displayName, seal: identity.seal };
}

async function createNeuron(request: Request, env: Env): Promise<Response> {
  const identity = await requireIdentity(request, env);
  if (identity instanceof Response) return identity;
  const payload = await readBoundedJson(request);
  if (!isRecord(payload)) return errorResponse("invalid-payload", 400);
  const sourceType = typeof payload.sourceType === "string" && ["card", "board", "fragment", "task"].includes(payload.sourceType) ? payload.sourceType : null;
  const title = normalizeTitle(payload.title);
  const body = normalizeBody(payload.body, NEURON_BODY_LIMIT);
  const intention = typeof payload.intention === "string" && ["share", "perspective", "help"].includes(payload.intention) ? payload.intention : null;
  if (!sourceType || !title || !body || !intention) return errorResponse("invalid-payload", 400);
  const now = Date.now();
  if (!await consumeRateLimit(env, "neuron-share", await subjectHash(request, env, identity), PUBLIC_WRITE_LIMIT, PUBLIC_WRITE_WINDOW_MS, now)) return errorResponse("rate-limited", 429);
  const row = await createNeuronRecord(env, identity, { sourceType, title, body, intention }, now);
  return json({ item: { ...publicSummary(row, identity), body: row.body, comments: [], commentCursor: null } }, 201);
}

async function neuronRow(env: Env, id: string): Promise<NeuronRow | null> {
  return env.COMMUNITY_DB.prepare(`
    SELECT n.id, n.author_id, n.source_type, n.title, n.body, n.intention, n.origin_neuron_id,
      n.comment_count, n.created_at, i.display_name, i.seal
    FROM shared_neurons n JOIN community_identities i ON i.id = n.author_id
    WHERE n.id = ? AND n.status = 'active' AND i.status = 'active' LIMIT 1
  `).bind(id).first<NeuronRow>();
}

function encodeCommentCursor(createdAt: number, id: string): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify({ createdAt, id })));
}

function decodeCommentCursor(value: string | null): { createdAt: number; id: string } | null {
  if (!value || value.length > 500) return null;
  try {
    const item: unknown = JSON.parse(new TextDecoder().decode(base64UrlDecode(value)));
    return isRecord(item) && typeof item.createdAt === "number" && typeof item.id === "string" ? { createdAt: item.createdAt, id: item.id } : null;
  } catch { return null; }
}

async function commentRows(env: Env, neuronId: string, cursor: { createdAt: number; id: string } | null, limit = 20): Promise<{ rows: CommentRow[]; nextCursor: string | null }> {
  const cursorSql = cursor ? "AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?))" : "";
  const result = await env.COMMUNITY_DB.prepare(`
    SELECT c.id, c.neuron_id, c.author_id, c.body, c.is_admin, c.created_at,
      i.display_name, i.seal, n.author_id AS neuron_author_id
    FROM neuron_comments c
    JOIN shared_neurons n ON n.id = c.neuron_id AND n.status = 'active'
    JOIN community_identities i ON i.id = c.author_id
    WHERE c.neuron_id = ? AND c.status = 'active' ${cursorSql}
    ORDER BY c.created_at DESC, c.id DESC LIMIT ?
  `).bind(neuronId, ...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []), limit + 1).all<CommentRow>();
  const hasMore = result.results.length > limit;
  const visible = result.results.slice(0, limit);
  const last = visible.at(-1);
  return { rows: visible.reverse(), nextCursor: hasMore && last ? encodeCommentCursor(last.created_at, last.id) : null };
}

async function getNeuron(request: Request, env: Env, id: string): Promise<Response> {
  const row = await neuronRow(env, id);
  if (!row) return errorResponse("neuron-not-found", 404);
  const identity = await communityIdentityFromRequest(request, env);
  const comments = await commentRows(env, id, null);
  return json({ item: { ...publicSummary(row, identity), body: row.body, comments: comments.rows.map((comment) => publicComment(comment, identity)), commentCursor: comments.nextCursor } });
}

async function forkNeuron(request: Request, env: Env, id: string): Promise<Response> {
  const identity = await requireIdentity(request, env);
  if (identity instanceof Response) return identity;
  const source = await neuronRow(env, id);
  if (!source) return errorResponse("neuron-not-found", 404);
  const now = Date.now();
  if (!await consumeRateLimit(env, "neuron-fork", await subjectHash(request, env, identity), PUBLIC_WRITE_LIMIT, PUBLIC_WRITE_WINDOW_MS, now)) return errorResponse("rate-limited", 429);
  const row = await createNeuronRecord(env, identity, { sourceType: source.source_type, title: source.title, body: source.body, intention: "share", originNeuronId: source.id }, now);
  return json({ item: { ...publicSummary(row, identity), body: row.body, comments: [], commentCursor: null } }, 201);
}

async function deleteNeuron(request: Request, env: Env, id: string): Promise<Response> {
  const [identity, admin] = await Promise.all([communityIdentityFromRequest(request, env), verifyAdminToken(env.WISH_SIGNING_SECRET, bearerToken(request), Date.now())]);
  const row = await neuronRow(env, id);
  if (!row) return errorResponse("neuron-not-found", 404);
  if (!admin && identity?.id !== row.author_id) return errorResponse(identity ? "not-owner" : "identity-required", identity ? 403 : 401);
  const now = Date.now();
  await env.COMMUNITY_DB.batch([
    env.COMMUNITY_DB.prepare("UPDATE shared_neurons SET status = 'deleted', updated_at = ? WHERE id = ?").bind(now, id),
    env.COMMUNITY_DB.prepare("UPDATE neuron_comments SET status = 'deleted' WHERE neuron_id = ?").bind(id),
    env.COMMUNITY_DB.prepare("UPDATE community_reports SET status = 'resolved', resolved_at = ? WHERE target_type = 'neuron' AND target_id = ? AND status = 'pending'").bind(now, id),
  ]);
  return json({ deleted: true });
}

async function updateNeuron(request: Request, env: Env, id: string): Promise<Response> {
  const identity = await requireIdentity(request, env);
  if (identity instanceof Response) return identity;
  const row = await neuronRow(env, id);
  if (!row) return errorResponse("neuron-not-found", 404);
  if (row.author_id !== identity.id) return errorResponse("not-owner", 403);
  const payload = await readBoundedJson(request);
  if (!isRecord(payload)) return errorResponse("invalid-payload", 400);
  const title = normalizeTitle(payload.title);
  const body = normalizeBody(payload.body, NEURON_BODY_LIMIT);
  if (!title || !body) return errorResponse("invalid-payload", 400);
  const now = Date.now();
  if (!await consumeRateLimit(env, "neuron-update", await subjectHash(request, env, identity), 30, PUBLIC_WRITE_WINDOW_MS, now)) return errorResponse("rate-limited", 429);
  await env.COMMUNITY_DB.prepare("UPDATE shared_neurons SET title = ?, body = ?, updated_at = ? WHERE id = ? AND author_id = ? AND status = 'active'").bind(title, body, now, id, identity.id).run();
  return json({ updated: true });
}

async function createComment(request: Request, env: Env, neuronId: string): Promise<Response> {
  const now = Date.now();
  const admin = await verifyAdminToken(env.WISH_SIGNING_SECRET, bearerToken(request), now);
  const identity = admin ? { id: "admin", displayName: "管理員", seal: "#5fae98", pattern: communityIdentityPattern("admin"), status: "active" as const } : await communityIdentityFromRequest(request, env);
  if (!identity) return errorResponse("identity-required", 401);
  const neuron = await neuronRow(env, neuronId);
  if (!neuron) return errorResponse("neuron-not-found", 404);
  const payload = await readBoundedJson(request);
  const body = isRecord(payload) ? normalizeBody(payload.body, COMMENT_BODY_LIMIT) : null;
  if (!body) return errorResponse("invalid-payload", 400);
  if (!admin && !await consumeRateLimit(env, "neuron-comment", await subjectHash(request, env, identity), PUBLIC_WRITE_LIMIT, PUBLIC_WRITE_WINDOW_MS, now)) return errorResponse("rate-limited", 429);
  const id = `c_${crypto.randomUUID()}`;
  await env.COMMUNITY_DB.batch([
    env.COMMUNITY_DB.prepare("INSERT INTO neuron_comments(id, neuron_id, author_id, body, is_admin, status, report_count, created_at) VALUES (?, ?, ?, ?, ?, 'active', 0, ?)").bind(id, neuronId, identity.id, body, admin ? 1 : 0, now),
    env.COMMUNITY_DB.prepare("UPDATE shared_neurons SET comment_count = comment_count + 1, updated_at = ? WHERE id = ?").bind(now, neuronId),
  ]);
  const row: CommentRow = { id, neuron_id: neuronId, author_id: identity.id, body, is_admin: admin ? 1 : 0, created_at: now, display_name: identity.displayName, seal: identity.seal, neuron_author_id: neuron.author_id };
  return json({ item: publicComment(row, identity) }, 201);
}

async function listComments(request: Request, env: Env, neuronId: string): Promise<Response> {
  if (!await neuronRow(env, neuronId)) return errorResponse("neuron-not-found", 404);
  const cursorValue = new URL(request.url).searchParams.get("cursor");
  const cursor = decodeCommentCursor(cursorValue);
  if (cursorValue && !cursor) return errorResponse("invalid-cursor", 400);
  const result = await commentRows(env, neuronId, cursor);
  const identity = await communityIdentityFromRequest(request, env);
  return json({ items: result.rows.map((comment) => publicComment(comment, identity)), nextCursor: result.nextCursor });
}

async function deleteSharedComment(request: Request, env: Env, id: string): Promise<Response> {
  const now = Date.now();
  const [identity, admin] = await Promise.all([communityIdentityFromRequest(request, env), verifyAdminToken(env.WISH_SIGNING_SECRET, bearerToken(request), now)]);
  const row = await env.COMMUNITY_DB.prepare("SELECT id, neuron_id, author_id FROM neuron_comments WHERE id = ? AND status = 'active' LIMIT 1").bind(id).first<{ id: string; neuron_id: string; author_id: string }>();
  if (!row) return errorResponse("comment-not-found", 404);
  if (!admin && identity?.id !== row.author_id) return errorResponse(identity ? "not-owner" : "identity-required", identity ? 403 : 401);
  await env.COMMUNITY_DB.batch([
    env.COMMUNITY_DB.prepare("UPDATE neuron_comments SET status = 'deleted' WHERE id = ?").bind(id),
    env.COMMUNITY_DB.prepare("UPDATE shared_neurons SET comment_count = MAX(0, comment_count - 1), updated_at = ? WHERE id = ?").bind(now, row.neuron_id),
    env.COMMUNITY_DB.prepare("UPDATE community_reports SET status = 'resolved', resolved_at = ? WHERE target_type = 'comment' AND target_id = ? AND status = 'pending'").bind(now, id),
  ]);
  return json({ deleted: true });
}

async function createReport(request: Request, env: Env): Promise<Response> {
  const identity = await requireIdentity(request, env);
  if (identity instanceof Response) return identity;
  const payload = await readBoundedJson(request);
  if (!isRecord(payload)) return errorResponse("invalid-payload", 400);
  const targetType = payload.targetType === "neuron" || payload.targetType === "comment" ? payload.targetType : null;
  const targetId = typeof payload.targetId === "string" && payload.targetId.length <= 80 ? payload.targetId : null;
  const reason = typeof payload.reason === "string" && ["harmful", "privacy", "spam", "other"].includes(payload.reason) ? payload.reason as CommunityReportReason : null;
  const detail = payload.detail === undefined || payload.detail === "" ? "" : normalizeBody(payload.detail, REPORT_DETAIL_LIMIT);
  if (!targetType || !targetId || !reason || detail === null) return errorResponse("invalid-payload", 400);
  const target = targetType === "neuron"
    ? await env.COMMUNITY_DB.prepare("SELECT author_id FROM shared_neurons WHERE id = ? AND status = 'active'").bind(targetId).first<{ author_id: string }>()
    : await env.COMMUNITY_DB.prepare("SELECT author_id FROM neuron_comments WHERE id = ? AND status = 'active'").bind(targetId).first<{ author_id: string }>();
  if (!target) return errorResponse("target-not-found", 404);
  if (target.author_id === identity.id) return errorResponse("cannot-report-own", 400);
  const now = Date.now();
  if (!await consumeRateLimit(env, "community-report", await subjectHash(request, env, identity), 6, 60 * 60 * 1000, now)) return errorResponse("rate-limited", 429);
  try {
    const id = `p_${crypto.randomUUID()}`;
    await env.COMMUNITY_DB.batch([
      env.COMMUNITY_DB.prepare("INSERT INTO community_reports(id, reporter_id, target_type, target_id, reason, detail, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)").bind(id, identity.id, targetType, targetId, reason, detail, now),
      targetType === "neuron"
        ? env.COMMUNITY_DB.prepare("UPDATE shared_neurons SET report_count = report_count + 1 WHERE id = ?").bind(targetId)
        : env.COMMUNITY_DB.prepare("UPDATE neuron_comments SET report_count = report_count + 1 WHERE id = ?").bind(targetId),
    ]);
    return json({ reported: true }, 201);
  } catch (error) {
    if (String(error).includes("UNIQUE")) return errorResponse("already-reported", 409);
    throw error;
  }
}

async function listAdminReports(request: Request, env: Env): Promise<Response> {
  if (!await verifyAdminToken(env.WISH_SIGNING_SECRET, bearerToken(request), Date.now())) return errorResponse("admin-session-expired", 401);
  const result = await env.COMMUNITY_DB.prepare(`
    SELECT r.id, r.target_type, r.target_id, r.reason, r.detail, r.created_at,
      reporter.display_name AS reporter_name,
      CASE WHEN r.target_type = 'neuron' THEN COALESCE(n.title, '已刪除的神經元') ELSE COALESCE(parent.title, '已刪除的回聲') END AS target_title,
      CASE WHEN r.target_type = 'neuron' THEN COALESCE(SUBSTR(n.body, 1, 240), '') ELSE COALESCE(SUBSTR(c.body, 1, 240), '') END AS target_excerpt
    FROM community_reports r
    JOIN community_identities reporter ON reporter.id = r.reporter_id
    LEFT JOIN shared_neurons n ON r.target_type = 'neuron' AND n.id = r.target_id
    LEFT JOIN neuron_comments c ON r.target_type = 'comment' AND c.id = r.target_id
    LEFT JOIN shared_neurons parent ON parent.id = c.neuron_id
    WHERE r.status = 'pending'
    ORDER BY r.created_at DESC LIMIT 80
  `).all<{ id: string; target_type: "neuron" | "comment"; target_id: string; reason: CommunityReportReason; detail: string; created_at: number; reporter_name: string; target_title: string; target_excerpt: string }>();
  return json({ items: result.results.map((row) => ({ id: row.id, targetType: row.target_type, targetId: row.target_id, reason: row.reason, detail: row.detail, reporterName: row.reporter_name, createdAt: row.created_at, targetTitle: row.target_title, targetExcerpt: row.target_excerpt })) });
}

async function dismissAdminReport(request: Request, env: Env, id: string): Promise<Response> {
  if (!await verifyAdminToken(env.WISH_SIGNING_SECRET, bearerToken(request), Date.now())) return errorResponse("admin-session-expired", 401);
  const result = await env.COMMUNITY_DB.prepare("UPDATE community_reports SET status = 'resolved', resolved_at = ? WHERE id = ? AND status = 'pending'").bind(Date.now(), id).run();
  return result.meta.changes > 0 ? json({ resolved: true }) : errorResponse("report-not-found", 404);
}

async function notifications(request: Request, env: Env): Promise<Response> {
  const identity = await requireIdentity(request, env);
  if (identity instanceof Response) return identity;
  const url = new URL(request.url);
  const requestedSince = Number.parseInt(url.searchParams.get("since") || "0", 10);
  const since = Number.isFinite(requestedSince) ? Math.max(0, Math.min(Date.now(), requestedSince)) : 0;
  const result = await env.COMMUNITY_DB.prepare(`
    SELECT c.id, c.neuron_id, c.author_id, c.body, c.created_at, c.is_admin,
      n.title AS neuron_title, i.display_name, i.seal
    FROM neuron_comments c
    JOIN shared_neurons n ON n.id = c.neuron_id AND n.status = 'active'
    JOIN community_identities i ON i.id = c.author_id
    WHERE n.author_id = ? AND c.author_id != ? AND c.status = 'active' AND c.created_at > ?
    ORDER BY c.created_at DESC LIMIT 30
  `).bind(identity.id, identity.id, since).all<{ id: string; neuron_id: string; author_id: string; body: string; created_at: number; is_admin: number; neuron_title: string; display_name: string; seal: string }>();
  return json({ items: result.results.map((row) => ({ id: row.id, neuronId: row.neuron_id, neuronTitle: row.neuron_title, authorName: row.is_admin ? "管理員" : row.display_name, seal: row.is_admin ? "#5fae98" : row.seal, authorPattern: communityIdentityPattern(row.is_admin ? "admin" : row.author_id), body: row.body, isAdmin: row.is_admin === 1, createdAt: row.created_at })) });
}

export async function communityRoute(request: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/v1/community/identity" && request.method === "POST") return registerIdentity(request, env, ctx);
  if (url.pathname === "/v1/community/identity" && (request.method === "GET" || request.method === "PATCH")) return getOrRenameIdentity(request, env);
  if (url.pathname === "/v1/community/neurons/discover" && request.method === "GET") return discoverNeurons(request, env, ctx);
  if (url.pathname === "/v1/community/neurons" && request.method === "POST") return createNeuron(request, env);
  if (url.pathname === "/v1/community/reports" && request.method === "POST") return createReport(request, env);
  if (url.pathname === "/v1/community/notifications" && request.method === "GET") return notifications(request, env);
  if (url.pathname === "/v1/admin/community/reports" && request.method === "GET") return listAdminReports(request, env);

  const neuron = url.pathname.match(/^\/v1\/community\/neurons\/([^/]+)$/);
  if (neuron?.[1] && request.method === "GET") return getNeuron(request, env, decodeURIComponent(neuron[1]));
  if (neuron?.[1] && request.method === "PATCH") return updateNeuron(request, env, decodeURIComponent(neuron[1]));
  if (neuron?.[1] && request.method === "DELETE") return deleteNeuron(request, env, decodeURIComponent(neuron[1]));
  const fork = url.pathname.match(/^\/v1\/community\/neurons\/([^/]+)\/fork$/);
  if (fork?.[1] && request.method === "POST") return forkNeuron(request, env, decodeURIComponent(fork[1]));
  const comments = url.pathname.match(/^\/v1\/community\/neurons\/([^/]+)\/comments$/);
  if (comments?.[1] && request.method === "GET") return listComments(request, env, decodeURIComponent(comments[1]));
  if (comments?.[1] && request.method === "POST") return createComment(request, env, decodeURIComponent(comments[1]));
  const comment = url.pathname.match(/^\/v1\/community\/comments\/([^/]+)$/);
  if (comment?.[1] && request.method === "DELETE") return deleteSharedComment(request, env, decodeURIComponent(comment[1]));
  const report = url.pathname.match(/^\/v1\/admin\/community\/reports\/([^/]+)$/);
  if (report?.[1] && request.method === "PATCH") return dismissAdminReport(request, env, decodeURIComponent(report[1]));
  return null;
}
