const assert = require("node:assert/strict");
const test = require("node:test");
const { parseMacHotkey } = require("./mac-hotkey.cjs");

test("macOS 原生快捷鍵以實體 key code 解析預設 Command+反斜線", () => {
  assert.deepEqual(parseMacHotkey("CommandOrControl+\\"), { keyCode: 42, modifiers: 256 });
});

test("macOS 原生快捷鍵支援多修飾鍵與方向鍵", () => {
  assert.deepEqual(parseMacHotkey("CommandOrControl+Alt+Shift+Up"), { keyCode: 126, modifiers: 2816 });
});

test("無修飾鍵或未知鍵會安全交回 Electron", () => {
  assert.equal(parseMacHotkey("A"), null);
  assert.equal(parseMacHotkey("CommandOrControl+UnknownKey"), null);
});
