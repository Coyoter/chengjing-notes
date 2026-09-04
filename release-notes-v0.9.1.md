這次小更新加入 Responses API，並重新整理持續變長的設定頁；功能沒有刪除，只讓當下需要的選項更容易找到。

- 自訂 AI Provider 的每組連線都能獨立選擇 Chat Completions 或 Responses API；既有連線維持原模式。
- Responses 模式使用 `/responses`、`input`、`instructions` 與 `max_output_tokens`。遠端 Gateway 固定使用 `store: false`；Ollama 使用官方支援的非狀態式模式。
- 同時解析頂層 `output_text` 與巢狀 output content；結構化輸出不相容時仍會安全降級重試。
- 設定頁頂端新增八個快速錨點，可前往語言、AI、外部整合、更新、快速記錄、外觀、備份與打賞。
- AI 設定依目前引擎整理：OpenRouter 模型只在選中時自動展開，自訂 Provider 也是；Gemma 4 只顯示本機模型。
- 未選設定仍可手動展開，模型同步、路由模式、金鑰、本機模型與所有原有功能完整保留。
- 回答創意度與本機知識搜尋移到清楚的「所有 AI 共用」區，不再混在 OpenRouter 專屬模型設定裡。
- OpenRouter 三個精選模型中的 Gemini 已更新為 `google/gemini-3.8-flash`，另外兩個模型與排列不變。
- 選中引擎使用完整實心控制面；未啟用的 MCP 收成摘要列，從錨點前往時會自動展開。
- 五種語言、120% 大字、錨點首尾移動、三引擎切換、收合／展開與正式 Responses 回覆均已驗證。

Windows 提供 ARM64 與 Intel／AMD x64 安裝程式；Mac 提供 Apple Silicon DMG。Release 只包含這三個正式安裝檔。

---

## English

This small update adds the Responses API and reorganizes the growing Settings page. No capability was removed; the controls relevant to the current choice are simply easier to find.

- Every custom provider can independently use Chat Completions or the Responses API. Existing profiles keep their original mode.
- Responses mode uses `/responses`, `input`, `instructions`, and `max_output_tokens`. Remote gateways always receive `store: false`; Ollama uses its officially supported stateless flow.
- ChengJing parses both top-level `output_text` and nested output content, with the existing safe fallback when structured output is unsupported.
- Eight compact anchors jump to Language, AI, Integrations, Updates, Quick capture, Appearance, Backup, and Support.
- AI settings follow the selected engine: OpenRouter models open automatically only for OpenRouter, Custom provider opens only when selected, and Gemma 4 shows its local model controls.
- Inactive settings remain manually accessible. Model sync, routing, keys, local-model management, and every existing feature are preserved.
- Creativity and local knowledge search now live in a clearly labeled shared-AI group instead of an OpenRouter-only section.
- Gemini in the three featured OpenRouter models is now `google/gemini-3.8-flash`; the other two presets and their order are unchanged.
- The selected engine uses a coherent solid control surface; disabled MCP collapses to a summary and expands automatically when reached from its anchor.
- Five languages, 120% text scale, first-to-last anchor navigation, three-engine switching, disclosure controls, and real Responses output have been verified.

Windows installers are available for ARM64 and Intel/AMD x64. An Apple Silicon DMG is available for Mac. The Release contains only these three installers.
