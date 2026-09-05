import type { AppLanguage } from "../types";

export interface AutoBackupCopy {
  eyebrow: string;
  title: string;
  description: string;
  cloudTitle: string;
  cloudDescription: string;
  cloudPrivacy: string;
  privacyPolicy?: string;
  connectGoogle: string;
  connecting: string;
  connected: string;
  servicePending: string;
  disconnect: string;
  automaticCloud: string;
  cloudEnabled: string;
  cloudDisabled: string;
  intervalLabel: string;
  every15Minutes: string;
  every30Minutes: string;
  recommended: string;
  hourly: string;
  every3Hours: string;
  runCloudNow: string;
  cloudRunning: string;
  cloudReady: string;
  latestCloud: string;
  noCloudBackup: string;
  restoreLatest: string;
  restoreLatestConfirm: string;
  restoreDone: string;
  cloudExistingTitle: string;
  cloudExistingHint: string;
  useCloudCopy: string;
  replaceCloud: string;
  replaceCloudConfirm: string;
  emergencyTitle: string;
  emergencySummary: string;
  emergencyWarning: string;
  previousLabel: string;
  noPrevious: string;
  restoreYesterday: string;
  restoreYesterdayConfirm: string;
  safetyCopy: string;
  localTitle: string;
  localDescription: string;
  folderLabel: string;
  noFolder: string;
  chooseFolder: string;
  changeFolder: string;
  automaticLocal: string;
  localEnabled: string;
  localDisabled: string;
  daily: string;
  everyThreeDays: string;
  weekly: string;
  retention: string;
  runLocalNow: string;
  localRunning: string;
  localReady: string;
  lastSuccess: string;
  never: string;
  otherLocalTools: string;
  otherLocalToolsHint: string;
  folderRequired: string;
  desktopRequired: string;
  storageTitle: string;
  notesStorage: string;
  attachmentsStorage: string;
  modelStorage: string;
  storageHint: string;
}

const zhTW: AutoBackupCopy = {
  eyebrow: "資料守護",
  title: "備份與復原",
  description: "雲端與本地可以同時開啟，各自保護同一份澄境資料。",
  cloudTitle: "Google 雲端",
  cloudDescription: "登入 Google 帳號後自動備份；換電腦或換作業系統時，可以把資料完整帶回來。",
  cloudPrivacy: "澄境只能使用自己的隱藏備份空間，無法讀取你 Google Drive 裡的其他檔案。本機 AI 模型不會上傳。",
  privacyPolicy: "查看隱私權政策",
  connectGoogle: "連結 Google 帳號",
  connecting: "正在開啟 Google 登入…",
  connected: "已連結",
  servicePending: "Google 雲端服務尚未完成設定，暫時不能連結。",
  disconnect: "中斷連結",
  automaticCloud: "自動雲端備份",
  cloudEnabled: "已開啟；只在澄境開啟且閒置時執行",
  cloudDisabled: "已暫停；雲端上的既有備份不會被刪除",
  intervalLabel: "雲端備份頻率",
  every15Minutes: "每 15 分鐘",
  every30Minutes: "每 30 分鐘",
  recommended: "建議",
  hourly: "每小時",
  every3Hours: "每 3 小時",
  runCloudNow: "立即備份到雲端",
  cloudRunning: "正在安全備份…",
  cloudReady: "Google 雲端備份已完成。",
  latestCloud: "目前雲端備份",
  noCloudBackup: "尚未建立雲端備份",
  restoreLatest: "復原最新雲端備份",
  restoreLatestConfirm: "這會用最新雲端備份取代這台裝置目前的澄境資料。執行前會先保留一份本機安全副本。確定要繼續嗎？",
  restoreDone: "復原完成。覆蓋前的本機安全副本也已保留；澄境將重新載入。",
  cloudExistingTitle: "這個 Google 帳號已有澄境備份",
  cloudExistingHint: "為避免新裝置不小心蓋掉原資料，自動備份目前暫停。請選擇使用雲端內容，或明確以這台裝置取代雲端。",
  useCloudCopy: "使用雲端內容",
  replaceCloud: "以這台裝置取代",
  replaceCloudConfirm: "這會以這台裝置目前的資料取代最新雲端備份。原本的雲端內容可能無法再取回。確定要繼續嗎？",
  emergencyTitle: "緊急救援",
  emergencySummary: "復原前一天的資料",
  emergencyWarning: "這是不小心刪掉重要資料，而且錯誤內容已同步到雲端時的救援方案。它會取代目前資料，日常請勿使用。",
  previousLabel: "前一天救援點",
  noPrevious: "目前沒有可用的前一天備份",
  restoreYesterday: "緊急復原前一天",
  restoreYesterdayConfirm: "最後確認：這不是一般復原。澄境會先建立本機安全副本，再用前一天的內容取代目前資料，並同步成新的目前版本。確定要執行緊急救援嗎？",
  safetyCopy: "覆蓋前會先在這台電腦保留一份安全副本。",
  localTitle: "本地",
  localDescription: "把完整備份放在你指定的資料夾；不必登入，也可以和雲端備份同時進行。",
  folderLabel: "備份資料夾",
  noFolder: "尚未選擇資料夾",
  chooseFolder: "選擇資料夾",
  changeFolder: "更換資料夾",
  automaticLocal: "自動本地備份",
  localEnabled: "已開啟；只在閒置時執行",
  localDisabled: "已關閉；仍可隨時手動備份",
  daily: "每天",
  everyThreeDays: "每 3 天",
  weekly: "每週",
  retention: "自動保留最近 10 份；只清理澄境建立的舊備份，不碰資料夾內其他檔案。",
  runLocalNow: "立即備份到本地",
  localRunning: "正在建立本地備份…",
  localReady: "本地完整備份已安全寫入。",
  lastSuccess: "上次完成",
  never: "尚未完成過備份",
  otherLocalTools: "其他本地工具",
  otherLocalToolsHint: "手動匯出、可閱讀的 Markdown，以及從檔案復原",
  folderRequired: "請先選擇本地備份資料夾。",
  desktopRequired: "請使用澄境桌面版設定備份。",
  storageTitle: "本機空間分佈",
  notesStorage: "筆記與結構",
  attachmentsStorage: "附件檔案",
  modelStorage: "本機 AI 模型",
  storageHint: "本機 AI 模型不會進入任何備份。",
};

const en: AutoBackupCopy = {
  eyebrow: "Data protection", title: "Backup and restore", description: "Cloud and local backup can run together to protect the same ChengJing data.",
  cloudTitle: "Google Cloud", cloudDescription: "Connect a Google Account for automatic backup and restore your data after moving to another computer or operating system.", cloudPrivacy: "ChengJing can only use its own hidden backup space and cannot read other files in your Google Drive. The local AI model is never uploaded.", connectGoogle: "Connect Google Account", connecting: "Opening Google sign-in…", connected: "Connected", servicePending: "Google cloud service setup is not complete yet.", disconnect: "Disconnect", automaticCloud: "Automatic cloud backup", cloudEnabled: "On · runs only while ChengJing is open and idle", cloudDisabled: "Paused · existing cloud backups are not deleted", intervalLabel: "Cloud backup frequency", every15Minutes: "Every 15 minutes", every30Minutes: "Every 30 minutes", recommended: "Recommended", hourly: "Hourly", every3Hours: "Every 3 hours", runCloudNow: "Back up to cloud now", cloudRunning: "Backing up safely…", cloudReady: "Google cloud backup completed.", latestCloud: "Current cloud backup", noCloudBackup: "No cloud backup yet", restoreLatest: "Restore latest cloud backup", restoreLatestConfirm: "This replaces the ChengJing data on this device with the latest cloud backup. A local safety copy will be created first. Continue?", restoreDone: "Restore completed. A local safety copy was kept and ChengJing will reload.", cloudExistingTitle: "This Google Account already has a ChengJing backup", cloudExistingHint: "Automatic backup is paused so this device cannot overwrite it by accident. Restore the cloud copy or explicitly replace it with this device.", useCloudCopy: "Use cloud copy", replaceCloud: "Replace with this device", replaceCloudConfirm: "This replaces the latest cloud backup with the data currently on this device. The previous cloud content might not be recoverable. Continue?", emergencyTitle: "Emergency rescue", emergencySummary: "Restore the previous day's data", emergencyWarning: "Use this only when important data was deleted and the mistake was already synced to the cloud. It replaces current data; do not use it for everyday restore.", previousLabel: "Previous-day rescue point", noPrevious: "No previous-day backup is available", restoreYesterday: "Emergency restore previous day", restoreYesterdayConfirm: "Final confirmation: this is not a normal restore. ChengJing will first make a local safety copy, then replace current data with the previous day's content and sync it as current. Continue?", safetyCopy: "A safety copy is kept on this computer before anything is replaced.",
  localTitle: "Local", localDescription: "Keep complete backups in a folder you choose. No sign-in is needed, and it can run alongside cloud backup.", folderLabel: "Backup folder", noFolder: "No folder selected", chooseFolder: "Choose folder", changeFolder: "Change folder", automaticLocal: "Automatic local backup", localEnabled: "On · runs only while idle", localDisabled: "Off · manual backup remains available", daily: "Daily", everyThreeDays: "Every 3 days", weekly: "Weekly", retention: "Keeps the 10 most recent copies and only removes older backups created by ChengJing.", runLocalNow: "Back up locally now", localRunning: "Creating local backup…", localReady: "The complete local backup was written safely.", lastSuccess: "Last completed", never: "No backup has completed yet", otherLocalTools: "Other local tools", otherLocalToolsHint: "Manual export, readable Markdown, and restore from a file", folderRequired: "Choose a local backup folder first.", desktopRequired: "Use the ChengJing desktop app to configure backup.", storageTitle: "Local storage", notesStorage: "Notes and structure", attachmentsStorage: "Attachments", modelStorage: "Local AI model", storageHint: "The local AI model is excluded from every backup.",
};

const copy: Record<AppLanguage, AutoBackupCopy> = {
  "zh-TW": zhTW,
  "zh-CN": {
    ...zhTW,
    eyebrow: "数据保护", title: "备份与恢复", description: "云端与本地可以同时开启，各自保护同一份澄境数据。", cloudTitle: "Google 云端", cloudDescription: "登录 Google 帐号后自动备份；更换电脑或操作系统时，可以完整恢复数据。", cloudPrivacy: "澄境只能使用自己的隐藏备份空间，无法读取你 Google Drive 里的其他文件。本地 AI 模型不会上传。", connectGoogle: "连接 Google 帐号", connecting: "正在打开 Google 登录…", connected: "已连接", servicePending: "Google 云端服务尚未完成设置，暂时无法连接。", disconnect: "断开连接", automaticCloud: "自动云端备份", cloudEnabled: "已开启；只在澄境打开且空闲时执行", cloudDisabled: "已暂停；云端已有备份不会被删除", intervalLabel: "云端备份频率", every15Minutes: "每 15 分钟", every30Minutes: "每 30 分钟", recommended: "建议", hourly: "每小时", every3Hours: "每 3 小时", runCloudNow: "立即备份到云端", cloudRunning: "正在安全备份…", cloudReady: "Google 云端备份已完成。", latestCloud: "当前云端备份", noCloudBackup: "尚未创建云端备份", restoreLatest: "恢复最新云端备份", cloudExistingTitle: "这个 Google 帐号已有澄境备份", cloudExistingHint: "为避免新设备误覆盖原数据，自动备份已暂停。请选择使用云端内容，或明确由这台设备取代。", useCloudCopy: "使用云端内容", replaceCloud: "由这台设备取代", emergencyTitle: "紧急救援", emergencySummary: "恢复前一天的数据", emergencyWarning: "这是误删重要数据，而且错误内容已同步到云端时的救援方案。它会取代当前数据，日常请勿使用。", previousLabel: "前一天救援点", noPrevious: "目前没有可用的前一天备份", restoreYesterday: "紧急恢复前一天", safetyCopy: "覆盖前会先在这台电脑保留一份安全副本。", localTitle: "本地", localDescription: "把完整备份放在你指定的文件夹；无需登录，也可以和云端备份同时进行。", folderLabel: "备份文件夹", noFolder: "尚未选择文件夹", chooseFolder: "选择文件夹", changeFolder: "更换文件夹", automaticLocal: "自动本地备份", localEnabled: "已开启；只在空闲时执行", localDisabled: "已关闭；仍可随时手动备份", daily: "每天", everyThreeDays: "每 3 天", weekly: "每周", retention: "自动保留最近 10 份；只清理澄境创建的旧备份，不会动文件夹内其他文件。", runLocalNow: "立即备份到本地", localRunning: "正在创建本地备份…", localReady: "本地完整备份已安全写入。", lastSuccess: "上次完成", never: "尚未完成过备份", otherLocalTools: "其他本地工具", otherLocalToolsHint: "手动导出、可阅读的 Markdown，以及从文件恢复", folderRequired: "请先选择本地备份文件夹。", desktopRequired: "请使用澄境桌面版设置备份。", storageTitle: "本地空间分布", notesStorage: "笔记与结构", attachmentsStorage: "附件文件", modelStorage: "本地 AI 模型", storageHint: "本地 AI 模型不会进入任何备份。",
  },
  en,
  ja: { ...en, eyebrow: "データ保護", title: "バックアップと復元", description: "クラウドとローカルのバックアップを同時に利用できます。", cloudTitle: "Google クラウド", cloudDescription: "Google アカウントを接続して自動バックアップし、別のPCやOSでもデータを復元できます。", cloudPrivacy: "ChengJing専用の非表示領域だけを使用し、Google Drive内の他のファイルは読み取れません。ローカルAIモデルはアップロードされません。", connectGoogle: "Google アカウントを接続", connected: "接続済み", disconnect: "接続解除", automaticCloud: "クラウド自動バックアップ", runCloudNow: "今すぐクラウドへバックアップ", latestCloud: "現在のクラウドバックアップ", restoreLatest: "最新のクラウドバックアップを復元", emergencyTitle: "緊急救援", emergencySummary: "前日のデータを復元", emergencyWarning: "重要なデータを誤って削除し、その状態がすでにクラウドへ同期された場合だけ使用してください。現在のデータを置き換えるため、日常的には使用しないでください。", restoreYesterday: "前日を緊急復元", localTitle: "ローカル", localDescription: "指定したフォルダに完全なバックアップを保存します。クラウドと同時に利用できます。", automaticLocal: "ローカル自動バックアップ", runLocalNow: "今すぐローカルへバックアップ", otherLocalTools: "その他のローカルツール" },
  ko: { ...en, eyebrow: "데이터 보호", title: "백업 및 복원", description: "클라우드와 로컬 백업을 동시에 사용할 수 있습니다.", cloudTitle: "Google 클라우드", cloudDescription: "Google 계정을 연결해 자동으로 백업하고 다른 PC나 운영체제에서도 데이터를 복원할 수 있습니다.", cloudPrivacy: "ChengJing 전용 숨김 공간만 사용하며 Google Drive의 다른 파일은 읽을 수 없습니다. 로컬 AI 모델은 업로드되지 않습니다.", connectGoogle: "Google 계정 연결", connected: "연결됨", disconnect: "연결 해제", automaticCloud: "클라우드 자동 백업", runCloudNow: "지금 클라우드에 백업", latestCloud: "현재 클라우드 백업", restoreLatest: "최신 클라우드 백업 복원", emergencyTitle: "긴급 복구", emergencySummary: "전날 데이터 복원", emergencyWarning: "중요한 데이터를 실수로 삭제했고 그 상태가 이미 클라우드에 동기화된 경우에만 사용하세요. 현재 데이터를 교체하므로 평소에는 사용하지 마세요.", restoreYesterday: "전날 긴급 복원", localTitle: "로컬", localDescription: "선택한 폴더에 전체 백업을 저장하며 클라우드와 동시에 사용할 수 있습니다.", automaticLocal: "로컬 자동 백업", runLocalNow: "지금 로컬에 백업", otherLocalTools: "기타 로컬 도구" },
};

const completeCopyOverrides: Partial<Record<AppLanguage, Partial<AutoBackupCopy>>> = {
  "zh-CN": {
    privacyPolicy: "查看隐私政策",
    restoreLatestConfirm: "这会用最新云端备份替换这台设备当前的澄境数据。执行前会先保留一份本地安全副本。确定要继续吗？",
    restoreDone: "恢复完成。覆盖前的本地安全副本也已保留；澄境将重新加载。",
    replaceCloudConfirm: "这会以这台设备当前的数据替换最新云端备份。原有云端内容可能无法取回。确定要继续吗？",
    restoreYesterdayConfirm: "最后确认：这不是一般恢复。澄境会先创建本地安全副本，再用前一天的内容替换当前数据，并同步为新的当前版本。确定要执行紧急救援吗？",
  },
  ja: {
    privacyPolicy: "プライバシーポリシーを見る",
    connecting: "Google ログインを開いています…",
    servicePending: "Google クラウドサービスの設定がまだ完了していません。",
    cloudEnabled: "オン・ChengJingを開いていて操作が止まったときだけ実行",
    cloudDisabled: "一時停止・既存のクラウドバックアップは削除されません",
    intervalLabel: "クラウドのバックアップ間隔",
    every15Minutes: "15分ごと",
    every30Minutes: "30分ごと",
    recommended: "推奨",
    hourly: "1時間ごと",
    every3Hours: "3時間ごと",
    cloudRunning: "安全にバックアップしています…",
    cloudReady: "Google クラウドへのバックアップが完了しました。",
    noCloudBackup: "クラウドバックアップはまだありません",
    restoreLatestConfirm: "この端末のChengJingデータを最新のクラウドバックアップで置き換えます。先にローカルの安全コピーを作成します。続けますか？",
    restoreDone: "復元が完了しました。置き換え前の安全コピーも保存しました。ChengJingを再読み込みします。",
    cloudExistingTitle: "このGoogleアカウントには既にChengJingのバックアップがあります",
    cloudExistingHint: "この端末が誤って上書きしないよう、自動バックアップを一時停止しました。クラウドを復元するか、この端末で置き換えるかを明示的に選んでください。",
    useCloudCopy: "クラウドを使用",
    replaceCloud: "この端末で置き換える",
    replaceCloudConfirm: "最新のクラウドバックアップをこの端末のデータで置き換えます。以前の内容を取り戻せない場合があります。続けますか？",
    previousLabel: "前日の救援ポイント",
    noPrevious: "利用できる前日のバックアップはありません",
    restoreYesterdayConfirm: "最終確認：これは通常の復元ではありません。ローカルの安全コピーを作成してから、現在のデータを前日の内容で置き換え、新しい現在版として同期します。緊急復元を実行しますか？",
    safetyCopy: "置き換える前に、このコンピューターへ安全コピーを保存します。",
    folderLabel: "バックアップ先",
    noFolder: "フォルダが選択されていません",
    chooseFolder: "フォルダを選択",
    changeFolder: "フォルダを変更",
    localEnabled: "オン・操作が止まったときだけ実行",
    localDisabled: "オフ・手動バックアップはいつでも利用できます",
    daily: "毎日",
    everyThreeDays: "3日ごと",
    weekly: "毎週",
    retention: "最新10件を保存します。ChengJingが作成した古いバックアップだけを整理し、同じフォルダの他のファイルには触れません。",
    localRunning: "ローカルバックアップを作成しています…",
    localReady: "ローカルの完全バックアップを安全に保存しました。",
    lastSuccess: "前回の完了",
    never: "完了したバックアップはまだありません",
    otherLocalToolsHint: "手動書き出し、読みやすいMarkdown、ファイルからの復元",
    folderRequired: "先にローカルバックアップ先を選択してください。",
    desktopRequired: "ChengJingデスクトップ版でバックアップを設定してください。",
    storageTitle: "ローカル容量",
    notesStorage: "ノートと構造",
    attachmentsStorage: "添付ファイル",
    modelStorage: "ローカルAIモデル",
    storageHint: "ローカルAIモデルはどのバックアップにも含まれません。",
  },
  ko: {
    privacyPolicy: "개인정보 처리방침 보기",
    connecting: "Google 로그인을 여는 중…",
    servicePending: "Google 클라우드 서비스 설정이 아직 완료되지 않았습니다.",
    cloudEnabled: "켜짐 · ChengJing이 열려 있고 유휴 상태일 때만 실행",
    cloudDisabled: "일시 정지 · 기존 클라우드 백업은 삭제되지 않음",
    intervalLabel: "클라우드 백업 주기",
    every15Minutes: "15분마다",
    every30Minutes: "30분마다",
    recommended: "권장",
    hourly: "매시간",
    every3Hours: "3시간마다",
    cloudRunning: "안전하게 백업하는 중…",
    cloudReady: "Google 클라우드 백업이 완료되었습니다.",
    noCloudBackup: "아직 클라우드 백업이 없습니다",
    restoreLatestConfirm: "이 기기의 ChengJing 데이터를 최신 클라우드 백업으로 교체합니다. 먼저 로컬 안전 사본을 만듭니다. 계속할까요?",
    restoreDone: "복원이 완료되었습니다. 교체 전 로컬 안전 사본도 보관했습니다. ChengJing을 다시 불러옵니다.",
    cloudExistingTitle: "이 Google 계정에 ChengJing 백업이 이미 있습니다",
    cloudExistingHint: "이 기기가 실수로 덮어쓰지 않도록 자동 백업을 일시 정지했습니다. 클라우드를 복원하거나 이 기기로 교체할지 명확히 선택하세요.",
    useCloudCopy: "클라우드 사본 사용",
    replaceCloud: "이 기기로 교체",
    replaceCloudConfirm: "최신 클라우드 백업을 이 기기의 현재 데이터로 교체합니다. 기존 클라우드 내용을 되찾지 못할 수 있습니다. 계속할까요?",
    previousLabel: "전날 복구 지점",
    noPrevious: "사용 가능한 전날 백업이 없습니다",
    restoreYesterdayConfirm: "최종 확인: 일반 복원이 아닙니다. 로컬 안전 사본을 만든 뒤 현재 데이터를 전날 내용으로 교체하고 새 현재 버전으로 동기화합니다. 긴급 복구를 실행할까요?",
    safetyCopy: "교체 전에 이 컴퓨터에 안전 사본을 저장합니다.",
    folderLabel: "백업 폴더",
    noFolder: "폴더를 선택하지 않음",
    chooseFolder: "폴더 선택",
    changeFolder: "폴더 변경",
    localEnabled: "켜짐 · 유휴 상태일 때만 실행",
    localDisabled: "꺼짐 · 수동 백업은 언제든 사용 가능",
    daily: "매일",
    everyThreeDays: "3일마다",
    weekly: "매주",
    retention: "최근 10개를 보관합니다. ChengJing이 만든 오래된 백업만 정리하며 폴더의 다른 파일은 건드리지 않습니다.",
    localRunning: "로컬 백업을 만드는 중…",
    localReady: "로컬 전체 백업을 안전하게 저장했습니다.",
    lastSuccess: "마지막 완료",
    never: "완료된 백업이 아직 없습니다",
    otherLocalToolsHint: "수동 내보내기, 읽기 쉬운 Markdown, 파일에서 복원",
    folderRequired: "먼저 로컬 백업 폴더를 선택하세요.",
    desktopRequired: "ChengJing 데스크톱 앱에서 백업을 설정하세요.",
    storageTitle: "로컬 저장 공간",
    notesStorage: "노트와 구조",
    attachmentsStorage: "첨부 파일",
    modelStorage: "로컬 AI 모델",
    storageHint: "로컬 AI 모델은 어떤 백업에도 포함되지 않습니다.",
  },
};

export function getAutoBackupCopy(language: AppLanguage) {
  const base = copy[language] || copy.en;
  const schedule = {
    "zh-TW": ["修改後停筆 30 秒自動備份；持續編輯時定期備份，退出前補存。", "持續編輯時的備份間隔"],
    "zh-CN": ["修改后停笔 30 秒自动备份；持续编辑时定期备份，退出前补存。", "持续编辑时的备份间隔"],
    en: ["Backs up 30 seconds after editing stops, periodically while writing, and before quitting.", "Backup interval while editing"],
    ja: ["編集が止まって30秒後、編集中は定期的に、終了前にもバックアップします。", "編集中のバックアップ間隔"],
    ko: ["편집을 멈춘 지 30초 후, 계속 편집하는 동안 주기적으로, 종료 전에도 백업합니다.", "편집 중 백업 간격"],
  }[language] || ["Backs up after editing and before quitting.", "Backup interval while editing"];
  return { ...base, ...(completeCopyOverrides[language] || {}), cloudEnabled: schedule[0], intervalLabel: schedule[1] };
}
