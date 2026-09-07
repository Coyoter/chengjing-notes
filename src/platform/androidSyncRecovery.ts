import type { SyncRecoveryBridge } from "../types";

export type AndroidRecoveryCaller =
  (method: string, args?: Record<string, unknown>) => Promise<unknown>;

/** Prevent an authorization refresh started before pause from publishing afterward. */
export function createAndroidSyncRecoveryBridge(call: AndroidRecoveryCaller): SyncRecoveryBridge {
  let enabled = false;
  let generation = 0;

  const invoke = <T>(method: string, args: Record<string, unknown> = {}) =>
    call(method, args) as Promise<T>;

  async function authenticated<T>(
    method: string, args: Record<string, unknown>, needsEnabled: boolean,
  ): Promise<T> {
    const ticket = generation;
    const check = () => {
      if (ticket !== generation || (needsEnabled && !enabled)) {
        throw new Error("sync-recovery-paused");
      }
    };
    check();
    const account = await invoke<{ connected: boolean }>("google.status");
    check();
    if (!account?.connected) throw new Error("sync-recovery-auth-required");
    await invoke("google.refresh");
    check();
    return invoke<T>(method, args);
  }

  return {
    getStatus: () => authenticated("syncRecovery.getStatus", {}, false),
    async setEnabled(value) {
      if (typeof value !== "boolean") throw new Error("sync-recovery-enabled-invalid");
      if (value !== enabled) { enabled = value; generation++; }
      return invoke("syncRecovery.setEnabled", { enabled: value });
    },
    createDaily: request => authenticated("syncRecovery.createDaily", {
      data: request.data, assets: request.assets.map(asset => ({ ...asset })),
    }, true),
    download: id => authenticated("syncRecovery.download", { id }, true),
    releaseDownload: restoreId => invoke("syncRecovery.releaseDownload", { restoreId }),
  };
}
