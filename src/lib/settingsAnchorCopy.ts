import type { AppLanguage } from "../types";

const copy = {
  "zh-TW": { label: "快速前往", language: "語言", ai: "AI", integrations: "外部整合", updates: "更新", quickCapture: "快速記錄", appearance: "外觀", backup: "備份", support: "打賞" },
  "zh-CN": { label: "快速前往", language: "语言", ai: "AI", integrations: "外部集成", updates: "更新", quickCapture: "快速记录", appearance: "外观", backup: "备份", support: "赞赏" },
  en: { label: "Jump to", language: "Language", ai: "AI", integrations: "Integrations", updates: "Updates", quickCapture: "Quick capture", appearance: "Appearance", backup: "Backup", support: "Support" },
  ja: { label: "移動", language: "言語", ai: "AI", integrations: "外部連携", updates: "更新", quickCapture: "クイック記録", appearance: "外観", backup: "バックアップ", support: "支援" },
  ko: { label: "바로가기", language: "언어", ai: "AI", integrations: "외부 연동", updates: "업데이트", quickCapture: "빠른 기록", appearance: "화면", backup: "백업", support: "후원" },
} as const;

export function getSettingsAnchorCopy(language: AppLanguage) { return copy[language] || copy.en; }

const disclosureCopy = {
  "zh-TW": { active: "目前使用", inactive: "未選用", hint: "選擇 OpenRouter 時會自動展開；其他模式下保持精簡。", common: "所有 AI 共用", commonHint: "不論選擇哪一個引擎，這兩項設定都會套用。" },
  "zh-CN": { active: "当前使用", inactive: "未选用", hint: "选择 OpenRouter 时自动展开；其他模式下保持简洁。", common: "所有 AI 共用", commonHint: "无论选择哪个引擎，这两项设置都会应用。" },
  en: { active: "Active", inactive: "Not selected", hint: "Opens automatically with OpenRouter and stays compact for other modes.", common: "Shared by every AI mode", commonHint: "These two settings apply whichever engine you choose." },
  ja: { active: "使用中", inactive: "未選択", hint: "OpenRouterを選ぶと自動で開き、他のモードではコンパクトに保ちます。", common: "すべてのAIで共通", commonHint: "どのエンジンを選んでも、この2項目が適用されます。" },
  ko: { active: "사용 중", inactive: "선택 안 됨", hint: "OpenRouter를 선택하면 자동으로 열리고 다른 모드에서는 간결하게 유지됩니다.", common: "모든 AI 모드 공통", commonHint: "어떤 엔진을 선택해도 이 두 설정이 적용됩니다." },
} as const;

export function getSettingsDisclosureCopy(language: AppLanguage) { return disclosureCopy[language] || disclosureCopy.en; }
