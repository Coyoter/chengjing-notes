import { useEffect, useRef, useState } from "react";
import { Check, Feather, Send } from "lucide-react";
import { createFragment } from "../db";
import { useAppStore } from "../store";
import { getQuickCaptureCopy } from "../lib/quickCaptureCopy";

export function QuickCaptureWindow() {
  const theme = useAppStore((state) => state.theme);
  const language = useAppStore((state) => state.language);
  const copy = getQuickCaptureCopy(language);
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const composing = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const apply = () => {
      const resolved = theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.dataset.quickCapture = "true";
      document.documentElement.lang = language;
    };
    apply();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [language, theme]);

  useEffect(() => {
    const focus = () => window.setTimeout(() => { input.current?.focus(); input.current?.select(); }, 30);
    focus();
    return window.chengjing?.quickCapture?.onFocus(focus);
  }, []);

  useEffect(() => window.chengjing?.quickCapture?.onNativeSubmit?.(async (text) => {
    try {
      await createFragment(text);
      await window.chengjing?.quickCapture?.nativeSubmitResult?.(true);
    } catch {
      await window.chengjing?.quickCapture?.nativeSubmitResult?.(false);
    }
  }), []);

  async function submit() {
    const text = value.trim();
    if (!text) return;
    await createFragment(text);
    setValue("");
    setSaved(true);
    window.setTimeout(() => { setSaved(false); void window.chengjing?.quickCapture?.hide(); }, 360);
  }

  return <main className="quick-capture-shell">
    <section className="quick-capture-card">
      <header><div><Feather size={18} /><span>{copy.eyebrow}</span></div><b>{copy.title}</b></header>
      <textarea ref={input} value={value} maxLength={500} placeholder={copy.placeholder} onChange={(event) => setValue(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); void window.chengjing?.quickCapture?.hide(); return; } if (event.key !== "Enter" || composing.current || (event.nativeEvent as KeyboardEvent).isComposing) return; if (event.altKey) { event.preventDefault(); const target = event.currentTarget; const start = target.selectionStart; const end = target.selectionEnd; setValue((current) => `${current.slice(0, start)}\n${current.slice(end)}`); window.requestAnimationFrame(() => target.setSelectionRange(start + 1, start + 1)); return; } event.preventDefault(); void submit(); }} />
      <footer><small>{saved ? copy.saved : copy.enterHint}</small><button type="button" disabled={!value.trim() || saved} onClick={() => void submit()}>{saved ? <Check size={15} /> : <Send size={15} />}{saved ? copy.saved : copy.submit}</button></footer>
    </section>
  </main>;
}
