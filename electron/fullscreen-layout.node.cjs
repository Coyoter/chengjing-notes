const test = require("node:test");
const assert = require("node:assert/strict");
const { fullscreenTopInset } = require("./fullscreen-layout.cjs");
const windowBounds = { x: 0, y: 0, width: 1920, height: 1080 };
test("only a visible menu intersecting the top of a fullscreen window reserves space", () => {
  const menuBars = [{ x: 0, y: 0, width: 1920, height: 30 }];
  assert.equal(fullscreenTopInset({ fullscreen: true, windowBounds, menuBars }), 30);
  assert.equal(fullscreenTopInset({ fullscreen: false, windowBounds, menuBars }), 0);
  assert.equal(fullscreenTopInset({ fullscreen: true, windowBounds, menuBars: [] }), 0);
  assert.equal(fullscreenTopInset({ fullscreen: true, windowBounds, menuBars: [{ ...menuBars[0], y: -30 }] }), 0);
  assert.equal(fullscreenTopInset({ fullscreen: true, windowBounds, menuBars: [{ ...menuBars[0], x: 1920 }] }), 0);
});
test("reveal fraction, negative display origins and different menu heights use measured DIP bounds", () => {
  assert.equal(fullscreenTopInset({ fullscreen: true, windowBounds, menuBars: [{ x: 0, y: -12, width: 1920, height: 30 }] }), 18);
  assert.equal(fullscreenTopInset({ fullscreen: true, windowBounds: { x: -1600, y: -900, width: 1600, height: 900 }, menuBars: [{ x: -1600, y: -900, width: 1600, height: 37 }] }), 37);
  assert.equal(fullscreenTopInset({ fullscreen: true, windowBounds, menuBars: [{ x: NaN, y: 0, width: 1920, height: 30 }] }), 0);
});
