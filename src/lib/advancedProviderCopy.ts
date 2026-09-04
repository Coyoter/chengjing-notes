import type { AppLanguage } from "../types";

const copy = {
  "zh-TW": {
    title: "自訂 AI Provider",
    summary: "連接 Ollama 或自己的 OpenAI 相容 Gateway",
    aiDescription: "OpenRouter 適合快速使用雲端模型；Gemma 4 在本機執行；進階使用者也可以連接自己的 Gateway 或 Ollama。",
    advanced: "進階設定",
    configured: (count: number) => count ? `已設定 ${count} 個連線` : "尚未設定",
    description: "給熟悉模型服務的進階使用者。澄境只會把你主動送出的 AI 內容傳到這個位址。",
    localOnly: "遠端位址必須使用 HTTPS；HTTP 只允許這台電腦的 localhost。API Key 會加密留在本機，不會放進備份。",
    ollama: "Ollama（本機）", gateway: "OpenAI 相容 Gateway", connectionName: "連線名稱", baseUrl: "API 位址", model: "模型 ID", apiKey: "API Key（選填）",
    keySaved: "已保存金鑰；不更換時，這格保持空白即可", keyOptional: "Ollama 通常不需要金鑰", save: "儲存連線", saving: "正在儲存…", test: "測試連線", testing: "正在測試…", models: "取得模型", select: "使用", active: "使用中", remove: "移除", newConnection: "新增連線", clearKey: "移除金鑰",
    saved: "連線已安全儲存。", connected: (count: number) => `連線正常，找到 ${count} 個模型。`, removed: "連線已移除。", chooseModel: "請先輸入模型 ID。", desktop: "請在澄境桌面版設定。",
  },
  "zh-CN": {
    title: "自定义 AI Provider", summary: "连接 Ollama 或自己的 OpenAI 兼容 Gateway", aiDescription: "OpenRouter 适合快速使用云端模型；Gemma 4 在本机运行；高级用户也可以连接自己的 Gateway 或 Ollama。", advanced: "高级设置", configured: (count: number) => count ? `已设置 ${count} 个连接` : "尚未设置", description: "面向熟悉模型服务的高级用户。澄境只会把你主动发送的 AI 内容传到这个地址。", localOnly: "远程地址必须使用 HTTPS；HTTP 只允许这台电脑的 localhost。API Key 会加密保存在本机，不会写入备份。", ollama: "Ollama（本机）", gateway: "OpenAI 兼容 Gateway", connectionName: "连接名称", baseUrl: "API 地址", model: "模型 ID", apiKey: "API Key（可选）", keySaved: "已保存密钥；不更换时，这一栏保持空白即可", keyOptional: "Ollama 通常不需要密钥", save: "保存连接", saving: "正在保存…", test: "测试连接", testing: "正在测试…", models: "获取模型", select: "使用", active: "使用中", remove: "移除", newConnection: "新增连接", clearKey: "移除密钥", saved: "连接已安全保存。", connected: (count: number) => `连接正常，找到 ${count} 个模型。`, removed: "连接已移除。", chooseModel: "请先输入模型 ID。", desktop: "请在澄境桌面版设置。",
  },
  en: {
    title: "Custom AI provider", summary: "Connect Ollama or your own OpenAI-compatible gateway", aiDescription: "Use OpenRouter for convenient cloud models, Gemma 4 on-device, or connect your own gateway or Ollama as an advanced option.", advanced: "Advanced", configured: (count: number) => count ? `${count} connection${count === 1 ? "" : "s"} configured` : "Not configured", description: "For advanced users who run model services. ChengJing sends only the AI content you explicitly submit to this address.", localOnly: "Remote URLs must use HTTPS; HTTP is allowed only for localhost on this computer. API keys are encrypted locally and excluded from backups.", ollama: "Ollama (local)", gateway: "OpenAI-compatible gateway", connectionName: "Connection name", baseUrl: "API URL", model: "Model ID", apiKey: "API key (optional)", keySaved: "Key saved; leave this field empty unless replacing it", keyOptional: "Ollama usually needs no key", save: "Save connection", saving: "Saving…", test: "Test connection", testing: "Testing…", models: "Fetch models", select: "Use", active: "Active", remove: "Remove", newConnection: "New connection", clearKey: "Remove key", saved: "Connection saved securely.", connected: (count: number) => `Connected. Found ${count} model${count === 1 ? "" : "s"}.`, removed: "Connection removed.", chooseModel: "Enter a model ID first.", desktop: "Configure this in the ChengJing desktop app.",
  },
  ja: {
    title: "カスタムAI Provider", summary: "OllamaまたはOpenAI互換Gatewayに接続", aiDescription: "OpenRouterでクラウドモデルを手軽に使い、Gemma 4をローカルで実行し、上級者は独自GatewayやOllamaにも接続できます。", advanced: "詳細設定", configured: (count: number) => count ? `${count}件の接続を設定済み` : "未設定", description: "モデルサービスに詳しい方向けです。明示的に送信したAIコンテンツだけをこのURLへ送ります。", localOnly: "リモートURLはHTTPS必須です。HTTPはこのPCのlocalhostだけ許可されます。API Keyはローカルで暗号化され、バックアップには含まれません。", ollama: "Ollama（ローカル）", gateway: "OpenAI互換Gateway", connectionName: "接続名", baseUrl: "API URL", model: "モデルID", apiKey: "API Key（任意）", keySaved: "キー保存済み。変更しない場合は空欄のままで構いません", keyOptional: "Ollamaは通常キー不要です", save: "接続を保存", saving: "保存中…", test: "接続テスト", testing: "テスト中…", models: "モデル取得", select: "使用", active: "使用中", remove: "削除", newConnection: "新しい接続", clearKey: "キーを削除", saved: "接続を安全に保存しました。", connected: (count: number) => `接続しました。${count}件のモデルが見つかりました。`, removed: "接続を削除しました。", chooseModel: "先にモデルIDを入力してください。", desktop: "ChengJingデスクトップ版で設定してください。",
  },
  ko: {
    title: "사용자 지정 AI Provider", summary: "Ollama 또는 OpenAI 호환 Gateway 연결", aiDescription: "OpenRouter로 클라우드 모델을 간편하게 사용하고, Gemma 4를 로컬에서 실행하거나 고급 옵션으로 자체 Gateway와 Ollama를 연결할 수 있습니다.", advanced: "고급 설정", configured: (count: number) => count ? `${count}개 연결 설정됨` : "설정되지 않음", description: "모델 서비스에 익숙한 고급 사용자를 위한 기능입니다. 사용자가 직접 전송한 AI 내용만 이 주소로 보냅니다.", localOnly: "원격 주소는 HTTPS여야 합니다. HTTP는 이 컴퓨터의 localhost에서만 허용됩니다. API Key는 로컬에 암호화되며 백업에 포함되지 않습니다.", ollama: "Ollama(로컬)", gateway: "OpenAI 호환 Gateway", connectionName: "연결 이름", baseUrl: "API 주소", model: "모델 ID", apiKey: "API Key(선택)", keySaved: "키 저장됨. 변경하지 않으면 이 칸을 비워 두세요", keyOptional: "Ollama는 보통 키가 필요 없습니다", save: "연결 저장", saving: "저장 중…", test: "연결 테스트", testing: "테스트 중…", models: "모델 가져오기", select: "사용", active: "사용 중", remove: "삭제", newConnection: "새 연결", clearKey: "키 삭제", saved: "연결을 안전하게 저장했습니다.", connected: (count: number) => `연결되었습니다. ${count}개 모델을 찾았습니다.`, removed: "연결을 삭제했습니다.", chooseModel: "먼저 모델 ID를 입력하세요.", desktop: "ChengJing 데스크톱 앱에서 설정하세요.",
  },
} as const;

export function getAdvancedProviderCopy(language: AppLanguage) {
  return copy[language] || copy.en;
}

const apiModeCopy = {
  "zh-TW": { label: "API 模式", chat: "Chat Completions", chatHint: "相容範圍最廣", responses: "Responses API", responsesHint: "新式輸入與結構化輸出", privacy: "遠端 Responses 請求固定使用 store: false；Ollama 使用非狀態式模式。" },
  "zh-CN": { label: "API 模式", chat: "Chat Completions", chatHint: "兼容范围最广", responses: "Responses API", responsesHint: "新式输入与结构化输出", privacy: "远程 Responses 请求固定使用 store: false；Ollama 使用无状态模式。" },
  en: { label: "API mode", chat: "Chat Completions", chatHint: "Broadest compatibility", responses: "Responses API", responsesHint: "Modern input and structured output", privacy: "Remote Responses requests always use store: false; Ollama uses stateless mode." },
  ja: { label: "APIモード", chat: "Chat Completions", chatHint: "最も広い互換性", responses: "Responses API", responsesHint: "新しい入力と構造化出力", privacy: "リモートResponsesは常にstore: false、Ollamaはステートレスで使用します。" },
  ko: { label: "API 모드", chat: "Chat Completions", chatHint: "가장 넓은 호환성", responses: "Responses API", responsesHint: "최신 입력 및 구조화 출력", privacy: "원격 Responses 요청은 항상 store: false이며 Ollama는 비상태 모드로 사용합니다." },
} as const;

export function getProviderApiModeCopy(language: AppLanguage) { return apiModeCopy[language] || apiModeCopy.en; }
