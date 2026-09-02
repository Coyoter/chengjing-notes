這一版讓澄境正式支援 Windows ARM64 與 Intel／AMD x64；筆記、白板、看板、第二大腦、AI、備份與共享功能沿用同一套資料與操作體驗。

- 新增 `ChengJing-0.7.5-arm64-Installer.exe` 與 `ChengJing-0.7.5-x64-Installer.exe`。改用澄境自製的原生安裝流程，安裝到目前使用者的 `%LOCALAPPDATA%\Programs\ChengJing`，不再使用曾於 Windows ARM 遺失主程式的 NSIS 流程。
- Windows 主程式、安裝程式與移除程式皆依處理器分開建置；ARM64 為 PE AArch64，x64 為 PE x86-64。兩個版本使用完全相同的澄境應用程式碼。
- Windows 主程式固定使用 `ChengJing.exe`，桌面與開始功能表捷徑仍顯示「澄境」；安裝程式會登錄移除入口，移除 App 時保留筆記與設定。
- Windows 使用原生標題列與右上角最小化／最大化／關閉按鈕，不保留 macOS 紅綠燈安全區；介面字型改用 Segoe UI，快捷鍵依平台顯示 Ctrl／Alt。
- 傳統「檔案／編輯／顯示／視窗」列預設隱藏，按 Alt 才暫時顯示完整功能；「檔案」內仍保留「檢查更新…」。
- macOS 選單列快速記錄在 Windows 對應為系統匣快速記錄；預設 `Ctrl+\`，可自訂全域快捷鍵，也可在登入 Windows 時只啟動背景工具。
- 關閉主視窗後，Windows 版會留在系統匣並保留快速記錄；從系統匣可重新顯示或完整結束。重複啟動只會帶回既有視窗。
- 更新器會從 GitHub API、Cloudflare 索引或 Release Feed 取得目前處理器對應的安裝程式，核對檔案大小與 SHA-256 後才開啟。
- Windows 應用圖示與彩色系統匣圖示已加入打包；macOS 仍保留 ICNS、Template 選單列圖示、交通燈安全區與原生 AppKit 快速輸入。
- 已完成 Windows 介面與封裝 QA、雙架構 PE／ASAR 驗證、90 個前端測試、26 個 Electron 測試、3 個更新服務測試，以及 macOS 正式封裝回歸。

目前 Windows 安裝程式尚未使用商業程式碼簽章憑證，因此 SmartScreen 可能顯示未知發行者，啟用 Smart App Control 的電腦也可能直接封鎖安裝檔。Release 同時提供 SHA-256 檔供核對；請不要為了安裝而降低主要工作電腦的安全設定。
