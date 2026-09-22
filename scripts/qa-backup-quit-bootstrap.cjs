const fs = require("node:fs");
const { app, dialog, net } = require("electron");
const service = require("../electron/google-drive-backup.cjs");
const report = { writes: 0, dialogs: 0, includedLastEdit: false, legacyWrites: 0 };
const settings = { enabled: false, conflict: false, intervalMinutes: 30, lastSuccessAt: Date.now() };
// All cloud operations are local doubles. No Google account or user workspace is used.
net.fetch = async () => { throw new Error("qa-external-network-disabled"); };
const recoveryStatus = { dayBasis: "UTC", today: { day: new Date().toISOString().slice(0, 10) }, yesterday: null, dayBeforeYesterday: null };
service.createGoogleDriveBackupService = () => ({
  getLocalStatus: async () => ({ connected: true, configured: true, settings }),
  write: async () => { report.legacyWrites++; throw new Error("legacy snapshots must not run"); },
  syncList: async () => ({ files: [] }),
  syncGet: async () => { throw new Error("no remote packet expected"); },
  syncPut: async (_id, data) => {
    report.writes++;
    if (process.env.QA_QUIT_FAIL === "1" && (report.writes === 1
      || (process.env.QA_QUIT_CHOICE === "cancel" && !fs.existsSync(process.env.QA_QUIT_ALLOW_FILE)))) {
      throw new Error("cloud-request-timeout");
    }
    report.includedLastEdit = data.includes("quit-final-edit");
    return { id: "test-packet" };
  },
  syncRecovery: { setEnabled: async () => ({}), getStatus: async () => recoveryStatus },
});
dialog.showMessageBox = async () => {
  report.dialogs++;
  fs.writeFileSync(process.env.QA_QUIT_REPORT, JSON.stringify(report));
  return { response: process.env.QA_QUIT_CHOICE === "cancel" ? 1 : process.env.QA_QUIT_CHOICE === "quit" ? 2 : 0 };
};
app.on("will-quit", () => fs.writeFileSync(process.env.QA_QUIT_REPORT, JSON.stringify(report)));
require("../electron/main.cjs");
