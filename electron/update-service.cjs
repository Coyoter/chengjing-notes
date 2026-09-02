function parseVersion(value) {
  const normalized = String(value || "").trim().replace(/^v/i, "");
  const match = normalized.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return {
    raw: normalized,
    numbers: [Number(match[1] || 0), Number(match[2] || 0), Number(match[3] || 0)],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] > b.numbers[index] ? 1 : -1;
  }
  if (!a.prerelease.length && b.prerelease.length) return 1;
  if (a.prerelease.length && !b.prerelease.length) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const aPart = a.prerelease[index];
    const bPart = b.prerelease[index];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    if (aPart === bPart) continue;
    const aNumber = /^\d+$/.test(aPart) ? Number(aPart) : null;
    const bNumber = /^\d+$/.test(bPart) ? Number(bPart) : null;
    if (aNumber !== null && bNumber !== null) return aNumber > bNumber ? 1 : -1;
    if (aNumber !== null) return -1;
    if (bNumber !== null) return 1;
    return aPart.localeCompare(bPart) > 0 ? 1 : -1;
  }
  return 0;
}

function isUpdateCandidateStale(update, currentVersion) {
  return Boolean(update?.latestVersion) && compareVersions(update.latestVersion, currentVersion) < 0;
}

function selectReleaseAsset(assets, platform = "darwin", arch = "arm64") {
  const extension = platform === "win32" ? ".exe" : ".dmg";
  const matchingAssets = (Array.isArray(assets) ? assets : []).filter((asset) => String(asset?.name || "").toLowerCase().endsWith(extension) && /^https:\/\//i.test(String(asset?.browser_download_url || "")));
  const aliases = arch === "arm64" ? ["arm64", "aarch64", "apple-silicon"] : arch === "x64" ? ["x64", "x86_64", "intel"] : [arch];
  const universalWindows = platform === "win32" ? matchingAssets.find((asset) => /windows.*setup|setup.*windows|universal/i.test(String(asset.name))) : null;
  return universalWindows || matchingAssets.find((asset) => aliases.some((alias) => String(asset.name).toLowerCase().includes(alias))) || (matchingAssets.length === 1 ? matchingAssets[0] : null);
}

function selectDmgAsset(assets, arch = "arm64") {
  return selectReleaseAsset(assets, "darwin", arch);
}

function releaseAssetName(version, platform = "darwin", arch = "arm64") {
  const archLabel = arch === "x64" ? "x64" : arch === "arm64" ? "arm64" : arch;
  return platform === "win32"
    ? `ChengJing-${version}-${archLabel}-Installer.exe`
    : `ChengJing-${version}-${archLabel}.dmg`;
}

function parseLatestRelease(payload, currentVersion, arch = "arm64", platform = "darwin") {
  if (!payload || payload.draft) throw new Error("invalid-release");
  const latestVersion = String(payload.tag_name || payload.name || "").trim().replace(/^v/i, "");
  if (!parseVersion(latestVersion)) throw new Error("invalid-version");
  const asset = selectReleaseAsset(payload.assets, platform, arch);
  return {
    status: compareVersions(latestVersion, currentVersion) > 0 ? "available" : "current",
    currentVersion: String(currentVersion),
    latestVersion,
    releaseName: String(payload.name || `v${latestVersion}`),
    notes: String(payload.body || "").trim().slice(0, 12_000),
    publishedAt: String(payload.published_at || ""),
    htmlUrl: String(payload.html_url || ""),
    asset: asset ? {
      name: String(asset.name),
      url: String(asset.browser_download_url),
      size: Number(asset.size || 0),
      digest: typeof asset.digest === "string" ? asset.digest : null,
    } : null,
  };
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function releaseNotesFromFeed(value) {
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

function parseLatestReleaseFeed(feed, currentVersion, arch = "arm64", platform = "darwin", owner = "Coyoter", repository = "chengjing-notes") {
  const entries = String(feed || "").match(/<entry>[\s\S]*?<\/entry>/g) || [];
  for (const entry of entries) {
    const rawLink = entry.match(/<link\s+rel="alternate"\s+type="text\/html"\s+href="([^"]+)"\s*\/>/i)?.[1] || "";
    const htmlUrl = decodeEntities(rawLink);
    const tag = htmlUrl.match(/\/releases\/tag\/([^/?#]+)/)?.[1] || "";
    const latestVersion = tag.replace(/^v/i, "");
    const parsed = parseVersion(latestVersion);
    if (!parsed || parsed.prerelease.length) continue;
    const releaseName = decodeEntities(entry.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "").trim() || `澄境筆記 ${latestVersion}`;
    const publishedAt = decodeEntities(entry.match(/<updated>([\s\S]*?)<\/updated>/i)?.[1] || "").trim();
    const content = entry.match(/<content\s+type="html">([\s\S]*?)<\/content>/i)?.[1] || "";
    const assetName = releaseAssetName(latestVersion, platform, arch);
    return {
      status: compareVersions(latestVersion, currentVersion) > 0 ? "available" : "current",
      currentVersion: String(currentVersion),
      latestVersion,
      releaseName,
      notes: releaseNotesFromFeed(content),
      publishedAt,
      htmlUrl: htmlUrl || `https://github.com/${owner}/${repository}/releases/tag/v${latestVersion}`,
      asset: {
        name: assetName,
        url: `https://github.com/${owner}/${repository}/releases/download/v${latestVersion}/${assetName}`,
        size: 0,
        digest: null,
      },
    };
  }
  throw new Error("invalid-release-feed");
}

module.exports = { compareVersions, isUpdateCandidateStale, parseLatestRelease, parseLatestReleaseFeed, parseVersion, releaseAssetName, selectDmgAsset, selectReleaseAsset };
