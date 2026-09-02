import assert from "node:assert/strict";
import test from "node:test";
import { cacheGenerationForRelease, compareReleaseIndexes, normalizeApiRelease, parseReleaseFeed } from "./index.ts";

test("只輸出正式 Release 與可信的 macOS／Windows 安裝檔", () => {
  const release = normalizeApiRelease({
    tag_name: "v0.2.10",
    name: "澄境筆記 0.2.10",
    body: "修正更新。",
    published_at: "2026-08-26T00:00:00Z",
    html_url: "https://github.com/Coyoter/chengjing-notes/releases/tag/v0.2.10",
    draft: false,
    prerelease: false,
    assets: [
      { name: "ChengJing-0.2.10-arm64.dmg", browser_download_url: "https://github.com/Coyoter/chengjing-notes/releases/download/v0.2.10/ChengJing-0.2.10-arm64.dmg", size: 123, digest: `sha256:${"a".repeat(64)}` },
      { name: "ChengJing-0.2.10-arm64-Installer.exe", browser_download_url: "https://github.com/Coyoter/chengjing-notes/releases/download/v0.2.10/ChengJing-0.2.10-arm64-Installer.exe", size: 456, digest: `sha256:${"b".repeat(64)}` },
      { name: "wrong.dmg", browser_download_url: "https://evil.example/wrong.dmg", size: 1 },
    ],
  });
  assert.equal(release?.tag_name, "v0.2.10");
  assert.equal(release?.assets.length, 2);
  assert.equal(release?.assets[0].digest, `sha256:${"a".repeat(64)}`);
  assert.equal(release?.assets[1].name, "ChengJing-0.2.10-arm64-Installer.exe");
  assert.equal(normalizeApiRelease({ tag_name: "v0.2.10-beta.1", prerelease: true }), null);
});

test("GitHub Atom Feed 可轉成一致的最新版本索引", () => {
  const feed = `<?xml version="1.0"?><feed><entry><id>tag:github.com,2008:Repository/1/v0.2.10</id><updated>2026-08-26T01:00:00Z</updated><link rel="alternate" type="text/html" href="https://github.com/Coyoter/chengjing-notes/releases/tag/v0.2.10"/><title>澄境筆記 0.2.10</title><content type="html">&lt;p&gt;更新內容&lt;/p&gt;&lt;ul&gt;&lt;li&gt;修正 403&lt;/li&gt;&lt;/ul&gt;</content></entry></feed>`;
  const release = parseReleaseFeed(feed, "Coyoter", "chengjing-notes");
  assert.equal(release?.version, "0.2.10");
  assert.equal(release?.name, "澄境筆記 0.2.10");
  assert.equal(release?.body, "更新內容\n- 修正 403");
  assert.equal(release?.source, "github-feed");
});

test("不同節點的舊快取不得蓋過 KV 中較新的 Release", () => {
  const older = { tag_name: "v0.5.3" };
  const current = { tag_name: "v0.5.8" };
  assert.equal(compareReleaseIndexes(current, older), 1);
  assert.equal(compareReleaseIndexes(older, current), -1);
  assert.equal(compareReleaseIndexes(current, { tag_name: "v0.5.8" }), 0);
});

test("同版本的說明或資產更新會使用新的快取世代", () => {
  const base = normalizeApiRelease({
    tag_name: "v0.7.5",
    name: "澄境筆記 0.7.5",
    body: "第一版說明",
    assets: [{ name: "ChengJing-0.7.5-arm64.dmg", browser_download_url: "https://github.com/example/app.dmg", size: 1, digest: `sha256:${"a".repeat(64)}` }],
  });
  const changedBody = base ? { ...base, body: "修正版說明" } : null;
  const changedAsset = base ? { ...base, assets: base.assets.map((asset) => ({ ...asset, digest: `sha256:${"b".repeat(64)}` })) } : null;
  assert.notEqual(cacheGenerationForRelease(base), cacheGenerationForRelease(changedBody));
  assert.notEqual(cacheGenerationForRelease(base), cacheGenerationForRelease(changedAsset));
});
