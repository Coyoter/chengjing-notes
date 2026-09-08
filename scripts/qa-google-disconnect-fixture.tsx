import React from "react";
import { createRoot } from "react-dom/client";
import { GoogleDisconnectControl } from "../src/components/GoogleDisconnectControl";
import "../src/components/sync-settings.css";

export function mount() {
  let connected = true;
  const state = { calls: 0, errors: [] as string[] };
  window.chengjing = { platform: "darwin", cloudBackups: {
    getLocalStatus: async () => ({ connected }),
    disconnect: async () => { state.calls++; connected = false; return { connected }; },
  } } as NonNullable<Window["chengjing"]>;
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;z-index:99999;background:var(--canvas);padding:20px;overflow:auto";
  document.body.append(host);
  const root = createRoot(host);
  root.render(<div className="backup-method-card cloud-method sync-settings" style={{ maxWidth: 560, margin: "0 auto", paddingTop: 20 }}>
    <header><span><h4>Google 同步</h4><p>登入同一個 Google 帳號，在不同裝置間接續內容。</p></span></header>
    <GoogleDisconnectControl language="zh-TW" enabled={true} blocked={false} onBusyChange={() => {}} onDisconnected={() => {}} onError={error => { if (error) state.errors.push(error); }}/>
  </div>);
  return state;
}
