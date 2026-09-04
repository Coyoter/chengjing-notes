本次更新修正 0.8.0 備份設定中 Google 登入按鈕沒有顯示的問題。

- 原因是內嵌的完整按鈕 PNG 損壞，只留下透明點擊區；這與 Google OAuth 正式發布或 Brand Verification 審查狀態無關。
- 登入入口改成由澄境直接繪製的中性膠囊按鈕，搭配 Google 官方本機 SVG 彩色 G 與清楚的五語文字，不再依賴整張 PNG。
- 按鈕保留 40px 高度、鍵盤焦點、低調 hover 與 disabled 狀態；即使圖示意外失效，文字按鈕仍然可見。
- 新增實際圖片載入、尺寸、顏色、文字與連結前視覺截圖驗收，避免只驗證點擊功能而漏掉不可見狀態。

Windows 提供 ARM64 與 Intel／AMD x64 安裝程式；Mac 提供 Apple Silicon DMG。Release 只包含這三個正式安裝檔。

---

## English

This update fixes the missing Google connection button in the backup settings introduced in 0.8.0.

- A damaged embedded full-button PNG left only a transparent click target. This was unrelated to OAuth production publishing or Brand Verification status.
- ChengJing now draws the neutral pill button itself and uses Google's official local SVG color G with clear localized text instead of relying on a full-button PNG.
- The button retains its 40px height, keyboard focus, restrained hover treatment, and disabled state. Its text remains visible even if the icon ever fails.
- Visual QA now verifies the actual icon load, dimensions, colors, text, and a pre-connection screenshot instead of checking click behavior alone.

Windows installers are available for ARM64 and Intel/AMD x64. An Apple Silicon DMG is available for Mac. The Release contains only these three installers.
