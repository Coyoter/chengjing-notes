import type { AppLanguage } from "../types";
const copies = {
  "zh-TW": { retry: "重試", topic: "歸入分類…", board: "加入白板…", kanban: "加入看板…", destination: "選擇目的地", list: "看板列表", create: "新增…", name: "名稱", none: "未歸類", submit: "儲存", hint: "使用同一張卡片，不會另外複製內容。", noTopics: "尚未建立主題分類，請先在卡片庫新增。", filed: "完成整理 · 保留在卡片庫" },
  "zh-CN": { retry: "重试", topic: "归入分类…", board: "加入白板…", kanban: "加入看板…", destination: "选择目的地", list: "看板列表", create: "新增…", name: "名称", none: "未归类", submit: "保存", hint: "使用同一张卡片，不会另外复制内容。", noTopics: "尚未建立主题分类，请先在卡片库新增。", filed: "完成整理 · 保留在卡片库" },
  en: { retry: "Retry", topic: "File under…", board: "Add to whiteboard…", kanban: "Add to kanban…", destination: "Choose destination", list: "Kanban list", create: "Create new…", name: "Name", none: "Uncategorized", submit: "Save", hint: "Uses the same card, without duplicating its content.", noTopics: "Create a topic in the library first.", filed: "Finish organizing · Keep in library" },
  ja: { retry: "再試行", topic: "分類に移動…", board: "ホワイトボードに追加…", kanban: "カンバンに追加…", destination: "保存先を選択", list: "カンバンリスト", create: "新規作成…", name: "名前", none: "未分類", submit: "保存", hint: "同じカードを使い、内容は複製しません。", noTopics: "先にライブラリでトピックを作成してください。", filed: "整理を完了 · ライブラリに保存" },
  ko: { retry: "다시 시도", topic: "분류 지정…", board: "화이트보드에 추가…", kanban: "칸반에 추가…", destination: "대상 선택", list: "칸반 목록", create: "새로 만들기…", name: "이름", none: "미분류", submit: "저장", hint: "내용을 복제하지 않고 같은 카드를 사용합니다.", noTopics: "먼저 라이브러리에서 주제를 만드세요.", filed: "정리 완료 · 라이브러리에 보관" },
} satisfies Record<AppLanguage, Record<string, string>>;
export function captureCopy(language: AppLanguage) { return copies[language]; }
