"use strict";
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

const profile = process.env.CHENGJING_RECOVERY_QA_PROFILE;
if (!profile || !path.basename(profile).startsWith("chengjing-recovery-desktop-qa-")) {
  throw new Error("QA requires its own temporary profile");
}
const realProfile = fs.realpathSync(profile);
const relative = path.relative(fs.realpathSync(os.tmpdir()), realProfile);
if (relative.startsWith("..") || path.isAbsolute(relative)
  || fs.readFileSync(path.join(profile, "QA_ONLY"), "utf8") !== "isolated-recovery-ui-test") {
  throw new Error("Refusing to use an unverified profile");
}
const dist = fs.realpathSync(path.resolve(__dirname, "../dist"));
const sessionPath = path.join(profile, "chromium");
fs.mkdirSync(sessionPath, { recursive: true, mode: 0o700 });

app.setName("ChengJing Recovery UI QA");
app.setPath("userData", profile);
app.setPath("sessionData", sessionPath);
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-component-update");

globalThis.__recoveryQaBlockedOrigins = [];
setTimeout(() => app.exit(2), 150_000).unref();

app.whenReady().then(async () => {
  const isolated = session.fromPartition("recovery-ui-qa", { cache: false });
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false;
    try {
      const url = new URL(details.url);
      if (["about:", "data:", "blob:", "devtools:"].includes(url.protocol)) allowed = true;
      if (url.protocol === "file:") {
        const rel = path.relative(dist, fileURLToPath(url));
        allowed = !rel.startsWith("..") && !path.isAbsolute(rel);
      }
      if (!allowed) globalThis.__recoveryQaBlockedOrigins.push(url.protocol + "//" + url.host);
    } catch {}
    callback({ cancel: !allowed });
  });

  const window = new BrowserWindow({
    width: 1440, height: 980, show: false, frame: false,
    title: "ChengJing — isolated recovery UI test",
    webPreferences: {
      session: isolated, contextIsolation: true, nodeIntegration: false,
      sandbox: true, backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file:") && url !== "about:blank") event.preventDefault();
  });
  await window.loadURL("about:blank");
}).catch(error => {
  console.error(error);
  app.exit(1);
});
app.on("window-all-closed", () => app.quit());
