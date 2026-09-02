const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeOpenRouterRoutingMode, providerPreferencesForRoutingMode } = require("./openrouter-routing.cjs");

test("平衡模式以 45 tokens/s 為偏好門檻，再依價格排序", () => {
  assert.deepEqual(providerPreferencesForRoutingMode("balanced"), { sort: "price", preferred_min_throughput: 45 });
});

test("極速模式使用與 Nitro 等價的 throughput 排序", () => {
  assert.deepEqual(providerPreferencesForRoutingMode("speed"), { sort: "throughput" });
});

test("省錢模式明確使用價格排序", () => {
  assert.deepEqual(providerPreferencesForRoutingMode("economy"), { sort: "price" });
});

test("未知或舊版路由值安全回到平衡模式", () => {
  assert.equal(normalizeOpenRouterRoutingMode("unknown"), "balanced");
  assert.deepEqual(providerPreferencesForRoutingMode(undefined), { sort: "price", preferred_min_throughput: 45 });
});
