const assert = require("node:assert/strict");
const test = require("node:test");
const { buildApplicationMenuTemplate, shouldUseUpdateMenuIcon } = require("./menu-template.cjs");

const messages = {
  app: "澄境", about: "關於澄境", checkUpdates: "檢查更新…", hide: "隱藏澄境", hideOthers: "隱藏其他應用程式", showAll: "全部顯示", quit: "結束澄境",
  file: "檔案", newCard: "新增卡片", search: "快速搜尋", export: "匯出備份", closeWindow: "關閉視窗", edit: "編輯", undo: "復原", redo: "重做", cut: "剪下", copy: "複製", paste: "貼上", selectAll: "全選",
  view: "顯示", reload: "重新載入", devtools: "開發者工具", actualSize: "實際大小", zoomIn: "放大", zoomOut: "縮小", fullscreen: "全螢幕", window: "視窗",
};

test("macOS 澄境選單提供檢查更新並送出共用快捷事件", () => {
  const shortcuts = [];
  const icon = { source: "SF Symbol" };
  const template = buildApplicationMenuTemplate({ messages, isMac: true, checkUpdatesIcon: icon, sendShortcut: (value) => shortcuts.push(value) });
  const appMenu = template[0];
  const checkItem = appMenu.submenu.find((item) => item.label === "檢查更新…");
  assert.equal(appMenu.label, "澄境");
  assert.ok(checkItem);
  assert.equal(checkItem.icon, icon);
  checkItem.click();
  assert.deepEqual(shortcuts, ["check-update"]);
  const closeItem = template.find((item) => item.label === "檔案").submenu.find((item) => item.label === "關閉視窗");
  assert.equal(closeItem.label, "關閉視窗");
  assert.equal(closeItem.accelerator, "CmdOrCtrl+W");
  closeItem.click();
  assert.deepEqual(shortcuts, ["check-update", "close-main-window"]);
});

test("只在 macOS 26 Tahoe 顯示自訂更新圖示", () => {
  assert.equal(shouldUseUpdateMenuIcon("darwin", "26.6.1"), true);
  assert.equal(shouldUseUpdateMenuIcon("darwin", "27.0"), false);
  assert.equal(shouldUseUpdateMenuIcon("win32", "26.0"), false);
});

test("非 macOS 不建立應用程式選單，但保留檔案功能", () => {
  const shortcuts = [];
  const template = buildApplicationMenuTemplate({ messages, isMac: false, sendShortcut: (value) => shortcuts.push(value) });
  assert.equal(template[0].label, "檔案");
  assert.ok(template[0].submenu.some((item) => item.role === "quit"));
  const checkItem = template[0].submenu.find((item) => item.label === "檢查更新…");
  assert.ok(checkItem);
  checkItem.click();
  assert.deepEqual(shortcuts, ["check-update"]);
});
