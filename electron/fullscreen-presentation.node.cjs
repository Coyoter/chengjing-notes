const assert = require("node:assert/strict");
const test = require("node:test");
const { createFullscreenPresentation } = require("./fullscreen-presentation.cjs");
function fixture() {
  let state = { fullscreen: true, active: true, keyWindow: true, minimized: false, autoHideMenuBar: true, menuBarVisible: false, options: 1029, preferenceToken: "[2,null,0]" };
  const repairs = [];
  const controller = createFullscreenPresentation({ window: { getNativeWindowHandle: () => Buffer.alloc(8) }, native: {
    read: () => JSON.stringify(state),
    repair: (_handle, options, token) => { repairs.push({ options, token }); state = { ...state, options, autoHideMenuBar: true, menuBarVisible: false }; return JSON.stringify({ changed: true, after: state }); },
  } });
  return { controller, repairs, state: patch => { state = { ...state, ...patch }; } };
}
test("only missing full-screen presentation is restored, using the OS-established baseline", () => {
  const h = fixture(); h.controller.capture();
  assert.equal(h.controller.check().changed, false);
  h.state({ autoHideMenuBar: false, menuBarVisible: true, options: 1024 });
  assert.equal(h.controller.check().changed, true);
  assert.deepEqual(h.repairs, [{ options: 1029, token: "[2,null,0]" }]);
  assert.equal(h.controller.check().changed, false); assert.equal(h.repairs.length, 1);
});
test("hovering the menu, inactive apps, auxiliary windows and normal windows are left alone", () => {
  for (const patch of [{ menuBarVisible: true }, { active: false, autoHideMenuBar: false, menuBarVisible: true },
    { keyWindow: false, autoHideMenuBar: false, menuBarVisible: true }, { fullscreen: false, autoHideMenuBar: false, menuBarVisible: true }]) {
    const h = fixture(); h.controller.capture(); h.state(patch); assert.equal(h.controller.check().changed, false); assert.equal(h.repairs.length, 0);
  }
});
test("system preference changes invalidate the baseline until the next fullscreen entry", () => {
  const h = fixture(); h.controller.capture(); h.state({ preferenceToken: "[3,null,0]", autoHideMenuBar: false, menuBarVisible: true, options: 1024 });
  assert.equal(h.controller.check().reason, "preferences-changed");
  h.state({ preferenceToken: "[2,null,0]" }); assert.equal(h.controller.check().changed, false); assert.equal(h.repairs.length, 0);
  h.state({ autoHideMenuBar: true, menuBarVisible: false, options: 1029 }); h.controller.capture();
  h.state({ autoHideMenuBar: false, menuBarVisible: true, options: 0 }); assert.equal(h.controller.check().changed, true);
});
test("a non-autohiding baseline or a missing baseline never forces menu hiding", () => {
  const h = fixture(); h.state({ autoHideMenuBar: false, menuBarVisible: true, options: 1024 });
  h.controller.capture(); assert.equal(h.controller.check().changed, false); assert.equal(h.repairs.length, 0);
});
test("a lost auto-hide mode is restored even when the native visibility query says the bar is hidden", () => {
  const h = fixture(); h.controller.capture(); h.state({ options: 1034, autoHideMenuBar: false, menuBarVisible: false });
  assert.equal(h.controller.check().changed, true); assert.equal(h.repairs.length, 1);
});
