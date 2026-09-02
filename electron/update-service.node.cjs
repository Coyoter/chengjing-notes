const assert = require("node:assert/strict");
const test = require("node:test");
const { compareVersions, isUpdateCandidateStale, parseLatestRelease, parseLatestReleaseFeed, selectDmgAsset, selectReleaseAsset } = require("./update-service.cjs");

test("比較正式版與預覽版版本號", () => {
  assert.equal(compareVersions("0.2.1", "0.2.0"), 1);
  assert.equal(compareVersions("v1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.0.0-beta.2", "1.0.0-beta.1"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0-beta.9"), 1);
});

test("依 Mac 架構選擇正確 DMG", () => {
  const assets = [
    { name: "ChengJing-1.0.0-x64.dmg", browser_download_url: "https://github.com/example/x64", size: 10 },
    { name: "ChengJing-1.0.0-arm64.dmg", browser_download_url: "https://github.com/example/arm64", size: 20, digest: "sha256:abc" },
  ];
  assert.equal(selectDmgAsset(assets, "arm64").name, "ChengJing-1.0.0-arm64.dmg");
  assert.equal(selectDmgAsset(assets, "x64").name, "ChengJing-1.0.0-x64.dmg");
});

test("依 Windows 架構選擇正確 EXE 安裝程式", () => {
  const assets = [
    { name: "ChengJing-1.0.0-x64-Installer.exe", browser_download_url: "https://github.com/example/x64", size: 10 },
    { name: "ChengJing-1.0.0-arm64-Installer.exe", browser_download_url: "https://github.com/example/arm64", size: 20, digest: "sha256:abc" },
    { name: "ChengJing-1.0.0-arm64.dmg", browser_download_url: "https://github.com/example/mac", size: 30 },
  ];
  assert.equal(selectReleaseAsset(assets, "win32", "arm64").name, "ChengJing-1.0.0-arm64-Installer.exe");
  assert.equal(selectReleaseAsset(assets, "win32", "x64").name, "ChengJing-1.0.0-x64-Installer.exe");
});

test("Windows 通用安裝程式同時適用 ARM64 與 x64", () => {
  const universal = { name: "ChengJing-1.0.0-Windows-Setup.exe", browser_download_url: "https://github.com/example/universal", size: 30 };
  const assets = [
    universal,
    { name: "ChengJing-1.0.0-portable.exe", browser_download_url: "https://github.com/example/portable", size: 20 },
  ];
  assert.equal(selectReleaseAsset(assets, "win32", "arm64"), universal);
  assert.equal(selectReleaseAsset(assets, "win32", "x64"), universal);
});

test("解析 GitHub 最新 Release 與更新內容", () => {
  const result = parseLatestRelease({
    tag_name: "v0.2.1",
    name: "澄境筆記 0.2.1",
    body: "新增半自動更新。",
    published_at: "2026-08-26T00:00:00Z",
    html_url: "https://github.com/Coyoter/chengjing-notes/releases/tag/v0.2.1",
    assets: [{ name: "ChengJing-0.2.1-arm64.dmg", browser_download_url: "https://github.com/Coyoter/chengjing-notes/releases/download/v0.2.1/ChengJing-0.2.1-arm64.dmg", size: 100 }],
  }, "0.2.0", "arm64");
  assert.equal(result.status, "available");
  assert.equal(result.latestVersion, "0.2.1");
  assert.equal(result.asset.name, "ChengJing-0.2.1-arm64.dmg");
});

test("GitHub Atom Feed 可作為 403 時的免登入備援", () => {
  const feed = `<?xml version="1.0"?><feed><entry><updated>2026-08-26T01:00:00Z</updated><link rel="alternate" type="text/html" href="https://github.com/Coyoter/chengjing-notes/releases/tag/v0.2.10"/><title>澄境筆記 0.2.10</title><content type="html">&lt;p&gt;更新內容&lt;/p&gt;&lt;ul&gt;&lt;li&gt;修正 403&lt;/li&gt;&lt;/ul&gt;</content></entry></feed>`;
  const result = parseLatestReleaseFeed(feed, "0.2.9", "arm64");
  assert.equal(result.status, "available");
  assert.equal(result.latestVersion, "0.2.10");
  assert.equal(result.notes, "更新內容\n- 修正 403");
  assert.equal(result.asset.name, "ChengJing-0.2.10-arm64.dmg");
  assert.equal(result.asset.url, "https://github.com/Coyoter/chengjing-notes/releases/download/v0.2.10/ChengJing-0.2.10-arm64.dmg");
});

test("Windows GitHub Atom Feed 備援會指向相同架構的 EXE", () => {
  const feed = `<?xml version="1.0"?><feed><entry><updated>2026-08-26T01:00:00Z</updated><link rel="alternate" type="text/html" href="https://github.com/Coyoter/chengjing-notes/releases/tag/v0.7.5"/><title>澄境 0.7.5</title><content type="html">Windows</content></entry></feed>`;
  const result = parseLatestReleaseFeed(feed, "0.7.4", "x64", "win32");
  assert.equal(result.asset.name, "ChengJing-0.7.5-x64-Installer.exe");
  assert.equal(result.asset.url, "https://github.com/Coyoter/chengjing-notes/releases/download/v0.7.5/ChengJing-0.7.5-x64-Installer.exe");
});

test("比目前 App 更舊的索引必須視為過期，不能顯示成 GitHub 最新版", () => {
  const stale = parseLatestRelease({
    tag_name: "v0.5.3",
    name: "澄境 0.5.3",
    assets: [{ name: "ChengJing-0.5.3-arm64.dmg", browser_download_url: "https://github.com/Coyoter/chengjing-notes/releases/download/v0.5.3/ChengJing-0.5.3-arm64.dmg" }],
  }, "0.5.7", "arm64");
  assert.equal(isUpdateCandidateStale(stale, "0.5.7"), true);
  assert.equal(isUpdateCandidateStale({ latestVersion: "0.5.8" }, "0.5.7"), false);
});
