這次集中改善長期使用的穩定性、資料完整性與效能。

- 復原／重做只記錄成功提交的資料操作；背景維護不再干擾使用者的操作紀錄。
- Markdown 匯出不再遺失同名筆記；復原前驗證備份並保存本機安全副本，附件也會先驗證再還原。
- 移除附件後可在本次使用期間正常復原；下次啟動清理仍未被引用的待移除檔案。
- MCP 追加筆記保留原有格式，修改檢查與寫入一次完成；新增子待辦會同步母項目。
- 搜尋補上單字元、全半形、長文尾端與大量候選後面的符合項目；待辦數量與垃圾桶狀態一致。
- 第二大腦在靜止時按需繪製，減少持續重畫；鏡頭操作、選取及動畫保持正常。
- 自訂 Provider 新增「試送訊息」驗證模型回答，並清楚區分設定拒絕、授權、額度與服務錯誤。
- 中途切換內容或 Provider 時，舊 AI 請求不再影響新畫面，也不會在重試時切換傳送目的地。
- Google 雲端備份與更新索引補強衝突檢查及備援資料保留。

提供 Apple Silicon Mac、Windows ARM64 與 Windows Intel／AMD x64 三個安裝檔。

---

## English

This release improves reliability, data integrity, and performance for long-term use.

- Undo and redo record committed changes only, and background maintenance no longer interferes with user history.
- Markdown exports preserve notes with duplicate titles. Restore validates backups, keeps a local safety copy, and verifies attachments before restoring them.
- Removed attachments remain recoverable during the current session; unreferenced pending files are cleaned up on the next launch.
- MCP appends preserve formatting. Conflict checks and updates are atomic, and child tasks correctly update their parents.
- Search covers single characters, normalized text, long-note tails, and matches beyond earlier candidate limits. Task counts respect trash state.
- The Second Brain renders on demand when idle, retaining camera interaction, selection, and animations.
- Custom providers gain Test a reply and distinct configuration, authorization, quota, and server errors.
- Switching context or providers no longer lets old AI requests affect the new view or change destination during retries.
- Cloud backup conflict checks and update-index fallback retention are strengthened.

Includes three installers: Apple Silicon Mac, Windows ARM64, and Windows Intel/AMD x64.
