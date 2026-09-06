# 澄境 0.10.0-dev.3 — Android、Mac、Windows 同步測試版

跨平台開發測試版，尚未上架 Google Play；不取代 Mac／Windows v0.9.5 穩定版。

## 這次更新

- Google 同步改為自動處理：首次合併本機與雲端的不同筆資料，同一筆內容自動採用最新修改，不再要求日常選版本。
- 原有資料沿用原修改時間，避免第一次按同步時把所有本機內容誤認成最新。截止日期不影響新舊判斷。
- 較早的並發內容保留在收起的「復原同步前的內容」，只供誤刪／覆蓋救援；復原需確認，目前內容也會保留。
- 改善 Android 桌面圖示資源配置，標準與圓形圖示指向同一個置中的澄境標誌。
- 手機白板支援雙指縮放，包括從卡片上開始手勢；保留單指移動畫布／物件、點選連線及編輯。兩指縮放時不拖走卡片。
- 更新入口區分 GitHub 與未來 Google Play 建置；Play 版不引導外部 APK 更新。本次仍為 GitHub 安裝版。

## 安裝與同步

下載 `ChengJing-0.10.0-dev.3-Android.apk`，直接覆蓋安裝先前測試版，**不要先解除安裝**。Android 9 或更新版本；本機 AI 是否可用仍視裝置能力而定。

停筆約 5 秒、回到 App、恢復連線時會嘗試同步；開啟期間每分鐘檢查。Android 背景工作會補送已暫存的變更，但受省電與系統排程影響，下次開啟會接續。

**Google 雙向同步需要各裝置使用本次相容同步版。舊桌面 v0.9.5 只有快照備份，不能直接當成雙向同步客戶端。** 此 Release 同時提供 Apple Silicon Mac DMG、Windows ARM64 與 Intel／AMD x64 安裝包，沿用相同的同步及舊內容救援規則。備份快照仍與日常同步分開，本地與 Google 備份可以同時使用。

這不是多人即時逐字合寫。同一篇離線修改採較新版本，較早內容供本機救援；裝置時間不正確仍可能影響並發排序，建議保持系統自動日期時間。

完整真機、本機 AI、長時間大資料與所有背景限制情境尚未完成驗收；Windows 安裝包經封裝與架構檢查，未於 Windows 真機重跑本輪全部操作。請先保留獨立備份，再參與測試。詳見 [Android 說明](https://github.com/Coyoter/chengjing-notes/blob/v0.10.0-dev.3/ANDROID.md)。

---

# ChengJing 0.10.0-dev.3 — Android, Mac and Windows sync preview

Cross-platform development prerelease, not a Google Play release. The stable Mac/Windows release remains v0.9.5.

## Changes

- First sync combines independent local and cloud items. Concurrent changes to the same item now use the latest modification automatically, without routine version-choice prompts.
- Initial publication preserves original timestamps. Task deadlines are never used to determine which edit is newer.
- Earlier concurrent content is retained in a collapsed local recovery section. Restoration requires confirmation and preserves the current content as well.
- Standard and round launcher resources now resolve to the same centered ChengJing emblem.
- Mobile whiteboards support two-finger pinch zoom, including gestures starting over a card. Single-finger canvas/node dragging, tap-to-connect, and editing remain available; pinching does not move the card.
- Direct and future Play builds have separate update destinations; Play builds do not direct users to external APK updates. This release is the GitHub edition.

## Install and sync

Install `ChengJing-0.10.0-dev.3-Android.apk` over the previous test build. **Do not uninstall first.** Requires Android 9 or later; local AI availability depends on device capability.

Sync is attempted after approximately five seconds without edits, on resume/reconnection, and every minute while open. Android background work retries staged uploads subject to OS scheduling and power restrictions; pending changes resume on the next launch.

**Bidirectional Google sync requires the compatible builds in this release on every device. Older desktop v0.9.5 supports snapshot backups only.** This release includes Apple Silicon Mac, Windows ARM64, and Intel/AMD x64 installers using the same sync and earlier-content recovery rules. Snapshot backups remain separate from everyday sync; local and Google backups can be used together.

This is item-level sync, not real-time collaborative text merging. Older concurrent content is kept for local recovery. Incorrect device clocks can affect concurrent ordering; automatic system date/time is recommended.

Full physical-device, local-AI, large-data, and background-lifecycle acceptance remains incomplete. Windows packages receive packaging and architecture checks, not a full physical-Windows retest of all workflows. Keep an independent backup before testing. See [Android details](https://github.com/Coyoter/chengjing-notes/blob/v0.10.0-dev.3/ANDROID.md).
