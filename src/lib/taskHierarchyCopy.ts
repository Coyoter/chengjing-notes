import type { AppLanguage } from "../types";

interface TaskHierarchyCopy {
  addChild: string;
  dialogEyebrow: string;
  dialogTitle: (parent: string) => string;
  inputLabel: string;
  placeholder: string;
  added: string;
  alreadyExists: string;
  inheritsDue: string;
  subtask: string;
  progress: (done: number, total: number) => string;
  confirmDelete: (title: string, count: number) => string;
}

const copies: Record<AppLanguage, TaskHierarchyCopy> = {
  "zh-TW": {
    addChild: "新增子項目",
    dialogEyebrow: "待辦層級",
    dialogTitle: (parent) => `在「${parent}」下新增子項目`,
    inputLabel: "子項目內容",
    placeholder: "輸入一個更小、可以完成的步驟…",
    added: "子項目已加入",
    alreadyExists: "相同的未完成子項目已經存在",
    inheritsDue: "沿用主項目的期限，之後仍可個別修改",
    subtask: "子項目",
    progress: (done, total) => `${done}/${total} 子項目完成`,
    confirmDelete: (title, count) => `刪除「${title}」及其 ${count} 個子項目？這項操作無法復原。`,
  },
  "zh-CN": {
    addChild: "新增子项目",
    dialogEyebrow: "待办层级",
    dialogTitle: (parent) => `在“${parent}”下新增子项目`,
    inputLabel: "子项目内容",
    placeholder: "输入一个更小、可以完成的步骤…",
    added: "子项目已加入",
    alreadyExists: "相同的未完成子项目已经存在",
    inheritsDue: "沿用主项目期限，之后仍可单独修改",
    subtask: "子项目",
    progress: (done, total) => `${done}/${total} 子项目完成`,
    confirmDelete: (title, count) => `删除“${title}”及其 ${count} 个子项目？此操作无法恢复。`,
  },
  en: {
    addChild: "Add subtask",
    dialogEyebrow: "Task hierarchy",
    dialogTitle: (parent) => `Add a subtask under “${parent}”`,
    inputLabel: "Subtask",
    placeholder: "Add a smaller step you can complete…",
    added: "Subtask added",
    alreadyExists: "The same unfinished subtask already exists",
    inheritsDue: "Uses the parent due date; you can change it later",
    subtask: "Subtask",
    progress: (done, total) => `${done}/${total} subtasks complete`,
    confirmDelete: (title, count) => `Delete “${title}” and its ${count} subtasks? This cannot be undone.`,
  },
  ja: {
    addChild: "サブタスクを追加",
    dialogEyebrow: "タスク階層",
    dialogTitle: (parent) => `「${parent}」にサブタスクを追加`,
    inputLabel: "サブタスク内容",
    placeholder: "完了できる小さな手順を入力…",
    added: "サブタスクを追加しました",
    alreadyExists: "同じ未完了のサブタスクがすでにあります",
    inheritsDue: "親タスクの期限を引き継ぎ、後から個別に変更できます",
    subtask: "サブタスク",
    progress: (done, total) => `${done}/${total} 完了`,
    confirmDelete: (title, count) => `「${title}」と配下の${count}件を削除しますか？元に戻せません。`,
  },
  ko: {
    addChild: "하위 항목 추가",
    dialogEyebrow: "할 일 계층",
    dialogTitle: (parent) => `‘${parent}’ 아래에 하위 항목 추가`,
    inputLabel: "하위 항목 내용",
    placeholder: "완료할 수 있는 더 작은 단계를 입력하세요…",
    added: "하위 항목을 추가했습니다",
    alreadyExists: "같은 미완료 하위 항목이 이미 있습니다",
    inheritsDue: "상위 항목의 기한을 따르며 나중에 개별 변경할 수 있습니다",
    subtask: "하위 항목",
    progress: (done, total) => `${done}/${total} 하위 항목 완료`,
    confirmDelete: (title, count) => `‘${title}’과 하위 항목 ${count}개를 삭제할까요? 되돌릴 수 없습니다.`,
  },
};

export function getTaskHierarchyCopy(language: AppLanguage) {
  return copies[language];
}
