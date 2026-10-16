import { useSyncExternalStore } from "react";

let enabled = typeof window !== "undefined" && Boolean(window.chengjing?.privacy?.initial.enabled);
const listeners = new Set<() => void>();
window.chengjing?.privacy?.onChanged((state) => {
  enabled = state.enabled;
  document.documentElement.dataset.localOnly = String(enabled);
  for (const listener of listeners) listener();
  window.dispatchEvent(new Event("chengjing:local-only-changed"));
});
document.documentElement.dataset.localOnly = String(enabled);
document.addEventListener("click", (event) => {
  if (!enabled || !(event.target instanceof Element)) return;
  const link = event.target.closest("a[href]") as HTMLAnchorElement | null;
  if (link && !["file:", "blob:", "data:", "about:"].includes(link.protocol) && !link.getAttribute("href")?.startsWith("#")) {
    event.preventDefault(); event.stopImmediatePropagation();
  }
}, true);

export const isLocalOnly = () => enabled;
export function assertCloudAvailable() { if (enabled) throw new Error("local-only-mode"); }
export function useLocalOnly() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, isLocalOnly);
}

export function localOnlyCopy(language: string) {
  const zh = language.startsWith("zh");
  return zh ? {
    title: "純本地端模式", eyebrow: "連線與隱私", status: "純本地端模式已開啟",
    description: "只使用這台電腦。開啟後，除軟體更新外，澄境不會連線上傳或下載。",
    detail: "Google 同步、AI 與模型下載、第二大腦、社群、網頁匯入及外部工具連接會停用。本地筆記、附件、匯入匯出與本地備份照常使用。",
    restart: "切換時會儲存本機內容並重新開啟澄境，結束原有連線。關閉後，先前啟用的雲端功能會恢復。",
    blocked: "純本地端模式中不可用", busy: "正在儲存並重新開啟…", failed: "無法切換模式，請稍後重試。",
    backup: "本地備份若選用雲端硬碟或網路磁碟資料夾，該服務仍可能自行同步檔案。公司設備請選擇真正的本機資料夾。",
  } : {
    title: "Local-only mode", eyebrow: "CONNECTIONS & PRIVACY", status: "Local-only mode is on",
    description: "Use only this computer. When enabled, ChengJing makes no network uploads or downloads except software updates.",
    detail: "Google sync, AI and model downloads, Second Brain, community, web import and external tool connections are disabled. Local notes, attachments, file import/export and local backups remain available.",
    restart: "Switching saves local changes and restarts ChengJing to end existing connections. Turning it off restores previously enabled cloud features.",
    blocked: "Unavailable in local-only mode", busy: "Saving and restarting…", failed: "Could not switch modes. Please try again.",
    backup: "A backup folder inside a cloud drive or network disk may still be synced by that service. On company devices, choose a genuinely local folder.",
  };
}
