import type { AppLanguage } from "../types";

const copy = {
  "zh-TW": { startupError: "澄境暫時無法載入資料", retry: "重新載入", restoreConfirm: "這會以選取的備份取代目前資料。澄境會先保存一份本機安全副本，確定繼續嗎？", generation: "試送訊息", generationHint: "確認模型能實際回答；會產生一則短回覆，可能計費。", generating: "等待模型回覆…", generationOK: "模型已成功回答，可以開始對話。", saveFirst: "先儲存變更，再測試目前設定。", details: "錯誤詳情" },
  "zh-CN": { startupError: "澄境暂时无法加载数据", retry: "重新加载", restoreConfirm: "这会用选中的备份替换当前数据。澄境会先保存一份本地安全副本，确定继续吗？", generation: "试发消息", generationHint: "确认模型能够实际回答；会生成一条短回复，可能计费。", generating: "等待模型回复…", generationOK: "模型已成功回答，可以开始对话。", saveFirst: "先保存修改，再测试当前设置。", details: "错误详情" },
  en: { startupError: "ChengJing could not load your workspace", retry: "Reload", restoreConfirm: "Replace current data with this backup? ChengJing will first save a local safety copy.", generation: "Test a reply", generationHint: "Check that the model can answer. Generates a short reply and may incur a charge.", generating: "Waiting for the model…", generationOK: "The model replied successfully. You can start chatting.", saveFirst: "Save your changes before testing these settings.", details: "Error details" },
  ja: { startupError: "ワークスペースを読み込めませんでした", retry: "再読み込み", restoreConfirm: "現在のデータをこのバックアップで置き換えます。先にローカルの安全コピーを保存します。続けますか？", generation: "応答をテスト", generationHint: "モデルが回答できるか確認します。短い回答が生成され、料金が発生する場合があります。", generating: "モデルの応答を待っています…", generationOK: "モデルが正常に応答しました。会話を開始できます。", saveFirst: "変更を保存してからテストしてください。", details: "エラーの詳細" },
  ko: { startupError: "워크스페이스를 불러오지 못했습니다", retry: "다시 불러오기", restoreConfirm: "현재 데이터를 이 백업으로 교체할까요? 먼저 로컬 안전 사본을 저장합니다.", generation: "응답 테스트", generationHint: "모델이 답변할 수 있는지 확인합니다. 짧은 응답을 생성하며 비용이 발생할 수 있습니다.", generating: "모델 응답을 기다리는 중…", generationOK: "모델이 정상적으로 응답했습니다. 대화를 시작할 수 있습니다.", saveFirst: "변경 사항을 저장한 뒤 테스트하세요.", details: "오류 상세 정보" },
};
export function getHealthCopy(language: AppLanguage) { return copy[language] || copy.en; }
