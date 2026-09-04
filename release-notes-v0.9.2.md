這次小更新修正兩個實際使用時會立刻注意到的問題。

- 「快速前往」不再撐滿整個設定頁；外框會在最後一個「打賞」按鈕後自然結束，不留下大片無作用的右側空白。
- 窄視窗仍可橫向滑動查看全部八個入口，鍵盤操作、平滑定位與自動展開功能不變。
- 某些 Responses API 模型不接受選填的 `temperature`。遇到服務明確拒絕時，澄境現在會自動省略後重試，不再把它誤報為網址、模型或服務失效。
- 支援 `temperature` 的模型仍會使用原本的「回答創意度」；不支援的 Provider／模型在本次開啟期間會記住相容方式，後續對話不再重複失敗。
- 自訂 Provider 的加密金鑰、`store: false`、完整對話內容、Responses 結構化輸出與所有原有設定均維持不變。

Windows 提供 ARM64 與 Intel／AMD x64 安裝程式；Mac 提供 Apple Silicon DMG。Release 只包含這三個正式安裝檔。

---

## English

This small update fixes two issues that were immediately noticeable in real use.

- The Jump to container no longer stretches across the Settings page. It ends naturally after the final Support button without a large unused area.
- Narrow windows retain horizontal access to all eight destinations, with keyboard navigation, smooth scrolling, and automatic disclosure unchanged.
- Some Responses API models reject the optional `temperature` parameter. ChengJing now detects that explicit response and retries without the parameter instead of incorrectly reporting a broken URL, model, or service.
- Models that support `temperature` still honor the Creativity setting. For incompatible provider/model pairs, the current app session remembers the fallback and avoids repeated failed requests.
- Encrypted provider keys, `store: false`, full conversation input, structured Responses output, and every existing setting remain unchanged.

Windows installers are available for ARM64 and Intel/AMD x64. An Apple Silicon DMG is available for Mac. The Release contains only these three installers.
