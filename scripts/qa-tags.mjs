import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/tags");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1480, height: 920 }, colorScheme: "dark", locale: "zh-TW" });
const page = await context.newPage();
page.setDefaultTimeout(12_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });

async function createTagWithEnter(root, name, composingText = "ceshi") {
  await root.locator(".add-tag").click();
  await root.locator(".create-tag-button").click();
  const input = root.getByRole("textbox", { name: "標籤名稱", exact: true });
  await input.dispatchEvent("compositionstart", { data: "" });
  await input.fill(composingText);
  await input.fill(name);
  await input.dispatchEvent("compositionend", { data: name });
  await input.press("Enter");
  await root.locator(":scope > button").filter({ hasText: name }).waitFor();
}

async function createTagWithBlur(root, name, outside) {
  await root.locator(".add-tag").click();
  await root.locator(".create-tag-button").click();
  const input = root.getByRole("textbox", { name: "標籤名稱", exact: true });
  await input.dispatchEvent("compositionstart", { data: "" });
  await input.fill("pianyubiaoqian");
  await input.fill(name);
  await input.dispatchEvent("compositionend", { data: name });
  await outside.click();
  await root.locator(":scope > button").filter({ hasText: name }).waitFor();
}

async function addExistingTag(root, name) {
  await root.locator(".add-tag").click();
  await root.locator(".tag-picker-options button").filter({ hasText: name }).click();
  await root.locator(":scope > button").filter({ hasText: name }).waitFor();
}

await page.goto(base, { waitUntil: "networkidle" });

// 日誌：文字游標與 Enter／中文輸入法新增標籤
await page.getByRole("button", { name: "日誌", exact: true }).click();
await page.locator(".journal-paper .prose-editor").waitFor();
const journalCursor = await page.locator(".journal-paper .prose-editor").evaluate((element) => getComputedStyle(element).cursor);
const journalTags = page.locator(".journal-tags [data-tag-picker]");
await createTagWithEnter(journalTags, "共同日誌", "gongtongrizhi");
const journalTagCreated = true;

// 隻言片語：失焦新增、套用既有標籤、保存後保留標籤
await page.getByRole("button", { name: /^隻言片語/ }).click();
const draftTags = page.locator(".fragment-draft-tags");
await createTagWithBlur(draftTags, "片語標籤", page.locator(".fragments-heading h2"));
await addExistingTag(draftTags, "共同日誌");
await page.locator(".fragment-capture textarea").fill("標籤生命週期測試片語");
await page.locator(".fragment-capture footer button").click();
const fragment = page.locator(".fragment-stream > article").filter({ hasText: "標籤生命週期測試片語" });
await fragment.waitFor();
const fragmentTagsPersisted = await fragment.locator("[data-tag-picker]").innerText().then((text) => text.includes("共同日誌") && text.includes("片語標籤"));

// 白板：新白板可建立與套用標籤
await page.getByRole("button", { name: "白板", exact: true }).click();
await page.locator(".board-switcher-trigger").click();
await page.locator(".board-switcher-menu").getByRole("button", { name: "新增白板", exact: true }).click();
const boardTitle = page.getByRole("textbox", { name: "白板名稱", exact: true });
await boardTitle.fill("標籤測試白板");
await boardTitle.press("Enter");
const boardTags = page.locator(".board-tags");
await addExistingTag(boardTags, "片語標籤");
await createTagWithEnter(boardTags, "白板標籤", "baibanbiaoqian");
const boardTagsCreated = true;

// 卡片：快捷新增英文標籤、解除套用但保留全域標籤
await page.getByRole("button", { name: "卡片庫", exact: true }).click();
await page.locator(".library-card").first().click();
const cardTags = page.locator(".card-meta-line [data-tag-picker]");
await createTagWithEnter(cardTags, "ResearchTag", "ResearchTag");
const cardTagChip = cardTags.locator(":scope > button").filter({ hasText: "ResearchTag" });
await cardTagChip.click();
await cardTagChip.waitFor({ state: "detached" });
const cardTagAssociationRemoved = !(await cardTags.innerText()).includes("ResearchTag");
await page.getByRole("button", { name: "返回卡片庫", exact: true }).click();

// 資料庫：全域標籤可見，右鍵重新命名並同步所有引用
await page.getByRole("button", { name: "資料庫", exact: true }).click();
const databaseTags = page.locator(".database-sidebar > button");
await databaseTags.filter({ hasText: "ResearchTag" }).waitFor();
const sourceTag = databaseTags.filter({ hasText: "共同日誌" });
await sourceTag.click({ button: "right" });
const tagMenu = page.locator('[data-context-menu="tag"]');
await tagMenu.waitFor();
await tagMenu.getByRole("menuitem", { name: "重新命名標籤", exact: true }).waitFor();
const tagContextItems = await tagMenu.getByRole("menuitem").allTextContents();
await tagMenu.getByRole("menuitem", { name: "重新命名標籤", exact: true }).click();
const renameInput = page.getByRole("textbox", { name: "標籤名稱", exact: true });
await renameInput.dispatchEvent("compositionstart", { data: "" });
await renameInput.fill("gongtongzhuti");
await renameInput.fill("共同主題");
await renameInput.dispatchEvent("compositionend", { data: "共同主題" });
await renameInput.press("Enter");
await databaseTags.filter({ hasText: "共同主題" }).waitFor();
const tagRenamed = !(await page.locator(".database-sidebar").innerText()).includes("共同日誌");
await page.waitForTimeout(180);
await page.screenshot({ path: path.join(output, "01-database-tag-renamed.png"), fullPage: true });

await page.getByRole("button", { name: "日誌", exact: true }).click();
await page.locator(".journal-tags").getByText("共同主題", { exact: true }).waitFor();
const journalRenameSynced = (await page.locator(".journal-tags").innerText()).includes("共同主題");
await page.getByRole("button", { name: /^隻言片語/ }).click();
await page.locator(".fragment-stream").getByText("共同主題", { exact: true }).waitFor();
const fragmentRenameSynced = (await page.locator(".fragment-stream").innerText()).includes("共同主題");

// 資料庫右鍵移除，全域引用同步清除
await page.getByRole("button", { name: "資料庫", exact: true }).click();
const deleteTarget = databaseTags.filter({ hasText: "片語標籤" });
await deleteTarget.click({ button: "right" });
await page.locator('[data-context-menu="tag"]').waitFor();
page.once("dialog", (dialog) => dialog.accept());
await page.locator('[data-context-menu="tag"]').getByRole("menuitem", { name: "移除標籤", exact: true }).click();
await deleteTarget.waitFor({ state: "detached" });
const tagDeleted = !(await page.locator(".database-sidebar").innerText()).includes("片語標籤");

await page.getByRole("button", { name: /^隻言片語/ }).click();
const fragmentDeleteSynced = !(await page.locator(".fragment-stream").innerText()).includes("片語標籤");
await page.getByRole("button", { name: "白板", exact: true }).click();
await page.locator(".board-switcher-trigger").click();
await page.locator(".board-switcher-menu").getByRole("button", { name: "標籤測試白板", exact: true }).click();
const boardDeleteSynced = !(await page.locator(".board-tags").innerText()).includes("片語標籤");
await page.waitForTimeout(180);
await page.screenshot({ path: path.join(output, "02-board-tags-after-global-delete.png"), fullPage: true });

// 重新載入：標籤、重新命名與刪除狀態持久保存
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: "日誌", exact: true }).click();
await page.locator(".journal-tags").getByText("共同主題", { exact: true }).waitFor();
const reloadCursor = await page.locator(".journal-paper .prose-editor").evaluate((element) => getComputedStyle(element).cursor);
await page.getByRole("button", { name: "資料庫", exact: true }).click();
await page.locator(".database-sidebar").getByText("共同主題", { exact: true }).waitFor();
await page.locator(".database-sidebar").getByText("ResearchTag", { exact: true }).waitFor();
await page.locator(".database-sidebar").getByText("白板標籤", { exact: true }).waitFor();
const databaseTextAfterReload = await page.locator(".database-sidebar").innerText();
const persistedAfterReload = databaseTextAfterReload.includes("共同主題") && databaseTextAfterReload.includes("ResearchTag") && databaseTextAfterReload.includes("白板標籤") && !databaseTextAfterReload.includes("片語標籤");
await page.waitForTimeout(180);
await page.screenshot({ path: path.join(output, "03-tags-persisted.png"), fullPage: true });

// 淺色卡片標籤選單：無粗框、保留新增入口
await page.getByRole("button", { name: "設定", exact: true }).click();
await page.getByRole("button", { name: "淺色", exact: true }).click();
await page.getByRole("button", { name: "卡片庫", exact: true }).click();
await page.locator(".library-card").first().click();
await page.locator(".card-meta-line .add-tag").click();
await page.locator(".card-meta-line .tag-picker").waitFor();
const pickerVisual = await page.locator(".card-meta-line .tag-picker").evaluate((element) => ({
  borderWidth: parseFloat(getComputedStyle(element).borderTopWidth),
  bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
}));
const createTagActionVisible = await page.getByRole("button", { name: "新增標籤", exact: true }).isVisible();
await page.waitForTimeout(180);
await page.screenshot({ path: path.join(output, "04-light-tag-picker.png"), fullPage: true });
const report = {
  journalCursor,
  reloadCursor,
  journalTagCreated,
  fragmentTagsPersisted,
  boardTagsCreated,
  cardTagAssociationRemoved,
  tagContextItems,
  tagRenamed,
  journalRenameSynced,
  fragmentRenameSynced,
  tagDeleted,
  fragmentDeleteSynced,
  boardDeleteSynced,
  persistedAfterReload,
  createTagActionVisible,
  pickerVisual,
  errors,
};
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
const failed = journalCursor !== "text" || reloadCursor !== "text" || !journalTagCreated || !fragmentTagsPersisted || !boardTagsCreated || !cardTagAssociationRemoved || !tagContextItems.includes("重新命名標籤") || !tagContextItems.includes("移除標籤") || !tagRenamed || !journalRenameSynced || !fragmentRenameSynced || !tagDeleted || !fragmentDeleteSynced || !boardDeleteSynced || !persistedAfterReload || !createTagActionVisible || pickerVisual.borderWidth !== 0 || pickerVisual.bodyOverflow > 2 || errors.length;
if (failed) process.exit(1);
