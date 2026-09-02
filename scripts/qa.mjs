import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts");
await fs.mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", locale: "zh-TW" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });

await page.goto(base, { waitUntil: "networkidle" });
await page.getByText("今天想釐清什麼？").waitFor();
await page.screenshot({ path: path.join(output, "01-today-dark.png"), fullPage: true });

await page.getByRole("button", { name: "白板", exact: true }).click();
await page.getByText("產品研究室", { exact: true }).first().waitFor();
await page.screenshot({ path: path.join(output, "02-board.png"), fullPage: true });

await page.getByRole("button", { name: "卡片庫", exact: true }).click();
await page.locator(".library-card").first().click();
await page.locator(".card-editor-panel").waitFor();
await page.screenshot({ path: path.join(output, "03-card-editor.png"), fullPage: true });

await page.getByRole("button", { name: /AI 動作/ }).click();
await page.getByText("一起把事情想清楚").waitFor();
await page.screenshot({ path: path.join(output, "04-ai-panel.png"), fullPage: true });
await page.getByRole("button", { name: "關閉 AI" }).click();

await page.getByRole("button", { name: "設定", exact: true }).click();
await page.getByText("選擇資料要去哪裡").waitFor();
await page.locator(".right-panel").waitFor({ state: "detached" });
await page.screenshot({ path: path.join(output, "05-settings.png"), fullPage: true });

await page.getByRole("button", { name: "淺色", exact: true }).click();
await page.screenshot({ path: path.join(output, "06-settings-light.png"), fullPage: true });

const summary = {
  url: base,
  screenshots: (await fs.readdir(output)).filter((file) => file.endsWith(".png")),
  errors,
};
await fs.writeFile(path.join(output, "qa-summary.json"), JSON.stringify(summary, null, 2));
await browser.close();

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(summary, null, 2));
}
