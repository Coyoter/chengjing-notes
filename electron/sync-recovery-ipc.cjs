"use strict";

const CHANNELS = Object.freeze({
  getStatus: "sync-recovery:get-status",
  setEnabled: "sync-recovery:set-enabled",
  createDaily: "sync-recovery:create-daily",
  download: "sync-recovery:download",
  releaseDownload: "sync-recovery:release-download",
});

function publicError(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  if (/^sync-recovery-[a-z0-9-]+$/.test(message)) return new Error(message);
  if (/^cloud-auth-(required|expired)$/.test(message)) return new Error("sync-recovery-auth-required");
  return new Error("sync-recovery-operation-failed");
}

function registerSyncRecoveryIpc({ ipcMain, getMainWindow, getService }) {
  let owner = null;

  function clearOwner() {
    const prior = owner;
    owner = null;
    if (!prior) return;
    for (const name of ["destroyed", "render-process-gone", "did-navigate"]) {
      prior.sender.removeListener(name, prior.stop);
    }
    prior.service.setEnabled(false);
  }

  function bindOwner(sender, service) {
    if (owner?.sender === sender && owner.service === service) return;
    clearOwner();
    const entry = { sender, service, stop: null };
    entry.stop = () => { if (owner === entry) clearOwner(); };
    owner = entry;
    for (const name of ["destroyed", "render-process-gone", "did-navigate"]) {
      sender.on(name, entry.stop);
    }
  }

  function trustedSender(event) {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) throw new Error("sync-recovery-untrusted-sender");
    const sender = window.webContents;
    if (!sender || sender.isDestroyed() || event.sender !== sender
      || !event.senderFrame || event.senderFrame !== sender.mainFrame) {
      throw new Error("sync-recovery-untrusted-sender");
    }
    return sender;
  }

  for (const [method, channel] of Object.entries(CHANNELS)) {
    ipcMain.handle(channel, async (event, value) => {
      try {
        const sender = trustedSender(event);
        if (method === "setEnabled" && typeof value !== "boolean") {
          throw new Error("sync-recovery-enabled-invalid");
        }
        const service = getService();
        if (!service || typeof service[method] !== "function") {
          throw new Error("sync-recovery-unavailable");
        }
        if (method === "setEnabled" && value) bindOwner(sender, service);
        // Disabling must reach the service immediately, not wait behind an upload.
        return await (method === "getStatus" ? service[method]() : service[method](value));
      } catch (error) {
        throw publicError(error);
      }
    });
  }

  return () => {
    for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel);
    clearOwner();
  };
}

module.exports = { CHANNELS, registerSyncRecoveryIpc };
