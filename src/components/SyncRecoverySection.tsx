import type { ReactNode } from "react";
import { ChevronDown, History } from "lucide-react";
import type { AppLanguage } from "../types";
import "./sync-recovery.css";

const copy: Record<AppLanguage, { title: string; hint: string }> = {
  "zh-TW": { title: "版本復原", hint: "找回較早內容，復原後接續同步" },
  "zh-CN": { title: "版本恢复", hint: "找回较早内容，恢复后继续同步" },
  en: { title: "Version recovery", hint: "Recover earlier content and continue syncing" },
  ja: { title: "バージョンの復元", hint: "以前の内容を復元し、同期を続けます" },
  ko: { title: "버전 복원", hint: "이전 내용을 복원하고 동기화를 계속합니다" },
};

/** A single disclosure inside the Google Sync card, not another backup card. */
export function SyncRecoverySection({
  language,
  children,
  onOpen,
}: {
  language: AppLanguage;
  children: ReactNode;
  onOpen?: () => void;
}) {
  const text = copy[language] || copy.en;
  return (
    <details className="sync-recovery" id="sync-recovery" onToggle={event => {
      if (event.target === event.currentTarget && event.currentTarget.open) onOpen?.();
    }}>
      <summary>
        <History size={18} aria-hidden="true" />
        <span className="sync-recovery-label">
          <b>{text.title}</b>
          <small>{text.hint}</small>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="sync-recovery-content">{children}</div>
    </details>
  );
}
