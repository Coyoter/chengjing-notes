# 澄境 0.10.0

Android、Apple Silicon Mac、Windows ARM64 與 Intel／AMD x64 正式發布。

- Google 跨裝置同步：首次合併本機與雲端資料，同一筆自動採用最新修改；較早的並發內容保留於收起的救援入口。
- 手機白板支援雙指縮放，包含從卡片上開始的手勢；保留單指平移、移動物件、點選連線與編輯。
- Android 採用置中的自適應澄境圖示，介面、導覽、設定與救援入口適配手機使用。
- 手機與電腦共用同步規則；本地／Google 快照備份仍與日常同步分開。

請讓各裝置都使用本次同步相容版本。舊桌面 v0.9.5 只有快照備份，不會自動支援雙向同步。更新時直接覆蓋安裝，不要先解除安裝；建議先保留獨立備份。

Android APK 為 GitHub 直接安裝版。Google Play 上架及審核另行處理，本次正式 Release 不代表已通過 Google Play 審核。Mac 目前仍採 ad-hoc 簽章，Windows 尚未使用商業程式碼簽章。

已知限制：同一篇離線修改採項目層級最新版本，不是逐字協作合併；不正確的裝置時間可能影響並發排序。Android 背景上傳受系統排程限制。全部真機、本機 AI、長期大量資料及所有背景情境尚未完成驗收；Windows 本輪為封裝／架構檢查，不是全功能真機重測。詳見 [驗收記錄](https://github.com/Coyoter/chengjing-notes/blob/v0.10.0/ANDROID_QA.md)。

---

# ChengJing 0.10.0

Release for Android, Apple Silicon Mac, Windows ARM64, and Intel/AMD x64.

- Google cross-device sync combines independent local/cloud items and automatically applies the latest edit to each item. Earlier concurrent content is kept in a collapsed recovery section.
- Mobile whiteboards support two-finger pinch zoom, including over cards, while preserving single-finger panning, node dragging, tap-to-connect, and editing.
- Android uses the centered adaptive ChengJing emblem and mobile-adapted navigation, settings, and recovery controls.
- Mobile and desktop share sync rules. Local/Google snapshot backups remain separate from everyday sync.

Use compatible sync-enabled versions on every device. Older desktop v0.9.5 supports snapshot backups only. Install over the previous version without uninstalling; keep an independent backup first.

The APK is the direct-install GitHub edition. Google Play publication and review are separate; this release does not imply Play approval. macOS remains ad-hoc signed; Windows does not yet use a commercial code-signing certificate.

Known limitations: sync is item-level, not collaborative text merging; incorrect clocks can affect concurrent ordering. Android background work is subject to OS scheduling. Full physical-device, local-AI, large-data, and background-lifecycle acceptance remains incomplete. Windows receives packaging/architecture checks, not a complete physical-device retest. See the [validation record](https://github.com/Coyoter/chengjing-notes/blob/v0.10.0/ANDROID_QA.md).
