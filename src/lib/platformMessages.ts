import type { AppLanguage } from "../types";
import { isWindows } from "./platform";

const windowsMessages: Record<AppLanguage, Record<string, string>> = {
  "zh-TW": {
    "settings.keySaved": "已保存在澄境・不使用 Windows 認證管理員",
    "settings.keyMissing": "尚未設定",
    "settings.keyBoundary": "金鑰以 AES-256-GCM 加密保存在這台 Windows 電腦的澄境資料目錄，不進入備份，也不會要求 Windows 認證管理員權限。若他人已能讀取你整個 Windows 帳號的檔案，本機加密仍無法提供和系統認證儲存區相同的防護。",
    "settings.keyFooter": "本機加密・持久保存・不使用 Windows 認證管理員",
    "local.capacityExceeded": "本機 Gemma 超過這台 Windows 電腦目前可安全處理的推論容量，澄境已停止執行。請縮小內容或改用 OpenRouter。",
  },
  "zh-CN": {
    "settings.keySaved": "已保存在澄境・不使用 Windows 凭据管理器",
    "settings.keyMissing": "尚未设置",
    "settings.keyBoundary": "密钥以 AES-256-GCM 加密保存在这台 Windows 电脑的澄境数据目录，不进入备份，也不会请求 Windows 凭据管理器权限。如果他人已能读取你整个 Windows 帐号的文件，本地加密仍无法提供与系统凭据存储区相同的防护。",
    "settings.keyFooter": "本地加密・持久保存・不使用 Windows 凭据管理器",
    "local.capacityExceeded": "本地 Gemma 超出这台 Windows 电脑当前可安全处理的推理容量，澄境已停止运行。请缩小内容或改用 OpenRouter。",
  },
  en: {
    "settings.keySaved": "Saved in ChengJing · Windows Credential Manager not used",
    "settings.keyMissing": "Not configured",
    "settings.keyBoundary": "The key is encrypted with AES-256-GCM in ChengJing's data folder on this Windows PC. It is excluded from backups and never requests Windows Credential Manager access. Local encryption cannot provide the same protection as the system credential store if someone can already read every file in your Windows account.",
    "settings.keyFooter": "Local encryption · persistent · no Windows Credential Manager",
    "local.capacityExceeded": "Local Gemma exceeded the inference capacity this Windows PC can safely handle. ChengJing stopped the run. Reduce the content or use OpenRouter.",
  },
  ja: {
    "settings.keySaved": "ChengJingに保存済み（Windows資格情報マネージャー不使用）",
    "settings.keyMissing": "未設定",
    "settings.keyBoundary": "キーはAES-256-GCMで暗号化され、このWindows PCのChengJingデータフォルダに保存されます。バックアップには含まれず、Windows資格情報マネージャーの権限も要求しません。Windowsアカウント内のすべてのファイルを読める相手には、システム資格情報ストアと同等の保護は提供できません。",
    "settings.keyFooter": "ローカル暗号化・永続保存・Windows資格情報マネージャー不使用",
    "local.capacityExceeded": "ローカルGemmaがこのWindows PCで安全に処理できる推論容量を超えたため停止しました。内容を減らすかOpenRouterを使用してください。",
  },
  ko: {
    "settings.keySaved": "ChengJing에 저장됨 · Windows 자격 증명 관리자 미사용",
    "settings.keyMissing": "설정되지 않음",
    "settings.keyBoundary": "키는 AES-256-GCM으로 암호화되어 이 Windows PC의 ChengJing 데이터 폴더에 저장됩니다. 백업에 포함되지 않고 Windows 자격 증명 관리자 권한도 요청하지 않습니다. 누군가 Windows 계정의 모든 파일을 읽을 수 있다면 시스템 자격 증명 저장소와 같은 보호 수준은 제공할 수 없습니다.",
    "settings.keyFooter": "로컬 암호화 · 영구 저장 · Windows 자격 증명 관리자 미사용",
    "local.capacityExceeded": "로컬 Gemma가 이 Windows PC에서 안전하게 처리할 수 있는 추론 용량을 초과해 실행을 중단했습니다. 내용을 줄이거나 OpenRouter를 사용하세요.",
  },
};

export function platformMessageOverride(language: AppLanguage, key: string) {
  return isWindows() ? windowsMessages[language]?.[key] : undefined;
}
