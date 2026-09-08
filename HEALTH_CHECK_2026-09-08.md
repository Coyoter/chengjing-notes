# 澄境健檢：AI／MCP 與 Android Google 授權

基準：`v0.10.4`／`536a9c4`，`android-workstation`。這是程式碼修正與測試報告，不是新的安裝包或 Google Play 上架完成證明。

## 結論

公司提出的問題大致值得處理，但不能全部當成登入失敗的直接原因。APK 簽章、手機實際安裝來源及 Google Cloud 設定，必須獨立驗證。這次沒有更換登入 SDK、同步格式、資料庫架構或 Google 專案，也沒有清除使用者資料。

## AI 與 MCP：已修正

- 取消 AI 計畫在第 40 個動作後靜默截斷；長筆記內文不再被解析器偷偷截短。
- 助理可分頁讀取工作內容、分段讀取長文字、累積研究筆記及多輪動作。不把初始 80／100 筆目錄樣本當成整個工作區。模型、網路與每次請求仍有實際容量和時間限制；分頁／分段不是總資料權限上限。
- 支援按明確 ID、某類全部內容或全部私人工作內容批次刪除。不需要模型逐筆抄出所有 ID。卡片可移到垃圾桶，也可明確指定永久刪除資料紀錄。
- MCP 增加 `chengjing_list_records`、`chengjing_action_schema`、`chengjing_apply_actions`、`chengjing_delete_items`、`chengjing_manage_metadata`、`chengjing_update_fields`。
- 同一套操作可用於助理及桌面 MCP：筆記／日誌、待辦、片語、白板節點與連線、看板、神經元關聯、標籤／知識分類／劃記，以及筆記表格屬性。不新增 Android MCP 伺服器。
- 助理新增可記住的「先預覽／直接執行」。選直接執行後，明確的修改要求可自動套用，不再要求逐批按套用；純分析和能力詢問不會自動修改資料。升級不擅自替既有使用者開啟此模式。
- MCP 原有唯讀／逐次詢問／允許修改三種選擇保留；允許修改可直接執行批次。沒有默默打開 MCP 服務、改變既有權限設定、取消權杖或暴露到外部網路。
- 同一批寫入包含待辦連動，後段失敗會一併回滾；不再先存筆記／白板，後面處理待辦失敗卻留下半批結果。單條無法識別的白板關係線仍沿用既有的明確略過回報，不冒充已建立。
- 刪除白板／片語時同步移除私人神經元關聯。全部永久刪除卡片改為單次蒐集關聯，避免每刪一張都重新掃描全部卡片。
- 永久清空後不會在下次啟動重新塞入示範資料。
- 對話收據保存失敗，不會讓已經套用的計畫留在畫面上供再次執行、重複建立內容。

### 「清空」與復原的實際邊界

`workspace` 指工作內容與分類，不包括帳戶、金鑰、對話、同步追蹤資料或既有救援點。刪除不會掃除電腦或手機上的任意檔案。**已分享內容的修改或永久刪除，會由原有 SharedBrainSyncManager 嘗試同步到公開副本**；本次保留原有行為，不能保證公開副本不受影響，也不會把本機成功冒稱成遠端已移除。

批次永久刪除的是資料紀錄；附件實體檔暫時保留供復原，不以此功能清理磁碟。當次應用的 Undo 不等於永久備份：歷史只保留在執行中的應用，並有 50 次操作保留範圍。關閉後的救援須依賴仍有效且含完整內容的備份／版本復原，不能承諾所有 AI 誤操作一定救得回。

## 公司六項建議的判斷

| 建議 | 核對結果與處理 |
| --- | --- |
| 1. 空 token 也可能回報成功 | **確認。已修正。** 互動登入、非互動授權及背景工作共用檢查；null、空字串、純空白都不會保存成成功授權。 |
| 2. 登入狀態只看本機 token | **局部成立，不能推論每次同步都沒有更新授權。** 原本前景同步的 `list` 以及雲端 `getStatus` 會先執行 `google.refresh`。現在已知需要重新授權時，即使還留有舊 token，也不會回報 connected。沒有為每次畫面重繪增加網路驗證；遠端可用性仍由實際授權／同步結果確認。 |
| 3. 中斷連線沒有撤銷 Google 授權 | **實作觀察正確，但不是必然錯誤。** 暫停／中斷本機同步和撤銷帳戶授權要區分。本次保留本機中斷語意，沒有偷偷撤銷整個應用的授權。Google 官方指出 `revokeAccess` 會撤銷該使用者先前授予此應用的所有 scopes，不只是傳入的 scope。若增加「移除此帳戶授權」，應另作明確動作。 |
| 4. 背景工作沒有 AUTH_REQUIRED | **確認。已修正可辨識的需要互動授權情況。** `hasResolution`、空 token、Google 的 SIGN_IN_REQUIRED／RESOLUTION_REQUIRED 會保存狀態並結束當次工作，保留待傳資料。原版 `hasResolution` 是直接 failure，不是先重試。網路錯誤維持重試，不誤判成撤銷授權。前景提供重新連結入口。 |
| 5. OAuth JSON 不參與建置檢查 | **確認。已補本地建置檢查。** release 前核對 package、scope、client 記錄與實際本地簽章。這不代表連上 Google Cloud 查驗 client，也不把 AAB 上傳金鑰當成 Play 安裝版金鑰。 |
| 6. 缺少發布簽章交叉確認 | **合理。部分自動化，外部核對仍未完成。** 本地簽章已對上記錄；本次沒有下載並重驗 GitHub APK、提取使用者手機 APK 或重新核對 Play／Cloud 頁面。公司提供的 APK 及 Play 指紋是交接證據，不能冒稱本次真機驗證。 |

官方依據：[Google Android 授權與撤銷](https://developer.android.com/identity/authorization)、[Android 應用程式簽章](https://developer.android.com/studio/publish/app-signing)。

## 還需要注意，但不在這次偷偷重寫

- **長期同步紀錄累積**：現有同步封包、操作歷史與救援紀錄仍需要有協定相容性的壓縮／保留策略。這是真正值得後續量測的成長風險，不能直接刪除舊雲端封包來「優化」。
- **授權快取與真機恢復**：SDK token 到期、撤銷後的 HTTP 401、程序被殺後 WorkManager、斷網再連線，需要實際 Play 與 GitHub 安裝版的測試。Google 官方建議無效 token 清除 SDK 快取後再取授權；本次不把所有網路／HTTP 錯誤誤分類為 AUTH_REQUIRED，也不宣稱撤銷與快取所有路徑都完成真機驗收。
- **大資料的模型判斷**：讀取能力已開放，但不能保證任何模型在任何資料量下都能給出正確分析。新增／修改仍必須符合資料格式與既有關聯；這不是刪減業務權限。
- **工作區舊有畫面**：這次只對新增模式與受影響流程做介面檢查，不宣稱全應用所有頁面與所有真機都通過。
- **發布來源**：本次起點的 `main` 仍是 v0.10.0，最新發布基準在 `android-workstation`／v0.10.4。不要把未更新的 main 當成本次修正基準。

## 驗證範圍

- TypeScript 檢查及正式前端建置。
- Vitest 與 Electron Node 測試：包含批次 120／125 筆、超過初始目錄的查詢、長文分段讀回、跨模組操作、錯誤整批回滾、同步刪除紀錄、Undo、清空後不重建示範資料、標籤／表格屬性與不合法欄位拒絕。
- Android JVM 單元測試及 `verifyGoogleOAuthSigning`；未安裝或解除安裝使用者手機上的應用。
- `qa-ai-actions.mjs`：隔離瀏覽器，檢查既有白板、卡片轉白板、日誌、待辦連動、預覽取消、垃圾桶、Undo／Redo 等流程。
- `qa-ai-permissions.mjs`：隔離瀏覽器及模擬模型，自動新增 120 筆、能力詢問不刪資料、預覽不寫入、批次刪除與復原、390px Android 版面／44px 操作高度。桌面與手機截圖已人工檢視。
- **以上模型測試使用模擬回覆，不代表已向每個真實模型或 Google 帳戶發出端到端測試。**

## Design Read

```text
artifact: AI 面板執行模式小控制
audience: 希望自主決定 AI 操作權限的筆記使用者
purpose: 在保留預覽的同時提供直接執行
visual-language: 既有墨色工具介面與單一青綠狀態
mode: preserve
visual-variance: 1
motion-intensity: 1
information-density: 5
asset-dependence: 1
brand-fidelity: 10
```

沿用既有 palette／系統字體／4px 間距與 6px 控制圓角，不新增卡片層或陰影。模式控制採 Lucide 圖示加短文字、160ms 色彩轉換、鍵盤焦點與 reduced-motion；手機維持至少44px點擊高度。

## English summary

Based on v0.10.4, this change expands built-in AI and desktop MCP workspace access with paginated reads, chunked text, multi-round planning, batch operations, metadata editing and explicit permanent record deletion. A persistent Preview first / Run directly control lets users opt into automatic execution. Existing MCP authentication, loopback binding and user-selected access modes remain intact.

AI writes and linked task changes now commit together. Failed batches roll back; explicit skips remain reported. Workspace clearing preserves accounts, conversations, sync bookkeeping and recovery data. Existing shared-brain synchronization may update or remove published copies when their local sources change or are permanently deleted; local completion is not proof of remote completion. Undo is session-local, not an unconditional recovery guarantee.

Android rejects missing/blank tokens, records identifiable reauthorization requirements and exposes reconnection. Release builds verify the local signing certificate against the OAuth record. Local disconnect is not silently converted into account-wide revocation.

Automated and isolated-browser checks do not establish real-device Play/GitHub sign-in success. Installed certificate verification, Google Cloud/Play configuration checks, token-cache recovery and long-term sync-log compaction remain explicitly separate follow-up work. No user data was cleared and no website changes were made.
