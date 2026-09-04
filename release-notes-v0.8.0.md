本次更新把備份重新整理成兩個簡單選項：「Google 雲端」與「本地」，兩者可以同時使用。

- Google 雲端備份預設每 30 分鐘在澄境開啟且閒置時執行；內容沒有改變就不會重複上傳。
- 雲端固定保留目前版本，以及前一天最後一份救援點；超過 48 小時的舊救援資料會自動清理。
- 「緊急復原前一天」預設收合並與日常操作明顯分開，只供重要資料誤刪、錯誤內容又已同步時使用。
- 緊急復原會再次警告，並在覆蓋前先保留一份本機安全副本。
- 新裝置或另一台裝置更新雲端後，澄境會暫停上傳並要求明確選擇，不會靜默互相覆蓋。
- 附件依內容去重，只上傳一次；本機 Gemma 模型、OpenRouter 金鑰與 Google 授權憑證都不會進入備份。
- Google 權限只限澄境自己的隱藏 App Data，不能查看使用者 Google Drive 裡的其他檔案。
- macOS Google 登入不會再呼叫鑰匙圈或要求輸入系統密碼；Windows 使用不跳提示的系統 DPAPI。

Windows 提供 ARM64 與 Intel／AMD x64 安裝程式；Mac 提供 Apple Silicon DMG。Release 只保留三個正式安裝檔。

---

## English

This release simplifies backup into two clear choices—Google Cloud and Local—and both can run at the same time.

- Google cloud backup runs every 30 minutes by default, only while ChengJing is open and idle. Unchanged content is not uploaded again.
- The cloud keeps the current snapshot plus the last rescue point from the previous day. Rescue history older than 48 hours is removed automatically.
- “Emergency restore previous day” is collapsed and separated from everyday controls. It is only for recovering from an accidental deletion that has already synced.
- Emergency restore warns again and creates a local safety copy before replacing current data.
- On a new device, or when another device has updated the cloud, ChengJing pauses upload and asks before replacing anything.
- Attachments are deduplicated by content and uploaded only once. The local Gemma model, OpenRouter key, and Google authorization token are excluded.
- Google access is limited to ChengJing’s own hidden App Data and cannot read any other file in the user’s Drive.
- Google sign-in on macOS does not invoke Keychain or request the system password. Windows uses silent DPAPI protection.

Windows installers are available for ARM64 and Intel/AMD x64. An Apple Silicon DMG is available for Mac. The Release contains only these three installers.
