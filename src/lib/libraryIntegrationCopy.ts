import type { AppLanguage } from "../types";
const copy = {
  "zh-TW": { allTags: "所有標籤", stages: "階段視圖", more: "顯示更多內容", tagHint: "標籤可與領域、主題及類型一起篩選。", failed: "操作未完成，請再試一次。" },
  "zh-CN": { allTags: "所有标签", stages: "阶段视图", more: "显示更多内容", tagHint: "标签可与领域、主题及类型一起筛选。", failed: "操作未完成，请重试。" },
  en: { allTags: "All tags", stages: "Stage view", more: "Show more content", tagHint: "Combine tags with areas, topics and content types.", failed: "The operation could not be completed. Please try again." },
  ja: { allTags: "すべてのタグ", stages: "段階ビュー", more: "さらに表示", tagHint: "タグを領域、トピック、種類と組み合わせて絞り込めます。", failed: "操作を完了できませんでした。もう一度お試しください。" },
  ko: { allTags: "모든 태그", stages: "단계 보기", more: "더 보기", tagHint: "태그를 영역, 주제 및 유형과 함께 필터링하세요.", failed: "작업을 완료하지 못했습니다. 다시 시도해 주세요." },
};
export function getLibraryIntegrationCopy(language: AppLanguage) { return copy[language]; }
