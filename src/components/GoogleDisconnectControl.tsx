import { useEffect, useState } from "react";
import { LoaderCircle, Unplug } from "lucide-react";
import type { AppLanguage } from "../types";
import { androidCall } from "../platform/android";
import { disconnectGoogleAccount } from "../lib/googleDisconnect";
import { syncRecovery } from "../lib/syncRecoveryRuntime";

const copy = {
  "zh-TW": { action: "解除 Google 綁定", title: "解除這台裝置的連結？", detail: "停止這台裝置的 Google 同步並移除保存的登入憑證。本機筆記、尚未同步的內容與雲端資料都會保留，也不會撤銷其他裝置的授權。", cancel: "保留連結", confirm: "解除綁定", working: "正在解除…", done: "已解除 Google 綁定，內容仍保留在這台裝置。", unavailable: "目前無法解除 Google 綁定。請稍後再試。" },
  "zh-CN": { action: "解除 Google 绑定", title: "解除这台设备的连接？", detail: "停止这台设备的 Google 同步并移除保存的登录凭证。本地笔记、尚未同步的内容与云端数据都会保留，也不会撤销其他设备的授权。", cancel: "保留连接", confirm: "解除绑定", working: "正在解除…", done: "已解除 Google 绑定，内容仍保留在这台设备。", unavailable: "目前无法解除 Google 绑定。请稍后再试。" },
  en: { action: "Unlink Google account", title: "Unlink this device?", detail: "Stop Google sync on this device and remove its saved credentials. Local notes, pending changes and cloud data stay intact. Authorization on other devices is not revoked.", cancel: "Keep linked", confirm: "Unlink account", working: "Unlinking…", done: "Google is unlinked. Your content remains on this device.", unavailable: "Could not unlink Google. Please try again." },
  ja: { action: "Google の連携を解除", title: "この端末の連携を解除しますか？", detail: "この端末の Google 同期を停止し、保存済みの認証情報を削除します。ローカルのノート、未同期の変更、クラウドのデータは保持され、他の端末の認可は取り消されません。", cancel: "連携を維持", confirm: "連携を解除", working: "解除中…", done: "Google の連携を解除しました。内容はこの端末に残ります。", unavailable: "Google の連携を解除できませんでした。もう一度お試しください。" },
  ko: { action: "Google 연결 해제", title: "이 기기의 연결을 해제할까요?", detail: "이 기기의 Google 동기화를 중지하고 저장된 인증 정보를 제거합니다. 로컬 노트, 미동기화 변경 사항 및 클라우드 데이터는 유지되며 다른 기기의 권한은 취소되지 않습니다.", cancel: "연결 유지", confirm: "연결 해제", working: "해제 중…", done: "Google 연결이 해제되었습니다. 콘텐츠는 이 기기에 남아 있습니다.", unavailable: "Google 연결을 해제하지 못했습니다. 다시 시도해 주세요." },
};

export function GoogleDisconnectControl({ language, enabled, blocked, onBusyChange, onDisconnected, onError }: {
  language: AppLanguage; enabled: boolean; blocked: boolean;
  onBusyChange: (busy: boolean) => void; onDisconnected: () => void; onError: (error: string) => void;
}) {
  const text = copy[language] || copy.en;
  const [connected, setConnected] = useState(enabled);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let active = true;
    if (enabled) setDone(false);
    void window.chengjing?.cloudBackups?.getLocalStatus().then(status => { if (active) setConnected(status.connected); }).catch(() => {});
    return () => { active = false; };
  }, [enabled]);
  async function unlink() {
    if (blocked || pending) return;
    const bridge = window.chengjing?.cloudBackups;
    if (!bridge) { onError(text.unavailable); return; }
    setPending(true); onBusyChange(true); onError("");
    try {
      await disconnectGoogleAccount({
        suspendRecovery: syncRecovery.suspend,
        pauseNative: window.chengjing?.platform === "android" ? () => androidCall("sync.pause") : undefined,
        disconnect: () => bridge.disconnect(),
      });
      setConnected(false); setConfirming(false); setDone(true); onDisconnected();
    } catch { onError(text.unavailable); onDisconnected(); }
    finally { setPending(false); onBusyChange(false); }
  }
  if (!connected && !done) return null;
  return <div className="sync-account-control">
    {done ? <p role="status">{text.done}</p> : <>
      <button type="button" className="sync-unlink-trigger" disabled={blocked || pending} aria-expanded={confirming} onClick={() => setConfirming(value => !value)}><Unplug size={15} aria-hidden="true"/><span>{text.action}</span></button>
      {confirming && <section className="sync-unlink-confirm" role="group" aria-label={text.title}>
        <strong>{text.title}</strong><p>{text.detail}</p>
        <div><button type="button" disabled={pending} onClick={() => setConfirming(false)}>{text.cancel}</button><button type="button" className="sync-unlink-submit" disabled={blocked || pending} onClick={() => void unlink()}>{pending && <LoaderCircle size={15} className="spin" aria-hidden="true"/>}{pending ? text.working : text.confirm}</button></div>
      </section>}
    </>}
  </div>;
}
