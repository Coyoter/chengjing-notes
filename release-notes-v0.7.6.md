本次更新修正本機 Gemma 在 Windows 與 Mac 上處理摘要時可能異常緩慢、最後超過 60 秒停止的問題。

- 回補 [Transformers.js 官方 PR #1681](https://github.com/huggingface/transformers.js/pull/1681)，讓 Gemma 4 WebGPU 生成正確保留 `num_logits_to_keep=1`。
- 修正前會替提示詞內每個 token 計算完整 262,144 詞彙 logits；數百字內容也可能產生數百倍多餘運算。
- 修正後只計算生成下一個 token 所需的最後一組 logits，不以縮短卡片、摘要輸出或對話能力掩蓋問題。
- 既有 Gemma 4 模型檔不必重新下載；更新應用程式後即可沿用原本的本機模型快取。
- 新增安裝、測試、正式 bundle 與 ONNX feed 四層驗證，避免上游套件更新後修正悄悄失效。

Windows 仍分別提供 ARM64 與 Intel／AMD x64 安裝程式；Mac 提供 Apple Silicon DMG。Release 只保留三個正式安裝檔。
