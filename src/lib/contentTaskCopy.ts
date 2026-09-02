import type { AppLanguage } from "../types";

interface ContentTaskCopy {
  addAsTask: string;
  unscheduled: string;
  menuLabel: string;
  added: string;
  alreadyExists: string;
  section: string;
}

const copies: Record<AppLanguage, ContentTaskCopy> = {
  "zh-TW": {
    addAsTask: "新增為待辦",
    unscheduled: "未排期",
    menuLabel: "新增為待辦 · 未排期",
    added: "已加入待辦，尚未排期",
    alreadyExists: "這項內容已經在未排期待辦中",
    section: "待辦",
  },
  "zh-CN": {
    addAsTask: "新增为待办",
    unscheduled: "未排期",
    menuLabel: "新增为待办 · 未排期",
    added: "已加入待办，尚未排期",
    alreadyExists: "这项内容已经在未排期待办中",
    section: "待办",
  },
  en: {
    addAsTask: "Add as task",
    unscheduled: "Unscheduled",
    menuLabel: "Add as task · Unscheduled",
    added: "Added to Tasks without a due date",
    alreadyExists: "This content is already in unscheduled Tasks",
    section: "Task",
  },
  ja: {
    addAsTask: "タスクに追加",
    unscheduled: "未定",
    menuLabel: "タスクに追加 · 日程未定",
    added: "日程未定のタスクに追加しました",
    alreadyExists: "この内容はすでに日程未定のタスクにあります",
    section: "タスク",
  },
  ko: {
    addAsTask: "할 일로 추가",
    unscheduled: "일정 없음",
    menuLabel: "할 일로 추가 · 일정 없음",
    added: "일정 없는 할 일로 추가했습니다",
    alreadyExists: "이 콘텐츠는 이미 일정 없는 할 일에 있습니다",
    section: "할 일",
  },
};

export function getContentTaskCopy(language: AppLanguage) {
  return copies[language];
}
