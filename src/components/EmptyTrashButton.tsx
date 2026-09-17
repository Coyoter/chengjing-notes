import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { LoaderCircle, Trash2 } from "lucide-react";
import { db } from "../db";
import { useI18n } from "../hooks/useI18n";
import { permanentlyDeleteTrashItems } from "../lib/trash";

export function EmptyTrashButton({ disabled = false, onBusyChange, onComplete }: { disabled?: boolean; onBusyChange?: (busy: boolean) => void; onComplete?: () => void }) {
  const { language } = useI18n();
  const count = useLiveQuery(() => db.cards.where("state").equals("trash").count(), [], 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const copy = {
    "zh-TW": { action: "永久清空垃圾桶", confirm: (n: number) => `永久刪除垃圾桶全部 ${n} 個項目及其相關資料？\n\n這包含目前未顯示的垃圾桶項目，不包含封存或一般卡片。已分享項目可能隨既有同步移除公開副本。請先確認有需要的備份。`, failed: "無法完成清空，資料未變更。" },
    "zh-CN": { action: "永久清空回收站", confirm: (n: number) => `永久删除回收站全部 ${n} 个项目及其相关数据？\n\n包含当前未显示的回收站项目，不包含归档或普通卡片。已分享项目可能随同步移除公开副本。请先确认所需备份。`, failed: "无法完成清空，数据未更改。" },
    en: { action: "Empty trash permanently", confirm: (n: number) => `Permanently delete all ${n} trashed items and related data?\n\nIncludes items outside the current filter, but not archived or active cards. Existing sync may remove shared copies. Check your backups first.`, failed: "Could not empty trash. Data was not changed." },
    ja: { action: "ゴミ箱を完全に空にする", confirm: (n: number) => `ゴミ箱の全 ${n} 件と関連データを完全に削除しますか？\n\n非表示の項目も含みますが、アーカイブや通常のカードは含みません。共有済みコピーも同期で削除される場合があります。バックアップをご確認ください。`, failed: "ゴミ箱を空にできませんでした。データは変更されていません。" },
    ko: { action: "휴지통 영구 비우기", confirm: (n: number) => `휴지통의 모든 ${n}개 항목과 관련 데이터를 영구 삭제할까요?\n\n현재 필터에 없는 항목도 포함하며 보관 및 일반 카드는 제외됩니다. 공유 사본도 동기화로 삭제될 수 있습니다. 백업을 먼저 확인하세요.`, failed: "휴지통을 비우지 못했습니다. 데이터는 변경되지 않았습니다." },
  }[language];
  async function clear() {
    if (busy || disabled) return;
    const ids = (await db.cards.where("state").equals("trash").primaryKeys()).map(String);
    if (!ids.length || !window.confirm(copy.confirm(ids.length))) return;
    setBusy(true); onBusyChange?.(true); setError("");
    try { await permanentlyDeleteTrashItems(ids); onComplete?.(); }
    catch { setError(copy.failed); }
    finally { setBusy(false); onBusyChange?.(false); }
  }
  return <span className="empty-trash-control"><button type="button" className="empty-trash-button" disabled={disabled || busy || count === 0} onClick={() => void clear()}>{busy ? <LoaderCircle size={16} className="spin"/> : <Trash2 size={16}/>}<span>{copy.action}</span></button>{error && <small role="alert">{error}</small>}</span>;
}
