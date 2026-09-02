function shouldUseUpdateMenuIcon(platform, systemVersion) {
  const major = Number.parseInt(String(systemVersion || "").split(".")[0], 10);
  return platform === "darwin" && major === 26;
}

function buildApplicationMenuTemplate({ messages, isMac = true, checkUpdatesIcon, sendShortcut = () => {} }) {
  const m = messages;
  return [
    ...(isMac ? [{
      label: m.app,
      submenu: [
        { role: "about", label: m.about },
        { label: m.checkUpdates, ...(checkUpdatesIcon ? { icon: checkUpdatesIcon } : {}), click: () => sendShortcut("check-update") },
        { type: "separator" },
        { role: "hide", label: m.hide },
        { role: "hideOthers", label: m.hideOthers },
        { role: "unhide", label: m.showAll },
        { type: "separator" },
        { role: "quit", label: m.quit },
      ],
    }] : []),
    {
      label: m.file,
      submenu: [
        { label: m.newCard, accelerator: "CmdOrCtrl+N", click: () => sendShortcut("new-card") },
        { label: m.search, accelerator: "CmdOrCtrl+K", click: () => sendShortcut("command") },
        { type: "separator" },
        { label: m.export, click: () => sendShortcut("export") },
        ...(!isMac ? [{ label: m.checkUpdates, click: () => sendShortcut("check-update") }] : []),
        { type: "separator" },
        { label: m.closeWindow, accelerator: "CmdOrCtrl+W", click: () => sendShortcut("close-main-window") },
        ...(isMac ? [] : [{ role: "quit", label: m.quit }]),
      ],
    },
    {
      label: m.edit,
      submenu: [
        { role: "undo", label: m.undo },
        { role: "redo", label: m.redo },
        { type: "separator" },
        { role: "cut", label: m.cut },
        { role: "copy", label: m.copy },
        { role: "paste", label: m.paste },
        { role: "selectAll", label: m.selectAll },
      ],
    },
    {
      label: m.view,
      submenu: [
        { role: "reload", label: m.reload },
        { role: "toggleDevTools", label: m.devtools },
        { type: "separator" },
        { role: "resetZoom", label: m.actualSize },
        { role: "zoomIn", label: m.zoomIn },
        { role: "zoomOut", label: m.zoomOut },
        { role: "togglefullscreen", label: m.fullscreen },
      ],
    },
    { role: "windowMenu", label: m.window },
  ];
}

module.exports = { buildApplicationMenuTemplate, shouldUseUpdateMenuIcon };
