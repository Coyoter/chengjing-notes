import { exports } from "cloudflare:workers";
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

declare const __COMMUNITY_MIGRATIONS__: D1Migration[];

const worker = exports.default;

beforeAll(async () => {
  await applyD1Migrations(env.COMMUNITY_DB, __COMMUNITY_MIGRATIONS__);
});

function request(path: string, init: RequestInit = {}, ip = "203.0.113.20") {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("CF-Connecting-IP", ip);
  return worker.fetch(new Request(`https://wish.test${path}`, { ...init, headers }));
}

function anonymousPayload(body: string) {
  return {
    authorId: crypto.randomUUID(),
    authorName: "匿名台灣黑熊",
    body,
  };
}

async function createIdentity(displayName = "Amber", ip = "203.0.113.70") {
  const response = await request("/v1/community/identity", { method: "POST", body: JSON.stringify({ displayName }) }, ip);
  expect(response.status).toBe(201);
  return response.json<{ identity: { id: string; displayName: string; token: string; seal: string; pattern: number } }>().then((payload) => payload.identity);
}

function identityHeaders(token: string) {
  return { "X-ChengJing-Identity": token };
}

describe("澄境許願池", () => {
  it("建立願望、兩層回覆並以游標列表回讀", async () => {
    const createdResponse = await request("/v1/wishes", { method: "POST", body: JSON.stringify(anonymousPayload("希望白板可以新增簡報模式。")) });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json<{ item: { id: string } }>();
    expect(created.item.id).toMatch(/^w_\d{6}_/);

    const replyResponse = await request(`/v1/wishes/${created.item.id}/replies`, { method: "POST", body: JSON.stringify(anonymousPayload("我也需要這個功能。")) }, "203.0.113.21");
    expect(replyResponse.status).toBe(201);

    const listResponse = await request("/v1/wishes?limit=20");
    expect(listResponse.status).toBe(200);
    const list = await listResponse.json<{ items: Array<{ id: string; body: string; replyCount: number; replies: Array<{ body: string }> }> }>();
    const wish = list.items.find((item) => item.id === created.item.id);
    expect(wish).toMatchObject({ body: "希望白板可以新增簡報模式。", replyCount: 1 });
    expect(wish?.replies[0]?.body).toBe("我也需要這個功能。");
  });

  it("管理員登入、醒目回覆與刪除都需要短期簽章", async () => {
    const createdResponse = await request("/v1/wishes", { method: "POST", body: JSON.stringify(anonymousPayload("希望新增管理員回覆。")) }, "203.0.113.30");
    const created = await createdResponse.json<{ item: { id: string } }>();

    const invalidLogin = await request("/v1/admin/login", { method: "POST", body: JSON.stringify({ password: "wrong" }) }, "203.0.113.31");
    expect(invalidLogin.status).toBe(401);
    const login = await request("/v1/admin/login", { method: "POST", body: JSON.stringify({ password: "test-admin-password" }) }, "203.0.113.32");
    expect(login.status).toBe(200);
    const session = await login.json<{ token: string; expiresAt: number }>();
    expect(session.expiresAt).toBeGreaterThan(Date.now());

    const adminReply = await request(`/v1/wishes/${created.item.id}/replies`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ body: "管理員已收到，會評估實作方式。" }),
    }, "203.0.113.32");
    expect(adminReply.status).toBe(201);
    const reply = await adminReply.json<{ item: { id: string; authorName: string; isAdmin: boolean } }>();
    expect(reply.item).toMatchObject({ authorName: "管理員", isAdmin: true });

    const anonymousDelete = await request(`/v1/replies/${reply.item.id}`, { method: "DELETE" }, "203.0.113.40");
    expect(anonymousDelete.status).toBe(401);
    const adminDelete = await request(`/v1/replies/${reply.item.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${session.token}` } }, "203.0.113.32");
    expect(adminDelete.status).toBe(200);
    expect(await adminDelete.json()).toEqual({ deleted: true });
  });

  it("拒絕第三層路由、過大內容與短時間濫用", async () => {
    const oversized = await request("/v1/wishes", { method: "POST", body: JSON.stringify(anonymousPayload("願".repeat(801))) }, "203.0.113.50");
    expect(oversized.status).toBe(400);

    let lastStatus = 0;
    for (let index = 0; index < 9; index += 1) {
      const response = await request("/v1/wishes", { method: "POST", body: JSON.stringify(anonymousPayload(`同一來源的第 ${index + 1} 則願望`)) }, "203.0.113.60");
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);

    const unknownRoute = await request("/v1/replies/some-reply/replies", { method: "POST", body: JSON.stringify(anonymousPayload("不允許第三層")) });
    expect(unknownRoute.status).toBe(404);
  });

  it("同名共享身分可共存，重新命名會同步到許願池", async () => {
    const first = await createIdentity("Amber", "203.0.113.71");
    const second = await createIdentity("Amber", "203.0.113.72");
    expect(first.id).not.toBe(second.id);
    expect(first.seal).toMatch(/^#[0-9a-f]{6}$/i);
    expect(first.pattern).not.toBe(second.pattern);

    const wishResponse = await request("/v1/wishes", { method: "POST", headers: identityHeaders(first.token), body: JSON.stringify({ body: "希望共享名称可以同步。" }) }, "203.0.113.71");
    expect(wishResponse.status).toBe(201);
    const wish = await wishResponse.json<{ item: { id: string; authorName: string } }>();
    expect(wish.item.authorName).toBe("Amber");

    const rename = await request("/v1/community/identity", { method: "PATCH", headers: identityHeaders(first.token), body: JSON.stringify({ displayName: "琥珀" }) }, "203.0.113.71");
    expect(rename.status).toBe(200);
    const renamed = await rename.json<{ identity: { pattern: number } }>();
    expect(renamed.identity.pattern).toBe(first.pattern);
    const list = await request("/v1/wishes?limit=20");
    const listed = await list.json<{ items: Array<{ id: string; authorName: string }> }>();
    expect(listed.items.find((item) => item.id === wish.item.id)?.authorName).toBe("琥珀");
  });

  it("共享、外圍探索、回聲通知與收進自己大腦形成完整閉環", async () => {
    const author = await createIdentity("海風", "203.0.113.73");
    const visitor = await createIdentity("山霧", "203.0.113.74");
    const sharedResponse = await request("/v1/community/neurons", {
      method: "POST", headers: identityHeaders(author.token),
      body: JSON.stringify({ sourceType: "fragment", title: "轉職前的猶豫", body: "想離開熟悉的工作，卻擔心新的方向不夠穩定。", intention: "help" }),
    }, "203.0.113.73");
    expect(sharedResponse.status).toBe(201);
    const shared = await sharedResponse.json<{ item: { id: string; isOwn: boolean } }>();
    expect(shared.item.isOwn).toBe(true);

    const updated = await request(`/v1/community/neurons/${shared.item.id}`, { method: "PATCH", headers: identityHeaders(author.token), body: JSON.stringify({ title: "轉職前的重新整理", body: "先把真正害怕的事情寫清楚，再決定是否離開。" }) }, "203.0.113.73");
    expect(updated.status).toBe(200);

    const discovery = await request("/v1/community/neurons/discover?pool=0", { headers: identityHeaders(visitor.token) });
    expect(discovery.status).toBe(200);
    const discovered = await discovery.json<{ items: Array<{ id: string; isOwn: boolean; title: string }> }>();
    expect(discovered.items.find((item) => item.id === shared.item.id)).toMatchObject({ isOwn: false, title: "轉職前的重新整理" });

    const echo = await request(`/v1/community/neurons/${shared.item.id}/comments`, {
      method: "POST", headers: identityHeaders(visitor.token), body: JSON.stringify({ body: "也許可以先用小型副業驗證新方向，不必一次跳到底。" }),
    }, "203.0.113.74");
    expect(echo.status).toBe(201);

    const notifications = await request("/v1/community/notifications?since=0", { headers: identityHeaders(author.token) });
    const notice = await notifications.json<{ items: Array<{ neuronId: string; authorName: string }> }>();
    expect(notice.items[0]).toMatchObject({ neuronId: shared.item.id, authorName: "山霧" });

    const fork = await request(`/v1/community/neurons/${shared.item.id}/fork`, { method: "POST", headers: identityHeaders(visitor.token), body: "{}" }, "203.0.113.74");
    expect(fork.status).toBe(201);
    const forked = await fork.json<{ item: { id: string; originNeuronId: string; isOwn: boolean } }>();
    expect(forked.item).toMatchObject({ originNeuronId: shared.item.id, isOwn: true });
  });
});
