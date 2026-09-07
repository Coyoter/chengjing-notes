import type {
  SyncRecoveryBridge, SyncRecoveryDownloadResult, SyncRecoverySnapshot,
  SyncRecoveryStatus, SyncRecoveryAssetSource,
} from "../types";

export interface RecoveryRestoreResult {
  restoredItems: number;
  deletedItems: number;
  safetyCopyPath: string;
  syncPending: boolean;
}

export interface RecoveryControllerState {
  phase: "idle" | "checking" | "creating" | "restoring";
  status: SyncRecoveryStatus | null;
  error: string;
  warning: string;
  lastRestore: RecoveryRestoreResult | null;
}

export interface RecoveryControllerDependencies {
  bridge: () => SyncRecoveryBridge | undefined;
  isEnabled: () => boolean;
  now: () => number;
  withWorkspace: <T>(operation: () => Promise<T>) => Promise<T>;
  capture: () => Promise<{ data: string; assets: SyncRecoveryAssetSource[] }>;
  flushEditors: () => Promise<void>;
  restore: (
    download: SyncRecoveryDownloadResult,
    expected: SyncRecoverySnapshot,
    assertAllowed: () => void,
  ) => Promise<Omit<RecoveryRestoreResult, "syncPending">>;
  synchronize: () => Promise<void>;
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/^sync-recovery-[a-z0-9-]+$/.test(message)) return message;
  if (/^cloud-auth-(required|expired)$/.test(message)) return "sync-recovery-auth-required";
  return "sync-recovery-operation-failed";
}

/** No timer or independent backup schedule: invoked by successful synchronization. */
export function createSyncRecoveryController(deps: RecoveryControllerDependencies) {
  let state: RecoveryControllerState = {
    phase: "idle", status: null, error: "", warning: "", lastRestore: null,
  };
  const listeners = new Set<() => void>();
  let generation = 0;
  let suspended = false;
  let active: Promise<unknown> | null = null;
  let completedDay = "";
  let retryAfter = 0;

  function update(patch: Partial<RecoveryControllerState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }
  const day = () => new Date(deps.now()).toISOString().slice(0, 10);
  function context() {
    const bridge = deps.bridge();
    if (!bridge) throw new Error("sync-recovery-unavailable");
    const version = generation;
    const assertAllowed = () => {
      if (suspended || version !== generation || deps.bridge() !== bridge || !deps.isEnabled()) {
        throw new Error("sync-recovery-paused");
      }
    };
    return { bridge, version, assertAllowed };
  }
  function current(version: number) {
    return !suspended && generation === version;
  }
  function perform<T>(
    phase: RecoveryControllerState["phase"],
    operation: () => Promise<T>,
  ): Promise<T> {
    if (active) return Promise.reject(new Error("sync-recovery-busy"));
    update({ phase, error: "", warning: "" });
    const result = Promise.resolve().then(operation).finally(() => {
      active = null;
      update({ phase: "idle" });
    });
    active = result;
    return result;
  }
  function remember(status: SyncRecoveryStatus) {
    if (!status || status.dayBasis !== "UTC"
      || !["today", "yesterday", "dayBeforeYesterday"].every(
        key => Object.prototype.hasOwnProperty.call(status, key),
      )) throw new Error("sync-recovery-status-invalid");
    update({ status });
    if (status.today?.day === day()) completedDay = day();
  }

  async function syncStateChanged() {
    suspended = false;
    const version = ++generation;
    completedDay = "";
    retryAfter = 0;
    update({ status: null, error: "", warning: "" });
    const bridge = deps.bridge();
    if (!bridge) return;
    try {
      await bridge.setEnabled(deps.isEnabled());
    } catch (error) {
      if (current(version)) update({ error: errorCode(error) });
    }
  }

  async function suspend() {
    suspended = true;
    generation++;
    completedDay = "";
    retryAfter = 0;
    // Send this immediately; never queue it behind a potentially long upload.
    try { await deps.bridge()?.setEnabled(false); } catch { /* Lifecycle cleanup is best effort. */ }
  }

  function afterSuccessfulSync(): Promise<void> {
    if (suspended || !deps.isEnabled() || !deps.bridge()) return Promise.resolve();
    if (!active && state.lastRestore?.syncPending) {
      update({
        lastRestore: { ...state.lastRestore, syncPending: false },
        error: state.error === "sync-recovery-restored-sync-pending" ? "" : state.error,
      });
    }
    if (active || completedDay === day() || deps.now() < retryAfter) return Promise.resolve();
    const ctx = context();
    return perform("checking", async () => {
      ctx.assertAllowed();
      await ctx.bridge.setEnabled(true);
      ctx.assertAllowed();
      const status = await ctx.bridge.getStatus();
      ctx.assertAllowed();
      remember(status);
      if (status.today?.day === day()) return;
      update({ phase: "creating" });
      // Capture only after a complete synchronization, under the shared lock.
      const payload = await deps.withWorkspace(async () => {
        ctx.assertAllowed();
        const value = await deps.capture();
        ctx.assertAllowed();
        return value;
      });
      // Network upload is outside the lock; editors and normal sync can continue.
      ctx.assertAllowed();
      const result = await ctx.bridge.createDaily(payload);
      ctx.assertAllowed();
      remember(result.status);
      if (result.snapshot.day === day()) completedDay = day();
      retryAfter = 0;
      update({ warning: result.cleanupWarning || "", error: "" });
    }).catch(error => {
      const code = errorCode(error);
      if (!current(ctx.version) || !deps.isEnabled()) return;
      if (["sync-recovery-paused", "sync-recovery-pending-changes",
        "sync-recovery-content-changed", "sync-recovery-capture-date-changed"].includes(code)) return;
      retryAfter = deps.now() + 60_000;
      update({ error: code });
      // Recovery errors must not turn a successful content sync into a failure.
    });
  }

  function refresh(): Promise<SyncRecoveryStatus | null> {
    if (active) return active.then(() => state.status, () => state.status);
    const bridge = deps.bridge();
    if (!bridge || suspended) return Promise.resolve(null);
    const version = generation;
    return perform("checking", async () => {
      const status = await bridge.getStatus();
      if (!current(version) || deps.bridge() !== bridge) return null;
      remember(status);
      return status;
    }).catch(error => {
      if (current(version)) update({ error: errorCode(error) });
      throw error;
    });
  }

  function restorePoint(selection: SyncRecoverySnapshot): Promise<RecoveryRestoreResult> {
    if (active) return Promise.reject(new Error("sync-recovery-busy"));
    let ctx: ReturnType<typeof context>;
    try {
      ctx = context();
      ctx.assertAllowed();
    } catch (error) { return Promise.reject(error); }
    const expected = { ...selection };
    return perform("restoring", async () => {
      let download: SyncRecoveryDownloadResult | undefined;
      try {
        ctx.assertAllowed();
        await deps.flushEditors();
        ctx.assertAllowed();
        const applied = await deps.withWorkspace(async () => {
          ctx.assertAllowed();
          download = await ctx.bridge.download(expected.id);
          ctx.assertAllowed();
          return deps.restore(download, expected, ctx.assertAllowed);
        });
        // The database transaction has committed. A subsequent network failure
        // must never be presented as a failed or rolled-back local restoration.
        let result: RecoveryRestoreResult = { ...applied, syncPending: true };
        update({ lastRestore: result });
        try {
          ctx.assertAllowed();
          await deps.synchronize();
          ctx.assertAllowed();
          result = { ...result, syncPending: false };
          update({ lastRestore: result, error: "" });
        } catch {
          update({ lastRestore: result, error: "sync-recovery-restored-sync-pending" });
        }
        return result;
      } catch (error) {
        if (current(ctx.version)) update({ error: errorCode(error) });
        throw error;
      } finally {
        if (download?.restoreId) {
          try { await ctx.bridge.releaseDownload(download.restoreId); }
          catch { update({ warning: "sync-recovery-staging-cleanup-deferred" }); }
        }
      }
    });
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    syncStateChanged, suspend, afterSuccessfulSync, refresh, restorePoint,
  };
}
