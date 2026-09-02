const endpoint = "https://chengjing-wish-pool.coyoter.workers.dev";
const password = process.env.WISH_POOL_ADMIN_PASSWORD || "";
if (!password) throw new Error("WISH_POOL_ADMIN_PASSWORD is required");

async function json(path, init = {}) {
  const response = await fetch(`${endpoint}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init.headers || {}) } });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${response.status}:${payload.error || "request-failed"}`);
  return payload;
}

const author = { authorId: crypto.randomUUID(), authorName: "匿名台灣黑熊" };
let wishId = "";
let token = "";
const neuronIds = [];
try {
  const created = await json("/v1/wishes", { method: "POST", body: JSON.stringify({ ...author, body: "QA：確認許願池正式環境可以新增、回覆並由管理員清理。" }) });
  wishId = created.item.id;
  const reply = await json(`/v1/wishes/${encodeURIComponent(wishId)}/replies`, { method: "POST", body: JSON.stringify({ ...author, body: "匿名回覆測試完成。" }) });
  const login = await json("/v1/admin/login", { method: "POST", body: JSON.stringify({ password }) });
  token = login.token;
  const adminReply = await json(`/v1/wishes/${encodeURIComponent(wishId)}/replies`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ body: "管理員回覆測試完成。" }) });
  if (!adminReply.item.isAdmin || adminReply.item.authorName !== "管理員") throw new Error("admin-reply-not-marked");
  const list = await json("/v1/wishes?limit=20");
  const found = list.items.find((item) => item.id === wishId);
  if (!found || found.replyCount !== 2 || found.replies.length !== 2) throw new Error("public-readback-failed");
  console.log(JSON.stringify({ created: true, publicReply: true, adminReply: true, replyCount: found.replyCount }));
} finally {
  if (wishId && token) await json(`/v1/wishes/${encodeURIComponent(wishId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
}

const finalList = await json("/v1/wishes?limit=20");
if (finalList.items.some((item) => item.id === wishId)) throw new Error("cleanup-failed");
console.log(JSON.stringify({ cleanup: true }));

async function identity(displayName) {
  const result = await json("/v1/community/identity", { method: "POST", body: JSON.stringify({ displayName }) });
  return result.identity;
}

function identityHeaders(value) {
  return { "X-ChengJing-Identity": value.token };
}

try {
  const owner = await identity("ProductionQAOne");
  const visitor = await identity("ProductionQATwo");
  const shared = await json("/v1/community/neurons", { method: "POST", headers: identityHeaders(owner), body: JSON.stringify({ sourceType: "fragment", title: "Production QA neuron", body: "Verifies shared-neuron publishing, echoes, notifications, and copies.", intention: "help" }) });
  neuronIds.push(shared.item.id);
  await json(`/v1/community/neurons/${encodeURIComponent(shared.item.id)}/comments`, { method: "POST", headers: identityHeaders(visitor), body: JSON.stringify({ body: "Production QA echo." }) });
  const notifications = await json("/v1/community/notifications?since=0", { headers: identityHeaders(owner) });
  if (!notifications.items.some((item) => item.neuronId === shared.item.id)) throw new Error("community-notification-missing");
  const forked = await json(`/v1/community/neurons/${encodeURIComponent(shared.item.id)}/fork`, { method: "POST", headers: identityHeaders(visitor), body: "{}" });
  neuronIds.push(forked.item.id);
  if (forked.item.originNeuronId !== shared.item.id) throw new Error("community-provenance-missing");
  await json("/v1/community/reports", { method: "POST", headers: identityHeaders(visitor), body: JSON.stringify({ targetType: "neuron", targetId: shared.item.id, reason: "other", detail: "Production QA report." }) });
  const reports = await json("/v1/admin/community/reports", { headers: { Authorization: `Bearer ${token}` } });
  const report = reports.items.find((item) => item.targetId === shared.item.id);
  if (!report) throw new Error("community-report-missing");
  await json(`/v1/admin/community/reports/${encodeURIComponent(report.id)}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: "dismiss" }) });
  console.log(JSON.stringify({ identity: true, sharedNeuron: true, echo: true, notification: true, fork: true, report: true }));
} finally {
  for (const id of neuronIds) await json(`/v1/community/neurons/${encodeURIComponent(id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
}

console.log(JSON.stringify({ communityCleanup: neuronIds.length }));
