const fs = require("node:fs");
const { app, dialog } = require("electron");
const service = require("../electron/google-drive-backup.cjs");
const report = { writes: 0, dialogs: 0, includedLastEdit: false };
const settings = { enabled: true, conflict: false, intervalMinutes: 30, lastSuccessAt: Date.now() };
service.createGoogleDriveBackupService = () => ({
  getLocalStatus: async () => ({ connected: true, configured: true, settings }),
  write: async ({ data }) => {
    report.writes++;
    if (process.env.QA_QUIT_FAIL === "1" && report.writes === 1) throw new Error("cloud-request-timeout");
    report.includedLastEdit = data.includes("quit-final-edit");
    settings.lastSuccessAt = Date.now();
    return { settings };
  },
});
dialog.showMessageBox = async () => { report.dialogs++; return { response: 0 }; };
app.on("will-quit", () => fs.writeFileSync(process.env.QA_QUIT_REPORT, JSON.stringify(report)));
require("../electron/main.cjs");
