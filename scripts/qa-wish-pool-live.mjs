import { chromium } from "playwright";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const password = process.env.WISH_POOL_ADMIN_PASSWORD || "";
if (!password) throw new Error("WISH_POOL_ADMIN_PASSWORD is required");
const endpoint = "https://chengjing-wish-pool.coyoter.workers.dev";
const marker = `QA 正式串接 ${Date.now()}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", locale: "zh-TW" });
const page = await context.newPage();
page.setDefaultTimeout(20_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
let wishId = "";
let deleted = false;

async function cleanup() {
  if (!wishId || deleted) return;
  const login = await fetch(`${endpoint}/v1/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
  const session = await login.json();
  if (!login.ok || !session.token) return;
  const response = await fetch(`${endpoint}/v1/wishes/${encodeURIComponent(wishId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${session.token}` } });
  deleted = response.ok;
}

try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "許願池", exact: true }).click();
  const panel = page.locator(".wish-pool-panel");
  await panel.getByRole("button", { name: "建立你的共享身分" }).click();
  await page.getByPlaceholder("例如：Amber").fill("QAWishPool");
  await page.getByRole("button", { name: "建立身分", exact: true }).click();
  await panel.locator(".wish-identity-bar b").getByText("QAWishPool", { exact: true }).waitFor();
  await panel.getByRole("textbox", { name: /你希望澄境下一步加入什麼/ }).fill(`${marker}：確認 App、Worker 與 SQLite Durable Object 可以共同運作。`);
  await panel.getByRole("button", { name: "投入許願池" }).click();
  const wish = panel.locator(".wish-item").filter({ hasText: marker });
  await wish.waitFor();
  wishId = await wish.getAttribute("data-wish-id") || "";
  if (!wishId) throw new Error("wish-id-missing");

  await panel.getByRole("button", { name: "管理員登入" }).click();
  await panel.getByRole("textbox", { name: "管理密碼" }).fill(password);
  await panel.getByRole("button", { name: "登入", exact: true }).click();
  await panel.getByText("管理員模式已開啟", { exact: true }).waitFor();
  await wish.getByRole("button", { name: "刪除", exact: true }).click();
  await wish.getByRole("button", { name: "確定刪除", exact: true }).click();
  await wish.waitFor({ state: "detached" });
  deleted = true;
  console.log(JSON.stringify({ openedInApp: page.url().startsWith(base), created: true, adminLogin: true, deleted, errors }));
} finally {
  await cleanup();
  await browser.close();
}

if (!deleted || errors.length) process.exitCode = 1;
