import type { AppLanguage } from "../types";

const copies = {
  "zh-TW": { undo: "上一步", redo: "下一步", undoDone: "已回到上一步", redoDone: "已前往下一步", copy: "複製", paste: "貼上", copied: "已複製 {count} 個白板物件。", pasted: "已貼上 {count} 個白板物件。", clipboardEmpty: "剪貼簿裡沒有可貼到白板的內容。", cardCreated: "卡片已放到白板，直接輸入標題即可。", filesAdded: "已把 {count} 個檔案放到白板。", fileImportFailed: "檔案沒有成功加入白板，請再試一次。" },
  "zh-CN": { undo: "上一步", redo: "下一步", undoDone: "已回到上一步", redoDone: "已前往下一步", copy: "复制", paste: "粘贴", copied: "已复制 {count} 个白板对象。", pasted: "已粘贴 {count} 个白板对象。", clipboardEmpty: "剪贴板里没有可粘贴到白板的内容。", cardCreated: "卡片已放到白板，可直接输入标题。", filesAdded: "已将 {count} 个文件放到白板。", fileImportFailed: "文件未能加入白板，请重试。" },
  en: { undo: "Undo", redo: "Redo", undoDone: "Undid the last board change", redoDone: "Redid the board change", copy: "Copy", paste: "Paste", copied: "Copied {count} board objects.", pasted: "Pasted {count} board objects.", clipboardEmpty: "The clipboard has nothing that can be pasted onto a board.", cardCreated: "Card added to the board. Type its title in place.", filesAdded: "Added {count} files to the board.", fileImportFailed: "The files could not be added to the board." },
  ja: { undo: "元に戻す", redo: "やり直す", undoDone: "一つ前の状態に戻しました", redoDone: "次の状態へ進みました", copy: "コピー", paste: "ペースト", copied: "ボード要素を{count}件コピーしました。", pasted: "ボード要素を{count}件ペーストしました。", clipboardEmpty: "ボードにペーストできる内容がありません。", cardCreated: "カードをボードに追加しました。その場でタイトルを入力できます。", filesAdded: "ファイルを{count}件ボードに追加しました。", fileImportFailed: "ファイルをボードに追加できませんでした。" },
  ko: { undo: "실행 취소", redo: "다시 실행", undoDone: "이전 보드 상태로 돌아갔습니다", redoDone: "다음 보드 상태로 이동했습니다", copy: "복사", paste: "붙여넣기", copied: "보드 개체 {count}개를 복사했습니다.", pasted: "보드 개체 {count}개를 붙여넣었습니다.", clipboardEmpty: "보드에 붙여넣을 수 있는 내용이 없습니다.", cardCreated: "카드를 보드에 추가했습니다. 그 자리에서 제목을 입력하세요.", filesAdded: "파일 {count}개를 보드에 추가했습니다.", fileImportFailed: "파일을 보드에 추가하지 못했습니다." },
} as const;

export function getBoardPolishCopy(language: AppLanguage) {
  return copies[language] || copies["zh-TW"];
}
