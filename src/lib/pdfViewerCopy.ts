import type { AppLanguage } from "../types";

interface PdfViewerCopy {
  document: string;
  pageCount: (count: number) => string;
  loadingPreview: string;
  previewUnavailable: string;
  previewUnavailableHint: string;
  openReader: string;
  openReaderFor: (name: string) => string;
  readerTitle: string;
  closeReader: string;
  previousPage: string;
  nextPage: string;
  page: string;
  pageStatus: (page: number, total: number) => string;
  zoomOut: string;
  zoomIn: string;
  fitWidth: string;
  saveCopy: string;
  saveTitle: string;
  saveFailed: string;
  remove: string;
  confirmRemove: (name: string) => string;
  removeFailed: string;
  rendering: string;
}

const copies: Record<AppLanguage, PdfViewerCopy> = {
  "zh-TW": {
    document: "PDF 文件",
    pageCount: (count) => `${count} 頁`,
    loadingPreview: "正在準備文件預覽…",
    previewUnavailable: "這份 PDF 暫時無法產生預覽",
    previewUnavailableHint: "下方已擷取的文字仍可閱讀、編輯與搜尋。",
    openReader: "開啟完整閱讀",
    openReaderFor: (name) => `開啟「${name}」完整閱讀`,
    readerTitle: "PDF 閱讀器",
    closeReader: "返回卡片",
    previousPage: "上一頁",
    nextPage: "下一頁",
    page: "頁碼",
    pageStatus: (page, total) => `${page} / ${total}`,
    zoomOut: "縮小",
    zoomIn: "放大",
    fitWidth: "符合寬度",
    saveCopy: "儲存副本",
    saveTitle: "儲存 PDF 副本",
    saveFailed: "暫時無法儲存這份 PDF，請稍後再試。",
    remove: "移除附件",
    confirmRemove: (name) => `要從這張卡片移除「${name}」嗎？已擷取的文字內容會保留。`,
    removeFailed: "附件沒有完整移除，請重新開啟卡片確認；已擷取的文字仍會保留。",
    rendering: "正在顯示這一頁…",
  },
  "zh-CN": {
    document: "PDF 文件",
    pageCount: (count) => `${count} 页`,
    loadingPreview: "正在准备文件预览…",
    previewUnavailable: "这份 PDF 暂时无法生成预览",
    previewUnavailableHint: "下方已提取的文字仍可阅读、编辑与搜索。",
    openReader: "打开完整阅读",
    openReaderFor: (name) => `打开“${name}”完整阅读`,
    readerTitle: "PDF 阅读器",
    closeReader: "返回卡片",
    previousPage: "上一页",
    nextPage: "下一页",
    page: "页码",
    pageStatus: (page, total) => `${page} / ${total}`,
    zoomOut: "缩小",
    zoomIn: "放大",
    fitWidth: "适合宽度",
    saveCopy: "保存副本",
    saveTitle: "保存 PDF 副本",
    saveFailed: "暂时无法保存这份 PDF，请稍后再试。",
    remove: "移除附件",
    confirmRemove: (name) => `要从这张卡片移除“${name}”吗？已提取的文字内容会保留。`,
    removeFailed: "附件未能完整移除，请重新打开卡片确认；已提取的文字仍会保留。",
    rendering: "正在显示这一页…",
  },
  en: {
    document: "PDF document",
    pageCount: (count) => `${count} pages`,
    loadingPreview: "Preparing document preview…",
    previewUnavailable: "This PDF cannot be previewed right now",
    previewUnavailableHint: "The extracted text below is still available to read, edit, and search.",
    openReader: "Open full reader",
    openReaderFor: (name) => `Open ${name} in the full reader`,
    readerTitle: "PDF reader",
    closeReader: "Back to card",
    previousPage: "Previous page",
    nextPage: "Next page",
    page: "Page",
    pageStatus: (page, total) => `${page} / ${total}`,
    zoomOut: "Zoom out",
    zoomIn: "Zoom in",
    fitWidth: "Fit width",
    saveCopy: "Save a copy",
    saveTitle: "Save PDF copy",
    saveFailed: "This PDF could not be saved. Please try again.",
    remove: "Remove attachment",
    confirmRemove: (name) => `Remove “${name}” from this card? The extracted text will be kept.`,
    removeFailed: "The attachment was not fully removed. Reopen the card to check it; the extracted text will remain.",
    rendering: "Rendering this page…",
  },
  ja: {
    document: "PDF書類",
    pageCount: (count) => `${count}ページ`,
    loadingPreview: "書類のプレビューを準備中…",
    previewUnavailable: "このPDFは現在プレビューできません",
    previewUnavailableHint: "抽出済みのテキストは引き続き閲覧、編集、検索できます。",
    openReader: "全画面で読む",
    openReaderFor: (name) => `「${name}」をPDFリーダーで開く`,
    readerTitle: "PDFリーダー",
    closeReader: "カードへ戻る",
    previousPage: "前のページ",
    nextPage: "次のページ",
    page: "ページ",
    pageStatus: (page, total) => `${page} / ${total}`,
    zoomOut: "縮小",
    zoomIn: "拡大",
    fitWidth: "幅に合わせる",
    saveCopy: "コピーを保存",
    saveTitle: "PDFのコピーを保存",
    saveFailed: "PDFを保存できませんでした。しばらくしてからもう一度お試しください。",
    remove: "添付を削除",
    confirmRemove: (name) => `このカードから「${name}」を削除しますか？抽出済みテキストは残ります。`,
    removeFailed: "添付を完全に削除できませんでした。カードを開き直して確認してください。抽出済みテキストは残ります。",
    rendering: "ページを表示中…",
  },
  ko: {
    document: "PDF 문서",
    pageCount: (count) => `${count}페이지`,
    loadingPreview: "문서 미리보기를 준비하는 중…",
    previewUnavailable: "이 PDF는 현재 미리볼 수 없습니다",
    previewUnavailableHint: "아래의 추출된 텍스트는 계속 읽고 편집하고 검색할 수 있습니다.",
    openReader: "전체 리더 열기",
    openReaderFor: (name) => `‘${name}’ 전체 리더 열기`,
    readerTitle: "PDF 리더",
    closeReader: "카드로 돌아가기",
    previousPage: "이전 페이지",
    nextPage: "다음 페이지",
    page: "페이지",
    pageStatus: (page, total) => `${page} / ${total}`,
    zoomOut: "축소",
    zoomIn: "확대",
    fitWidth: "너비에 맞춤",
    saveCopy: "사본 저장",
    saveTitle: "PDF 사본 저장",
    saveFailed: "PDF를 저장할 수 없습니다. 잠시 후 다시 시도하세요.",
    remove: "첨부 파일 제거",
    confirmRemove: (name) => `이 카드에서 ‘${name}’을 제거할까요? 추출된 텍스트는 유지됩니다.`,
    removeFailed: "첨부 파일이 완전히 제거되지 않았습니다. 카드를 다시 열어 확인하세요. 추출된 텍스트는 유지됩니다.",
    rendering: "페이지를 표시하는 중…",
  },
};

export function getPdfViewerCopy(language: AppLanguage) {
  return copies[language];
}
