import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/board-ime-security");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1480, height: 920 }, colorScheme: "dark", locale: "zh-TW" });
const page = await context.newPage();
page.setDefaultTimeout(10_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });

await page.goto(base, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "白板", exact: true }).click();
await page.locator(".board-switcher-trigger").waitFor();
const renameDiscoverable = await page.getByRole("button", { name: "重新命名白板", exact: true }).isVisible();
await page.locator(".board-switcher-trigger").click();
await page.locator(".board-switcher-menu").getByRole("button", { name: "新增白板", exact: true }).click();
const boardTitle = page.getByRole("textbox", { name: "白板名稱" });
await boardTitle.waitFor();
await boardTitle.dispatchEvent("compositionstart", { data: "" });
await boardTitle.fill("wodeyanjiubaiban");
await boardTitle.fill("我的研究白板");
await boardTitle.dispatchEvent("compositionend", { data: "我的研究白板" });
await boardTitle.press("Enter");
await page.locator(".board-switcher-trigger").getByText("我的研究白板", { exact: true }).waitFor();
const boardImeWorks = true;

const pane = page.locator(".react-flow__pane");
await pane.dblclick({ position: { x: 360, y: 260 } });
await page.locator(".flow-card header").first().dblclick();
await page.locator(".card-editor-panel").waitFor();
const titleInput = page.locator(".card-title-input");
await titleInput.dispatchEvent("compositionstart", { data: "" });
await titleInput.fill("wodexinxiangfa");
await titleInput.fill("我的新想法");
await titleInput.dispatchEvent("compositionend", { data: "我的新想法" });
await titleInput.blur();
await page.locator(".card-back-button").click();
await page.locator(".flow-card h3").getByText("我的新想法", { exact: true }).waitFor();
const cardImeWorks = true;
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(output, "01-board-renamed-chinese.png"), fullPage: true });

await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: "白板", exact: true }).click();
await page.locator(".board-switcher-trigger").click();
await page.locator(".board-switcher-menu").getByRole("button", { name: "我的研究白板", exact: true }).click();
await page.locator(".flow-card h3").getByText("我的新想法", { exact: true }).waitFor();
const namesPersisted = true;

await page.getByRole("button", { name: "設定", exact: true }).click();
await page.getByText(/不使用.*鑰匙圈/).first().waitFor();
const settingsText = await page.locator(".settings-page").innerText();
const noKeychainCopy = !settingsText.includes("Keychain") && !settingsText.includes("Windows DPAPI") && settingsText.includes("AES-256-GCM") && settingsText.includes("不使用 macOS 鑰匙圈");
const connectionTestVisible = await page.getByRole("button", { name: "測試 OpenRouter", exact: true }).isVisible();
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(output, "02-local-key-settings.png"), fullPage: true });

const report = { renameDiscoverable, boardImeWorks, cardImeWorks, namesPersisted, noKeychainCopy, connectionTestVisible, errors };
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (!renameDiscoverable || !boardImeWorks || !cardImeWorks || !namesPersisted || !noKeychainCopy || !connectionTestVisible || errors.length) process.exitCode = 1;
