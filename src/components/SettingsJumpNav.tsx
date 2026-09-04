import type { MouseEvent } from "react";
import { Navigation2 } from "lucide-react";
import { useI18n } from "../hooks/useI18n";
import { getSettingsAnchorCopy } from "../lib/settingsAnchorCopy";

export function SettingsJumpNav() {
  const { language } = useI18n();
  const copy = getSettingsAnchorCopy(language);
  const destinations = [
    ["language-settings", copy.language],
    ["ai-settings", copy.ai],
    ["mcp-settings", copy.integrations],
    ["update-settings", copy.updates],
    ["quick-capture-settings", copy.quickCapture],
    ["appearance-settings", copy.appearance],
    ["backup-settings", copy.backup],
    ["support-author", copy.support],
  ] as const;

  function jump(event: MouseEvent<HTMLAnchorElement>, id: string) {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    if (target instanceof HTMLDetailsElement && !target.open) target.open = true;
    target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }

  return (
    <nav className="settings-jump-nav" aria-label={copy.label}>
      <span><Navigation2 size={14} /><b>{copy.label}</b></span>
      <div className="settings-jump-track">
        {destinations.map(([id, label]) => <a key={id} href={`#${id}`} onClick={(event) => jump(event, id)}>{label}</a>)}
      </div>
    </nav>
  );
}
