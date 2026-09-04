本次更新精簡 Google 登入按鈕的留白。

- 移除不必要的固定最小寬度，直接刪除文字右側多餘空白，不把空白重新分配到兩側。
- 按鈕依五種語言的內容自然決定寬度，保留可見 G 前方 12px、圖文之間 10px、文字後方 12px。
- 繁中 120% 介面下實測寬度 166.05px、右距 12px、額外未使用寬度 0px，圖示與文字垂直中心誤差皆為 0px。
- Google OAuth 已是 Production；Brand Verification 是否通過只影響 Google 授權頁的品牌顯示，不會停用備份或登入功能。

Windows 提供 ARM64 與 Intel／AMD x64 安裝程式；Mac 提供 Apple Silicon DMG。Release 只包含這三個正式安裝檔。

---

## English

This update tightens the spacing of the Google connection button.

- It removes the unnecessary fixed minimum width and eliminates the extra blank space after the label instead of redistributing that space to both sides.
- The button follows the natural width of each of the five interface languages while keeping 12px before the visible G, 10px between the icon and label, and 12px after the label.
- At 120% interface scale, the Traditional-Chinese button measures 166.05px wide with a 12px right inset, zero unused width, and zero vertical-center error for both icon and text.
- Google OAuth is already in Production. Brand Verification only affects branding on Google's authorization screen and does not disable backup or sign-in functionality.

Windows installers are available for ARM64 and Intel/AMD x64. An Apple Silicon DMG is available for Mac. The Release contains only these three installers.
