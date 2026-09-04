import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, CircleDot, Copy, KeyRound, Laptop, Network, RotateCw, ShieldCheck, TerminalSquare } from "lucide-react";
import { useI18n } from "../hooks/useI18n";
import { getMcpSettingsCopy } from "../lib/mcpSettingsCopy";
import type { McpAccessMode, McpAuditEntry, McpSettings } from "../types";
import { friendlyErrorMessage } from "../lib/utils";

const empty: McpSettings = { enabled: false, accessMode: "read-only", port: 47831, running: false, endpoint: "http://127.0.0.1:47831/mcp", error: "", tokenStored: true };

export function McpSettingsPanel() {
  const { language } = useI18n(); const copy = useMemo(() => getMcpSettingsCopy(language), [language]);
  const [settings, setSettings] = useState<McpSettings>(empty); const [audit, setAudit] = useState<McpAuditEntry[]>([]); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(""); const [port, setPort] = useState("47831");
  useEffect(() => {
    const mcp = window.chengjing?.mcp;
    if (!mcp?.getSettings || !mcp?.getAudit) return;
    let active = true;
    Promise.all([mcp.getSettings(), mcp.getAudit()]).then(([nextSettings, nextAudit]) => {
      if (!active || !nextSettings) return; setSettings(nextSettings); setPort(String(nextSettings.port)); setAudit(nextAudit || []);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  async function update(patch: Partial<Pick<McpSettings, "enabled" | "accessMode" | "port">>) {
    if (!window.chengjing) return; setBusy(true); setNotice("");
    try { const value = await window.chengjing.mcp.updateSettings(patch); setSettings(value); setPort(String(value.port)); }
    catch (error) { setNotice(friendlyErrorMessage(error, copy.failed)); }
    finally { setBusy(false); }
  }
  async function copySetup(target: "codex" | "claude") {
    try { await window.chengjing?.mcp.copySetup(target); setNotice(copy.copied); }
    catch (error) { setNotice(friendlyErrorMessage(error, copy.failed)); }
  }
  async function rotateToken() {
    if (!window.confirm(copy.rotateConfirm)) return; setBusy(true);
    try { const value = await window.chengjing?.mcp.regenerateToken(); if (value) setSettings(value); setNotice(copy.tokenChanged); }
    catch (error) { setNotice(friendlyErrorMessage(error, copy.failed)); }
    finally { setBusy(false); }
  }
  const statusLabel = settings.error ? copy.failed : settings.running ? copy.running : copy.stopped;
  return (
    <section className="settings-section mcp-section" id="mcp-settings">
      <header><span><Network size={14} /> {copy.eyebrow}</span><h2>{copy.title}</h2><p>{copy.description}</p></header>
      <div className="mcp-control-surface">
        <div className="mcp-primary-row">
          <span className="mcp-symbol"><Laptop size={20} /></span>
          <span><b>{copy.enabled}</b><small>{copy.enabledHint}</small></span>
          <em className={settings.error ? "is-error" : settings.running ? "is-running" : ""}><CircleDot size={12} />{statusLabel}</em>
          <label className="backup-switch"><input type="checkbox" checked={settings.enabled} disabled={busy} onChange={(event) => void update({ enabled: event.target.checked })} /><i /></label>
        </div>
        <div className="mcp-endpoint"><span><b>{copy.endpoint}</b><code>{settings.endpoint}</code></span><ShieldCheck size={17} /></div>
        {settings.error && <p className="mcp-error" role="alert">{settings.error}</p>}
        <div className="mcp-access">
          <header><b>{copy.access}</b><small>{copy.safety}</small></header>
          <div>{(["read-only", "ask", "allow"] as McpAccessMode[]).map((mode) => <button type="button" key={mode} className={settings.accessMode === mode ? "is-active" : ""} disabled={busy} onClick={() => { if (mode === "allow" && settings.accessMode !== "allow" && !window.confirm(copy.allowConfirm)) return; void update({ accessMode: mode }); }}><span><b>{copy.modes[mode][0]}{mode === "ask" && <em>{copy.recommended}</em>}</b><small>{copy.modes[mode][1]}</small></span>{settings.accessMode === mode && <Check size={15} />}</button>)}</div>
        </div>
        <div className="mcp-setup">
          <header><b>{copy.setup}</b><small>{copy.setupHint}</small></header>
          <div><button type="button" disabled={!settings.running || busy} onClick={() => void copySetup("codex")}><TerminalSquare size={16} /><span>{copy.copyCodex}</span><Copy size={14} /></button><button type="button" disabled={!settings.running || busy} onClick={() => void copySetup("claude")}><TerminalSquare size={16} /><span>{copy.copyClaude}</span><Copy size={14} /></button></div>
          {notice && <p role="status">{notice}</p>}
        </div>
        <details className="mcp-advanced">
          <summary><span><KeyRound size={15} /><b>{copy.advanced}</b></span><ChevronDown size={15} /></summary>
          <div>
            <label><span>{copy.port}</span><input inputMode="numeric" value={port} onChange={(event) => setPort(event.target.value.replace(/\D/g, "").slice(0, 5))} /><button type="button" disabled={busy || Number(port) === settings.port} onClick={() => void update({ port: Number(port) })}>{copy.applyPort}</button></label>
            <button type="button" className="mcp-rotate" disabled={busy} onClick={() => void rotateToken()}><RotateCw size={14} />{copy.rotate}</button>
          </div>
        </details>
        <details className="mcp-audit" onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open) void window.chengjing?.mcp.getAudit().then(setAudit); }}>
          <summary><span><b>{copy.recent}</b><small>{audit.length ? `${audit.length}` : copy.noRecent}</small></span><ChevronDown size={15} /></summary>
          <div>{audit.length ? audit.slice(0, 8).map((entry) => <article key={entry.id}><i className={`is-${entry.outcome}`} /><span><b>{entry.tool}</b><small>{entry.summary}</small></span><time>{copy.outcomes[entry.outcome]} · {new Intl.DateTimeFormat(language, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(entry.createdAt)}</time></article>) : <p>{copy.noRecent}</p>}</div>
        </details>
      </div>
    </section>
  );
}
