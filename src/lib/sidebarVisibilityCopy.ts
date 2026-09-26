import type { AppLanguage } from "../types";

const copies = {
  "zh-TW": {
    hide: "隱藏此功能", hidden: "顯示隱藏功能", show: "顯示", showAll: "全部顯示",
    empty: "目前沒有隱藏功能", hint: "只隱藏選單，不會刪除資料。可在左側空白處按右鍵重新顯示。",
    navigationHint: "拖曳排序，或按 Alt＋↑／↓；右鍵隱藏",
  },
  "zh-CN": {
    hide: "隐藏此功能", hidden: "显示隐藏功能", show: "显示", showAll: "全部显示",
    empty: "目前没有隐藏功能", hint: "只隐藏菜单，不会删除数据。可在左侧空白处右键重新显示。",
    navigationHint: "拖动排序，或按 Alt＋↑／↓；右键隐藏",
  },
  en: {
    hide: "Hide this feature", hidden: "Show hidden features", show: "Show", showAll: "Show all",
    empty: "No hidden features", hint: "Hides only the menu entry, not your data. Right-click empty sidebar space to show it again.",
    navigationHint: "Drag to reorder, or Alt + ↑ / ↓; right-click to hide",
  },
  ja: {
    hide: "この機能を非表示", hidden: "非表示の機能を表示", show: "表示", showAll: "すべて表示",
    empty: "非表示の機能はありません", hint: "メニューだけを非表示にし、データは削除しません。左側の空白部分を右クリックすると再表示できます。",
    navigationHint: "ドラッグまたは Alt＋↑／↓で並べ替え、右クリックで非表示",
  },
  ko: {
    hide: "이 기능 숨기기", hidden: "숨긴 기능 표시", show: "표시", showAll: "모두 표시",
    empty: "숨긴 기능이 없습니다", hint: "메뉴만 숨기며 데이터는 삭제하지 않습니다. 왼쪽 빈 공간을 오른쪽 클릭하면 다시 표시할 수 있습니다.",
    navigationHint: "드래그 또는 Alt＋↑／↓로 정렬, 오른쪽 클릭으로 숨기기",
  },
};

export function getSidebarVisibilityCopy(language: AppLanguage) {
  return copies[language];
}
