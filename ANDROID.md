# 澄境 Android 工作站

基準：桌面 v0.9.5（429560d）。本分支為 Android 開發，不代表正式版已完成。

## Design Read

artifact: 離線 Android 知識工作站
audience: 手機、平板、摺疊裝置上的澄境使用者
purpose: 隨時記錄並操作同一座完整知識庫
visual-language: 墨色實心工具介面、暖紙閱讀、單一青綠操作色
mode: extension
visual-variance: 3 / motion-intensity: 2 / information-density: 5 / asset-dependence: 1 / brand-fidelity: 10

沿用既有 canvas/surface/text/accent tokens。手機正文16px、標題22–28px，4px間距基準，主要點擊區48px。內容平面、浮層輕陰影，160ms切換並遵守減少動態偏好。重用自有標誌與Lucide圖示。

## 架構決策

- Kotlin Android 宿主載入隨 APK 打包的 React 工作區，來源固定為 HTTPS WebViewAssetLoader；外部網址交系統瀏覽器。
- 保留 Dexie 為內容唯一主庫。原生分享入口保存獨立待匯入佇列，成功匯入後才確認移除。原生層不另行修改筆記副本。
- 型別橋接取代 Electron；附件、Android Keystore、Google AuthorizationClient、背景工作與本機推論由原生提供。
- MCP 只保留桌面；Android 不註冊伺服器、不顯示相關設定。
- Google 同步使用獨立命名空間與協定。不同筆資料合併；同一筆先判斷修改先後關係，離線並發才依修改時間自動採用較新者。較早內容保留在本機救援入口，日常不要求選版本。舊備份不改名為同步。

## Android 0.10.0-dev.3：自動同步規則

- 首次啟用會合併本機與雲端，不整份覆蓋。原有本機資料保留原修改時間，不把「今天啟用同步」誤判成「今天修改所有資料」。
- 同一筆資料已有明確先後關係時，後續修改優先。兩台裝置各自離線修改同一筆時，以修改時間決定；相同時間使用固定排序，避免抵達順序造成不同結果。待辦截止時間不參與判斷。
- 刪除也有修改時間。較新的刪除可以同步生效，較新的編輯可以保留內容；旧版沒有時間的刪除採保全內容的退路。較早的並發版本保留在本機「復原同步前的內容」，收起且需確認才可復原。
- 「最新」不是多人即時逐字合寫；同一張卡片的兩個離線正文不會硬接成一篇。裝置時間明顯錯誤仍可能影響並發排序，建議開啟系統自動日期時間。救援記錄目前是各裝置遇到並發時保留的本機記錄，不是完整跨裝置版本歷史。
- 本機存檔後停筆 5 秒嘗試同步；開啟後約 3 秒、回到 App、恢復網路時補同步；前景每 60 秒檢查雲端。持續輸入不必等到閒置 30 分鐘。
- 送到背景時會要求編輯器補存並暫存待上傳資料。Android 背景工作在有網路時嘗試上傳，另有 15 分鐘週期補送；省電、強制停止及系統調度可能延後，不保證關閉後立即完成。下次開啟會接續。
- 備份與同步是兩件事：備份保留快照供救援；同步交換每筆內容。舊桌面 v0.9.5 只有備份，**不會自動變成雙向同步版**；跨裝置測試請一併安裝本次 0.10.0-dev.3 的相容桌面測試版。

### GitHub 與 Google Play 更新管道

本次 APK 是 GitHub 開發測試版（versionCode 3），不是 Play 商店正式發布。可以直接覆蓋安裝相同簽章的舊測試版，不要先解除安裝。

Gradle 預設 `distributionChannel=direct`，更新入口連到 GitHub。未來建置 Play 版必須指定 `-PdistributionChannel=play`；介面只提供 Google Play 更新入口，不引導外部 APK、不要求安裝套件權限。本次新增管道區分不代表已完成 Play 上架、政策審核或其餘發布關卡。

依據：[Google Play Device and Network Abuse](https://support.google.com/googleplay/android-developer/answer/16559646?hl=en)。Play 發行的 App 不得使用 Play 以外的機制更新自身。同步參考 [Joplin 同步架構](https://joplinapp.org/help/dev/spec/sync/)的修改後快速上傳及週期下載；各產品衝突策略並不相同，澄境依本次產品決策採最新修改加救援，而非宣稱所有筆記產品都相同。

### English — sync and distribution

First sync combines independent local and cloud items. Causal successors take precedence; concurrent edits to the same item use modification time with a deterministic tie-breaker. Initial publication preserves the original timestamp. Deadlines are never used as modification times. Earlier concurrent values are kept in a collapsed local recovery section; restoring requires confirmation. This is item-level sync, not collaborative text merging. Incorrect device clocks can affect concurrent ordering; recovery history is local to the device that observed the competing edits.

While open, sync runs after five seconds without edits, shortly after launch, on resume/reconnection, and every minute. Android stages pending uploads for network-constrained background work, with periodic recovery. OS scheduling or force-stop can delay it; the next launch resumes pending work. Desktop v0.9.5 supports snapshot backups only; bidirectional testing needs the compatible 0.10.0-dev.3 desktop build included in this release.

This GitHub APK is a development prerelease, not a Google Play release. Direct builds link to GitHub; future Play builds must use `-PdistributionChannel=play` and Google Play updates only. Channel separation is not a claim of full Play policy compliance or review approval.

## 必須逐項驗收的功能

|功能|Android 目標|驗收狀態|
|---|---|---|
|卡片、格式、日誌、標籤、屬性、反向連結、歷史|共用完整編輯引擎|待驗收|
|片語、待辦、父子階層、期限、劃記|共用原資料關係|待驗收|
|白板、心智圖、區段、關係線|觸控畫布與可見操作入口|待驗收|
|看板、資料庫、分類、搜尋|行動版排列與完整操作|待驗收|
|附件、PDF、DOCX、Markdown、影音、網址|系統檔案入口與原生串流|待驗收|
|AI對話、動作、Provider、Responses|共用確認與复原流程|待驗收|
|本機AI|Android LiteRT-LM，裝置能力檢查|待驗收|
|第二大腦、共享大腦、許願池|保留全部資料與互動|待驗收|
|Google備份與雙向同步|Android/Mac/Windows互通且衝突不丟內容|待驗收|
|背景、分享、程序重啟、升級、簽章|持久化與原生生命週期|待驗收|
|五語、三主題、大字級、平板與手機|可閱讀、可操作且無溢出|待驗收|

正式發布前需完成真機、Google Android OAuth 與跨裝置同步驗收。模擬器或單元測試通過不等同真機完整驗收。

2026-09-07 的介面與操作修正、已測範圍及未完成項目，詳見 [Android 驗收記錄](ANDROID_QA.md)。

## 2026-09-06 開發檢查點（非正式發布）

- 已建立 Android 正式簽章與開發簽章對應的 Google OAuth Client；模擬器完成本人登入，原生 AuthorizationClient 可取得 `drive.appdata`。
- Android 16 ARM64 模擬器與隔離 Electron 桌面測試環境，透過真實 Google Drive 雙向交換片語、待辦及文字附件；兩邊實際讀回內容。未使用或修改正式桌面 IndexedDB。
- 原生測試確認目前備份、前一天救援點、附件雜湊還原、內容不變不重傳、過期未引用備份附件清理。本地私有備份保留 10 份，不刪旁邊無關檔案；外部 SAF 目錄的保留策略仍待補齊。
- 共用程式測試 124 項與桌面 Node 測試 61 項通過；原生裝置測試 2 項通過。涵蓋交易回滾、衝突、刪除與修改並發、背景上傳收據、上傳中新增修改、501 筆批次、暫停不恢復、舊備份匯入前保留手機修改、同一天多份 AI 反思。
- 模擬器介面測試確認片語與待辦寫入、完整功能目錄可開啟、第二大腦工具預設收起、窄視窗無水平溢出。標題與正文輸入後立即關閉編輯畫面，資料實際讀回成功。
- 手機目錄改為依用途分組的圖示目錄，滑出／拖曳收起；底部導覽沿用內容底色。待辦移除大區塊分隔，保留日期、階層及明確的更多操作入口。
- 已產出 `0.10.0-dev.1` 簽章 APK，APK v2 簽章驗證通過。只屬於開發測試產物，未推上正式 Release、未更新官網、未替換已安裝的桌面正式版。

### 測試注意事項

請用 `node scripts/qa-android-native.mjs` 安裝更新並啟動原生測試。不要用 `connectedDebugAndroidTest` 對日常測試裝置執行；Gradle 會在結束時解除安裝被測應用。這次發現後已改成 `adb install -r` 加直接 instrumentation，重新登入連線恢復；雲端測試資料仍可讀回。

### 尚未通過的發布關卡

1. 真機繁中組字、鍵盤／手勢、附件／大型資料、平板與摺疊視窗、無障礙；完整功能帳冊不能因共用元件就標記通過。
2. 真機 LiteRT Gemma 的下載、推論、取消、記憶體與溫度；模擬器尚未執行本機模型。Android Provider 的錯誤與回傳格式相容仍須與桌面逐項對齊。
3. 真正殺掉程序後 WorkManager 持續上傳、斷網及重新授權的整合驗收。同步日誌仍為累加式，正式發布前需補上有版本協商的壓縮／清理，避免長期資料量不斷累積。
4. 外部本地備份目錄的 10 份保留與完整復原、分享匯入中斷的冪等處理、附件串流範圍讀取。
5. 新手機介面的完整五語文字、Android 專用更新流程、Google 備份與同步設定的單一入口整理。
6. Windows 同步版建置與相容驗收、桌面新格式的升級／回退策略。已發布 v0.9.5 只有備份，不會因 Android APK 完成就自動支援雙向同步。
