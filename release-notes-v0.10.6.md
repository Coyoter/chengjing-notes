## 澄境筆記 0.10.6

- 修正 AI 助理要求清空工作內容時，因工具名稱或參數格式不同而出現 `ai-write-tool-invalid` 的問題。
- 支援常見的工具欄位別名、巢狀 function／tool 格式與 JSON 字串參數；不猜測或擴大刪除範圍。
- 工作區工具的輸出規格明確要求工具名稱與參數。格式仍不完整時，執行前只嘗試一次修復；失敗則不變更資料，並提供可理解的提示。
- 已用真正的 Gemini 3.8 Flash 與隔離測試資料，驗證「清空當前所有內容」流程；沒有使用或刪除使用者既有資料。

保留 0.10.5 的 Google 解除綁定、待辦三天淡出、封存／垃圾桶、批次清空與電腦側欄排序功能。

Android APK 適用 GitHub APK 安裝來源；Google Play 版可能有不同簽章，請勿為了覆蓋安裝而直接解除安裝、遺失本機資料。本次 GitHub 發布不代表 Google Play 已更新。

---

## ChengJing Notes 0.10.6

- Fixed AI workspace clearing failing with `ai-write-tool-invalid` when a model used a different tool-call shape.
- Accepts common field aliases, nested function/tool calls and JSON-encoded arguments without guessing or widening deletion scope.
- The workspace action schema now requires a tool name and arguments. Incomplete calls get one pre-execution repair attempt; unsuccessful repairs leave data unchanged and show a readable message.
- Verified the clear-workspace request with live Gemini 3.8 Flash against isolated synthetic data. No existing user content was used or deleted.

Retains all 0.10.5 features. The GitHub APK may not overwrite a Play installation signed with a different key; do not uninstall without safeguarding local data. This release is not a Google Play rollout.
