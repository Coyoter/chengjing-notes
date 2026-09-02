import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/i18n");
await fs.mkdir(output, { recursive: true });

const languages = [
  { id: "zh-TW", picker: "繁體中文", nav: ["今日", "隻言片語", "日誌", "白板", "看板", "第二大腦", "卡片庫", "資料庫", "待辦", "劃記", "設定"], settings: "介面語言", brain: "第二大腦" },
  { id: "zh-CN", picker: "简体中文", nav: ["今日", "只言片语", "日志", "白板", "看板", "第二大脑", "卡片库", "数据库", "待办", "划记", "设置"], settings: "界面语言", brain: "第二大脑" },
  { id: "en", picker: "English", nav: ["Today", "Fragments", "Journal", "Boards", "Kanban", "Second Brain", "Card Library", "Database", "Tasks", "Highlights", "Settings"], settings: "Interface language", brain: "Second Brain" },
  { id: "ja", picker: "日本語", nav: ["今日", "ひとこと", "日誌", "ボード", "カンバン", "第二の脳", "カードライブラリ", "データベース", "タスク", "ハイライト", "設定"], settings: "表示言語", brain: "第二の脳" },
  { id: "ko", picker: "한국어", nav: ["오늘", "짧은 생각", "일지", "보드", "칸반", "세컨드 브레인", "카드 보관함", "데이터베이스", "할 일", "하이라이트", "설정"], settings: "인터페이스 언어", brain: "세컨드 브레인" },
];
const views = ["today", "fragments", "journal", "boards", "kanban", "brain", "library", "database", "tasks", "highlights"];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", locale: "zh-TW" });
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });

await page.goto(base, { waitUntil: "networkidle" });
await page.locator(".workspace.view-today").waitFor();
const reports = [];

for (const language of languages) {
  const currentLanguage = await page.locator("html").getAttribute("lang");
  const currentSettings = languages.find((item) => item.id === currentLanguage)?.nav.at(-1) || "設定";
  await page.getByRole("button", { name: currentSettings, exact: true }).click();
  await page.locator(".workspace.view-settings").waitFor();
  await page.locator(".language-grid button").filter({ hasText: language.picker }).click();
  await page.locator(`html[lang="${language.id}"]`).waitFor();
  await page.getByRole("heading", { name: language.settings, exact: true }).waitFor();
  await page.locator(".settings-page").evaluate((element) => { element.scrollTop = 0; });
  await page.waitForTimeout(220);
  await page.screenshot({ path: path.join(output, `${language.id}-settings.png`), fullPage: true });

  const pages = [];
  for (let index = 0; index < views.length; index += 1) {
    await page.locator(".primary-nav button").nth(index).click();
    await page.locator(`.workspace.view-${views[index]}`).waitFor();
    const metric = await page.evaluate(() => {
      const workspace = document.querySelector(".workspace");
      return {
        rootOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        workspaceOverflow: workspace ? workspace.scrollWidth - workspace.clientWidth : 0,
      };
    });
    pages.push({ view: views[index], ...metric });
  }

  await page.locator(".primary-nav button").nth(5).click();
  await page.locator(".workspace.view-brain").waitFor();
  await page.getByText(language.brain, { exact: true }).first().waitFor();
  await page.waitForTimeout(220);
  await page.screenshot({ path: path.join(output, `${language.id}-brain.png`), fullPage: true });
  await page.locator(".primary-nav button").nth(0).click();
  await page.locator(".workspace.view-today").waitFor();
  await page.waitForTimeout(220);
  await page.screenshot({ path: path.join(output, `${language.id}-today.png`), fullPage: true });

  const state = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    primaryNav: document.querySelector(".primary-nav")?.getAttribute("aria-label"),
    fontFamily: getComputedStyle(document.documentElement).fontFamily,
  }));
  reports.push({ language: language.id, state, pages });
}

await page.getByRole("button", { name: languages.at(-1).nav.at(-1), exact: true }).click();
await page.locator(".language-grid button").filter({ hasText: "English" }).click();
await page.locator(".font-scale-setting button").last().click();
await page.setViewportSize({ width: 1040, height: 760 });
await page.waitForTimeout(200);
const compactMetric = await page.evaluate(() => ({
  lang: document.documentElement.lang,
  fontScale: document.documentElement.dataset.fontScale,
  rootOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  languageColumns: getComputedStyle(document.querySelector(".language-grid")).gridTemplateColumns.split(" ").length,
}));
await page.screenshot({ path: path.join(output, "en-1040-font-120.png"), fullPage: true });

await page.reload({ waitUntil: "networkidle" });
await page.locator('html[lang="en"]').waitFor();
const persistence = await page.evaluate(() => ({ lang: document.documentElement.lang, fontScale: document.documentElement.dataset.fontScale }));

const summary = { reports, compactMetric, persistence, errors };
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(summary, null, 2));
await browser.close();
console.log(JSON.stringify(summary, null, 2));

const failed = errors.length > 0
  || reports.some((report) => report.state.lang !== report.language || report.pages.some((item) => item.rootOverflow > 2 || item.workspaceOverflow > 2))
  || compactMetric.lang !== "en"
  || compactMetric.fontScale !== "120"
  || compactMetric.rootOverflow > 2
  || compactMetric.languageColumns !== 3
  || persistence.lang !== "en"
  || persistence.fontScale !== "120";
if (failed) process.exitCode = 1;
