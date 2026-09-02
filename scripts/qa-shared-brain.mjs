import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.CHENGJING_URL || "http://127.0.0.1:5173";
const output = path.resolve("qa-artifacts/shared-brain");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1680, height: 1000 }, colorScheme: "dark", locale: "zh-TW" });
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const errors = [];
const requests = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });

const identity = { id: "11111111-1111-4111-8111-111111111111", displayName: "Amber", token: `11111111-1111-4111-8111-111111111111.${"a".repeat(44)}`, seal: "#718a9a", pattern: 1 };
const remote = { id: "n-remote-1", title: "離開熟悉工作前的猶豫", sourceType: "fragment", authorName: "山霧", seal: "#8e8f73", authorPattern: 5, intention: "help", commentCount: 1, createdAt: Date.now(), isOwn: false };
const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

await page.route("https://chengjing-wish-pool.coyoter.workers.dev/v1/community/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  requests.push({ method: request.method(), path: url.pathname, identity: Boolean(request.headers()["x-chengjing-identity"]) });
  const fulfill = (body, status = 200) => route.fulfill({ status, headers, body: JSON.stringify(body) });
  if (url.pathname === "/v1/community/identity" && request.method() === "POST") return fulfill({ identity }, 201);
  if (url.pathname === "/v1/community/notifications") return fulfill({ items: [] });
  if (url.pathname.endsWith("/discover")) return fulfill({ items: [remote], refreshAt: Date.now() + 300_000 });
  if (url.pathname === "/v1/community/neurons" && request.method() === "POST") {
    const body = request.postDataJSON();
    return fulfill({ item: { ...remote, id: "n-own-1", title: body.title, authorName: "Amber", seal: identity.seal, authorPattern: identity.pattern, sourceType: body.sourceType, intention: body.intention, body: body.body, comments: [], commentCursor: null, commentCount: 0, isOwn: true } }, 201);
  }
  if (url.pathname === "/v1/community/neurons/n-own-1" && request.method() === "GET") return fulfill({ item: { ...remote, id: "n-own-1", title: "自己的共享神經元", authorName: "Amber", seal: identity.seal, authorPattern: identity.pattern, intention: "perspective", commentCount: 1, isOwn: true, body: "這是通知直接開啟的共享神經元。", comments: [{ id: "c-own-reply", neuronId: "n-own-1", authorName: "遠山", seal: "#8e8f73", authorPattern: 7, body: "這是一則新回聲。", isAuthor: false, isAdmin: false, isOwn: false, createdAt: Date.now() }], commentCursor: null } });
  if (url.pathname === "/v1/community/neurons/n-remote-1" && request.method() === "GET") return fulfill({ item: { ...remote, body: "我想離開做了七年的工作，卻不確定這是暫時疲倦，還是真的該離開。", comments: [{ id: "c-1", neuronId: remote.id, authorName: "微光", seal: "#7e9277", authorPattern: 3, body: "也許可以先替自己留一條能回來的路。", isAuthor: false, isAdmin: false, isOwn: false, createdAt: Date.now() - 20_000 }], commentCursor: null } });
  if (url.pathname.endsWith("/comments") && request.method() === "POST") return fulfill({ item: { id: "c-new", neuronId: remote.id, authorName: "Amber", seal: identity.seal, authorPattern: identity.pattern, body: request.postDataJSON().body, isAuthor: false, isAdmin: false, isOwn: true, createdAt: Date.now() } }, 201);
  if (url.pathname.endsWith("/fork") && request.method() === "POST") return fulfill({ item: { ...remote, id: "n-fork-1", authorName: "Amber", seal: identity.seal, authorPattern: identity.pattern, body: "我想離開做了七年的工作。", comments: [], commentCursor: null, commentCount: 0, originNeuronId: remote.id, isOwn: true } }, 201);
  if (url.pathname === "/v1/community/reports" && request.method() === "POST") return fulfill({ reported: true }, 201);
  if (request.method() === "PATCH") return fulfill({ updated: true });
  return fulfill({ error: "not-found" }, 404);
});

await page.goto(base, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "第二大腦", exact: true }).click();
const oldShareRemoved = await page.getByRole("button", { name: "分享大腦", exact: true }).count() === 0;

await page.locator("[data-brain-node-key]").first().evaluate((element) => element.click());
await page.getByRole("button", { name: "共享這顆神經元", exact: true }).click();
await page.getByPlaceholder("例如：Amber").fill("Amber");
await page.getByRole("button", { name: "建立身分", exact: true }).click();
await page.locator(".shared-neuron-dialog").waitFor();
const irreversibleDefault = await page.locator(".shared-irreversible input").isChecked();
const confirmInitiallyDisabled = !await page.getByRole("button", { name: "確認共享", exact: true }).isEnabled();
await page.getByText("想聽不同觀點", { exact: true }).click();
await page.getByText("我知道共享後不能改回私人", { exact: true }).click();
await page.getByRole("button", { name: "確認共享", exact: true }).click();
await page.locator(".brain-own-shared-badge").waitFor();
const ownSharedBadge = await page.locator(".brain-own-shared-badge").innerText();

await page.evaluate(() => window.dispatchEvent(new CustomEvent("chengjing-open-shared-neuron", { detail: "n-own-1" })));
await page.locator(".shared-neuron-inspector h2").getByText("自己的共享神經元", { exact: true }).waitFor();
const singleInspectorDuringNotification = await page.locator(".shared-neuron-inspector").count() === 1 && await page.locator(".brain-inspector").count() === 0;
const identityPatternsVisible = new Set(await page.locator(".shared-neuron-inspector .identity-seal").evaluateAll((items) => items.map((item) => item.getAttribute("data-identity-pattern")))).size >= 2;
await page.locator(".shared-neuron-inspector .shared-neuron-close").click();
await page.locator(".shared-neuron-inspector").waitFor({ state: "detached" });
await page.locator(".brain-inspector").waitFor();
const localInspectorRestoredAfterClose = await page.locator(".brain-inspector").count() === 1;

await page.getByRole("button", { name: "探索共享大腦", exact: true }).click();
await page.waitForFunction(() => document.querySelectorAll("[data-shared-neuron-id]").length === 1);
await page.locator('[data-shared-neuron-id="n-remote-1"]').evaluate((element) => element.click());
await page.locator(".shared-neuron-inspector h2").getByText(remote.title, { exact: true }).waitFor();
await page.locator(".shared-comment-composer textarea").fill("你的描述也讓我重新看見自己的猶豫。");
await page.getByRole("button", { name: "留下回聲", exact: true }).click();
await page.getByText("你的描述也讓我重新看見自己的猶豫。", { exact: true }).waitFor();
await page.getByRole("button", { name: "收進我的共享大腦", exact: true }).click();
await page.getByText(/已建立一份屬於你的共享副本/).waitFor();
await page.getByRole("button", { name: "檢舉", exact: true }).first().click();
await page.getByText("其他", { exact: true }).click();
await page.getByRole("button", { name: "送出檢舉", exact: true }).click();
await page.getByText(/已交給管理員檢視/).waitFor();

for (const theme of ["light", "dark", "ink"]) {
  await page.evaluate((value) => { document.documentElement.dataset.theme = value; document.documentElement.style.colorScheme = value === "light" ? "light" : "dark"; }, theme);
  await page.waitForTimeout(180);
  await page.screenshot({ path: path.join(output, `community-${theme}.png`), fullPage: true });
}

const report = {
  oldShareRemoved,
  irreversibleDefault,
  confirmInitiallyDisabled,
  identityHeaderUsed: requests.filter((item) => item.method !== "GET").every((item) => item.path === "/v1/community/identity" || item.identity),
  remoteSummaryCount: await page.locator("[data-shared-neuron-id]").count(),
  ownSharedBadge,
  singleInspectorDuringNotification,
  identityPatternsVisible,
  localInspectorRestoredAfterClose,
  commentCreated: await page.getByText("你的描述也讓我重新看見自己的猶豫。", { exact: true }).count() === 1,
  requests,
  errors,
};
await fs.writeFile(path.join(output, "community-summary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (!oldShareRemoved || irreversibleDefault || !confirmInitiallyDisabled || !report.identityHeaderUsed || report.remoteSummaryCount !== 1 || report.ownSharedBadge !== "已共享" || !report.singleInspectorDuringNotification || !report.identityPatternsVisible || !report.localInspectorRestoredAfterClose || !report.commentCreated || errors.length) process.exitCode = 1;
