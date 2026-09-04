import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BadgeDollarSign,
  Check,
  Brush,
  Cloud,
  CloudCog,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  HardDrive,
  HeartHandshake,
  Gauge,
  KeyRound,
  Languages,
  Laptop,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  Trash2,
  Zap,
} from "lucide-react";
import { useAppStore } from "../store";
import type { AppLanguage, OpenRouterModel, OpenRouterRoutingMode, ThemeMode } from "../types";
import { clearLocalModel, inspectLocalModel, LOCAL_MODEL, prepareLocalModel } from "../lib/localGemma";
import { formatBytes, friendlyErrorMessage } from "../lib/utils";
import { languageOptions } from "../i18n";
import type { MessageKey } from "../i18n";
import { useI18n } from "../hooks/useI18n";
import { UpdateSettingsSection } from "../components/UpdateSettingsSection";
import { AutoBackupSettingsPanel } from "../components/AutoBackupSettings";
import { getSettingsEnhancementCopy } from "../lib/settingsEnhancementCopy";
import { getOpenRouterRoutingCopy } from "../lib/openRouterRoutingCopy";
import { QuickCaptureSettingsPanel } from "../components/QuickCaptureSettings";
import { AdvancedAIProviderSettings } from "../components/AdvancedAIProviderSettings";
import { getAdvancedProviderCopy } from "../lib/advancedProviderCopy";
import { McpSettingsPanel } from "../components/McpSettings";

const FEATURED_MODELS = [
  { id: "openai/gpt-5.6-luna", label: "GPT-5.6 Luna", note: "settings.modelDefault" as MessageKey },
  { id: "deepseek/deepseek-v4-flash-0731", label: "DeepSeek V4 Flash 0731", note: "settings.modelFast" as MessageKey },
  { id: "google/gemini-3.7-flash", label: "Gemini 3.7 Flash", note: "settings.modelLong" as MessageKey },
];

const ROUTING_ICONS: Record<OpenRouterRoutingMode, typeof Gauge> = { balanced: Gauge, speed: Zap, economy: BadgeDollarSign };

export function SettingsView() {
  const engine = useAppStore((state) => state.aiEngine);
  const setEngine = useAppStore((state) => state.setAIEngine);
  const model = useAppStore((state) => state.openRouterModel);
  const setModel = useAppStore((state) => state.setOpenRouterModel);
  const routingMode = useAppStore((state) => state.openRouterRoutingMode);
  const setRoutingMode = useAppStore((state) => state.setOpenRouterRoutingMode);
  const customModel = useAppStore((state) => state.customModel);
  const setCustomModel = useAppStore((state) => state.setCustomModel);
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const temperature = useAppStore((state) => state.temperature);
  const setTemperature = useAppStore((state) => state.setTemperature);
  const spaceSearch = useAppStore((state) => state.spaceSearch);
  const setSpaceSearch = useAppStore((state) => state.setSpaceSearch);
  const fontScale = useAppStore((state) => state.fontScale);
  const setFontScale = useAppStore((state) => state.setFontScale);
  const language = useAppStore((state) => state.language);
  const setLanguage = useAppStore((state) => state.setLanguage);
  const { t } = useI18n();
  const supportCopy = useMemo(() => getSettingsEnhancementCopy(language), [language]);
  const routingCopy = useMemo(() => getOpenRouterRoutingCopy(language), [language]);
  const providerCopy = useMemo(() => getAdvancedProviderCopy(language), [language]);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<{ configured: boolean; encrypted: boolean; storage: "app-local-aes-256-gcm"; error?: string }>({ configured: false, encrypted: true, storage: "app-local-aes-256-gcm" });
  const [testingKey, setTestingKey] = useState(false);
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [localStatus, setLocalStatus] = useState<{ state: string; cached: boolean; progress: number; size: number; message: string }>({ state: "unknown", cached: false, progress: 0, size: LOCAL_MODEL.approximateBytes, message: t("local.checking") });
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadFile, setDownloadFile] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.chengjing?.ai?.keyStatus?.().then(setKeyStatus);
    inspectLocalModel().then(setLocalStatus);
  }, [language]);

  const recentModels = useMemo(() => [...models].sort((a, b) => b.created - a.created).slice(0, 12), [models]);

  async function saveKey(event: React.FormEvent) {
    event.preventDefault();
    try {
      if (!window.chengjing) throw new Error(t("settings.desktopRequired"));
      const result = await window.chengjing.ai.setKey(apiKey);
      setKeyStatus(result);
      setApiKey("");
      try {
        const connection = await window.chengjing.ai.testOpenRouter();
        setNotice(t("settings.keySavedConnected", { label: connection.label }));
      } catch (error) {
        setNotice(t("settings.keySavedTestFailed", { error: friendlyErrorMessage(error, t("settings.testFailed")) }));
      }
    } catch (error) { setNotice(friendlyErrorMessage(error, t("settings.keySaveFailed"))); }
  }

  async function testOpenRouter() {
    if (!window.chengjing) return;
    setTestingKey(true);
    setNotice(t("settings.testingNotice"));
    try {
      const result = await window.chengjing.ai.testOpenRouter();
      const detail = result.limitRemaining === null ? result.label : `${result.label} · ${result.limitRemaining.toFixed(2)}`;
      setNotice(t("settings.connectionOk", { detail }));
    } catch (error) {
      setNotice(friendlyErrorMessage(error, t("settings.testFailed")));
    } finally {
      setTestingKey(false);
    }
  }

  async function loadModels() {
    setLoadingModels(true);
    setNotice("");
    try {
      if (!window.chengjing) throw new Error(t("settings.desktopModels"));
      const result = await window.chengjing.ai.listModels();
      setModels(result);
      setNotice(t("settings.modelsSynced", { count: result.length }));
    } catch (error) { setNotice(friendlyErrorMessage(error, t("settings.modelsFailed"))); }
    finally { setLoadingModels(false); }
  }

  async function downloadModel() {
    setBusy(true);
    setNotice(t("settings.downloadStarting"));
    try {
      await prepareLocalModel((progress, file) => { setDownloadProgress(progress); setDownloadFile(file); });
      const status = await inspectLocalModel();
      setLocalStatus(status);
      setNotice(t("settings.downloadDone"));
    } catch (error) { setNotice(error instanceof Error ? error.message : t("settings.downloadFailed")); }
    finally { setBusy(false); }
  }

  async function removeModel() {
    if (!window.confirm(t("settings.confirmRemoveModel"))) return;
    await clearLocalModel();
    setLocalStatus({ state: "not-downloaded", cached: false, progress: 0, size: LOCAL_MODEL.approximateBytes, message: t("settings.modelNotDownloaded") });
    setNotice(t("settings.modelRemoved"));
  }

  const themeChoices: Array<{ value: ThemeMode; label: MessageKey; icon: typeof Sun }> = [
    { value: "system", label: "settings.system", icon: Laptop },
    { value: "light", label: "settings.light", icon: Sun },
    { value: "dark", label: "settings.dark", icon: Moon },
    { value: "ink", label: "settings.ink", icon: Brush },
  ];

  return (
    <div className="page-scroll settings-page">
      {notice && <div className="settings-notice" role="status"><Check size={15} /><span>{notice}</span><button type="button" onClick={() => setNotice("")}>{t("common.close")}</button></div>}

      <section className="settings-section language-settings" id="language-settings">
        <header><span><Languages size={14} /> {t("language.eyebrow")}</span><h2>{t("language.title")}</h2><p>{t("language.description")}</p></header>
        <div className="language-grid">{languageOptions.map((option) => <button type="button" key={option.value} className={language === option.value ? "is-active" : ""} onClick={() => setLanguage(option.value as AppLanguage)}><span>{option.label}</span><small>{option.short}</small>{language === option.value && <Check size={15} />}</button>)}</div>
      </section>

      <section className="settings-section" id="ai-settings">
        <header><span>{t("settings.aiEyebrow")}</span><h2>{t("settings.aiTitle")}</h2><p>{providerCopy.aiDescription}</p></header>
        <div className="engine-choice-grid">
          <button type="button" className={engine === "openrouter" ? "is-active" : ""} onClick={() => setEngine("openrouter")}>
            <Cloud size={21} /><span><b>OpenRouter</b><small>{t("settings.openRouterNote")}</small></span>{engine === "openrouter" && <Check size={17} />}
          </button>
          <button type="button" className={engine === "local-gemma" ? "is-active" : ""} onClick={() => setEngine("local-gemma")}>
            <ShieldCheck size={21} /><span><b>Gemma 4 E2B</b><small>{t("settings.gemmaNote")}</small></span>{engine === "local-gemma" && <Check size={17} />}
          </button>
          <button type="button" className={engine === "custom-provider" ? "is-active" : ""} onClick={() => setEngine("custom-provider")}>
            <CloudCog size={21} /><span><b>{providerCopy.title}</b><small>{providerCopy.summary}</small></span>{engine === "custom-provider" && <Check size={17} />}
          </button>
        </div>
        <AdvancedAIProviderSettings />
      </section>

      <section className="settings-section two-column-settings">
        <div className="settings-card">
          <header><KeyRound size={18} /><div><h3>{t("settings.keyTitle")}</h3><p>{keyStatus.configured ? t("settings.keySaved") : t("settings.keyMissing")}</p></div><i className={keyStatus.configured ? "status-dot is-ready" : "status-dot"} /></header>
          <form className="api-key-form" onSubmit={saveKey}><label><input type={showKey ? "text" : "password"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={keyStatus.configured ? t("settings.replaceKey") : "sk-or-v1-…"} /><button type="button" aria-label={showKey ? t("settings.hideKey") : t("settings.showKey")} onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</button></label><button className="primary-button" type="submit" disabled={!apiKey.trim()}>{t("settings.saveKey")}</button></form>
          <div className="key-connection-row"><button type="button" className="secondary-button" disabled={!keyStatus.configured || testingKey} onClick={testOpenRouter}><Activity size={15} className={testingKey ? "spin" : ""} />{testingKey ? t("settings.testing") : t("settings.testOpenRouter")}</button><span>{t("settings.testNoCost")}</span></div>
          <p className="local-key-boundary">{t("settings.keyBoundary")}</p>
          <footer><span><ShieldCheck size={13} />{t("settings.keyFooter")}</span>{keyStatus.configured && <button type="button" className="danger-text" onClick={async () => { const result = await window.chengjing?.ai.clearKey(); if (result) setKeyStatus(result); }}>{t("common.remove")}</button>}</footer>
        </div>
        <div className="settings-card local-model-card">
          <header><HardDrive size={18} /><div><h3>{t("settings.localModel")}</h3><p>{localStatus.message}</p></div><i className={localStatus.cached ? "status-dot is-ready" : "status-dot"} /></header>
          <div className="model-storage"><span><b>{formatBytes(localStatus.size)}</b><small>q4f16・WebGPU</small></span>{localStatus.cached ? <button type="button" className="secondary-button" onClick={removeModel}><Trash2 size={15} />{t("settings.removeModel")}</button> : <button type="button" className="primary-button" disabled={busy || localStatus.state === "unsupported"} onClick={downloadModel}><Download size={15} />{busy ? t("settings.downloading") : t("settings.downloadModel")}</button>}</div>
          {busy && <div className="download-progress"><div><i style={{ width: `${downloadProgress}%` }} /></div><span>{downloadProgress.toFixed(1)}% · {downloadFile || t("local.preparing")}</span></div>}
          <footer><span><ShieldCheck size={13} />{t("settings.localPrivacy")}</span></footer>
        </div>
      </section>

      <section className="settings-section">
        <header className="settings-inline-header"><div><span>{t("settings.modelsEyebrow")}</span><h2>{t("settings.modelsTitle")}</h2></div><button type="button" className="secondary-button" disabled={loadingModels} onClick={loadModels}><RefreshCw size={15} className={loadingModels ? "spin" : ""} />{loadingModels ? t("settings.syncing") : t("settings.syncModels")}</button></header>
        <div className="featured-models">
          {FEATURED_MODELS.map((item) => <button type="button" key={item.id} className={!customModel && model === item.id ? "is-active" : ""} onClick={() => { setModel(item.id); setCustomModel(""); }}><Cloud size={17} /><span><b>{item.label}</b><small>{t(item.note)}</small><code>{item.id}</code></span>{!customModel && model === item.id && <Check size={16} />}</button>)}
        </div>
        {recentModels.length > 0 && <label className="settings-field"><span>{t("settings.latestModels")}</span><select value={customModel || model} onChange={(event) => { setCustomModel(event.target.value); }}><option value="">{t("settings.chooseModel")}</option>{recentModels.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.id}</option>)}</select></label>}
        <label className="settings-field"><span>{t("settings.customModel")}</span><input value={customModel} onChange={(event) => setCustomModel(event.target.value)} placeholder={t("settings.customModelPlaceholder")} /><small>{t("settings.customModelHint")}</small></label>
        <div className="routing-mode-setting" aria-label={routingCopy.title}>
          <header><b>{routingCopy.title}</b><span>{routingCopy.description}</span></header>
          <div className="routing-mode-grid">{routingCopy.options.map((option) => { const Icon = ROUTING_ICONS[option.value]; const active = routingMode === option.value; return <button type="button" key={option.value} className={active ? "is-active" : ""} aria-pressed={active} onClick={() => setRoutingMode(option.value)}><Icon size={17} /><span><b>{option.label}{option.value === "balanced" && <em>{routingCopy.defaultLabel}</em>}</b><small>{option.description}</small></span>{active && <Check size={15} />}</button>; })}</div>
          <p>{routingCopy.note}</p>
        </div>
        <label className="settings-range"><span><b>{t("settings.creativity")}</b><small>{temperature.toFixed(2)} · {temperature < 0.4 ? t("settings.stable") : temperature < 0.75 ? t("settings.balanced") : t("settings.free")}</small></span><input type="range" min="0" max="1" step="0.05" value={temperature} onChange={(event) => setTemperature(Number(event.target.value))} /></label>
        <label className="switch-row"><span><b>{t("settings.searchSpace")}</b><small>{t("settings.searchSpaceHint")}</small></span><input type="checkbox" checked={spaceSearch} onChange={(event) => setSpaceSearch(event.target.checked)} /><i /></label>
      </section>

      <McpSettingsPanel />

      <UpdateSettingsSection />

      <QuickCaptureSettingsPanel />

      <section className="settings-section">
        <header><span>{t("settings.appearance")}</span><h2>{t("settings.reading")}</h2></header>
        <div className="theme-grid">{themeChoices.map((choice) => { const Icon = choice.icon; return <button type="button" key={choice.value} className={theme === choice.value ? "is-active" : ""} onClick={() => setTheme(choice.value)}><Icon size={18} /><span>{t(choice.label)}</span>{theme === choice.value && <Check size={15} />}</button>; })}</div>
        <div className="font-scale-setting">
          <div><b>{t("settings.fontSize")}</b><small>{t("settings.fontHint")}</small></div>
          <div>{[{ value: 0.9, label: t("settings.compact"), size: "90%" }, { value: 1, label: t("settings.standard"), size: "100%" }, { value: 1.1, label: t("settings.comfortable"), size: "110%" }, { value: 1.2, label: t("settings.large"), size: "120%" }].map((choice) => <button type="button" key={choice.value} className={fontScale === choice.value ? "is-active" : ""} onClick={() => setFontScale(choice.value)}><span>{choice.label}</span><small>{choice.size}</small></button>)}</div>
        </div>
      </section>

      <section className="settings-section">
        <AutoBackupSettingsPanel />
      </section>

      <section className="settings-section support-author" id="support-author">
        <header><span><HeartHandshake size={14} /> {supportCopy.eyebrow}</span><h2>{supportCopy.title}</h2><p>{supportCopy.description}</p></header>
        <div className="support-actions">
          <a href="https://payment.ecpay.com.tw/Broadcaster/Donate/D599936B2C3A0AF2342FA6448088C9C6" target="_blank" rel="noreferrer"><span><b>{supportCopy.ecpay}</b><small>{supportCopy.ecpayHint}</small></span><ExternalLink size={15} /></a>
          <a href="https://paypal.me/techtarian" target="_blank" rel="noreferrer"><span><b>{supportCopy.paypal}</b><small>{supportCopy.paypalHint}</small></span><ExternalLink size={15} /></a>
        </div>
        <footer>{supportCopy.promise}</footer>
      </section>
    </div>
  );
}
