# 澄境 ChengJing — Design Read

```text
artifact: 本機優先的桌面筆記、研究與視覺思考應用
audience: 需要長期整理研究、產品、文章與生活資料的繁體中文個人使用者
purpose: 讓蒐集、理解、連結、寫作與 AI 協作在同一個安靜工作空間完成
visual-language: 現代工具介面為主，編輯留白與單色材質為輔
mode: greenfield
visual-variance: 7
motion-intensity: 3
information-density: 6
asset-dependence: 2
brand-fidelity: 1
```

## 設計原則

1. 功能要被找到，不以大量圖示猜謎。
2. 主畫面只保留一層導覽；白板、筆記與 AI 共用同一套內容脈絡。
3. 浮動面板只在需要時出現，關閉後完整還原工作空間。
4. 每個狀態以文字、形狀與色彩共同表達，不只靠顏色。
5. 所有主要功能以繁體中文命名，技術模型名稱保留原文。

## Design System

- palette：象牙白／近黑為底；青綠 `oklch(0.68 0.12 174)` 為唯一主功能色；琥珀、珊瑚與藍只用於狀態。
- typography：介面採系統繁中字體；產品名稱與大標題使用較寬鬆字距；正文 15–16px、行高 1.65。
- spacing：4px 基準，主要級距 4／8／12／16／24／32。
- shape：主要圓角 10px，緊湊控制 6px，大面板 14px；髮絲線 1px。
- depth：以明度層級與細框線為主，陰影只用於浮層、拖曳物件與對話面板。
- motion：140–220ms；只用於面板進出、選取、拖曳與狀態回饋；遵守 reduced-motion。
- asset plan：採 Lucide 線性圖示與自有幾何標誌；不使用任何外部產品的品牌資產。

## 主要產品設計取捨

- 合併「應用入口」與「分頁清單」，避免左側重複導覽。
- AI 具有三種入口：全域助理、卡片動作、白板建構；使用者不必先理解 Chat／Agent 的產品術語。
- 卡片庫、標籤資料庫與待辦共享同一套篩選列與鍵盤操作。
- OpenRouter 與 Gemma 4 的資料去向永遠顯示在輸入框旁。
- 預設不顯示小地圖、資訊欄與額外側欄，使用時才展開。

## 2026-08-25 可讀性重整

```text
Design Read:
artifact: 澄境桌面應用全介面
audience: 長時間閱讀繁體中文、整理研究與操作 AI 的個人使用者
purpose: 降低暗色疲勞、移除微小文字、讓設定與重要操作可被直接發現
visual-language: 溫暖墨色工具介面，保留單一青綠功能色
mode: overhaul
visual-variance: 3
motion-intensity: 2
information-density: 5
asset-dependence: 1
brand-fidelity: 9
```

- palette：深色背景改為墨綠黑 `#111816`；主要文字使用溫暖象牙色 `#F0EEE7`，不用純白；次要文字 `#D4D1C8`、輔助文字 `#AAA9A2`，皆以 WCAG 實測而非肉眼猜測。
- typography：介面最小可讀字級提高到 12px；一般控制 13–14px；正文 16px、行高至少 1.6；大標題沿用中文負字距約 `-0.016em`，正文不額外疏排。
- scaling：提供 90%／100%／110%／120% 四種全域文字比例，所有固定字級共同縮放。
- spacing：文字放大後同步放寬控制高度、側欄與右面板，不以裁切換取密度。
- shape：標籤與新增標籤改用 1px 低對比邊線，不再出現瀏覽器預設粗白框。
- interaction：AI 引擎狀態改為按鈕；日誌加入「今天」；卡片庫新增卡片與網址均成為第一層操作。

## 2026-08-25 白板互動重整

```text
Design Read:
artifact: 無限白板、關係線與心智圖
audience: 不應先學會繪圖軟體才能整理想法的個人使用者
purpose: 可靠建立關係、快速長出階層、讓右鍵與工具列具備可發現性
visual-language: Miro 式直接操控加上澄境的單色墨面
mode: overhaul
visual-variance: 4
motion-intensity: 3
information-density: 5
asset-dependence: 1
brand-fidelity: 9
```

- connection：四向大連接點、44px 吸附半徑、拖放成功／失敗文字回饋、點兩張卡片連線模式與可重新接線。
- handle hover：連接點本體不做 transform；hover 只從原圓心向外增加光圈，避免瞄準後命中位置漂移。
- mindmap：中心節點、節點旁 `+`、Tab 子節點、Enter 同層節點、分支折疊與自動排列。
- context menu：畫布、卡片、心智圖與關係線分別提供右鍵操作；移出白板不刪除卡片本體。
- toolbar：移到畫布底部中央，與白板選擇器分離；每個圖示有即時繁中 tooltip 與快捷鍵。
- visual hierarchy：白板卡片統一為無彩色頂線、近乎無邊框的墨色面；只有 hover、selected、connecting 顯示青綠狀態。

## 2026-08-25 墨色主題與第二大腦

```text
Design Read:
artifact: 澄境全應用、隻言片語與 3D 第二大腦
audience: 想長期保存完整筆記與未完成念頭，並在低干擾環境中回看自己的個人使用者
purpose: 讓微小念頭容易留下、所有內容可被重新連結，同時維持使用者對 AI 推論的控制
visual-language: 日式墨色、和紙層次、低彩度苔綠與實心材質；避免霓虹描邊與漂浮玻璃感
mode: overhaul
visual-variance: 5
motion-intensity: 3
information-density: 5
asset-dependence: 1
brand-fidelity: 10
```

- ink theme：新增獨立於一般深色的「墨色」主題；用炭黑、灰墨、和紙白、枯茶與苔綠建立層次，選取狀態以實心底色而非亮色外框表達。
- material：卡片庫、設定、日誌與列表共享無彩色內容面；彩色只保留給必要狀態，移除卡片頂部彩線與大量輪廓框。
- contextual actions：卡片、待辦、劃記、隻言片語與白板各自擁有內容相符的右鍵選單；三點按鈕與右鍵呼叫同一套可靠操作。
- fragments：「隻言片語」是一行即可保存的低摩擦入口，支援 `⌘ Enter`、釘選、轉成卡片與刪除。
- second brain：3D 神經元以全部未刪除內容為資料來源；重複概念提高節點權重與尺寸，使用者可旋轉、縮放、WASD 移動、手動連線及刪線。
- AI boundary：AI 只提出「可能的關聯與反思線索」，不得宣稱讀懂潛意識、診斷心理狀態或把人格推論寫成事實；每條 AI 連線保留來源、理由並可刪除。

## 2026-08-25 資料庫批次管理與大腦分享

```text
Design Read:
artifact: 資料庫管理介面、3D 第二大腦標題層與分享成品
audience: 需要快速整理大量卡片，以及願意選擇性公開個人知識網的使用者
purpose: 讓分類真的可操作、批次動作可預期，並把第二大腦變成可攜帶與觀看的個人作品
visual-language: 墨色工具介面延伸；批次狀態採實心選取，分享介面像交付一卷可控制揭露程度的私人腦圖
mode: extension
visual-variance: 4
motion-intensity: 3
information-density: 6
asset-dependence: 1
brand-fidelity: 10
```

- database filter：左側標籤是可辨識的篩選狀態，標題、數量與內容同步；不再出現看似按鈕卻沒有作用的元件。
- bulk actions：批次模式與平常開啟卡片模式明確分離；全選只作用於目前篩選結果，垃圾桶與永久刪除分級並再次確認。
- labels：第二大腦預設顯示全部神經元名稱；使用者仍可切換成只顯示重點，避免大型腦圖完全失去空間層次。
- share：分享產物是可直接傳送的單一互動 HTML，不需要對方安裝澄境；匯出前可排除日誌、隻言片語、完整內文與 AI 反思。
- privacy：分享預設只公開標題與連線，不自動夾帶最私密的日誌、片語或內文；介面直接顯示將公開的節點數與資料類型。

## 2026-08-26 日誌語意與編輯一致性

```text
Design Read:
artifact: 日誌日期列、任務勾選、文章工具列、第二大腦日誌節點與劃記流程
audience: 每天持續書寫、需要快速辨識時間與內容脈絡的個人使用者
purpose: 讓日期可立即理解、編輯控制對齊，並讓日誌在第二大腦中以內容而非檔案日期被記住
visual-language: 延續墨色實心材質；時間資訊清楚、內容語意優先、工具列退居輔助層
mode: preserve
visual-variance: 2
motion-intensity: 2
information-density: 5
asset-dependence: 1
brand-fidelity: 10
```

- date bar：每一天同時顯示星期與月／日，例如「四 8/27」，不要求使用者從單一日數推回月份。
- task alignment：核取方塊以正文第一行的行盒置中，不用手動 padding 猜位置。
- journal neuron：日誌神經元以第一個有意義的標題或句子命名；日期只作時間屬性，不再主導第一眼辨識。
- highlight bridge：編輯器螢光標記與澄境「劃記」共用同一次動作；卡片內標記後立即寫入劃記資料庫。
- editor material：工具列使用中性實心墨面，不再出現與內容無關的褐紅色帶。
- removal：移除低使用價值的 AI 導師入口與檢視，保留既有資料表以確保舊備份仍可還原。

## 2026-08-26 白板命名、輸入法與金鑰保管

```text
Design Read:
artifact: 白板標題控制、卡片標題輸入與 OpenRouter 設定
audience: 使用中文輸入法、希望設定一次後長期使用 AI 的單機 Mac 使用者
purpose: 讓命名操作可被找到、組字不被程式打斷，並讓金鑰保存方式與實際權限行為一致
visual-language: 延續墨色實心控制；命名在原位置完成，安全狀態以直接文字而非系統術語表達
mode: preserve
visual-variance: 2
motion-intensity: 2
information-density: 5
asset-dependence: 1
brand-fidelity: 10
```

- board naming：白板標題旁直接提供重新命名；編輯、Enter 儲存、Esc 取消皆在原位置完成。
- IME：輸入法 composition 期間只更新畫面草稿，不寫回資料庫；候選字完成後才保存中文結果。
- key storage：改用澄境資料目錄內的 AES-256-GCM 加密檔與 0600 權限本機密鑰，不呼叫 macOS 鑰匙圈。
- security copy：清楚說明「不明碼、不進備份、不跳鑰匙圈」，同時承認本機帳號遭完整讀取時的安全邊界。
- connection health：設定頁提供不消耗模型額度的 OpenRouter 官方 `/api/v1/key` 驗證，區分金鑰無效、逾時、模型不存在與網路中斷。

## 2026-08-26 三主題無邊框與視覺焦距

```text
Design Read:
artifact: 澄境淺色、深色與墨色三套完整主題
audience: 長時間閱讀繁體中文、對低對比暗色介面容易視覺疲勞的使用者
purpose: 保留無邊框的高級感，同時讓背景、工作面、內容面與控制面具有可立即對焦的層次
visual-language: 實心色階、清晰文字、留白分組；不用輪廓框、玻璃模糊或霓虹描邊代替資訊階層
mode: overhaul
visual-variance: 3
motion-intensity: 2
information-density: 5
asset-dependence: 1
brand-fidelity: 10
```

- palette：三主題都建立 canvas／surface-1／surface-2／surface-3 的明確感知亮度階梯；墨色提高相鄰面的亮度差與次要文字清晰度。
- borderless：主要卡片、面板、日誌紙張、設定區、側欄、頂欄與右面板不使用裝飾性邊框；表單輸入仍以實心底色和 focus ring 表達可操作性。
- focus：正文與次要資訊不用 opacity 製造層級，改用已量測的實際文字色；重要標題維持溫暖非純白。
- depth：一般內容不使用陰影；只有真正覆蓋其他內容的 modal、context menu 與拖曳浮層保留陰影。
- ink clarity：墨色關閉 backdrop-filter 與半透明混色，改成不透光實心墨面，避免整個畫面像隔著霧。

## 2026-08-26 五語介面

```text
Design Read:
artifact: 澄境完整桌面介面、原生選單、日期與分享檢視器
audience: 使用繁體中文、简体中文、English、日本語或한국어的單機知識工作者
purpose: 在不碰觸使用者筆記內容的前提下，讓所有操作、狀態與系統回饋完整切換語言並永久記住
visual-language: 保留既有無邊框材質；以語言長度彈性、原生字型回退與不換行控制維持五語一致
mode: extension
visual-variance: 2
motion-intensity: 2
information-density: 5
asset-dependence: 1
brand-fidelity: 10
```

- scope：翻譯導覽、工具列、右鍵、對話框、設定、空狀態、通知、日期、AI 提示與分享頁；使用者內容不自動翻譯。
- default：既有使用者維持繁體中文；語言選擇存入本機 UI 設定，重啟後保留。
- typography：字型依序支援 PingFang TC／SC、Hiragino Sans、Apple SD Gothic Neo 與通用系統字型；最小 12px 規則不變。
- layout：英文與韓文較長標籤允許彈性寬度；高頻工具保持圖示加短標籤，窄視窗依既有響應式規則收合。
- AI：系統提示與產生內容語言跟隨介面語言，但不翻譯送入模型的原始卡片。
- native：Electron 應用選單與儲存／匯入對話框使用目前介面語言；品牌名「澄境 ChengJing」維持不翻譯。

## 2026-08-26 GitHub 半自動更新

```text
Design Read:
artifact: 啟動更新提示、下載進度、完成說明與設定頁版本區
audience: 希望保持最新版、但不希望 App 未經同意自行覆蓋的單機 Mac 使用者
purpose: 把版本資訊、更新內容、下載驗證與 macOS 手動覆蓋流程濃縮成一次清楚決定
visual-language: 實心無邊框對話框、單一主動作、可讀 Release notes、明確進度與完成指示
mode: extension
visual-variance: 2
motion-intensity: 2
information-density: 5
asset-dependence: 1
brand-fidelity: 10
```

- consent：啟動時只檢查公開 GitHub Release；下載必須由使用者按下「下載並手動更新」。
- hierarchy：版本號與更新內容先於下載按鈕；下載期間鎖定離開操作，避免產生重複下載。
- integrity：下載完成後驗證檔案大小與 GitHub SHA-256 digest，通過才交由 macOS 開啟。
- handoff：完成畫面只說明「拖入應用程式並確認覆蓋」，不假裝 App 能繞過 macOS 自行替換。
- settings：設定頁保留目前版本、GitHub 最新版、啟動自動檢查狀態與立即檢查入口。

## 2026-08-26 全域標籤生命週期

```text
Design Read:
artifact: 卡片、白板、日誌、隻言片語標籤選擇器與資料庫標籤管理
audience: 需要在不同內容型態間維持一致分類語意的個人知識工作者
purpose: 讓套用、新增、重新命名、合併與移除成為一套可預期且全域同步的標籤流程
visual-language: 無邊框實心選單、低彩度圓點、原位輸入、右鍵管理與明確危險動作
mode: extension
visual-variance: 2
motion-intensity: 1
information-density: 5
asset-dependence: 1
brand-fidelity: 10
```

- shared source：所有內容引用同一筆 TagRecord；重新命名不複製文字，而是更新共同來源。
- quick create：每個「＋標籤」選單底部都有新增入口，支援 IME、Enter 與點擊外部保存。
- removal：全域移除前清楚說明影響範圍，確認後清除卡片、白板、日誌與片語引用。
- merge：重新命名為既有名稱時自動合併 ID，避免同名標籤分裂。
- cursor：可編輯正文使用文字游標；畫布選取仍維持箭頭，連線工具才使用十字游標。
