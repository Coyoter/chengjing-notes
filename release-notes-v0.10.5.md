## 澄境 0.10.5

- AI 助理新增「先預覽／直接執行」模式，可依指令批次新增、修改、刪除與整理工作內容。
- 移除 40 個動作的截斷限制；支援分頁研究、長文字分段讀取與多輪批次計畫。
- 桌面 MCP 補上批次刪除、完整內容讀取、標籤、分類與表格屬性操作；既有連線權杖與權限選擇保留。
- 修正整批操作可能只保存前半段、刪除後殘留私人關聯，以及永久清空後重新出現示範資料的問題。
- Android Google 授權拒絕空憑證，保存需要重新授權的狀態，並提供重新連結入口。
- Google 同步新增「解除 Google 綁定」：停止這台裝置的同步並清除本機憑證，保留筆記、待同步內容與雲端資料，不撤銷其他裝置的授權。
- 已完成待辦在第二大腦逐漸淡出，完成滿 3 天後隱藏；待辦紀錄仍保留，重新開啟待辦會重新顯示。舊資料沒有完成時間時，以原有最後修改時間推估。
- 資料庫新增封存與垃圾桶分類；卡片庫及資料庫的垃圾桶都可一次永久清空，確認時會列明項目數。
- 電腦版左側主要功能支援拖曳排序及 Alt＋↑／↓ 鍵盤排序，重新開啟後保留；手機導覽維持原樣。

直接執行模式需自行開啟。已分享內容的修改或永久刪除，可能隨原有共享同步更新公開副本；復原依賴仍可用的歷史或備份，不是無條件保證。

Android APK 適用既有 GitHub APK 安裝來源。若手機目前安裝 Google Play 版，簽章可能不同，不能直接覆蓋；請勿為了更新直接解除安裝而遺失本機資料。本次 GitHub 發布不等於 Google Play 已更新，也不宣稱所有裝置的 Google 登入均已驗收。

---

## ChengJing 0.10.5

- Added Preview first / Run directly for AI workspace actions, including batch creation, editing, deletion and organization.
- Removed silent truncation after 40 actions; added paginated research, chunked text reads and multi-round plans.
- Expanded desktop MCP with batch deletion, full text access, tags, categories and database properties while preserving authentication and user-selected access modes.
- Fixed partially committed batches, dangling private graph links and demo content reappearing after permanent clearing.
- Android rejects empty Google tokens, records identifiable reauthorization requirements and offers reconnection.
- Added Unlink Google account: stops sync and removes this device's saved credentials while preserving local notes, pending changes and cloud data, without revoking authorization on other devices.
- Completed tasks gradually fade from Second Brain and disappear after three days, without deleting task records. Reopening a task brings it back. Legacy records without a completion timestamp use their existing last-modified time as an estimate.
- Added Archive and Trash scopes to Database. Both Library and Database offer one-action permanent trash clearing with a count confirmation.
- Desktop primary navigation supports drag-and-drop and Alt + Up/Down reordering, remembered across restarts. Mobile navigation is unchanged.

Direct execution is opt-in. Existing shared-brain synchronization may propagate edits or permanent deletion to published copies. Recovery depends on available history or backups.

The APK upgrades installations from the GitHub APK channel. Google Play installations may use a different signing certificate; do not uninstall merely to replace them without safeguarding local data. This GitHub release does not indicate a Google Play rollout or verified Google sign-in on every device.
