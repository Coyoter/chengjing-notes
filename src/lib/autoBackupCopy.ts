import type { AppLanguage } from "../types";

export interface AutoBackupCopy {
  eyebrow: string;
  title: string;
  description: string;
  folderLabel: string;
  noFolder: string;
  chooseFolder: string;
  changeFolder: string;
  enableTitle: string;
  enabledHint: string;
  disabledHint: string;
  intervalLabel: string;
  daily: string;
  everyThreeDays: string;
  weekly: string;
  retention: string;
  cloudTitle: string;
  cloudHint: string;
  runNow: string;
  running: string;
  lastSuccess: string;
  never: string;
  ready: string;
  folderRequired: string;
  desktopRequired: string;
  storageTitle: string;
  notesStorage: string;
  attachmentsStorage: string;
  modelStorage: string;
  storageHint: string;
}

const copy: Record<AppLanguage, AutoBackupCopy> = {
  "zh-TW": {
    eyebrow: "安靜守護",
    title: "自動備份",
    description: "澄境只在應用開啟、你暫停操作而進入空閒時依排程建立完整備份；不會在背景常駐喚醒電腦。錯過時間時，會在下次開啟後安靜補上。",
    folderLabel: "備份資料夾",
    noFolder: "尚未選擇資料夾",
    chooseFolder: "選擇資料夾",
    changeFolder: "更換資料夾",
    enableTitle: "定時自動備份",
    enabledHint: "已啟用；只在空閒時執行",
    disabledHint: "停用後仍可手動完整備份",
    intervalLabel: "備份頻率",
    daily: "每天",
    everyThreeDays: "每 3 天",
    weekly: "每週",
    retention: "自動保留最近 10 份；較舊的澄境自動備份才會被清理，資料夾內其他檔案不受影響。",
    cloudTitle: "同步資料夾＝多一份雲端備份",
    cloudHint: "若選擇 Google Drive、Dropbox、OneDrive 或 iCloud Drive 的同步資料夾，澄境完成本機備份後，該雲端服務會自行同步。澄境不會登入或上傳你的雲端帳號。",
    runNow: "立即備份",
    running: "正在安靜備份…",
    lastSuccess: "上次完成",
    never: "尚未完成過自動備份",
    ready: "完整備份已安全寫入。",
    folderRequired: "請先選擇自動備份資料夾。",
    desktopRequired: "請使用澄境桌面版設定自動備份。",
    storageTitle: "本機空間分佈",
    notesStorage: "筆記與結構",
    attachmentsStorage: "附件檔案",
    modelStorage: "本機 AI 模型",
    storageHint: "三類資料彼此分開；附件與模型不會混入筆記資料庫。",
  },
  "zh-CN": {
    eyebrow: "安静守护", title: "自动备份", description: "澄境只会在应用已打开、你暂停操作时按计划创建完整备份；不会在后台常驻唤醒电脑。错过时间时，会在下次打开后安静补上。", folderLabel: "备份文件夹", noFolder: "尚未选择文件夹", chooseFolder: "选择文件夹", changeFolder: "更换文件夹", enableTitle: "定时自动备份", enabledHint: "已启用；只在空闲时执行", disabledHint: "停用后仍可手动完整备份", intervalLabel: "备份频率", daily: "每天", everyThreeDays: "每 3 天", weekly: "每周", retention: "自动保留最近 10 份；只有较旧的澄境自动备份会被清理，文件夹内的其他文件不受影响。", cloudTitle: "同步文件夹＝多一份云端备份", cloudHint: "如果选择 Google Drive、Dropbox、OneDrive 或 iCloud Drive 的同步文件夹，澄境完成本地备份后，该云端服务会自行同步。澄境不会登录或上传你的云端账号。", runNow: "立即备份", running: "正在安静备份…", lastSuccess: "上次完成", never: "尚未完成过自动备份", ready: "完整备份已安全写入。", folderRequired: "请先选择自动备份文件夹。", desktopRequired: "请使用澄境桌面版设置自动备份。", storageTitle: "本地空间分布", notesStorage: "笔记与结构", attachmentsStorage: "附件文件", modelStorage: "本地 AI 模型", storageHint: "三类数据彼此分开；附件和模型不会混入笔记数据库。",
  },
  en: {
    eyebrow: "Quiet protection", title: "Automatic backup", description: "While ChengJing is open, it creates a complete backup only after you pause. It does not keep waking your computer in the background. If a backup is missed, it quietly catches up the next time you open the app.", folderLabel: "Backup folder", noFolder: "No folder selected", chooseFolder: "Choose folder", changeFolder: "Change folder", enableTitle: "Scheduled automatic backup", enabledHint: "On · runs only while idle", disabledHint: "Manual complete backups remain available", intervalLabel: "Backup frequency", daily: "Daily", everyThreeDays: "Every 3 days", weekly: "Weekly", retention: "Keeps the 10 most recent copies. Only older ChengJing automatic backups are removed; other files in the folder are left alone.", cloudTitle: "A synced folder adds a cloud copy", cloudHint: "Choose a synced Google Drive, Dropbox, OneDrive, or iCloud Drive folder and its service will sync each local backup. ChengJing never signs in to or uploads to your cloud account.", runNow: "Back up now", running: "Backing up quietly…", lastSuccess: "Last completed", never: "No automatic backup has completed yet", ready: "The complete backup was written safely.", folderRequired: "Choose an automatic backup folder first.", desktopRequired: "Use the ChengJing desktop app to configure automatic backup.", storageTitle: "Local storage", notesStorage: "Notes and structure", attachmentsStorage: "Attachments", modelStorage: "Local AI model", storageHint: "Each category is stored separately; attachments and models no longer inflate the notes database.",
  },
  ja: {
    eyebrow: "静かな保護", title: "自動バックアップ", description: "ChengJingを開いている間、操作が止まったときだけ予定に沿って完全バックアップを作成します。バックグラウンドでコンピューターを起こし続けません。予定を逃した場合は、次回起動後に静かに補います。", folderLabel: "バックアップ先", noFolder: "フォルダが未選択です", chooseFolder: "フォルダを選択", changeFolder: "フォルダを変更", enableTitle: "定期自動バックアップ", enabledHint: "有効・アイドル時だけ実行", disabledHint: "無効でも手動の完全バックアップは利用できます", intervalLabel: "バックアップ頻度", daily: "毎日", everyThreeDays: "3日ごと", weekly: "毎週", retention: "最新10件を自動で保持します。古いChengJing自動バックアップだけを削除し、フォルダ内のほかのファイルには触れません。", cloudTitle: "同期フォルダならクラウドにも1部", cloudHint: "Google Drive、Dropbox、OneDrive、iCloud Driveの同期フォルダを選ぶと、ローカルバックアップ後に各サービスが同期します。ChengJingがクラウドアカウントへログインしたり直接アップロードしたりすることはありません。", runNow: "今すぐバックアップ", running: "静かにバックアップ中…", lastSuccess: "前回の完了", never: "自動バックアップはまだ完了していません", ready: "完全バックアップを安全に保存しました。", folderRequired: "先に自動バックアップ先を選択してください。", desktopRequired: "ChengJingデスクトップ版で自動バックアップを設定してください。", storageTitle: "ローカル容量", notesStorage: "ノートと構造", attachmentsStorage: "添付ファイル", modelStorage: "ローカルAIモデル", storageHint: "3種類は分離して保存され、添付とモデルがノートDBを膨らませません。",
  },
  ko: {
    eyebrow: "조용한 보호", title: "자동 백업", description: "ChengJing이 열려 있고 사용자가 잠시 멈췄을 때만 일정에 따라 전체 백업을 만듭니다. 백그라운드에서 컴퓨터를 계속 깨우지 않습니다. 일정을 놓치면 다음 실행 후 조용히 보완합니다.", folderLabel: "백업 폴더", noFolder: "폴더를 선택하지 않음", chooseFolder: "폴더 선택", changeFolder: "폴더 변경", enableTitle: "정기 자동 백업", enabledHint: "켜짐 · 유휴 상태에서만 실행", disabledHint: "꺼도 수동 전체 백업은 사용할 수 있음", intervalLabel: "백업 주기", daily: "매일", everyThreeDays: "3일마다", weekly: "매주", retention: "최근 10개를 자동으로 보관합니다. 오래된 ChengJing 자동 백업만 정리하며 폴더의 다른 파일은 건드리지 않습니다.", cloudTitle: "동기화 폴더라면 클라우드 사본도 생성", cloudHint: "Google Drive, Dropbox, OneDrive 또는 iCloud Drive 동기화 폴더를 선택하면 로컬 백업 후 해당 서비스가 동기화합니다. ChengJing은 클라우드 계정에 로그인하거나 직접 업로드하지 않습니다.", runNow: "지금 백업", running: "조용히 백업하는 중…", lastSuccess: "마지막 완료", never: "완료된 자동 백업이 아직 없습니다", ready: "전체 백업을 안전하게 저장했습니다.", folderRequired: "먼저 자동 백업 폴더를 선택하세요.", desktopRequired: "ChengJing 데스크톱 앱에서 자동 백업을 설정하세요.", storageTitle: "로컬 저장 공간", notesStorage: "노트와 구조", attachmentsStorage: "첨부 파일", modelStorage: "로컬 AI 모델", storageHint: "세 종류를 분리해 저장하며 첨부와 모델이 노트 DB를 키우지 않습니다.",
  },
};

export function getAutoBackupCopy(language: AppLanguage) {
  return copy[language] || copy.en;
}
