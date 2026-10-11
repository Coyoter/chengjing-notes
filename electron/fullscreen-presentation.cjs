const { fullscreenTopInset } = require("./fullscreen-layout.cjs");
function createFullscreenPresentation({ window, native, onLayout = () => {} }) {
  let baseline = null, preferencesChanged = false;
  const read = () => JSON.parse(native.read(window.getNativeWindowHandle()));
  function capture() {
    preferencesChanged = false;
    const state = read();
    baseline = state.fullscreen && state.active && state.keyWindow && state.autoHideMenuBar && (state.options & 1024)
      ? { options: state.options, preferenceToken: state.preferenceToken } : null;
    return state;
  }
  function clear() { baseline = null; preferencesChanged = false; onLayout(0); }
  function updateLayout() {
    const layout = native.readLayout ? JSON.parse(native.readLayout(window.getNativeWindowHandle())) : null;
    const inset = fullscreenTopInset(layout);
    onLayout(inset);
    return { topInset: inset, layout };
  }
  function check() {
    const state = read();
    if (!state.fullscreen) { clear(); return { changed: false, reason: "not-fullscreen", state }; }
    if (baseline && state.preferenceToken !== baseline.preferenceToken) {
      baseline = null; preferencesChanged = true;
      return { changed: false, reason: "preferences-changed", state };
    }
    if (!baseline && !preferencesChanged && state.active && state.keyWindow && state.autoHideMenuBar && (state.options & 1024)) {
      baseline = { options: state.options, preferenceToken: state.preferenceToken };
    }
    if (!baseline || !state.active || !state.keyWindow || state.minimized || state.autoHideMenuBar) {
      return { changed: false, reason: "unchanged", state };
    }
    return JSON.parse(native.repair(window.getNativeWindowHandle(), baseline.options, baseline.preferenceToken));
  }
  return { capture, check, clear, updateLayout };
}
module.exports = { createFullscreenPresentation };
