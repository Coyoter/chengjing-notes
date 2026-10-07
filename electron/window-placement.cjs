// Electron window bounds and display work areas are both in DIP coordinates.
// Never multiply these values by scaleFactor or replace a workArea with bounds.
function validRect(rect) {
  return rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
}
function overlapX(a, b) { return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)); }
function overlapArea(a, b) {
  return overlapX(a, b) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}
function sameBounds(a, b) { return ["x", "y", "width", "height"].every(key => Math.abs(a[key] - b[key]) < 1); }
function usableDisplays(displays) { return displays.filter(display => validRect(display.bounds) && validRect(display.workArea)); }
function nearestDisplay(bounds, displays) {
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  return [...displays].sort((a, b) => {
    const distance = display => {
      const r = display.workArea;
      return Math.max(r.x - x, 0, x - r.x - r.width) ** 2 + Math.max(r.y - y, 0, y - r.y - r.height) ** 2;
    };
    return distance(a) - distance(b);
  })[0];
}

function initialWindowBounds(display, width = 1480, height = 940) {
  const area = display.workArea;
  width = Math.min(width, area.width); height = Math.min(height, area.height);
  return { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2), width, height };
}

function windowCorrection(bounds, displays, state = {}) {
  if (!validRect(bounds) || state.fullscreen || state.simpleFullscreen || state.minimized) return null;
  const available = usableDisplays(displays);
  if (!available.length) return null;
  // A window can legitimately span stacked/negative-coordinate displays. Find
  // the display containing its top edge, not merely the centre of its body.
  const topDisplays = available.filter(display => bounds.y >= display.bounds.y - 0.5
    && bounds.y < display.bounds.y + display.bounds.height && overlapX(bounds, display.bounds) > 0);
  topDisplays.sort((a, b) => overlapX(bounds, b.bounds) - overlapX(bounds, a.bounds));
  const touching = available.filter(display => overlapArea(bounds, display.bounds) > 0)
    .sort((a, b) => overlapArea(bounds, b.bounds) - overlapArea(bounds, a.bounds));
  const display = topDisplays[0] || touching[0] || nearestDisplay(bounds, available);
  const area = display.workArea;
  const topVisible = bounds.y >= area.y - 0.5 && bounds.y < area.y + area.height && overlapX(bounds, area) > 0;
  if (topVisible) return null; // Bottom/side overhang alone is the user's choice.
  const disconnected = touching.length === 0;
  const width = disconnected ? Math.min(bounds.width, area.width) : bounds.width;
  const height = Math.min(bounds.height, area.height);
  const x = disconnected || overlapX(bounds, area) === 0
    ? Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)) : bounds.x;
  const y = Math.max(area.y, Math.min(bounds.y, area.y + area.height - height));
  const next = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  return sameBounds(bounds, next) ? null : { bounds: next, displayId: display.id, reason: disconnected ? "display-disconnected" : "top-outside-work-area" };
}

function geometrySnapshot(window, screen) {
  return {
    bounds: window.getBounds(), contentBounds: window.getContentBounds(), normalBounds: window.getNormalBounds(),
    fullscreen: window.isFullScreen(), simpleFullscreen: window.isSimpleFullScreen(), maximized: window.isMaximized(),
    minimized: window.isMinimized(), visible: window.isVisible(), focused: window.isFocused(),
    displayId: screen.getDisplayMatching(window.getBounds()).id,
    displays: screen.getAllDisplays().map(({ id, bounds, workArea, scaleFactor, rotation }) => ({ id, bounds, workArea, scaleFactor, rotation })),
  };
}

function createWindowPlacementGuard({ window, screen, app, powerMonitor, diagnostics, fullscreenPresentation, workspacePreferences, delay = 300 }) {
  let timer = null, applying = false, disposed = false, suspended = false, locked = false;
  const listeners = [];
  const listen = (emitter, event, callback) => { emitter.on(event, callback); listeners.push(() => emitter.removeListener(event, callback)); };
  function record(event, snapshot, extra) { diagnostics?.record(event, snapshot, extra); }
  function snapshot() { return geometrySnapshot(window, screen); }
  function check(event, allowHidden = false) {
    if (disposed || window.isDestroyed()) return;
    const before = snapshot();
    record(event, before);
    if (applying || suspended || (!before.visible && !allowHidden)) return;
    if (before.fullscreen && fullscreenPresentation) {
      const result = fullscreenPresentation.check();
      record(result.changed ? "fullscreen-presentation-repaired" : `${event}:fullscreen`, before, result);
      return;
    }
    if (locked) return;
    const correction = windowCorrection(before.bounds, before.displays, before);
    if (!correction) return;
    applying = true;
    try {
      const [minWidth, minHeight] = window.getMinimumSize();
      if (correction.bounds.width < minWidth || correction.bounds.height < minHeight) {
        window.setMinimumSize(Math.min(minWidth, correction.bounds.width), Math.min(minHeight, correction.bounds.height));
      }
      window.setBounds(correction.bounds, false);
      record("corrected", snapshot(), { trigger: event, reason: correction.reason, before: before.bounds, requested: correction.bounds });
    } finally { applying = false; }
  }
  function schedule(event) {
    if (disposed || applying || window.isDestroyed()) return;
    record(event, snapshot());
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; check(`${event}:settled`); }, delay);
  }
  for (const event of ["show", "focus", "restore", "leave-full-screen", "maximize", "unmaximize"]) listen(window, event, () => schedule(event));
  // Observe user moves/resizes without imposing placement during a drag.
  for (const event of ["moved", "resized", "hide", "minimize", "blur"]) listen(window, event, () => record(event, snapshot()));
  listen(window, "enter-full-screen", () => {
    clearTimeout(timer); timer = null;
    const native = fullscreenPresentation?.capture();
    record("enter-full-screen", snapshot(), native);
    schedule("fullscreen-entered");
  });
  listen(window, "leave-full-screen", () => fullscreenPresentation?.clear());
  listen(app, "did-become-active", () => schedule("app-active"));
  listen(screen, "display-added", () => schedule("display-added"));
  listen(screen, "display-removed", () => schedule("display-removed"));
  listen(screen, "display-metrics-changed", (_event, _display, metrics) => {
    if (metrics.some(metric => ["bounds", "workArea", "scaleFactor", "rotation"].includes(metric))) schedule(`display-metrics:${metrics.join(",")}`);
  });
  listen(powerMonitor, "suspend", () => { suspended = true; clearTimeout(timer); timer = null; record("suspend", snapshot()); });
  listen(powerMonitor, "resume", () => { suspended = false; schedule("resume"); });
  listen(powerMonitor, "lock-screen", () => { locked = true; record("lock-screen", snapshot()); });
  listen(powerMonitor, "unlock-screen", () => { locked = false; schedule("unlock-screen"); });
  if (workspacePreferences) {
    // Display wake is different from system resume or authentication unlock.
    const id = workspacePreferences.subscribeWorkspaceNotification("NSWorkspaceScreensDidWakeNotification", () => schedule("screens-wake"));
    listeners.push(() => workspacePreferences.unsubscribeWorkspaceNotification(id));
  }
  function dispose() { disposed = true; clearTimeout(timer); timer = null; for (const remove of listeners) remove(); }
  listen(window, "closed", dispose);
  return { check, schedule, dispose };
}

module.exports = { initialWindowBounds, windowCorrection, geometrySnapshot, createWindowPlacementGuard };
