/* Isolated CSS layout regression: no app startup, IndexedDB, or user data.
   Markup mirrors TodayView and CardListItem (compact + Inbox variants).
   Uses the repository's actual stylesheets, not jsdom layout estimates.
   Run: node scripts/qa-preview-overflow.mjs
   Negative control: node scripts/qa-preview-overflow.mjs --baseline
   Playwright is required, as with the other scripts/qa-*.mjs checks. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const baseline = process.argv.includes("--baseline");
const artifacts = path.resolve(process.env.CHENGJING_QA_ARTIFACTS || "qa-artifacts/preview-overflow");
await fs.mkdir(artifacts, { recursive: true });
const sheets = ["styles.css", "mobile.css", ...(!baseline ? ["preview-layout.css"] : [])];
const css = (await Promise.all(sheets.map((name) => fs.readFile(new URL(`../src/${name}`, import.meta.url), "utf8")))).join("\n");
if (!baseline) {
  const entry = await fs.readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  assert.match(entry, /import ["']\.\/preview-layout\.css["']/);
}
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHENGJING_CHROMIUM_PATH ? { executablePath: process.env.CHENGJING_CHROMIUM_PATH } : {}),
});
const failures = [];
let cases = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: "zh-TW" });
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body><div class="app-shell"><div class="app-main" id="fixture-main"><main class="workspace" id="fixture"></main></div></div></body></html>');
  await page.addStyleTag({ content: css });
  await page.addStyleTag({ content: "#fixture-main { flex: none; height: 100%; } #fixture * { transition: none !important; animation: none !important; }" });
  const sizes = [
    { name: "wide", viewport: 1920, workspace: 1668, platform: "darwin" },
    { name: "desktop", viewport: 1440, workspace: 1188, platform: "darwin" },
    { name: "minimum-window", viewport: 960, workspace: 708, platform: "darwin" },
    { name: "side-panel", viewport: 1440, workspace: 560, platform: "darwin" },
    { name: "android-shared-css", viewport: 390, workspace: 390, platform: "android" },
  ];
  const samples = [
    ["short", "短標題"],
    ["chinese", "澄境筆記繼續工作，內容太長不應該破框。".repeat(32)],
    ["ascii", "UnbrokenLongTitle".repeat(60)],
    ["url", `https://example.test/${"very-long-path-without-spaces/".repeat(32)}`],
    ["emoji", "🧑‍💻🚀筆記與研究🗂️".repeat(48)],
  ];
  for (const size of sizes) {
    await page.setViewportSize({ width: size.viewport, height: 1000 });
    for (const theme of ["light", "dark", "ink"]) {
      for (const scale of [1, 1.2]) {
        for (const [kind, text] of samples) {
          for (const view of ["today", "inbox"]) {
            const name = `${size.name}/${theme}/${scale}/${kind}/${view}`;
            await page.evaluate(({ size, theme, scale, markup }) => {
              document.documentElement.dataset.platform = size.platform;
              document.documentElement.dataset.theme = theme;
              document.documentElement.style.setProperty("--font-scale", String(scale));
              document.getElementById("fixture-main").style.width = `${size.workspace}px`;
              document.getElementById("fixture").innerHTML = markup;
            }, { size, theme, scale, markup: view === "today" ? today(text) : inbox(text) });
            const normal = await inspect(page, text);
            await page.locator(".card-list-item").first().hover({ force: true });
            const hover = await inspect(page, text);
            const problems = [...normal, ...hover.map((problem) => `hover: ${problem}`)];
            if (problems.length) failures.push({ name, problems });
            cases += 1;
            if (size.name === "desktop" && theme === "dark" && scale === 1 && kind === "chinese" && view === "today") {
              await page.screenshot({ path: path.join(artifacts, baseline ? "before.png" : "after.png") });
            }
          }
        }
      }
    }
  }
} finally {
  await browser.close();
}
const report = { baseline, cases, failed: failures.length, failures };
await fs.writeFile(path.join(artifacts, baseline ? "baseline.json" : "results.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ baseline, cases, failed: failures.length, firstFailures: failures.slice(0, 3) }, null, 2));
assert.equal(failures.length, 0, `${failures.length}/${cases} preview layout configurations failed; see ${artifacts}`);

function escape(text) {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function icon(size = 15, className = "") {
  return `<svg class="${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>`;
}
function card(text, compact) {
  return `<article class="card-list-item ${compact ? "is-compact" : ""}">
    <div class="card-kind-mark">${icon()}</div>
    <div class="card-list-content">
      <div class="card-list-heading"><h3>${escape(text)}</h3>${icon(13, "fixture-pin")}</div>
      ${compact ? "" : `<p>${escape(text.slice(0, 160))}</p>`}
      <footer><span>筆記</span><span>剛剛</span><i>${escape(text)}</i><i>研究</i><i>整理</i></footer>
    </div>
    <button type="button" class="bare-button item-more" aria-label="更多操作">${icon(16)}</button>
  </article>`;
}
function heading(eyebrow, title, action = "") {
  return `<header class="section-heading"><div><span>${eyebrow}</span><h2>${title}</h2></div>${action ? `<button type="button" class="text-button">${action}${icon(14)}</button>` : ""}</header>`;
}
function today(text) {
  return `<div class="page-scroll today-page">
    <section class="today-hero"><div><span>9 月 15 日星期二</span><h2>午安，今天想釐清什麼？</h2><p>從一張卡片開始，等想法成熟後再把它放進白板。</p></div>
      <div class="hero-actions"><button type="button" class="primary-button">${icon(16)}新增卡片</button><button type="button" class="secondary-button">${icon(16)}和 AI 討論</button></div>
    </section>
    <section class="metric-row">${["隻言片語", "全部卡片", "研究白板"].map((label) => `<button type="button">${icon(18)}<span><b>123456</b><small>${label}</small></span>${icon()}</button>`).join("")}</section>
    <div class="today-grid">
      <section class="surface-panel recent-panel">${heading("繼續工作", "最近卡片", "查看全部")}<div class="card-list">${card(text, true)}${card("2026 年 9 月 15 日", true)}</div></section>
      <section class="surface-panel focus-panel">${heading("視覺脈絡", "最近白板")}<div class="board-preview-list"><button type="button"><div class="mini-board mini-board-1" aria-hidden="true"><i></i><i></i><i></i><i></i></div><span><b>${escape(text)}</b><small>${escape(text)}</small></span>${icon()}</button></div></section>
      <section class="surface-panel task-panel">${heading("下一步", "待辦事項", "管理待辦")}<div class="task-list"><label><button type="button" class="task-check" aria-label="完成待辦">${icon(17)}</button><span><b>${escape(text)}</b><small>9/18 到期</small></span></label></div></section>
    </div>
  </div>`;
}
function inbox(text) {
  return `<div class="page-scroll standard-page"><section class="surface-panel library-panel inbox-card-panel"><div class="card-list spacious">${card(text, false)}${card("一般筆記", false)}</div></section></div>`;
}
async function inspect(page, original) {
  return page.evaluate((original) => {
    const problems = [];
    const selectors = [".page-scroll", ".today-grid", ".surface-panel", ".card-list", ".card-list-item", ".card-list-heading", ".card-list-content", ".card-list-content footer", ".board-preview-list", ".board-preview-list > button", ".task-list", ".task-list > label", ".task-list b", ".metric-row", ".metric-row > button", ".today-hero", ".hero-actions", ".section-heading"];
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (el.scrollWidth > el.clientWidth + 1) problems.push(`${selector}: ${el.scrollWidth}px > ${el.clientWidth}px`);
      }
    }
    for (const selector of [".card-list-heading > h3", ".card-kind-mark", ".item-more", ".fixture-pin", ".board-preview-list b", ".board-preview-list small", ".board-preview-list > button > svg", ".task-check"]) {
      for (const el of document.querySelectorAll(selector)) {
        const rect = el.getBoundingClientRect();
        const panel = el.closest(".surface-panel").getBoundingClientRect();
        if (rect.width <= 0 || rect.left < panel.left - 1 || rect.right > panel.right + 1) problems.push(`${selector}: outside panel`);
      }
    }
    for (const [selector, width] of [[".fixture-pin", 13], [".item-more", 28], [".card-kind-mark", 34], [".task-check", 30], [".board-preview-list > button > svg", 15]]) {
      for (const el of document.querySelectorAll(selector)) {
        if (Math.abs(el.getBoundingClientRect().width - width) > 1) problems.push(`${selector}: squeezed`);
      }
    }
    const title = document.querySelector(".card-list-heading > h3");
    if (title.textContent !== original) problems.push("card title was modified");
    if (getComputedStyle(title).textOverflow !== "ellipsis") problems.push("card title lost ellipsis");
    const task = document.querySelector(".task-list b");
    if (task && (task.textContent !== original || getComputedStyle(task).whiteSpace === "nowrap")) problems.push("task text must remain intact and wrap");
    return problems;
  }, original);
}
