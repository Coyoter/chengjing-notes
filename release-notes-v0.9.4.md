第二大腦現在能適應不同 OpenRouter 模型的結構化輸出差異。

- 修正 Gemini 3.8 Flash 一般聊天正常、整理神經元連結卻因上游 Provider 拒絕完整 JSON Schema 而失敗的問題。
- 澄境會依模型能力自動嘗試 JSON Schema、JSON 物件與純 JSON 指令；不論採用哪一種方式，結果都會在本機驗證後才寫入。
- DeepSeek 等推理型模型使用較低的推理強度，把輸出空間留給正式答案；第一次輸出確實不完整時，才以較大額度修復一次。
- 接受 `connections`、`links`、`relations`、`edges`、`from`、`to` 等常見差異，也能正規化關係名稱、百分比信心值與證據物件。
- 模型拒絕 `reasoning` 或 `temperature` 時只移除該選填參數；空白回覆會改走另一個可用 Provider 路徑重試一次，不會無限制重送。
- 已用真實 OpenRouter 請求驗證 Gemini 3.8 Flash 與 DeepSeek V4 Flash 0731；兩者都能從同一份 40 筆合成資料建立 12 條有效連結。
- 第一次切換左側功能時，會依游標或鍵盤意圖預先準備該功能；準備完成前保留目前工作區，不再閃出整頁讀取畫面，也不會為此在啟動時載入全部功能。
- 第二大腦重用文字斷詞與日期格式工具，關鍵字直接累計而不建立重複陣列；完整資料與舊神經元搜尋能力維持不變。

提供 Apple Silicon Mac、Windows ARM64 與 Windows Intel／AMD x64 三個安裝檔。

---

## English

The Second Brain can now adapt to structured-output differences across OpenRouter models.

- Fixes a case where Gemini 3.8 Flash worked in normal chat but its upstream provider rejected the full JSON Schema used for neuron-link organization.
- ChengJing automatically tries JSON Schema, JSON object mode, and a plain JSON instruction as needed. Every result is still validated locally before it can be saved.
- Reasoning models such as DeepSeek use a lower reasoning effort so the final answer receives more output room. A larger repair request is made only when the first response is genuinely incomplete.
- Accepts common variations such as `connections`, `links`, `relations`, `edges`, `from`, and `to`, while normalizing relation names, percentage confidence values, and evidence objects.
- If a model rejects optional `reasoning` or `temperature` settings, only that setting is removed. An empty response gets one alternate-provider retry instead of an unbounded loop.
- Live OpenRouter checks confirmed that Gemini 3.8 Flash and DeepSeek V4 Flash 0731 each produced 12 valid links from the same synthetic 40-neuron dataset.
- Sidebar hover or keyboard focus now prepares a view before navigation. The current workspace remains visible until the new code is ready instead of flashing a full-page loading skeleton, without eagerly loading every feature at startup.
- The Second Brain reuses text segmenters and date formatters and counts keywords without a duplicate array, preserving the complete data and old-neuron search scope.

Includes three installers: Apple Silicon Mac, Windows ARM64, and Windows Intel/AMD x64.
