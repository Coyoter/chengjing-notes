const ROUTING_MODES = new Set(["balanced", "speed", "economy"]);

function normalizeOpenRouterRoutingMode(value) {
  return ROUTING_MODES.has(value) ? value : "balanced";
}

function providerPreferencesForRoutingMode(value) {
  const mode = normalizeOpenRouterRoutingMode(value);
  if (mode === "speed") return { sort: "throughput" };
  if (mode === "economy") return { sort: "price" };
  return { sort: "price", preferred_min_throughput: 45 };
}

module.exports = { normalizeOpenRouterRoutingMode, providerPreferencesForRoutingMode };
