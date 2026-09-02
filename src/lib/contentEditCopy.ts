import type { AppLanguage } from "../types";

interface ContentEditCopy {
  edit: string;
  taskEyebrow: string;
  taskTitle: string;
  taskLabel: string;
  fragmentEyebrow: string;
  fragmentTitle: string;
  fragmentLabel: string;
  highlightEyebrow: string;
  highlightTitle: string;
  highlightTextLabel: string;
  highlightNoteLabel: string;
  highlightNotePlaceholder: string;
}

const copies: Record<AppLanguage, ContentEditCopy> = {
  "zh-TW": {
    edit: "編輯",
    taskEyebrow: "待辦",
    taskTitle: "編輯待辦",
    taskLabel: "待辦內容",
    fragmentEyebrow: "隻言片語",
    fragmentTitle: "編輯這段片語",
    fragmentLabel: "片語內容",
    highlightEyebrow: "劃記",
    highlightTitle: "編輯劃記",
    highlightTextLabel: "劃記內容",
    highlightNoteLabel: "補充想法",
    highlightNotePlaceholder: "留下一句為什麼這段內容值得記住…",
  },
  "zh-CN": {
    edit: "编辑",
    taskEyebrow: "待办",
    taskTitle: "编辑待办",
    taskLabel: "待办内容",
    fragmentEyebrow: "只言片语",
    fragmentTitle: "编辑这段片语",
    fragmentLabel: "片语内容",
    highlightEyebrow: "划记",
    highlightTitle: "编辑划记",
    highlightTextLabel: "划记内容",
    highlightNoteLabel: "补充想法",
    highlightNotePlaceholder: "留下一句为什么这段内容值得记住…",
  },
  en: {
    edit: "Edit",
    taskEyebrow: "Task",
    taskTitle: "Edit task",
    taskLabel: "Task",
    fragmentEyebrow: "Fragment",
    fragmentTitle: "Edit fragment",
    fragmentLabel: "Fragment",
    highlightEyebrow: "Highlight",
    highlightTitle: "Edit highlight",
    highlightTextLabel: "Highlighted text",
    highlightNoteLabel: "Note",
    highlightNotePlaceholder: "Add a short note about why this matters…",
  },
  ja: {
    edit: "編集",
    taskEyebrow: "タスク",
    taskTitle: "タスクを編集",
    taskLabel: "タスク内容",
    fragmentEyebrow: "ひとこと",
    fragmentTitle: "ひとことを編集",
    fragmentLabel: "内容",
    highlightEyebrow: "ハイライト",
    highlightTitle: "ハイライトを編集",
    highlightTextLabel: "ハイライト内容",
    highlightNoteLabel: "補足メモ",
    highlightNotePlaceholder: "この箇所を残した理由をひとこと…",
  },
  ko: {
    edit: "편집",
    taskEyebrow: "할 일",
    taskTitle: "할 일 편집",
    taskLabel: "할 일 내용",
    fragmentEyebrow: "짧은 생각",
    fragmentTitle: "짧은 생각 편집",
    fragmentLabel: "내용",
    highlightEyebrow: "하이라이트",
    highlightTitle: "하이라이트 편집",
    highlightTextLabel: "하이라이트 내용",
    highlightNoteLabel: "메모",
    highlightNotePlaceholder: "이 부분을 기억할 이유를 짧게 남겨 보세요…",
  },
};

export function getContentEditCopy(language: AppLanguage) {
  return copies[language];
}
