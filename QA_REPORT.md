# 澄境筆記 v0.9.2 驗收報告

## 0.9.2 Responses 相容性與快速前往收尾

- 980px 設定頁中的「快速前往」外框實測寬 533.5px，最後一個按鈕到右側 padding 之外的未使用空間為 0px；淺色與深色均完成實際截圖目視。
- 480px 窄視窗下，容器不超出設定頁，軌道可橫向移到最後一個錨點；八個目的地、首尾定位與 details 自動展開均維持正常。
- Node 契約測試以公司 Gateway 同型錯誤拒絕 `temperature`：第一次請求帶參數並收到 400，第二次自動省略後成功；同 Provider／模型的下一輪直接省略，一共三次請求取得兩次正常回覆。
- 正式 Electron AI 面板同樣經過拒絕、重試與後續免重試流程；Responses 的 `store: false`、完整 input、輸出 token 上限、加密金鑰與錯誤去敏仍維持。

## 0.9.1 Responses API 與設定資訊架構

- Provider 設定新增 `apiMode` 白名單；既有缺少欄位的連線安全回到 `chat-completions`，新設定可保存 `responses` 且 API Key 仍不進公開設定。
- Responses 請求與回覆已有 Node 契約測試：遠端 Gateway 使用 `/responses`、`instructions`、訊息 `input`、`max_output_tokens`、`text.format` 與 `store: false`；Ollama 不送 store、conversation 或 `previous_response_id`。
- 正式 Electron 整合以本機 mock Responses Gateway 完成兩次回覆：一次直接經 preload，一次由澄境 AI 面板送出；模型清單、加密金鑰與 Responses 模式持久化均回讀一致。
- 設定頁有八個錨點，打賞與語言的跨頁首尾平滑定位、鍵盤連結、內部橫向溢出控制均通過；五種語言與 120% 字級沒有頁面水平溢出。
- 三種引擎來回切換已驗證：OpenRouter 預設展開模型；Gemma 4 只顯示本機模型並收合 OpenRouter／自訂 Provider；自訂 Provider 自動展開且其他引擎控制不殘留。
- 未選的 OpenRouter 模型仍可手動展開，三個精選模型、同步、自訂模型與路由控制完整可用；其中 Gemini 已確認只顯示並選用 `google/gemini-3.8-flash`，創意度與本機搜尋搬到共用區後原值不變。
- 未啟用 MCP 預設收合；「外部整合」錨點會先展開受控 details 再定位。選中引擎控制面在主題後段規則下仍保持 `surface-2` 外層與 `surface-1` 操作面，不再退回無背景散列。
- 同一台 Mac、同一時段各跑七輪的封裝版中位數：0.9.1 App shell 722ms、首次操作 738ms、RSS 758 MiB；已安裝的 0.9.0 對照為 707ms、729ms、756 MiB，差異 15ms／9ms／2 MiB，idle timer delay 兩版均為 0ms。

## 0.9.0 本機 MCP 與自訂 AI Provider

- 本機 Streamable HTTP MCP 只監聽 `127.0.0.1`，Host 與 Origin 非 loopback 時回傳 403，未帶正確 Bearer 權杖時回傳 401；請求本文限制為 1 MiB。
- MCP 預設關閉且預設唯讀；正式 Client 實測唯讀模式會拒絕新增筆記。允許寫入後，可經 Electron main → preload → renderer → Dexie 完成新增與防衝突更新，稽核清單正確記錄拒絕及成功結果。
- 正式 MCP Client 可初始化、讀取 capability resource、列出 15 個工具，核心工具涵蓋搜尋、筆記、待辦、白板、看板與神經元關係。修改既有項目需比對 `updatedAt`，永久刪除不對 MCP 開放。
- 外部一次寫入會在動作前後立即切開全域差異歷史，不和使用者相鄰編輯合併；寫入仍可用澄境的復原功能撤回。
- 自訂 Provider 實測可儲存多組 OpenAI 相容／Ollama 設定、列出模型、測試連線，並由正式封裝 App 的 AI 面板取得本機 mock Gateway 回覆。
- Provider 遠端 HTTP 會被拒絕，只有 loopback 可使用 HTTP；redirect 不會攜帶金鑰，API Key 以獨立 AES-256-GCM vault 保存，公開設定、備份與錯誤文字均無明碼。
- 兩個設定面板在繁中、簡中、英文、日文與韓文下均完整顯示；120% 介面字級時沒有水平溢出。繁中截圖實測 Provider 面板 846px、MCP 面板 890px，內容均完整落在邊界內。
- MCP SDK 與工作區處理採延遲載入；MCP 未啟用時不載入伺服器。同一台 Mac 各跑七輪的中位數，0.9.0 App shell 為 601ms（0.8.2：584ms）、首次操作 616ms（0.8.2：599ms）、RSS 757 MiB（0.8.2：754 MiB），差異 17ms／3 MiB，idle timer delay 均為 0ms。
- 封裝排除 MCP／Zod 的 source map、型別與非 CJS 重複檔後，0.9.0 App 約 360 MiB；0.8.2 App 約 358 MiB。正式封裝仍完成 Provider、MCP 唯讀保護與實際資料寫入。

## 0.8.2 Google 按鈕留白

- 登入按鈕移除固定最小寬度，繁中 120% 介面下實測寬 166.046875px、高 40px。
- 圖示殼左緣 2px，加上官方 SVG 內建 10px，形成 12px 可見左距；圖文視覺間距 10px，文字右距 12px，額外未使用寬度為 0px。
- 圖示與文字垂直中心誤差皆為 0px；繁中、簡中、英文、日文、韓文按鈕皆可見、自然寬度且不溢出。

## 0.8.1 Google 登入按鈕

- 確認 0.8.0 的透明登入區來自損壞的內嵌 PNG；修正版移除整張 PNG，改用澄境繪製的 40px 中性膠囊與 Google 官方本機 SVG 彩色 G。
- `qa:auto-backup` 在連結前驗證按鈕至少 180×40px、淺灰背景、深色文字、完整繁中操作文字、SVG 40×40 實際載入且不是 data URI，並保存實際畫面；所有檢查通過。
- 按鈕文字是獨立 DOM 內容，因此圖示即使意外失效也不會再次留下完全透明的操作區。

## 0.8.0 Google 雲端備份

- 真實 Google OAuth 已使用正式 Desktop Client、系統瀏覽器、PKCE、state、loopback 與唯一 `drive.appdata` 權限完成登入；Google Drive 實際建立目前快照後，成功下載並完整復原。
- 真實復原前會先建立本機安全副本；測試結束後刪除 1 份雲端測試 manifest、撤銷測試 token，雲端與本機暫存均清空。
- macOS refresh token 以應用程式本機 AES-256-GCM 靜默保存，實測加密約 8ms，未呼叫鑰匙圈、未出現系統密碼提示；Windows 的 OS safe storage／DPAPI 路徑另有注入測試。
- 雲端保留策略、48 小時救援點、附件 SHA-256 去重串流、未變更跳過、多裝置衝突暫停、復原附件完整性與測試資料清理均有 Node 整合測試。
- 設定頁「Google 雲端／本地」雙軌介面通過兩者同時啟用、預設 30 分鐘、緊急救援預設收合、二次確認、五語與 1040px 零溢出驗收。
- 0.8.1 封裝版未登入 Google 時，本機雲端狀態檢查不發網路請求；1,200 張卡片壓測仍維持 200 顆第二大腦視野上限與索引搜尋。
- Google Desktop Client Secret 不在 Git 追蹤檔案；發行時由開發機 macOS 鑰匙圈注入，Mac、Windows x64 與 Windows ARM64 ASAR 均確認包含正式 runtime 設定。

## 自動驗證

- `npm run typecheck`：通過。
- `npm test`：92 個前端單元測試與 45 個 Electron Node 測試全部通過。
- `npm run build`：Vite production build 通過。
- `npm run qa`：6 張關鍵畫面，console／page error 為 0。
- `npm run qa:functional`：新增、編輯、重新載入持久化、版本歷史、心智圖鍵盤、資料庫更新與指令搜尋通過。
- `npm run qa:knowledge-library`：知識問答入口與舊索引表均不存在；領域／主題生命週期、中文輸入、拖曳分類、統一新增入口及真實 PDF 匯入／文字抽取／預覽仍正常。
- `npm run qa:journal-polish`：日誌七日列與任意日期月曆、今天／選擇日期同組對齊（0px 高度與頂端差、6px 間距）、跨月跳轉、回到今天、鍵盤結構、工具列與劃記同步通過。
- `npm run qa:ai-conversation`：既有 AI 對話、中文輸入法、卡片＋AI、推薦 Prompt 與搜尋範圍均通過；收件匣分頁 hover 位移為 0，卡片本體、圖示、標題、摘要與底部資訊在 hover 前後的 x／y／寬／高完全一致；圖示背景前後皆透明、圓角為 0、transition 為 none。
- `npm run qa:ai-actions`：第一次轉換計畫刻意只含 description、缺 title／content 時會自動修復一次；最終白板、區段、三張卡片標題與內文非空。右鍵轉白板、原卡片保留、關係線別名、無效單線部分套用、跨分類匯出、搜尋範圍、undo／redo 與刪除確認均通過。
- `npm run qa:openrouter-routing`：平衡預設、三模式說明、極速持久化、一般聊天 speed payload、AI 動作 economy payload、平衡還原、五語及 1040px／120% 無溢出全部通過。
- `npm run qa:advanced-integrations`：原始碼與正式封裝 App 均通過三種 AI 引擎、自訂 Provider 加密／模型／回覆、本機 MCP 15 工具、唯讀拒絕、允許寫入、稽核紀錄與五語零溢出。
- `npm run qa:wish-pool`：右側開啟、留在 App、匿名名稱重生、願望、匿名回覆、管理員登入、管理員回覆與刪除通過；淺色／深色／墨色截圖、12px 最小字級與零水平溢出通過。
- `npm run qa:wish-pool-live`：App 介面直接連公開 Worker，真實建立願望、管理員登入與刪除，最後公開池回讀為空，console／page error 為 0。
- `npm run qa:local-gemma-runtime`：本機 `.mjs` 與 22 MB WASM 回傳 200；以 ONNX Runtime 執行 130-byte 測試模型，正確得到 `[1, 4, 9, 16, 25, 36]`，jsDelivr 請求為 0。
- `npm run qa:employee-workday`：以「產品營運上班日」走過繁中會議卡片、Q3 標籤、置頂、劃記、屬性新增／修改／移除、網址與 Markdown 匯入、片語、期限待辦、日誌、卡片轉白板、跨分類 AI、第二大腦、資料庫與雙格式匯出；所有資料均由 IndexedDB 回讀確認。
- `npm run qa:pinned-cards`：舊 favorite 資料直接成為置頂、卡片庫與資料庫置頂集合、取消／重新置頂、置頂優先排序、無待辦混入與右鍵文字全部通過。
- `npm run qa:ai-markdown`：標題、粗體、巢狀清單、分隔線、引用、行內程式碼、表格與安全外部連結正確；原始符號隱藏、腳本／圖片移除、窄面板無溢出，使用者單行泡泡約 44px、框內無身分標籤且保留 aria-label，存成卡片後仍保留安全 HTML。
- `npm run qa:highlight-theme`：新劃線不再保存固定色碼；既有亮黃色會被主題樣式接手。淺色、深色、墨色實測文字對比為 8.53:1、5.71:1、6.26:1，且三種畫面均完成截圖驗收。
- `npm run qa:update`：每日首次啟動只檢查一次、成功日期持久化、同日 reload 不重複；原生選單事件會切到設定更新區並執行第二次手動檢查；DMG 開啟後「關閉澄境並開始取代」會呼叫 quit bridge。
- `npm run qa:task-knowledge`：獨立待辦與編輯器待辦成為神經元、進入資料庫、自然語言搜尋、完成回寫與刪除連線清理通過。
- `npm run qa:second-brain`：14 個含待辦的神經元、語意連線、截斷 JSON 自動重試、低信心拒絕、朋友式 3～4 段反思、安全 Markdown、預覽／展開無痕捲動、960px 閱讀紙頁、神經元標籤遮擋、AI 線右鍵刪除、縮到最小與墨色外觀通過。
- `npm run qa:database-share`：卡片與待辦共同標籤篩選、卡片批次管理、待辦資料列、分享隱私預設、離線 3D HTML 與 12px 最小字級通過。
- `npm run qa:i18n`：繁體中文、簡體中文、英文、日文與韓文各走過 10 個主要頁面；1040px／120% 字級無水平溢出。
- `npm run qa:typography`：16 組一般深色／墨色主要介面最小可見字級 12px、最低文字對比 4.61:1，無字級、對比或長文行高失敗。
- 白板 80 層操作歷史、按鈕與 `⌘Z／⌘X`、文字剪下保護、Bullet 分行、關係標籤避讓，以及日期待辦、標籤、日誌劃記、中文 IME、無邊框主題、自動備份、更新視窗、偏好語言、分享大腦與響應式既有專項驗收全部重新通過。
- 28 組端到端 QA 依序完整執行並全部通過；沒有只重跑失敗項目後便宣告完成。
- `npm run smoke:electron`：Electron 44、Node 24.18.1、preload bridge、AES 加密持久化、WebGPU、OpenRouter 金鑰／聊天／模型清單端點通過。
- `npm run smoke:electron-main`：未封裝、正式 App 與 DMG 內 App 都通過許願池公開讀取、本機 ONNX `.mjs` 動態匯入、WASM 讀取，以及既有 OpenRouter、日誌、卡片、白板、更新、對話、Markdown、反思、加密金鑰與備份功能。

## Cloudflare 許願池

- Worker：`chengjing-wish-pool.coyoter.workers.dev`；最終版本 `01ca4ad9-4e07-4f20-8dd8-5718e2c25245`。
- 3 個 Workers Runtime 整合測試通過：匿名願望／回覆、管理員簽章／刪除、內容限制／限流／禁止第三層。
- 正式環境 smoke 真實建立願望、匿名回覆、管理員回覆，再刪除原始願望；最終公開列表為空。
- 資料按月份路由到 `WishShard` SQLite Durable Object，避免單一全域 Object；願望與回覆均有時間複合索引及游標分頁。
- `WISH_ADMIN_PASSWORD` 與隨機 `WISH_SIGNING_SECRET` 已設定為 Cloudflare Secrets；原始值不在 Git、App、設定檔、Log 或回應中。

## Gemma 4 Runtime 修復

- App 內含 `ort-wasm-simd-threaded.asyncify.mjs`（47,389 bytes）及 `.wasm`（23,567,050 bytes）。
- Transformers.js 在建立 pipeline 前明確設定本機 `wasmPaths`；CSP 只允許 App 本身及 App 產生的 blob module，不再允許或需要 jsDelivr。
- v0.3.17 安裝至 `/Applications` 後，沿用既有 2.9 GB Gemma 權重，實際生成「本機 Gemma 4 測試成功。」；模型為 `onnx-community/gemma-4-E2B-it-ONNX`，backend error、外部 Runtime 請求與 page error 均為 0。

## 封裝 App 人工操作

- 既有 v0.3.16 上班日人工操作結果持續保留；v0.3.17 另完成許願池公開串接與完整 Gemma 4 生成。
- 使用目前設定的 OpenRouter／`deepseek/deepseek-v4-flash-0731` 真實產生卡片轉白板計畫；模型回傳 11 個變更，套用後建立 4 張有標題與內文的卡片、3 個區段與 3 條關係線。
- 真實關閉並重新啟動 App 後，新增卡片、白板、待辦完成狀態與片語仍可回讀。
- Computer Use 的逐字鍵盤注入會受目前 macOS 輸入法影響，因此中文組字正確性另由 `qa:board-ime-security` 與 `qa:ai-conversation` 的 composition event 專項驗證；一般文字欄位的繁中寫入與回讀正常。

## 正式成品

- Windows ARM64：`release/ChengJing-0.9.2-arm64-Installer.exe`
- Windows Intel／AMD x64：`release/ChengJing-0.9.2-x64-Installer.exe`
- Apple Silicon Mac：`release/ChengJing-0.9.2-arm64.dmg`
- 本機 `release` 只保留上述三個正式安裝檔。
- `hdiutil verify`：通過。
- 尚未使用 Apple Developer ID 簽章與公證，Windows 也尚未使用商業程式碼簽章。
- DMG 內含：澄境 App 與 Applications 捷徑。

## 重要行為邊界

- OpenRouter 金鑰以 AES-256-GCM 加密保存在澄境資料目錄，密鑰與密文權限為 0600，不進備份、不使用 macOS 鑰匙圈。
- OpenRouter 請求由 Electron main process 送出；renderer 不讀取明文金鑰，HTTP 標頭維持純 ASCII。
- 知識問答、OpenRouter embeddings 與本機 Multilingual E5 索引已移除；升級資料庫會刪除舊索引表，啟動時會清理澄境專用的 E5 快取目錄。
- AI 對話依整體空間、卡片或白板分別恢復最近使用的 thread；「新對話」只切換目前 thread，不刪除舊訊息。
- 卡片內容在中央主工作面顯示；AI 為獨立右側工作面，卡片上下文由 thread 與參考卡片列共同固定。
- 卡片工作面覆蓋原 TopBar 時強制使用 `-webkit-app-region: no-drag`；AI 推薦 Prompt 只在使用者點擊推薦按鈕後寫入輸入框。
- 返回按鈕頂端位置不低於 42px，完整避開 macOS `hiddenInset` 原生標題列命中範圍。
- `同步搜尋本機卡片` 是 `aria-pressed` 範圍開關：關閉時不建立額外本機搜尋上下文，開啟時才把相關卡片結果加入 `<reference_material>`。
- 收件匣分頁固定寬高與透明背景，hover 只調整文字色；選中狀態以 2px accent 底線表示。
- 每日檢查日期保存在 renderer localStorage，以 Mac 本機年月日為準；成功的自動或手動檢查才寫入日期，失敗不寫入。
- 原生選單「檢查更新…」只送出 `check-update` 事件，由 renderer 呼叫與設定頁完全相同的 `useUpdateStore.check(false)`。
- 更新下載並開啟 DMG 後，renderer 只透過 preload 暴露的 `app.quit()` 要求 main process 結束應用；不執行自行覆蓋或檔案替換。
- 選單更新 icon 僅在 `process.getSystemVersion()` 主版本為 26 時建立；主版本 27 明確不傳入 icon。
- 收件匣卡片外層 panel 為透明；卡片一般／hover 狀態共用固定 padding 與圓角，唯一 transition property 為 `background-color`。
- 收件匣卡片內的文件圖示只保留 34×34 對齊空間與 glyph；背景透明、無圓角、無 transition，不建立第二層 hover 表面。
- 日誌日期選擇器重用共用月曆的日期與鍵盤核心，但關閉待辦專用 presets 與清除日期；選中日期直接更新唯一 journalDate。
- 「今天」與「選擇日期」位於同一個 `journal-date-navigation-actions`，紙張標題內不再重複日期控制；七日列樣式只作用於 `journal-week-days`。
- AI 動作可建立新白板並以 `boardRef` 將節點與連線安全限制在同一張白板；所有計畫仍必須先預覽才會寫入。
- 關係線會解析 tempId、標題、說明與常見 source／target 別名；仍無法唯一解析時只記錄為 skipped，不拋出 `invalid-edge-reference` 或回滾其他動作。
- 白板建立動作在預覽前會檢查實際 title／content／text；缺漏時只修復一次，最後再以 description 保底，apply 階段不會收到空白建立欄位。
- 卡片、白板、日誌、待辦與隻言片語共用跨分類工作目錄；關閉 spaceSearch 時其他卡片、待辦與片語陣列為空。
- 卡片置頂沿用既有 `favorite` 布林欄位，僅修正產品語意、集合與排序，不進行破壞性資料遷移。
- OpenRouter 路由模式只傳 balanced／speed／economy；Electron 分別轉成 `{ sort: "price", preferred_min_throughput: 45 }`、`{ sort: "throughput" }` 與 `{ sort: "price" }`。
- 45 tokens/s 為 OpenRouter 最近五分鐘 p50 統計的軟性偏好，不是硬性封鎖；快速 Provider 不可用時仍允許 fallback。
- AI 只能產生 17 種白名單動作；參考內容中的指令視為不可信。所有動作先預覽，刪除或覆寫必須由使用者確認。
- AI 刪除卡片只移到垃圾桶；待辦刪除會同步原文與第二大腦連線，避免留下孤立資料。
- 分享大腦預設排除日誌、隻言片語、待辦、完整內文、關鍵詞與 AI 反思。
- 編輯器劃線以主題 token 顯示；舊版 HTML 內的固定亮黃色仍會被目前外觀覆蓋，資料不需遷移。
- `npm audit --omit=dev`：production dependencies 為 0 個已知 info／low／moderate／high／critical 漏洞。
