import { useEffect, useMemo, useState } from "react";
import { Check, RotateCcw, Sparkles } from "lucide-react";
import { useAppStore } from "../store";
import { displayAccelerator, getQuickCaptureCopy } from "../lib/quickCaptureCopy";
import { isWindows } from "../lib/platform";

function acceleratorFromEvent(event: KeyboardEvent, platform: string) {
  const modifiers: string[] = [];
  if (isWindows(platform)) {
    if (event.ctrlKey) modifiers.push("CommandOrControl");
    else if (event.metaKey) modifiers.push("Super");
  } else if (event.metaKey) modifiers.push("CommandOrControl");
  else if (event.ctrlKey) modifiers.push("Control");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (!modifiers.length) return "";
  const aliases: Record<string, string> = { " ": "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Esc: "Escape" };
  const key = aliases[event.key] || (event.key.length === 1 ? event.key.toUpperCase() : event.key);
  if (["META", "CONTROL", "ALT", "SHIFT"].includes(key.toUpperCase())) return "";
  return [...modifiers, key].join("+");
}

export function QuickCaptureSettingsPanel() {
  const language = useAppStore((state) => state.language);
  const platform = window.chengjing?.platform || "web";
  const copy = useMemo(() => getQuickCaptureCopy(language, platform), [language, platform]);
  const [settings, setSettings] = useState({ shortcut: "CommandOrControl+\\", defaultShortcut: "CommandOrControl+\\", registered: false, openAtLogin: false });
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => { void window.chengjing?.quickCapture?.getSettings().then(setSettings); }, []);

  useEffect(() => {
    if (!recording) return;
    const capture = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") { setRecording(false); void window.chengjing?.quickCapture?.setRecording(false); return; }
      const accelerator = acceleratorFromEvent(event, platform);
      if (!accelerator) { setNotice(copy.invalid); return; }
      void window.chengjing?.quickCapture?.setShortcut(accelerator).then((result) => {
        setSettings((current) => ({ ...current, ...result }));
        setNotice("");
      }).catch(() => setNotice(copy.unavailable)).finally(() => {
        setRecording(false);
        void window.chengjing?.quickCapture?.setRecording(false);
      });
    };
    window.addEventListener("keydown", capture, true);
    return () => { window.removeEventListener("keydown", capture, true); void window.chengjing?.quickCapture?.setRecording(false); };
  }, [copy.invalid, copy.unavailable, platform, recording]);

  async function startRecording() {
    if (!window.chengjing?.quickCapture) { setNotice(copy.desktopOnly); return; }
    await window.chengjing.quickCapture.setRecording(true);
    setNotice("");
    setRecording(true);
  }

  async function resetShortcut() {
    if (!window.chengjing?.quickCapture) return;
    try {
      const result = await window.chengjing.quickCapture.setShortcut(settings.defaultShortcut);
      setSettings((current) => ({ ...current, ...result }));
      setNotice("");
    } catch { setNotice(copy.unavailable); }
  }

  async function toggleLogin(enabled: boolean) {
    if (!window.chengjing?.quickCapture) { setNotice(copy.desktopOnly); return; }
    const result = await window.chengjing.quickCapture.setOpenAtLogin(enabled);
    setSettings((current) => ({ ...current, openAtLogin: result.openAtLogin }));
  }

  return <section className="settings-section quick-capture-settings" id="quick-capture-settings">
    <header><span><Sparkles size={14} /> {copy.settingsEyebrow}</span><h2>{copy.settingsTitle}</h2><p>{copy.settingsDescription}</p></header>
    <div className="quick-capture-setting-row">
      <div><b>{copy.shortcut}</b><small>{copy.shortcutHint}</small></div>
      <button type="button" className={`shortcut-recorder ${recording ? "is-recording" : ""}`} onClick={() => void startRecording()}><span>{recording ? copy.recording : displayAccelerator(settings.shortcut, platform)}</span>{settings.registered && !recording && <Check size={14} />}</button>
      <button type="button" className="quick-capture-reset" onClick={() => void resetShortcut()} aria-label={copy.reset} title={copy.reset}><RotateCcw size={15} /></button>
    </div>
    <label className="quick-capture-login-row"><span><b>{copy.launch}</b><small>{copy.launchHint}</small></span><input type="checkbox" checked={settings.openAtLogin} onChange={(event) => void toggleLogin(event.target.checked)} /><i /></label>
    {notice && <p className="quick-capture-setting-notice">{notice}</p>}
  </section>;
}
