import { useState, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { useI18n } from "../hooks/useI18n";
import { localOnlyCopy, useLocalOnly } from "../lib/localOnly";

export function CloudFeature({ children }: { children: ReactNode }) {
  const enabled = useLocalOnly();
  const { language } = useI18n();
  return <div className={enabled ? "cloud-feature is-blocked" : "cloud-feature"}>
    {enabled && <p className="local-only-feature-note"><ShieldCheck size={14} />{localOnlyCopy(language).blocked}</p>}
    <fieldset disabled={enabled} inert={enabled || undefined} aria-disabled={enabled || undefined}>{children}</fieldset>
  </div>;
}

export function LocalOnlySettings() {
  const enabled = useLocalOnly();
  const { language } = useI18n();
  const copy = localOnlyCopy(language);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!window.chengjing?.privacy) return null;
  async function change(value: boolean) {
    setBusy(true); setError("");
    (document.activeElement as HTMLElement | null)?.blur();
    window.dispatchEvent(new Event("chengjing:flush-editors"));
    try { await window.chengjing!.privacy!.setLocalOnly(value); }
    catch { setBusy(false); setError(copy.failed); }
  }
  return <section className="settings-section local-only-settings" id="privacy-settings">
    <header><span><ShieldCheck size={14} />{copy.eyebrow}</span><h2>{copy.title}</h2><p>{copy.description}</p></header>
    <label className="switch-row"><span><b>{copy.title}</b><small>{busy ? copy.busy : copy.detail}</small></span><input type="checkbox" checked={enabled} disabled={busy} onChange={(event) => void change(event.target.checked)} /><i /></label>
    <p className="local-only-explanation">{copy.restart}</p>
    {enabled && <p className="local-only-explanation">{copy.backup}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
