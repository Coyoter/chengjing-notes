import { useRef, useState } from "react";
import { RefreshCw, RotateCcw } from "lucide-react";
import type { AppLanguage, SyncRecoverySnapshot, SyncRecoveryStatus } from "../types";
import type { RecoveryControllerState, RecoveryRestoreResult } from "../lib/syncRecoveryController";
import { getSyncRecoveryCopy, recoveryErrorText } from "../lib/syncRecoveryCopy";

export function recoveryHistoryRows(status: SyncRecoveryStatus | null, now: number) {
  const candidates = status?.dayBasis === "UTC"
    ? [status.today, status.yesterday, status.dayBeforeYesterday] : [];
  return (["yesterday", "dayBeforeYesterday"] as const).map((key, index) => {
    const day = new Date(now - (index + 1) * 86_400_000).toISOString().slice(0, 10);
    const snapshot = candidates.find(item => item && item.day === day
      && Number.isSafeInteger(item.snapshotAt) && item.snapshotAt >= 0 && item.snapshotAt <= now
      && new Date(item.snapshotAt).toISOString().slice(0, 10) === day
      && /^[A-Za-z0-9_-]{1,200}$/.test(item.id)
      && /^[a-f0-9]{64}$/.test(item.contentHash)
      && Number.isSafeInteger(item.size) && item.size > 0) || null;
    return { key, day, snapshot };
  });
}

export interface SyncRecoveryPanelProps {
  language: AppLanguage;
  enabled: boolean;
  available: boolean;
  blocked?: boolean;
  state: RecoveryControllerState;
  onRefresh: () => Promise<unknown>;
  onRestore: (snapshot: SyncRecoverySnapshot) => Promise<RecoveryRestoreResult>;
  now?: number;
}

/** Displays actual recovery dates; it never creates snapshots by itself. */
export function SyncRecoveryPanel({
  language, enabled, available, blocked = false, state, onRefresh, onRestore, now = Date.now(),
}: SyncRecoveryPanelProps) {
  const text = getSyncRecoveryCopy(language);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState("");
  const busy = pending || state.phase !== "idle";
  const rows = recoveryHistoryRows(state.status, now);
  const formatTime = (point: SyncRecoverySnapshot) =>
    new Intl.DateTimeFormat(language, {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", timeZone: "UTC",
    }).format(point.snapshotAt) + " UTC";

  async function refresh() {
    if (inFlight.current || busy || blocked || !available) return;
    inFlight.current = true;
    setPending(true);
    setLocalError("");
    try { await onRefresh(); }
    catch (error) { setLocalError(error instanceof Error ? error.message : ""); }
    finally { inFlight.current = false; setPending(false); }
  }

  async function restore(snapshot: SyncRecoverySnapshot) {
    if (inFlight.current || busy || blocked || !available || !enabled) return;
    const selected = { ...snapshot };
    if (!window.confirm(text.confirm.replace("{time}", formatTime(selected)))) return;
    inFlight.current = true;
    setPending(true);
    setLocalError("");
    try { await onRestore(selected); }
    catch (error) {
      setLocalError(error instanceof Error ? error.message : "sync-recovery-operation-failed");
    } finally { inFlight.current = false; setPending(false); }
  }

  const error = localError || state.error;
  const phaseText = state.phase === "restoring" ? text.restoring
    : state.phase === "creating" ? text.creating
    : busy ? text.checking : "";
  const receipt = state.lastRestore;

  return (
    <section className="sync-recovery-panel" aria-label={text.heading} aria-busy={busy}>
      <header>
        <h5>{text.heading}</h5>
        {available && (
          <button type="button" className="sync-recovery-refresh"
            disabled={busy || blocked} onClick={() => void refresh()}>
            <RefreshCw size={14} aria-hidden="true" className={busy ? "spin" : ""} />
            <span>{text.refresh}</span>
          </button>
        )}
      </header>

      {!available ? <p className="sync-recovery-description">{text.unavailable}</p> : (
        <>
          <p className="sync-recovery-description">{text.description}</p>
          <p className="sync-recovery-date-note">{text.utc}</p>
          {!enabled && <p className="sync-recovery-message">{text.paused}</p>}
          {!state.status && !busy && <p className="sync-recovery-message">{text.notLoaded}</p>}
          <div className="sync-recovery-points">
            {rows.map(row => (
              <div className="sync-recovery-point" key={row.key}>
                <span className="sync-recovery-point-copy">
                  <b>{text[row.key]}</b>
                  <small>{row.snapshot ? formatTime(row.snapshot) : `${row.day} · UTC`}</small>
                  {!row.snapshot && <small>{text.empty}</small>}
                </span>
                <button type="button" className="secondary-button"
                  disabled={!row.snapshot || !enabled || busy || blocked}
                  aria-label={`${text.restore} · ${text[row.key]} · ${row.day} UTC`}
                  onClick={() => { if (row.snapshot) void restore(row.snapshot); }}>
                  <RotateCcw size={14} aria-hidden="true" />
                  <span>{text.restore}</span>
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {phaseText && <p className="sync-recovery-message" role="status">{phaseText}</p>}
      {error && !(receipt?.syncPending && error === "sync-recovery-restored-sync-pending") && (
        <p className="sync-recovery-message is-error" role="alert">
          {recoveryErrorText(error, language)}
        </p>
      )}
      {state.warning && <p className="sync-recovery-message">{text.cleanup}</p>}
      {receipt && (
        <div className="sync-recovery-receipt">
          <p role="status">{receipt.syncPending ? text.restoredPending : text.restored}</p>
          <details>
            <summary>{text.safety}</summary>
            <code>{receipt.safetyCopyPath}</code>
          </details>
        </div>
      )}
    </section>
  );
}
