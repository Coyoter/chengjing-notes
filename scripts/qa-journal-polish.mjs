import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/journal-polish");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1540, height: 960 }, colorScheme: "dark", locale: "zh-TW" });
const page = await context.newPage();
page.setDefaultTimeout(10_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });

async function inspectToolbarTooltips(selector) {
  const buttons = page.locator(`${selector} button[data-tooltip]`);
  const count = await buttons.count();
  const items = [];
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    await button.hover();
    await page.waitForTimeout(140);
    items.push(await button.evaluate((element) => {
      const label = element.getAttribute("data-tooltip") || "";
      const pseudo = getComputedStyle(element, "::after");
      return {
        label,
        content: pseudo.content.replace(/^['\"]|['\"]$/g, ""),
        opacity: Number.parseFloat(pseudo.opacity),
      };
    }));
  }
  return {
    count,
    items,
    complete: count === 12 && items.every((item) => item.label && item.content === item.label && item.opacity > 0.95),
  };
}

await page.goto(base, { waitUntil: "networkidle" });
const tutorRemoved = await page.getByRole("button", { name: "AI 導師", exact: true }).count() === 0;

await page.getByRole("button", { name: "日誌", exact: true }).click();
await page.locator(".journal-paper").waitFor();
const dateButtons = page.locator(".journal-week-days > button");
const dateLabels = await dateButtons.allTextContents();
const dateBarClear = dateLabels.length === 7 && dateLabels.every((label) => /\d{1,2}\/\d{1,2}/.test(label));
const selectedDateText = await page.locator(".journal-week-days > button.is-active").innerText();
const journalNavigationMetrics = await page.locator(".journal-date-navigation-actions").evaluate((group) => {
  const today = group.querySelector(".journal-today-button")?.getBoundingClientRect();
  const picker = group.querySelector(".task-date-trigger")?.getBoundingClientRect();
  return today && picker ? { topShift: Math.abs(today.top - picker.top), heightShift: Math.abs(today.height - picker.height), gap: picker.left - today.right } : null;
});
const journalNavigationGrouping = Boolean(journalNavigationMetrics && journalNavigationMetrics.topShift <= 1.1 && journalNavigationMetrics.heightShift <= 1.1 && journalNavigationMetrics.gap >= 4 && journalNavigationMetrics.gap <= 8);
const journalDatePicker = page.locator(".journal-date-picker");
await journalDatePicker.getByRole("button", { name: "選擇日期", exact: true }).click();
const journalCalendar = journalDatePicker.getByRole("dialog", { name: "日誌日期月曆", exact: true });
await journalCalendar.waitFor();
const journalCalendarStructure = await journalCalendar.locator(".task-calendar-days button").count() === 42
  && await journalCalendar.locator(".task-calendar-weekdays span").count() === 7
  && await journalCalendar.locator(".task-date-presets").count() === 0
  && await journalCalendar.getByRole("button", { name: "清除日期", exact: true }).count() === 0;
await page.screenshot({ path: path.join(output, "00-journal-date-picker.png"), fullPage: true });
const journalTarget = new Date();
journalTarget.setDate(15);
journalTarget.setMonth(journalTarget.getMonth() - 2);
const journalTargetKey = `${journalTarget.getFullYear()}-${String(journalTarget.getMonth() + 1).padStart(2, "0")}-${String(journalTarget.getDate()).padStart(2, "0")}`;
await journalCalendar.getByRole("button", { name: "上一個月", exact: true }).click();
await journalCalendar.getByRole("button", { name: "上一個月", exact: true }).click();
await journalCalendar.locator(`[data-date="${journalTargetKey}"]`).click();
const journalTargetLabel = new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "long", day: "numeric" }).format(journalTarget);
await page.locator(".journal-heading-copy h2").getByText(journalTargetLabel, { exact: true }).waitFor();
const journalArbitraryDateWorks = await page.locator(".journal-heading-copy h2").innerText() === journalTargetLabel;
await page.locator(".journal-today-button").click();
const journalReturnsToday = await page.locator(".journal-today-button.is-active").isVisible();

const taskAlignment = await page.locator('.prose-editor ul[data-type="taskList"] li').first().evaluate((item) => {
  const checkbox = item.querySelector("input");
  const paragraph = item.querySelector("p");
  if (!checkbox || !paragraph) return { shift: Number.POSITIVE_INFINITY, checkboxTop: 0, textTop: 0 };
  const checkboxRect = checkbox.getBoundingClientRect();
  const paragraphRect = paragraph.getBoundingClientRect();
  const lineHeight = parseFloat(getComputedStyle(paragraph).lineHeight);
  const checkboxCenter = checkboxRect.top + checkboxRect.height / 2;
  const firstLineCenter = paragraphRect.top + lineHeight / 2;
  return { shift: Math.abs(checkboxCenter - firstLineCenter), checkboxTop: checkboxRect.top, textTop: paragraphRect.top };
});

const toolbarVisual = await page.locator(".journal-paper .editor-toolbar").evaluate((toolbar) => {
  const sample = document.createElement("div");
  sample.style.background = "var(--surface-2)";
  document.body.appendChild(sample);
  const surface = getComputedStyle(sample).backgroundColor;
  sample.remove();
  const style = getComputedStyle(toolbar);
  return { background: style.backgroundColor, surface, backdrop: style.backdropFilter, radius: parseFloat(style.borderRadius) };
});
const journalTooltips = await inspectToolbarTooltips(".journal-paper .editor-toolbar");
await page.getByRole("button", { name: "重點標示並建立劃記", exact: true }).hover();
await page.screenshot({ path: path.join(output, "01-journal.png"), fullPage: true });

const selectedJournalHighlight = "把新的筆記應用做成真正能長期使用的工具";
const selectedJournalText = await page.locator(".journal-paper .prose-editor").evaluate((editor, targetText) => {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const index = node.textContent?.indexOf(targetText) ?? -1;
    if (index < 0) continue;
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + targetText.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return selection?.toString() || "";
  }
  return "";
}, selectedJournalHighlight);
await page.getByRole("button", { name: "重點標示並建立劃記", exact: true }).click();
await page.getByRole("status").getByText("已標示文字並加入左側「劃記」。", { exact: true }).waitFor();
await page.getByRole("button", { name: "重點標示並建立劃記", exact: true }).click();
await page.getByRole("button", { name: "重點標示並建立劃記", exact: true }).click();
await page.getByRole("status").getByText("這段文字已經在劃記中。", { exact: true }).waitFor();
const journalDuplicateProtected = true;
await page.getByRole("button", { name: "劃記", exact: true }).click();
await page.locator(".highlight-card").filter({ hasText: selectedJournalHighlight }).waitFor();
const journalHighlightSynced = await page.locator(".highlight-card").filter({ hasText: selectedJournalHighlight }).count() === 1;
const journalHighlightSource = await page.locator(".highlight-card").filter({ hasText: selectedJournalHighlight }).innerText();
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: "劃記", exact: true }).click();
await page.locator(".highlight-card").filter({ hasText: selectedJournalHighlight }).waitFor();
const journalHighlightPersisted = await page.locator(".highlight-card").filter({ hasText: selectedJournalHighlight }).count() === 1;
await page.screenshot({ path: path.join(output, "02-journal-highlight-synced.png"), fullPage: true });

await page.getByRole("button", { name: "第二大腦", exact: true }).click();
await page.locator(".second-brain-page").waitFor();
await page.waitForFunction(() => document.querySelectorAll(".brain-node-label").length >= 7);
const brainLabels = await page.locator(".brain-node-label").allTextContents();
const journalMeaningfulInBrain = brainLabels.some((label) => label.includes("把新的筆記應用做成真正能長期使用的工具")) && !brainLabels.some((label) => /^\d{4}\s*年/.test(label));
await page.screenshot({ path: path.join(output, "03-brain-journal-title.png"), fullPage: true });

await page.getByRole("button", { name: "白板", exact: true }).click();
await page.locator(".react-flow__pane").waitFor();
const selectCursor = await page.locator(".react-flow__pane").evaluate((element) => getComputedStyle(element).cursor);
await page.getByRole("button", { name: "建立關係線", exact: true }).click();
const connectCursor = await page.locator(".react-flow__pane").evaluate((element) => getComputedStyle(element).cursor);

await page.getByRole("button", { name: "卡片庫", exact: true }).click();
await page.locator(".library-card").filter({ hasText: "Gemma 4 本機模式" }).click();
await page.locator(".card-editor-panel").waitFor();
const cardTooltips = await inspectToolbarTooltips(".card-editor-panel .editor-toolbar");
await page.getByRole("button", { name: "粗體", exact: true }).hover();
await page.screenshot({ path: path.join(output, "04-card-toolbar-tooltip.png"), fullPage: true });
const selectedHighlightText = "Gemma 4 E2B 以 WebGPU 在本機執行";
await page.locator(".prose-editor").evaluate((editor, targetText) => {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const index = node.textContent?.indexOf(targetText) ?? -1;
    if (index < 0) continue;
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + targetText.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
  }
  return false;
}, selectedHighlightText);
await page.getByRole("button", { name: "重點標示並建立劃記", exact: true }).click();
await page.getByText("已標示文字並加入左側「劃記」。", { exact: true }).waitFor();
await page.getByRole("button", { name: "劃記", exact: true }).click();
await page.locator(".highlight-card").filter({ hasText: selectedHighlightText }).waitFor();
const highlightSynced = await page.locator(".highlight-card").filter({ hasText: selectedHighlightText }).count() === 1;
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: "劃記", exact: true }).click();
await page.locator(".highlight-card").filter({ hasText: selectedHighlightText }).waitFor();
const highlightPersisted = await page.locator(".highlight-card").filter({ hasText: selectedHighlightText }).count() === 1;
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(output, "05-card-highlight-synced.png"), fullPage: true });

const report = {
  tutorRemoved,
  dateBarClear,
  dateLabels,
  selectedDateText,
  journalNavigationGrouping,
  journalNavigationMetrics,
  journalCalendarStructure,
  journalArbitraryDateWorks,
  journalReturnsToday,
  taskAlignment,
  toolbarVisual,
  journalTooltips,
  selectedJournalText,
  journalHighlightSynced,
  journalHighlightPersisted,
  journalDuplicateProtected,
  journalHighlightSource,
  journalMeaningfulInBrain,
  journalBrainLabel: brainLabels.find((label) => label.includes("把新的筆記應用")),
  selectCursor,
  connectCursor,
  cardTooltips,
  highlightSynced,
  highlightPersisted,
  errors,
};
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();

if (
  !tutorRemoved || !dateBarClear || !journalNavigationGrouping || !journalCalendarStructure || !journalArbitraryDateWorks || !journalReturnsToday || taskAlignment.shift > 2 || toolbarVisual.background !== toolbarVisual.surface ||
  toolbarVisual.backdrop !== "none" || toolbarVisual.radius < 7 || !journalTooltips.complete ||
  selectedJournalText !== selectedJournalHighlight || !journalHighlightSynced || !journalHighlightPersisted || !journalDuplicateProtected || !/\d{4}\s*年/.test(journalHighlightSource) ||
  !journalMeaningfulInBrain || selectCursor !== "default" || connectCursor !== "crosshair" || !cardTooltips.complete ||
  !highlightSynced || !highlightPersisted || errors.length
) process.exitCode = 1;
