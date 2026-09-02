import type { AppLanguage } from "../types";
import { isWindows } from "./platform";

const windowsCopy = {
  "zh-TW": {
    dailyDescription: "每天第一次啟動時自動檢查公開的 GitHub Releases；只在你按下按鈕後下載符合這台電腦處理器的 Windows 安裝程式，不會自行替換應用程式。",
    downloading: "正在下載新版 Windows 安裝程式…",
    opening: "下載完成，正在開啟 Windows 安裝程式…",
    openedTitle: "最新版 Windows 安裝程式已開啟",
    quitDescription: "安裝程式已開啟。按下下方按鈕關閉澄境，再回到安裝程式完成更新；你的筆記與設定會保留。",
    quitForReplace: "關閉澄境並繼續安裝",
  },
  "zh-CN": {
    dailyDescription: "每天首次启动时自动检查公开的 GitHub Releases；只有点击按钮后才下载适合这台电脑处理器的 Windows 安装程序，不会自动替换应用程序。",
    downloading: "正在下载新版 Windows 安装程序…",
    opening: "下载完成，正在打开 Windows 安装程序…",
    openedTitle: "最新版 Windows 安装程序已打开",
    quitDescription: "安装程序已打开。点击下方按钮关闭澄境，再回到安装程序完成更新；笔记和设置会保留。",
    quitForReplace: "关闭澄境并继续安装",
  },
  en: {
    dailyDescription: "ChengJing checks public GitHub Releases on the first launch of each day. It downloads the Windows installer for this computer's processor only after you click the button and never replaces the app automatically.",
    downloading: "Downloading the new Windows installer…",
    opening: "Download complete. Opening the Windows installer…",
    openedTitle: "The latest Windows installer is open",
    quitDescription: "The installer is open. Click below to quit ChengJing, then return to the installer to finish the update. Your notes and settings will remain.",
    quitForReplace: "Quit ChengJing and continue setup",
  },
  ja: {
    dailyDescription: "毎日の初回起動時に公開GitHub Releasesを確認します。ボタンを押した後だけ、このPCのプロセッサーに合うWindowsインストーラーをダウンロードし、アプリを自動で置き換えることはありません。",
    downloading: "新しいWindowsインストーラーをダウンロード中…",
    opening: "ダウンロード完了。Windowsインストーラーを開いています…",
    openedTitle: "最新Windowsインストーラーを開きました",
    quitDescription: "インストーラーを開きました。下のボタンでChengJingを終了し、インストーラーへ戻って更新を完了してください。ノートと設定は保持されます。",
    quitForReplace: "ChengJingを終了してインストールを続ける",
  },
  ko: {
    dailyDescription: "매일 처음 실행할 때 공개 GitHub Releases를 확인합니다. 버튼을 누른 뒤에만 이 PC의 프로세서에 맞는 Windows 설치 프로그램을 다운로드하며 앱을 자동으로 교체하지 않습니다.",
    downloading: "새 Windows 설치 프로그램 다운로드 중…",
    opening: "다운로드 완료. Windows 설치 프로그램을 여는 중…",
    openedTitle: "최신 Windows 설치 프로그램을 열었습니다",
    quitDescription: "설치 프로그램을 열었습니다. 아래 버튼으로 ChengJing을 종료한 뒤 설치 프로그램으로 돌아가 업데이트를 완료하세요. 노트와 설정은 유지됩니다.",
    quitForReplace: "ChengJing 종료 후 설치 계속",
  },
} as const;

export function getWindowsUpdateCopy(language: AppLanguage) {
  return isWindows() ? (windowsCopy[language] || windowsCopy.en) : null;
}
