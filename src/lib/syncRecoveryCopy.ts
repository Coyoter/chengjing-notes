import type { AppLanguage } from "../types";

const en = {
  heading: "Daily recovery points",
  description: "A recovery point is saved automatically after a successful sync each day. Restore synchronized content from yesterday or the day before.",
  utc: "Dates use UTC. Days without a successful sync do not have a recovery point.",
  yesterday: "Yesterday",
  dayBeforeYesterday: "Day before yesterday",
  empty: "No recovery point for this date",
  notLoaded: "Recovery points have not been loaded.",
  unavailable: "Daily recovery points are not available on this platform yet. Existing recovery tools remain below.",
  paused: "Sync is not enabled. Enable Google Sync before restoring.",
  refresh: "Refresh",
  restore: "Restore",
  checking: "Reading recovery points…",
  creating: "Saving today's recovery point…",
  restoring: "Restoring safely…",
  confirm: "Restore all synchronized content to {time}?\n\nContent added after this point will also be removed. A complete local safety copy must be saved first. The restored content will become new changes and sync to your other devices.",
  error: "The operation did not finish. Your current content has not been replaced by this attempt. Please try again.",
  authError: "Google authorization is unavailable. Check the Google Sync connection and try again.",
  changedError: "Content changed during preparation. Nothing was replaced; review the recovery point and try again.",
  invalidError: "The recovery point or its attachments could not be verified. Nothing was restored.",
  safetyError: "The local safety copy could not be saved. Nothing was restored.",
  pendingError: "Changes are still waiting to sync. Complete synchronization before trying again.",
  cleanup: "Temporary cleanup was deferred. The operation result shown here is unchanged.",
  restored: "Content was restored locally and the following synchronization completed.",
  restoredPending: "Content was restored locally. Synchronization is still pending; do not repeat the restoration.",
  safety: "Local safety copy saved before restoration",
};
type Copy = Record<keyof typeof en, string>;

const tw: Copy = {
  heading: "每日復原點",
  description: "成功同步後每天自動保留一次；可復原昨天或前天的同步內容。",
  utc: "日期統一以 UTC 計算；沒有成功同步的日期不會產生復原點。",
  yesterday: "昨天",
  dayBeforeYesterday: "前天",
  empty: "這一天沒有可用的復原點",
  notLoaded: "尚未讀取歷史復原點。",
  unavailable: "此平台尚未提供每日復原點，下方既有內容救援仍可使用。",
  paused: "同步目前未啟用；請先啟用 Google 同步，再進行復原。",
  refresh: "重新整理",
  restore: "復原",
  checking: "正在讀取復原點…",
  creating: "正在保留今天的復原點…",
  restoring: "正在安全復原…",
  confirm: "確定將所有已同步內容復原到 {time}？\n\n快照之後新增的內容也會移除。執行前必須先成功保存完整的本機安全副本；復原後的內容會成為新的修改，接續同步到其他裝置。",
  error: "這次操作尚未完成，尚未以此復原點取代目前內容，請稍後重試。",
  authError: "Google 授權目前無法使用，請先檢查 Google 同步連線。",
  changedError: "準備期間有新的內容修改，尚未取代任何內容，請重新確認後再試。",
  invalidError: "復原點或附件未通過完整性檢查，尚未執行復原。",
  safetyError: "本機安全副本未能成功保存，尚未執行復原。",
  pendingError: "仍有內容等待同步，請先完成同步後再試。",
  cleanup: "暫存清理已延後，不影響這裡顯示的操作結果。",
  restored: "內容已在本機復原，並已完成後續同步。",
  restoredPending: "內容已在本機復原，仍在等待同步；不需要重複復原。",
  safety: "復原前保存的本機安全副本",
};

const translations: Record<AppLanguage, Copy> = {
  "zh-TW": tw,
  "zh-CN": {
    heading: "每日恢复点",
    description: "成功同步后每天自动保留一次；可恢复昨天或前天的同步内容。",
    utc: "日期统一按 UTC 计算；没有成功同步的日期不会产生恢复点。",
    yesterday: "昨天", dayBeforeYesterday: "前天",
    empty: "这一天没有可用的恢复点", notLoaded: "尚未读取历史恢复点。",
    unavailable: "此平台尚未提供每日恢复点，下方现有内容恢复工具仍可使用。",
    paused: "同步尚未启用；请先启用 Google 同步，再进行恢复。",
    refresh: "刷新", restore: "恢复",
    checking: "正在读取恢复点…", creating: "正在保留今天的恢复点…", restoring: "正在安全恢复…",
    confirm: "确定将所有已同步内容恢复到 {time}？\n\n快照之后新增的内容也会移除。执行前必须先成功保存完整的本地安全副本；恢复后的内容会成为新的修改，继续同步到其他设备。",
    error: "此次操作尚未完成，尚未以此恢复点替换当前内容，请稍后重试。",
    authError: "Google 授权目前不可用，请先检查 Google 同步连接。",
    changedError: "准备期间有新的内容修改，尚未替换任何内容，请重新确认后再试。",
    invalidError: "恢复点或附件未通过完整性检查，尚未执行恢复。",
    safetyError: "本地安全副本未能成功保存，尚未执行恢复。",
    pendingError: "仍有内容等待同步，请先完成同步后再试。",
    cleanup: "临时文件清理已延后，不影响此处显示的操作结果。",
    restored: "内容已在本地恢复，并已完成后续同步。",
    restoredPending: "内容已在本地恢复，仍在等待同步；不需要重复恢复。",
    safety: "恢复前保存的本地安全副本",
  },
  en,
  ja: {
    heading: "毎日の復元ポイント",
    description: "同期に成功した日に、自動で1回保存します。昨日または一昨日の同期内容を復元できます。",
    utc: "日付は UTC 基準です。同期に成功していない日の復元ポイントはありません。",
    yesterday: "昨日", dayBeforeYesterday: "一昨日",
    empty: "この日の復元ポイントはありません", notLoaded: "復元ポイントは未読込です。",
    unavailable: "この環境では毎日の復元ポイントはまだ利用できません。既存の復元ツールは下にあります。",
    paused: "同期が無効です。復元する前に Google 同期を有効にしてください。",
    refresh: "更新", restore: "復元",
    checking: "復元ポイントを読込中…", creating: "今日の復元ポイントを保存中…", restoring: "安全に復元中…",
    confirm: "同期済みのすべての内容を {time} に復元しますか？\n\nこの時点より後に追加した内容も削除されます。先に完全なローカル安全コピーを保存します。復元内容は新しい変更として他の端末にも同期されます。",
    error: "処理が完了していません。今回の復元ポイントで現在の内容は置き換えていません。再試行してください。",
    authError: "Google の認証を利用できません。Google 同期の接続を確認してください。",
    changedError: "準備中に内容が変更されました。置き換えは行っていません。確認して再試行してください。",
    invalidError: "復元ポイントまたは添付ファイルを検証できませんでした。復元していません。",
    safetyError: "ローカル安全コピーを保存できませんでした。復元していません。",
    pendingError: "未同期の変更があります。先に同期を完了してください。",
    cleanup: "一時ファイルの整理は延期されました。表示中の処理結果には影響しません。",
    restored: "ローカルの内容を復元し、その後の同期も完了しました。",
    restoredPending: "ローカルの復元は完了しましたが、同期は保留中です。復元を繰り返す必要はありません。",
    safety: "復元前に保存したローカル安全コピー",
  },
  ko: {
    heading: "일일 복원 지점",
    description: "동기화에 성공한 날 자동으로 한 번 저장합니다. 어제 또는 그저께의 동기화 내용을 복원할 수 있습니다.",
    utc: "날짜는 UTC 기준입니다. 동기화에 성공하지 않은 날에는 복원 지점이 없습니다.",
    yesterday: "어제", dayBeforeYesterday: "그저께",
    empty: "이 날짜의 복원 지점이 없습니다", notLoaded: "복원 지점을 아직 읽지 않았습니다.",
    unavailable: "이 플랫폼에서는 일일 복원 지점을 아직 지원하지 않습니다. 기존 복원 도구는 아래에서 사용할 수 있습니다.",
    paused: "동기화가 꺼져 있습니다. 복원하기 전에 Google 동기화를 켜세요.",
    refresh: "새로 고침", restore: "복원",
    checking: "복원 지점을 읽는 중…", creating: "오늘의 복원 지점을 저장하는 중…", restoring: "안전하게 복원하는 중…",
    confirm: "동기화된 모든 내용을 {time} 상태로 복원할까요?\n\n이 시점 이후에 추가한 내용도 삭제됩니다. 먼저 전체 로컬 안전 사본을 저장해야 합니다. 복원된 내용은 새로운 변경 사항으로 다른 기기에도 동기화됩니다.",
    error: "작업이 완료되지 않았습니다. 이번 복원 지점으로 현재 내용을 바꾸지 않았습니다. 다시 시도하세요.",
    authError: "Google 인증을 사용할 수 없습니다. Google 동기화 연결을 확인하세요.",
    changedError: "준비 중 내용이 변경되었습니다. 아무 내용도 바꾸지 않았습니다. 확인 후 다시 시도하세요.",
    invalidError: "복원 지점 또는 첨부 파일을 검증하지 못했습니다. 복원하지 않았습니다.",
    safetyError: "로컬 안전 사본을 저장하지 못했습니다. 복원하지 않았습니다.",
    pendingError: "아직 동기화되지 않은 변경 사항이 있습니다. 동기화를 먼저 완료하세요.",
    cleanup: "임시 파일 정리를 연기했습니다. 표시된 작업 결과에는 영향이 없습니다.",
    restored: "로컬 내용을 복원하고 후속 동기화도 완료했습니다.",
    restoredPending: "로컬 복원은 완료했지만 동기화를 기다리고 있습니다. 복원을 반복하지 마세요.",
    safety: "복원 전에 저장한 로컬 안전 사본",
  },
};

export function getSyncRecoveryCopy(language: AppLanguage): Copy {
  return translations[language] || en;
}

export function recoveryErrorText(code: string, language: AppLanguage): string {
  const text = getSyncRecoveryCopy(language);
  if (code === "sync-recovery-restored-sync-pending") return text.restoredPending;
  if (code === "sync-recovery-auth-required") return text.authError;
  if (code === "sync-recovery-paused") return text.paused;
  if (code === "sync-recovery-content-changed") return text.changedError;
  if (code === "sync-recovery-pending-changes") return text.pendingError;
  if (code === "sync-recovery-safety-copy-required") return text.safetyError;
  if (/^sync-recovery-.*(corrupt|invalid|missing|unavailable|incomplete|selection-changed)$/.test(code)) {
    return text.invalidError;
  }
  // Never display raw transport errors, credentials, or stack traces.
  return text.error;
}
