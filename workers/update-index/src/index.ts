type JsonRecord = Record<string, unknown>;

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
  digest: string | null;
}

export interface ReleaseIndex {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
  draft: false;
  prerelease: false;
  assets: ReleaseAsset[];
  source: "github-api" | "github-feed";
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : 0;
}

function decodeEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function releaseNotesFromHtml(value: string) {
  return decodeEntities(value)
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/(?:li|p|ul|ol|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 12_000);
}

function stableVersionFromTag(tag: string) {
  const match = tag.trim().match(/^v?(\d+\.\d+\.\d+)$/);
  return match?.[1] || "";
}

export function compareReleaseIndexes(left: Pick<ReleaseIndex, "tag_name"> | null, right: Pick<ReleaseIndex, "tag_name"> | null) {
  const leftVersion = stableVersionFromTag(left?.tag_name || "").split(".").map(Number);
  const rightVersion = stableVersionFromTag(right?.tag_name || "").split(".").map(Number);
  if (leftVersion.length !== 3 || rightVersion.length !== 3) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (leftVersion[index] !== rightVersion[index]) return leftVersion[index] > rightVersion[index] ? 1 : -1;
  }
  return 0;
}

export function cacheGenerationForRelease(release: ReleaseIndex | null) {
  const version = stableVersionFromTag(release?.tag_name || "") || "bootstrap";
  const assets = release?.assets.map((asset) => `${asset.name}:${asset.digest || ""}:${asset.size}`).sort() || [];
  const signature = JSON.stringify([release?.tag_name || "", release?.body || "", assets]);
  let hash = 2_166_136_261;
  for (let index = 0; index < signature.length; index += 1) hash = Math.imul(hash ^ signature.charCodeAt(index), 16_777_619);
  return `${version}-${(hash >>> 0).toString(36)}`;
}

async function releaseFromCachedResponse(response: Response | undefined) {
  if (!response) return null;
  try { return normalizeApiRelease(await response.clone().json()); }
  catch { return null; }
}

export function normalizeApiRelease(payload: unknown): ReleaseIndex | null {
  if (!isRecord(payload) || payload.draft === true || payload.prerelease === true) return null;
  const tag = stringValue(payload.tag_name);
  const version = stableVersionFromTag(tag);
  if (!version) return null;
  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  const normalizedAssets = assets.flatMap((candidate): ReleaseAsset[] => {
    if (!isRecord(candidate)) return [];
    const name = stringValue(candidate.name);
    const url = stringValue(candidate.browser_download_url);
    if (!/\.(?:dmg|exe)$/i.test(name) || !url.startsWith("https://github.com/")) return [];
    const digest = stringValue(candidate.digest);
    return [{ name, browser_download_url: url, size: numberValue(candidate.size), digest: /^sha256:[a-f0-9]{64}$/i.test(digest) ? digest.toLowerCase() : null }];
  });
  return {
    tag_name: `v${version}`,
    name: stringValue(payload.name) || `澄境筆記 ${version}`,
    body: stringValue(payload.body).slice(0, 12_000),
    published_at: stringValue(payload.published_at),
    html_url: stringValue(payload.html_url),
    draft: false,
    prerelease: false,
    assets: normalizedAssets,
    source: "github-api",
  };
}

export function parseReleaseFeed(feed: string, owner: string, repository: string): Omit<ReleaseIndex, "assets"> & { version: string } | null {
  const entries = feed.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  for (const entry of entries) {
    const link = entry.match(/<link\s+rel="alternate"\s+type="text\/html"\s+href="([^"]+)"\s*\/>/i)?.[1] || "";
    const tag = decodeEntities(link).match(/\/releases\/tag\/([^/?#]+)/)?.[1] || "";
    const version = stableVersionFromTag(tag);
    if (!version) continue;
    const title = decodeEntities(entry.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
    const updated = decodeEntities(entry.match(/<updated>([\s\S]*?)<\/updated>/i)?.[1] || "").trim();
    const content = entry.match(/<content\s+type="html">([\s\S]*?)<\/content>/i)?.[1] || "";
    return {
      tag_name: `v${version}`,
      version,
      name: title || `澄境筆記 ${version}`,
      body: releaseNotesFromHtml(content),
      published_at: updated,
      html_url: `https://github.com/${owner}/${repository}/releases/tag/v${version}`,
      draft: false,
      prerelease: false,
      source: "github-feed",
    };
  }
  return null;
}

async function githubFetch(url: string, accept: string) {
  return fetch(url, {
    headers: {
      Accept: accept,
      "User-Agent": "ChengJing-Update-Index/1.0",
      "X-GitHub-Api-Version": "2026-03-10",
    },
    redirect: "follow",
  });
}

async function fetchFromApi(env: Env) {
  const response = await githubFetch(`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPOSITORY}/releases/latest`, "application/vnd.github+json");
  if (!response.ok) throw new Error(`github-api-${response.status}`);
  const release = normalizeApiRelease(await response.json());
  if (!release || release.assets.length === 0) throw new Error("github-api-invalid-release");
  return release;
}

async function fetchAssetSize(assetUrl: string) {
  const response = await fetch(assetUrl, { method: "HEAD", headers: { "User-Agent": "ChengJing-Update-Index/1.0" }, redirect: "follow" });
  return response.ok ? numberValue(response.headers.get("content-length")) : 0;
}

async function fetchFromFeed(env: Env): Promise<ReleaseIndex> {
  const response = await githubFetch(`https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPOSITORY}/releases.atom`, "application/atom+xml");
  if (!response.ok) throw new Error(`github-feed-${response.status}`);
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 1_000_000) throw new Error("github-feed-too-large");
  const parsed = parseReleaseFeed(await response.text(), env.GITHUB_OWNER, env.GITHUB_REPOSITORY);
  if (!parsed) throw new Error("github-feed-invalid");
  const assetNames = [
    `ChengJing-${parsed.version}-arm64.dmg`,
    `ChengJing-${parsed.version}-arm64-Installer.exe`,
    `ChengJing-${parsed.version}-x64-Installer.exe`,
  ];
  const assets = await Promise.all(assetNames.map(async (name) => {
    const browser_download_url = `https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPOSITORY}/releases/download/v${parsed.version}/${name}`;
    return { name, browser_download_url, size: await fetchAssetSize(browser_download_url), digest: null };
  }));
  const { version: _version, ...release } = parsed;
  return { ...release, assets };
}

async function fetchLatest(env: Env) {
  try {
    return await fetchFromApi(env);
  } catch (apiError) {
    console.error(JSON.stringify({ message: "GitHub API unavailable; using release feed", error: apiError instanceof Error ? apiError.message : String(apiError) }));
    return fetchFromFeed(env);
  }
}

function positiveSeconds(value: string, fallback: number) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function jsonResponse(data: unknown, cacheSeconds: number) {
  return Response.json(data, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": `public, max-age=300, s-maxage=${cacheSeconds}`,
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function withHeader(response: Response, name: string, value: string, headOnly = false) {
  const headers = new Headers(response.headers);
  headers.set(name, value);
  return new Response(headOnly ? null : response.body, { status: response.status, statusText: response.statusText, headers });
}

async function persistLastKnownGood(env: Env, release: ReleaseIndex, expirationTtl: number) {
  const previous = await env.RELEASE_STATE.get("latest-release", { type: "json" });
  const normalized = normalizeApiRelease(previous);
  const previousAssets = normalized?.assets.map((asset) => `${asset.name}:${asset.digest || ""}:${asset.size}`).sort().join("|") || "";
  const releaseAssets = release.assets.map((asset) => `${asset.name}:${asset.digest || ""}:${asset.size}`).sort().join("|");
  const lastRenewedAt = isRecord(previous) ? numberValue(previous.kv_saved_at) : 0;
  const needsRenewal = Date.now() - lastRenewedAt >= 7 * 86_400_000;
  if (normalized?.tag_name === release.tag_name && previousAssets === releaseAssets && !needsRenewal) return;
  await env.RELEASE_STATE.put("latest-release", JSON.stringify({ ...release, kv_saved_at: Date.now() }), { expirationTtl });
}

async function readLastKnownGood(env: Env) {
  const stored = await env.RELEASE_STATE.get("latest-release", { type: "json" });
  return normalizeApiRelease(stored);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const headOnly = request.method === "HEAD";
    if (request.method !== "GET" && !headOnly) return Response.json({ error: "method-not-allowed" }, { status: 405, headers: { Allow: "GET, HEAD" } });
    if (url.pathname === "/health") return Response.json({ ok: true, service: "chengjing-update-index" }, { headers: { "Cache-Control": "no-store" } });
    if (url.pathname !== "/v1/latest") return Response.json({ error: "not-found" }, { status: 404 });

    const cacheSeconds = positiveSeconds(env.CACHE_SECONDS, 900);
    const staleSeconds = positiveSeconds(env.STALE_SECONDS, 86_400);
    const kvStaleSeconds = positiveSeconds(env.KV_STALE_SECONDS, 2_592_000);
    const lastKnownGood = await readLastKnownGood(env).catch((error) => {
      console.error(JSON.stringify({ message: "Update index KV read failed", error: error instanceof Error ? error.message : String(error) }));
      return null;
    });
    const cacheGeneration = cacheGenerationForRelease(lastKnownGood);
    const freshKey = new Request(`${url.origin}/v1/latest?generation=${encodeURIComponent(cacheGeneration)}`, { method: "GET" });
    const staleKey = new Request(`${url.origin}/v1/latest?generation=${encodeURIComponent(cacheGeneration)}&stale=1`, { method: "GET" });
    const cache = caches.default;
    const cached = await cache.match(freshKey);
    if (cached) {
      const cachedRelease = await releaseFromCachedResponse(cached);
      if (lastKnownGood && (!cachedRelease || compareReleaseIndexes(lastKnownGood, cachedRelease) > 0)) {
        const response = jsonResponse(lastKnownGood, cacheSeconds);
        ctx.waitUntil(Promise.all([
          cache.put(freshKey, response.clone()),
          cache.put(staleKey, jsonResponse(lastKnownGood, staleSeconds)),
        ]).catch((error) => {
          console.error(JSON.stringify({ message: "Newer KV release cache repair failed", error: error instanceof Error ? error.message : String(error) }));
        }));
        return withHeader(response, "X-ChengJing-Cache", "KV-NEWER", headOnly);
      }
      return withHeader(cached, "X-ChengJing-Cache", "HIT", headOnly);
    }

    try {
      const release = await fetchLatest(env);
      const response = jsonResponse(release, cacheSeconds);
      const staleResponse = jsonResponse(release, staleSeconds);
      ctx.waitUntil(Promise.all([cache.put(freshKey, response.clone()), cache.put(staleKey, staleResponse), persistLastKnownGood(env, release, kvStaleSeconds)]).catch((error) => {
        console.error(JSON.stringify({ message: "Update index cache write failed", error: error instanceof Error ? error.message : String(error) }));
      }));
      return withHeader(response, "X-ChengJing-Cache", "MISS", headOnly);
    } catch (error) {
      const stale = await cache.match(staleKey);
      const staleRelease = await releaseFromCachedResponse(stale);
      if (lastKnownGood && (!staleRelease || compareReleaseIndexes(lastKnownGood, staleRelease) > 0)) {
        const response = jsonResponse(lastKnownGood, cacheSeconds);
        ctx.waitUntil(Promise.all([
          cache.put(freshKey, response.clone()),
          cache.put(staleKey, jsonResponse(lastKnownGood, staleSeconds)),
        ]).catch((cacheError) => {
          console.error(JSON.stringify({ message: "Stale cache upgraded from KV failed", error: cacheError instanceof Error ? cacheError.message : String(cacheError) }));
        }));
        return withHeader(response, "X-ChengJing-Cache", "KV-NEWER", headOnly);
      }
      if (stale) return withHeader(stale, "X-ChengJing-Cache", "STALE", headOnly);
      if (lastKnownGood) return withHeader(jsonResponse(lastKnownGood, 300), "X-ChengJing-Cache", "KV-STALE", headOnly);
      console.error(JSON.stringify({ message: "Update index unavailable", error: error instanceof Error ? error.message : String(error), path: url.pathname }));
      return Response.json({ error: "update-index-unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }
  },
} satisfies ExportedHandler<Env>;
