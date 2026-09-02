import type { AppLanguage } from "../types";

const copies = {
  "zh-TW": {
    allContent: "所有內容", cardsOnly: "卡片", tasksOnly: "待辦", matching: "{count} 筆符合目前條件", empty: "目前條件沒有符合的內容。",
    status: "狀態", tagsAndDue: "標籤／期限", taskOpen: "待處理", taskDone: "已完成", noDue: "無期限", due: "期限 {date}", batchCardsOnly: "批次垃圾桶與永久刪除只套用到卡片；待辦可用右鍵個別管理。",
    brainType: "待辦", brainDescription: "卡片、日誌、白板、待辦與隻言片語在這裡成為同一張立體記憶網。", brainNeedContent: "先留下幾則卡片、日誌、待辦或隻言片語，再生成今日分析。", brainEmpty: "先新增卡片、待辦或隻言片語，神經元就會出現在這裡。",
    source: "來源", shareTasks: "待辦事項", shareTasksPrivate: "可能包含工作與生活安排",
  },
  "zh-CN": {
    allContent: "所有内容", cardsOnly: "卡片", tasksOnly: "待办", matching: "{count} 条符合当前条件", empty: "当前条件没有符合的内容。",
    status: "状态", tagsAndDue: "标签／期限", taskOpen: "待处理", taskDone: "已完成", noDue: "无期限", due: "期限 {date}", batchCardsOnly: "批量移入回收站和永久删除只适用于卡片；待办可通过右键单独管理。",
    brainType: "待办", brainDescription: "卡片、日志、白板、待办和只言片语在这里成为同一张立体记忆网。", brainNeedContent: "先留下几则卡片、日志、待办或只言片语，再生成今日分析。", brainEmpty: "先新增卡片、待办或只言片语，神经元就会出现在这里。",
    source: "来源", shareTasks: "待办事项", shareTasksPrivate: "可能包含工作和生活安排",
  },
  en: {
    allContent: "All content", cardsOnly: "Cards", tasksOnly: "Tasks", matching: "{count} items match the current filters", empty: "No content matches the current filters.",
    status: "Status", tagsAndDue: "Tags / due", taskOpen: "Open", taskDone: "Completed", noDue: "No due date", due: "Due {date}", batchCardsOnly: "Batch Trash and permanent deletion apply to cards only. Manage tasks individually from their context menu.",
    brainType: "Task", brainDescription: "Cards, journals, boards, tasks, and fragments become one spatial memory network here.", brainNeedContent: "Add a few cards, journal entries, tasks, or fragments before generating today's analysis.", brainEmpty: "Add a card, task, or fragment and its neuron will appear here.",
    source: "Source", shareTasks: "Tasks", shareTasksPrivate: "May include work and personal plans",
  },
  ja: {
    allContent: "すべての内容", cardsOnly: "カード", tasksOnly: "タスク", matching: "現在の条件に一致する項目 {count}件", empty: "現在の条件に一致する内容はありません。",
    status: "状態", tagsAndDue: "タグ／期限", taskOpen: "未完了", taskDone: "完了", noDue: "期限なし", due: "期限 {date}", batchCardsOnly: "一括ゴミ箱移動と完全削除はカードのみが対象です。タスクは右クリックから個別に管理できます。",
    brainType: "タスク", brainDescription: "カード、日誌、ボード、タスク、ひとことが一つの立体記憶網になります。", brainNeedContent: "カード、日誌、タスク、ひとことをいくつか残してから今日の分析を生成してください。", brainEmpty: "カード、タスク、ひとことを追加するとニューロンが現れます。",
    source: "参照元", shareTasks: "タスク", shareTasksPrivate: "仕事や生活の予定を含む場合があります",
  },
  ko: {
    allContent: "모든 콘텐츠", cardsOnly: "카드", tasksOnly: "할 일", matching: "현재 조건과 일치하는 항목 {count}개", empty: "현재 조건에 맞는 콘텐츠가 없습니다.",
    status: "상태", tagsAndDue: "태그／기한", taskOpen: "진행 중", taskDone: "완료", noDue: "기한 없음", due: "기한 {date}", batchCardsOnly: "일괄 휴지통 이동과 영구 삭제는 카드에만 적용됩니다. 할 일은 우클릭 메뉴에서 개별 관리하세요.",
    brainType: "할 일", brainDescription: "카드, 일지, 보드, 할 일, 짧은 생각이 하나의 입체 기억망이 됩니다.", brainNeedContent: "카드, 일지, 할 일, 짧은 생각을 몇 개 남긴 뒤 오늘의 분석을 생성하세요.", brainEmpty: "카드, 할 일, 짧은 생각을 추가하면 뉴런이 나타납니다.",
    source: "출처", shareTasks: "할 일", shareTasksPrivate: "업무와 개인 일정이 포함될 수 있음",
  },
} as const;

export function getTaskIntegrationCopy(language: AppLanguage) {
  return copies[language] || copies["zh-TW"];
}

export function taskCopyFormat(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}
