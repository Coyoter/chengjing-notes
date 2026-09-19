import type { AppLanguage } from "../types";
const copies = {
  "zh-TW": { scope: "近期工作集合・舊內容可搜尋或翻頁", older: "較早內容", newer: "較新內容", loading: "正在準備這批內容…", done: "這批內容已整理，沒有新增或修改。", batch: "分批整理", finish: "連結已保存；可繼續下一批，或另按今日反思。", stale: "內容在分析期間有變更，這次結果未套用，請重新整理。" },
  "zh-CN": { scope: "近期工作集合・旧内容可搜索或翻页", older: "较早内容", newer: "较新内容", loading: "正在准备这批内容…", done: "这批内容已整理，没有新增或修改。", batch: "分批整理", finish: "连接已保存；可继续下一批，或另按今日反思。", stale: "分析期间内容有变化，结果未应用，请重新整理。" },
  en: { scope: "Recent working set · search or browse older content", older: "Older", newer: "Newer", loading: "Preparing this batch…", done: "This batch is up to date. No new or changed content.", batch: "Analyzing batch", finish: "Links saved. Continue with another batch or generate a reflection separately.", stale: "Content changed during analysis. Results were not applied; please retry." },
  ja: { scope: "最近の作業範囲・古い内容は検索やページ移動で表示", older: "以前の内容", newer: "新しい内容", loading: "この範囲を準備中…", done: "この範囲は整理済みです。変更はありません。", batch: "分割して整理中", finish: "関連を保存しました。次の範囲や振り返りを個別に実行できます。", stale: "分析中に内容が変更されました。再実行してください。" },
  ko: { scope: "최근 작업 범위 · 오래된 내용은 검색 또는 페이지 이동", older: "이전 내용", newer: "최근 내용", loading: "이 범위를 준비하는 중…", done: "이 범위는 정리되었습니다. 변경된 내용이 없습니다.", batch: "나누어 분석 중", finish: "연결을 저장했습니다. 다음 범위 또는 회고를 별도로 실행하세요.", stale: "분석 중 내용이 변경되었습니다. 다시 시도하세요." },
};
export const brainPerformanceCopy = (language: AppLanguage) => copies[language] || copies.en;
