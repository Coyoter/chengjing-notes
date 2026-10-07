const fs = require("node:fs/promises");
const path = require("node:path");

const copies = {
  "zh-TW": { toggle: "記錄視窗位置診斷", folder: "開啟視窗診斷資料夾" },
  "zh-CN": { toggle: "记录窗口位置诊断", folder: "打开窗口诊断文件夹" },
  en: { toggle: "Record window placement diagnostics", folder: "Open window diagnostics folder" },
  ja: { toggle: "ウインドウ位置の診断を記録", folder: "ウインドウ診断フォルダを開く" },
  ko: { toggle: "창 위치 진단 기록", folder: "창 진단 폴더 열기" },
};

async function createWindowDiagnostics({ userData, appVersion, electronVersion, environment = process.env.CHENGJING_WINDOW_DIAGNOSTICS }) {
  const settingsFile = path.join(userData, "window-diagnostics.json");
  const directory = path.join(userData, "window-diagnostics");
  const file = path.join(directory, "placement.jsonl");
  let enabled = false, queue = Promise.resolve(), lastRecord = "";
  try { enabled = JSON.parse(await fs.readFile(settingsFile, "utf8")).enabled === true; } catch {}
  if (environment === "1" || environment === "0") enabled = environment === "1";
  function record(event, geometry, detail) {
    if (!enabled) return;
    const value = { timestamp: new Date().toISOString(), appVersion, electronVersion, event, ...geometry, ...(detail ? { detail } : {}) };
    const fingerprint = JSON.stringify({ event, geometry, detail });
    if (fingerprint === lastRecord) return;
    lastRecord = fingerprint;
    queue = queue.then(async () => {
      await fs.mkdir(directory, { recursive: true });
      const size = await fs.stat(file).then(stat => stat.size).catch(() => 0);
      if (size >= 1024 * 1024) await fs.rename(file, `${file}.previous`).catch(() => {});
      await fs.appendFile(file, `${JSON.stringify(value)}\n`, "utf8");
    }).catch(() => {}); // Diagnostics must never prevent normal window operation.
  }
  async function setEnabled(value) {
    enabled = Boolean(value); lastRecord = "";
    await fs.writeFile(settingsFile, JSON.stringify({ enabled }), "utf8");
    if (enabled) await fs.mkdir(directory, { recursive: true });
    return enabled;
  }
  return { record, setEnabled, isEnabled: () => enabled, flush: () => queue, directory, copy: language => {
    const copy = copies[language] || copies.en;
    return { toggleLabel: copy.toggle, folder: copy.folder };
  } };
}
module.exports = { createWindowDiagnostics };
