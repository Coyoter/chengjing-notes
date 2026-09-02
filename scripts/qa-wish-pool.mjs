import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/wish-pool");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", locale: "zh-TW" });
const now = Date.now();
let sequence = 10;
const wishes = [
  {
    id: "w_202608_00000000-0000-4000-8000-000000000001",
    authorName: "匿名姬小紋青斑蝶", authorPattern: 2,
    body: "希望卡片能支援專案里程碑，並在白板上看到下一個交付日。",
    isAdmin: false,
    createdAt: now - 60_000,
    replyCount: 2,
    replies: [
      { id: "r_202608_00000000-0000-4000-8000-000000000002", wishId: "w_202608_00000000-0000-4000-8000-000000000001", authorName: "匿名白線斑蚊", authorPattern: 4, body: "如果可以同步到待辦時間軸會更好。", isAdmin: false, createdAt: now - 45_000 },
      { id: "r_202608_00000000-0000-4000-8000-000000000003", wishId: "w_202608_00000000-0000-4000-8000-000000000001", authorName: "管理員", authorPattern: 6, body: "收到，會先評估和現有待辦日期整合。", isAdmin: true, createdAt: now - 30_000 },
    ],
    replyCursor: null,
  },
  {
    id: "w_202608_00000000-0000-4000-8000-000000000004",
    authorName: "匿名比利時瑪連萊犬", authorPattern: 7,
    body: "想在日誌裡快速插入今天完成的待辦清單。",
    isAdmin: false,
    createdAt: now - 120_000,
    replyCount: 0,
    replies: [],
    replyCursor: null,
  },
];

await context.route("https://chengjing-wish-pool.coyoter.workers.dev/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body), headers: { "Access-Control-Allow-Origin": "*" } });
  if (request.method() === "GET" && url.pathname === "/v1/wishes") return json({ items: wishes, nextCursor: null });
  if (request.method() === "POST" && url.pathname === "/v1/community/identity") return json({ identity: { id: "11111111-1111-4111-8111-111111111111", displayName: "Amber", token: `11111111-1111-4111-8111-${"1".repeat(12)}.${"a".repeat(44)}`, seal: "#718a9a", pattern: 1 } }, 201);
  if (request.method() === "POST" && url.pathname === "/v1/wishes") {
    const payload = request.postDataJSON();
    const item = { id: `w_202608_00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`, authorName: "Amber", body: payload.body, isAdmin: false, createdAt: Date.now(), replyCount: 0, replies: [], replyCursor: null };
    wishes.unshift(item);
    return json({ item }, 201);
  }
  if (request.method() === "POST" && url.pathname === "/v1/admin/login") return json({ token: "qa-admin-token", expiresAt: Date.now() + 43_200_000 });
  if (request.method() === "GET" && url.pathname === "/v1/admin/status") return json({ admin: request.headers().authorization === "Bearer qa-admin-token" });
  const replyMatch = url.pathname.match(/^\/v1\/wishes\/([^/]+)\/replies$/);
  if (request.method() === "POST" && replyMatch?.[1]) {
    const wish = wishes.find((item) => item.id === replyMatch[1]);
    const payload = request.postDataJSON();
    const isAdmin = request.headers().authorization === "Bearer qa-admin-token";
    const item = { id: `r_202608_00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`, wishId: replyMatch[1], authorName: isAdmin ? "管理員" : "Amber", body: payload.body, isAdmin, createdAt: Date.now() };
    wish?.replies.push(item); if (wish) wish.replyCount += 1;
    return json({ item }, 201);
  }
  const deleteWish = url.pathname.match(/^\/v1\/wishes\/([^/]+)$/);
  if (request.method() === "DELETE" && deleteWish?.[1]) { const index = wishes.findIndex((item) => item.id === deleteWish[1]); if (index >= 0) wishes.splice(index, 1); return json({ deleted: true }); }
  const deleteReply = url.pathname.match(/^\/v1\/replies\/([^/]+)$/);
  if (request.method() === "DELETE" && deleteReply?.[1]) { for (const wish of wishes) { const index = wish.replies.findIndex((item) => item.id === deleteReply[1]); if (index >= 0) { wish.replies.splice(index, 1); wish.replyCount -= 1; break; } } return json({ deleted: true }); }
  return json({ error: "not-found" }, 404);
});

const page = await context.newPage();
page.setDefaultTimeout(15_000);
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
await page.goto(base, { waitUntil: "networkidle" });

await page.getByRole("button", { name: "許願池", exact: true }).click();
const panel = page.locator(".wish-pool-panel");
await panel.waitFor();
const stayedInApp = page.url().startsWith(base);
const panelAtRight = await panel.evaluate((element) => { const rect = element.getBoundingClientRect(); return Math.abs(rect.right - window.innerWidth) < 20 && rect.width >= 350; });
const firstIdentity = await panel.locator(".wish-identity-bar b").textContent();
await panel.getByRole("button", { name: "建立你的共享身分" }).click();
await page.getByPlaceholder("例如：Amber").fill("Amber");
await page.getByRole("button", { name: "建立身分", exact: true }).click();
await panel.locator(".wish-identity-bar b").getByText("Amber", { exact: true }).waitFor();
const secondIdentity = await panel.locator(".wish-identity-bar b").textContent();
const identityConfigured = Boolean(firstIdentity?.includes("建立") && secondIdentity === "Amber");

await panel.getByRole("textbox", { name: /你希望澄境下一步加入什麼/ }).fill("希望第二大腦能把本週的重要變化整理成週報。");
await panel.getByRole("button", { name: "投入許願池" }).click();
await panel.getByText("希望第二大腦能把本週的重要變化整理成週報。", { exact: true }).waitFor();
const newWish = panel.locator(".wish-item").filter({ hasText: "希望第二大腦能把本週的重要變化整理成週報。" });
await newWish.getByRole("button", { name: /^回覆/ }).click();
await newWish.getByRole("textbox", { name: "留下回應…" }).fill("也希望能選擇要不要包含日誌內容。");
await newWish.getByRole("button", { name: "送出回覆" }).click();
await newWish.getByText("也希望能選擇要不要包含日誌內容。", { exact: true }).waitFor();

await panel.getByRole("button", { name: "管理員登入" }).click();
await panel.getByRole("textbox", { name: "管理密碼" }).fill("qa-admin");
await panel.getByRole("button", { name: "登入", exact: true }).click();
await panel.getByText("管理員模式已開啟", { exact: true }).waitFor();
const originalWish = panel.locator(".wish-item").filter({ hasText: "希望卡片能支援專案里程碑" });
await originalWish.getByRole("button", { name: /^回覆/ }).click();
await originalWish.getByRole("textbox", { name: "留下回應…" }).fill("管理員測試：已收錄到功能評估清單。");
await originalWish.getByRole("button", { name: "送出回覆" }).click();
const adminReply = originalWish.locator(".wish-replies section.is-admin").filter({ hasText: "管理員測試" });
await adminReply.waitFor();
const adminReplyHighlighted = await adminReply.evaluate((element) => getComputedStyle(element).backgroundColor !== getComputedStyle(element.parentElement).backgroundColor);

for (const theme of ["light", "dark", "ink"]) {
  await page.evaluate((value) => { document.documentElement.dataset.theme = value; document.documentElement.style.colorScheme = value === "light" ? "light" : "dark"; }, theme);
  await page.waitForTimeout(260);
  await page.screenshot({ path: path.join(output, `${theme}.png`), fullPage: true });
}
const typography = await panel.evaluate((element) => {
  const visible = [...element.querySelectorAll("*")].filter((node) => { const style = getComputedStyle(node); const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && (node.textContent || "").trim(); });
  return { minFont: Math.min(...visible.map((node) => Number.parseFloat(getComputedStyle(node).fontSize))), overflow: element.scrollWidth - element.clientWidth };
});

await panel.getByRole("button", { name: "關閉許願池" }).click();
await panel.waitFor({ state: "detached" });

const report = { stayedInApp, panelAtRight, firstIdentity, secondIdentity, identityConfigured, adminReplyHighlighted, typography, errors };
await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();

if (!stayedInApp || !panelAtRight || !identityConfigured || !adminReplyHighlighted || typography.minFont < 12 || typography.overflow > 1 || errors.length) process.exitCode = 1;
