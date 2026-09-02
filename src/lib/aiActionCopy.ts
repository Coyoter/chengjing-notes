import type { AppLanguage } from "../types";

const copies = {
  "zh-TW": { mode: "AI 動作", modeHint: "把自然語言轉成可預覽、可套用的本機變更", planning: "AI 正在準備變更計畫…", planTitle: "準備套用到澄境", apply: (count: number) => `套用 ${count} 個變更`, cancel: "取消計畫", applied: (count: number) => `已完成 ${count} 個變更。`, failed: "無法產生安全、可驗證的變更計畫。", empty: "AI 沒有提出需要修改澄境的動作。", destructive: "包含刪除或覆蓋；套用前請逐項確認。", actionCreate: "新增", actionUpdate: "修改", actionDelete: "刪除", preview: "只會在你按下套用後寫入資料庫" },
  "zh-CN": { mode: "AI 操作", modeHint: "将自然语言转换成可预览、可应用的本地变更", planning: "AI 正在准备变更计划…", planTitle: "准备应用到澄境", apply: (count: number) => `应用 ${count} 个变更`, cancel: "取消计划", applied: (count: number) => `已完成 ${count} 个变更。`, failed: "无法生成安全、可验证的变更计划。", empty: "AI 没有提出需要修改澄境的操作。", destructive: "包含删除或覆盖；应用前请逐项确认。", actionCreate: "新增", actionUpdate: "修改", actionDelete: "删除", preview: "仅在你点击应用后写入数据库" },
  en: { mode: "AI Actions", modeHint: "Turn natural language into previewable local changes", planning: "AI is preparing a change plan…", planTitle: "Ready to apply in ChengJing", apply: (count: number) => `Apply ${count} changes`, cancel: "Cancel plan", applied: (count: number) => `Applied ${count} changes.`, failed: "Could not produce a safe, verifiable change plan.", empty: "AI proposed no changes to ChengJing.", destructive: "Contains deletion or replacement. Review every item before applying.", actionCreate: "Create", actionUpdate: "Update", actionDelete: "Delete", preview: "Nothing is written until you press Apply" },
  ja: { mode: "AIアクション", modeHint: "自然言語を確認可能なローカル変更へ変換", planning: "AIが変更計画を準備中…", planTitle: "ChengJingへ適用する準備", apply: (count: number) => `${count}件の変更を適用`, cancel: "計画をキャンセル", applied: (count: number) => `${count}件の変更を完了しました。`, failed: "安全で検証可能な変更計画を作成できませんでした。", empty: "ChengJingを変更するアクションは提案されませんでした。", destructive: "削除または置換を含みます。適用前に各項目を確認してください。", actionCreate: "追加", actionUpdate: "変更", actionDelete: "削除", preview: "「適用」を押すまでデータベースへ書き込みません" },
  ko: { mode: "AI 작업", modeHint: "자연어를 미리 확인할 수 있는 로컬 변경으로 변환", planning: "AI가 변경 계획을 준비하는 중…", planTitle: "ChengJing에 적용할 준비", apply: (count: number) => `변경 ${count}개 적용`, cancel: "계획 취소", applied: (count: number) => `변경 ${count}개를 완료했습니다.`, failed: "안전하고 검증 가능한 변경 계획을 만들지 못했습니다.", empty: "ChengJing을 수정할 작업이 제안되지 않았습니다.", destructive: "삭제 또는 덮어쓰기를 포함합니다. 적용 전 각 항목을 확인하세요.", actionCreate: "추가", actionUpdate: "수정", actionDelete: "삭제", preview: "적용을 누르기 전에는 데이터베이스에 쓰지 않습니다" },
} as const;

export function getAiActionCopy(language: AppLanguage) { return copies[language] || copies.en; }

export function formatAiActionResult(language: AppLanguage, applied: number, skipped: number) {
  if (skipped === 0) return getAiActionCopy(language).applied(applied);
  if (language === "zh-TW") return `已完成 ${applied} 個變更；略過 ${skipped} 條無法辨識的關係線。白板其他內容已安全建立。`;
  if (language === "zh-CN") return `已完成 ${applied} 个变更；跳过 ${skipped} 条无法识别的连接。白板其他内容已安全建立。`;
  if (language === "ja") return `${applied}件の変更を完了し、参照先を特定できない接続${skipped}件をスキップしました。ほかのボード内容は安全に作成されています。`;
  if (language === "ko") return `변경 ${applied}개를 완료하고 대상을 확인할 수 없는 연결 ${skipped}개를 건너뛰었습니다. 나머지 보드 내용은 안전하게 생성되었습니다.`;
  return `Applied ${applied} changes and skipped ${skipped} connections whose endpoints could not be identified. The rest of the board was created safely.`;
}
