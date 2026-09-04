這次更新讓澄境能安全連接外部 AI 工具，也讓進階使用者自由選擇自己的模型服務。

- 新增本機 MCP：Codex、Claude Code 與其他相容工具可以搜尋、讀取，以及依你選擇新增或修改筆記、待辦、白板、看板與神經元關係。
- MCP 預設關閉，開啟後預設唯讀；也可以改成每次寫入前由澄境詢問，或明確允許持有權杖的工具直接寫入。
- 設定頁可直接複製 Codex 設定或 Claude Code 指令。連線只綁定這台電腦的 `127.0.0.1`，不會公開到區域網路或網際網路。
- MCP 使用獨立加密權杖、Host／Origin 驗證與請求大小限制；可隨時更換權杖，讓舊設定立即失效。
- MCP 不提供永久刪除。修改既有內容前必須比對最新版本，避免覆蓋同時發生的編輯；每次外部寫入也能在澄境復原。
- 新增自訂 AI Provider，可保存並切換多組 OpenAI 相容 Gateway 或本機 Ollama。Ollama 預設使用 `http://127.0.0.1:11434/v1`。
- 自訂 Provider 支援模型清單、連線測試與現有 AI 問答／動作計畫。遠端位址必須使用 HTTPS；API Key 加密留在本機，不進入備份。
- 兩項進階功能都收在低干擾、可展開的設定面板；五種語言、120% 大字、正式封裝 App、正式 MCP Client 與大型資料回歸均已通過。

Windows 提供 ARM64 與 Intel／AMD x64 安裝程式；Mac 提供 Apple Silicon DMG。Release 只包含這三個正式安裝檔。

---

## English

This release gives ChengJing secure local connections to external AI tools and lets advanced users choose their own model service.

- Local MCP lets Codex, Claude Code, and other compatible tools search and read ChengJing, then create or update notes, tasks, whiteboards, kanban boards, and neuron relationships at the access level you choose.
- MCP is off by default and starts in read-only mode. You can instead have ChengJing confirm every write or explicitly allow token-holding tools to write directly.
- Settings can copy a complete Codex configuration or Claude Code command. The server binds only to `127.0.0.1` on this computer and is never exposed to the LAN or internet.
- MCP uses a separate encrypted token, Host and Origin validation, and a request-size limit. Replacing the token immediately invalidates earlier configurations.
- Permanent deletion is not exposed. Updates require the latest item version to prevent silent overwrites, and each external write becomes one undoable ChengJing action.
- Custom AI providers support multiple OpenAI-compatible gateways and local Ollama connections. Ollama defaults to `http://127.0.0.1:11434/v1`.
- Provider model discovery, connection testing, normal AI chat, and action planning are supported. Remote URLs require HTTPS; API keys stay encrypted locally and are excluded from backups.
- Both advanced features use quiet, expandable settings panels. Five languages, 120% text scale, the packaged app, a real MCP client, and large-data regressions have been verified.

Windows installers are available for ARM64 and Intel/AMD x64. An Apple Silicon DMG is available for Mac. The Release contains only these three installers.
