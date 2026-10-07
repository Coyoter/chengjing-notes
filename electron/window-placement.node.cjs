const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { initialWindowBounds, windowCorrection, createWindowPlacementGuard } = require("./window-placement.cjs");
const primary = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 31, width: 1920, height: 1049 }, scaleFactor: 2 };
const normal = { x: 220, y: 86, width: 1480, height: 940 };

test("initial geometry uses work area and fits a smaller display", () => {
  assert.deepEqual(initialWindowBounds(primary), normal);
  const small = { ...primary, workArea: { x: -900, y: -568, width: 900, height: 568 } };
  assert.deepEqual(initialWindowBounds(small), small.workArea);
});
test("only an obscured top edge is repaired, retaining size and horizontal position", () => {
  assert.deepEqual(windowCorrection({ ...normal, y: 6 }, [primary]).bounds, { ...normal, y: 31 });
  for (const bounds of [normal, primary.workArea, { ...normal, x: -200, y: 100 }, { ...normal, y: 900 }]) {
    assert.equal(windowCorrection(bounds, [primary]), null);
  }
});
test("normal, native fill, full screen and simple full screen are distinct", () => {
  assert.equal(windowCorrection(primary.workArea, [primary], { maximized: true }), null);
  assert.equal(windowCorrection(primary.bounds, [primary], { fullscreen: true }), null);
  assert.equal(windowCorrection(primary.bounds, [primary], { simpleFullscreen: true }), null);
  assert.equal(windowCorrection(primary.bounds, [primary], { minimized: true }), null);
  assert.deepEqual(windowCorrection(primary.bounds, [primary], { maximized: true }).bounds, primary.workArea);
});
test("negative coordinates and mixed scaling do not change the coordinate system", () => {
  const left = { id: 2, scaleFactor: 1, bounds: { x: -1600, y: -900, width: 1600, height: 900 }, workArea: { x: -1600, y: -868, width: 1600, height: 850 } };
  const bounds = { x: -1500, y: -890, width: 1000, height: 700 };
  assert.deepEqual(windowCorrection(bounds, [primary, left]).bounds, { ...bounds, y: -868 });
  assert.equal(windowCorrection({ ...bounds, y: -800 }, [primary, left]), null);
});
test("a usable title area on a stacked display is retained even if the body is on another display", () => {
  const upper = { id: 2, bounds: { x: 0, y: -1080, width: 1920, height: 1080 }, workArea: { x: 0, y: -1049, width: 1920, height: 1049 } };
  assert.equal(windowCorrection({ x: 100, y: -300, width: 1400, height: 1500 }, [primary, upper]), null);
});
test("a disconnected display is recovered to the nearest available area, without centring", () => {
  const right = { id: 2, bounds: { x: 1920, y: 0, width: 1280, height: 720 }, workArea: { x: 1920, y: 25, width: 1280, height: 675 } };
  const result = windowCorrection({ x: 3500, y: 800, width: 1480, height: 940 }, [primary, right]);
  assert.equal(result.displayId, 2);
  assert.equal(result.reason, "display-disconnected");
  assert.deepEqual(result.bounds, right.workArea);
});
test("auto-hidden menu bars do not gain a fixed artificial top margin", () => {
  assert.equal(windowCorrection(primary.bounds, [{ ...primary, workArea: primary.bounds }]), null);
  assert.equal(windowCorrection(normal, []), null);
  assert.equal(windowCorrection({ ...normal, y: NaN }, [primary]), null);
  assert.equal(windowCorrection(normal, [{ ...primary, workArea: { x: 0, y: 0, width: 0, height: 0 } }]), null);
});

function fixture() {
  const window = new EventEmitter(), app = new EventEmitter(), screen = new EventEmitter(), powerMonitor = new EventEmitter();
  let bounds = { ...normal }, fullscreen = false, minimized = false, visible = true;
  const writes = [], records = [];
  Object.assign(window, {
    getBounds: () => ({ ...bounds }), getContentBounds: () => ({ ...bounds }), getNormalBounds: () => ({ ...bounds }),
    getMinimumSize: () => [1040, 680], setMinimumSize: () => {},
    isDestroyed: () => false, isFullScreen: () => fullscreen, isSimpleFullScreen: () => false, isMaximized: () => false,
    isMinimized: () => minimized, isVisible: () => visible, isFocused: () => true,
    setBounds: next => { bounds = next; writes.push(next); window.emit("moved"); window.emit("resized"); window.emit("focus"); },
  });
  Object.assign(screen, { getAllDisplays: () => [primary], getDisplayMatching: () => primary });
  const guard = createWindowPlacementGuard({ window, app, screen, powerMonitor, delay: 5, diagnostics: { record: event => records.push(event) } });
  return { window, app, screen, powerMonitor, guard, writes, records,
    bounds: value => { bounds = value; }, fullscreen: value => { fullscreen = value; }, visible: value => { visible = value; }, minimized: value => { minimized = value; } };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
test("focus and active events leave a normal window exactly unchanged", async () => {
  const h = fixture(); h.window.emit("focus"); h.app.emit("did-become-active"); await settle();
  assert.equal(h.writes.length, 0); h.guard.dispose();
});
test("a burst uses live geometry and corrects once without move/focus recursion", async () => {
  const h = fixture(); h.bounds({ ...normal, y: 0 });
  h.window.emit("focus"); h.window.emit("show"); h.screen.emit("display-metrics-changed", {}, primary, ["workArea"]);
  await settle(); assert.deepEqual(h.writes, [{ ...normal, y: 31 }]);
  await settle(); assert.equal(h.writes.length, 1);
  h.bounds({ ...normal, y: 0 }); h.window.emit("focus"); h.bounds(normal);
  await settle(); assert.equal(h.writes.length, 1); h.guard.dispose();
});
test("full screen transitions, suspension and lock defer correction until return", async () => {
  const h = fixture(); h.bounds(primary.bounds); h.fullscreen(true); h.window.emit("focus"); await settle();
  assert.equal(h.writes.length, 0);
  h.fullscreen(false); h.bounds({ ...normal, y: 0 }); h.powerMonitor.emit("suspend"); h.window.emit("focus"); await settle();
  assert.equal(h.writes.length, 0);
  h.powerMonitor.emit("lock-screen"); h.powerMonitor.emit("resume"); await settle(); assert.equal(h.writes.length, 0);
  h.powerMonitor.emit("unlock-screen"); await settle(); assert.equal(h.writes.length, 1); h.guard.dispose();
});
test("hidden/minimized windows are not moved by background events and disposal cancels pending work", async () => {
  const h = fixture(); h.bounds({ ...normal, y: 0 }); h.visible(false); h.app.emit("did-become-active"); await settle();
  assert.equal(h.writes.length, 0); h.guard.check("before-show", true); assert.equal(h.writes.length, 1);
  h.visible(true); h.minimized(true); h.bounds({ ...normal, y: 0 }); h.window.emit("focus"); await settle(); assert.equal(h.writes.length, 1);
  h.minimized(false); h.window.emit("focus"); h.window.emit("closed"); await settle(); assert.equal(h.writes.length, 1);
  assert.equal(h.app.listenerCount("did-become-active"), 0); assert.equal(h.screen.listenerCount("display-removed"), 0);
});
