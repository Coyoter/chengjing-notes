# 全平台正式發布

正式發布必須同時提供以下五件安裝產物，不能以只有原始碼或單一 DMG 的 Release 視為完成：

- macOS Apple Silicon：`ChengJing-VERSION-arm64.dmg`
- Windows x64：`ChengJing-VERSION-x64-Installer.exe`
- Windows ARM64：`ChengJing-VERSION-arm64-Installer.exe`
- Android GitHub 管道：`ChengJing-VERSION-Android.apk`
- Android Google Play 管道：`ChengJing-VERSION-Android-Play.aab`

## 原始碼與版本

`release-version.json` 是發布版本計畫。流程先確認最後一個完整跨平台正式版 `v0.10.6` 的提交已被整合，避免新版主分支退回早期 Android 原生功能。未整合時直接停止，不使用 ours/theirs 覆蓋衝突，也不自行移動既有標籤。合併時必須保留目前卡片庫整合、隻言片語卡片化、封存與標籤色點修正。

通過前置檢查後，流程在獨立 prepared 分支同步 package.json、package-lock.json 與 Android versionName/versionCode，建立一個實際 Git 提交。測試、DMG、兩個 EXE、APK 與 AAB 全部檢出此 SHA，不以建置當下不斷變動的 main 作為來源。

## 簽章資料

Android 必須沿用原有 `android/signing/chengjing-release.jks`，絕不重新產生金鑰。以下資料只放 GitHub Actions Secrets，不能提交到版本庫或貼在公開 Issue：

- `CHENGJING_ANDROID_KEYSTORE_BASE64`：原有 JKS 的 Base64。
- `CHENGJING_ANDROID_SIGNING_CREDENTIALS_JSON`：原有 credentials.json（password、alias）。也可改用 `CHENGJING_ANDROID_KEYSTORE_PASSWORD` 與 `CHENGJING_ANDROID_KEY_ALIAS`。
- `CHENGJING_GOOGLE_OAUTH_CLIENT_SECRET`：沿用桌面建置憑證。

簽章檔只在 Android runner 的忽略路徑暫存，權限設為 600，結束時清除，不上傳為 Artifact。APK 使用 direct 管道，AAB 使用 play 管道。驗證 APK v2 簽章、原正式憑證、套件識別及版本；AAB 必須通過 jarsigner 並使用既有正式／上傳憑證。這不代表 Google Play 商店已發布；Play App Signing 金鑰可能與 GitHub APK 不同。

## 發布關卡

1. 完成必要型別與既有回歸測試。
2. Windows 檢查 x64/ARM64 PE 架構、ASAR 版本及共用應用內容。macOS 驗證 DMG。
3. Android 檢查 APK 與 AAB 裡的所有 public assets，必須與本次 dist 的位元組一致，避免包入過時介面。
4. 每個平台產生含版本、來源 SHA、大小與 SHA-256 的建置紀錄。彙整時缺少任何一件安裝檔、提交不一致或雜湊不符，都不發布。
5. 先建立草稿 Release，上傳五件安裝檔、SHA256SUMS 及 release-manifest.json，再讀回 GitHub 資產大小與 digest 核對。
6. 使用非強制 fast-forward 更新 main；主分支已被其他工作推進而無法快轉時停止，不覆寫他人的修改。完成後才將 Release 公開為正式版。

原本僅發布 DMG 的工作流程由全平台流程取代。已有版本與附件不覆寫。失敗的草稿不得自行改成正式版，也不得用 debug APK、未簽章檔或舊版改名補數量。

## 目前狀態

此變更為待驗證的發布基礎設施，不是安裝檔已發布的證明。首次執行仍須完成 GitHub 要求的核准、確認既有簽章已提供，並先整合分岔的 `v0.10.6` 與 main。只有實際成功的 Actions 紀錄及五件已上傳資產才算完成。
