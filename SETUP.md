# 澄境開發環境與 macOS 測試指南

這個專案不是 Swift／Xcode 專案。主要技術是：

- React + TypeScript：畫面與大部分應用功能
- Vite：開發伺服器與前端 production build
- Electron：把前端放進 macOS／Windows 桌面視窗，並提供檔案、選單列、IPC 等系統能力
- Vitest／Node test：單元與模組測試
- Playwright：操作實際畫面與 Electron 的 QA
- electron-builder：產生可執行的 macOS `.app` 與發佈用 `.dmg`

macOS 快速記錄功能另有一個 Objective-C + AppKit/Carbon helper，但建置腳本會自動呼叫 `xcrun clang` 編譯，不必把整個 repo 匯入 Xcode。

## 先建立一個心智模型

```text
src/ React + TypeScript
          │
          ▼
   Vite 開發伺服器（http://127.0.0.1:5173）
          │
          ▼
electron/main.cjs 建立原生桌面視窗並載入該網址
          │
          ├── electron/preload.cjs：安全地把部分桌面能力提供給 React
          └── macOS helper：全域快捷鍵與原生快速輸入窗
```

開發模式下，Electron 載入 Vite 的本機網址；production build 則載入 `dist/index.html`。因此 Vite 不是另一個 App，而是 Electron 視窗裡那套前端介面的開發與打包工具。

## macOS 前置需求

正式安裝包目前支援 Apple Silicon Mac。Intel Mac 可以嘗試本機開發，但不是目前正式發佈目標。

1. 安裝 Xcode Command Line Tools：

   ```bash
   xcode-select --install
   xcrun --find clang
   ```

   第二行能印出 clang 路徑就代表原生 helper 的編譯工具已就緒。完整 Xcode App 不是必要條件。

2. 安裝 Node.js 與 npm。

   README 記錄的已驗證版本是 Node `24.18.1`。建議使用 Node 24，以減少版本差異。目前 `package.json` 尚未用 `engines` 或 `.nvmrc` 強制版本。

   ```bash
   node --version
   npm --version
   ```

3. 在 repo 根目錄安裝鎖定版本的套件：

   ```bash
   npm ci
   ```

   `npm ci` 依照 `package-lock.json` 做乾淨、可重現的安裝，適合第一次設定與 CI。日後刻意新增或升級 dependency 時才使用 `npm install <package>`。

   這個 repo 以 `package-lock.json` 和 README 的 npm 指令為準。不要在同一份 checkout 交替執行 `npm install` 與 `pnpm install`；兩者的 lockfile 和 `node_modules` 佈局不同，混用可能讓已安裝的套件暫時無法解析。

## 第一次執行：`npm run dev`

```bash
npm run dev
```

npm 會先自動執行同名的 `predev`，再執行 `dev`。

### `predev` 做什麼

1. 準備 Google OAuth runtime 設定；開發模式下沒有憑證也可以繼續，只是 Google Drive 備份不可用。
2. 套用專案需要的 Gemma/Transformers 修補。
3. 複製 ONNX Runtime 瀏覽器資產。
4. 呼叫 `xcrun clang` 編譯 macOS 快速記錄 helper，並先跑 helper self-test。

### `dev` 做什麼

它用 `concurrently` 同時管理兩個程序：

```text
vite --host 127.0.0.1
wait-on http://127.0.0.1:5173 && electron . --dev
```

- Vite 在 `127.0.0.1:5173` 啟動前端開發伺服器。
- `wait-on` 等到 Vite 確實可以連線，避免 Electron 太早啟動而看到空白頁。
- `electron . --dev` 讀取 `package.json` 的 `main`，所以主程序入口是 `electron/main.cjs`。
- `--dev` 讓 Electron 載入 Vite 網址，而不是 production 的 `dist/index.html`。
- 修改 `src/` 的 React/CSS 後，Vite 通常會自動熱更新。
- 修改 `electron/` 主程序後，通常要停止並重新執行 `npm run dev`。
- 在 terminal 按 `Ctrl+C` 會停止整組開發程序。

`npm run dev` 是日常開發入口，不會生成 `.app` 或 `.dmg`。

## 建議驗證順序

### 1. TypeScript 型別檢查

```bash
npm run typecheck
```

這會執行 TypeScript compiler 的檢查，但不輸出 App。它能提早發現錯誤型別、缺少欄位與不相容的函式呼叫。

### 2. 快速自動測試

```bash
npm test
```

這一層會：

- 確認 Gemma/Transformers 修補仍正確
- 用 Vitest + jsdom 測試 `src/`
- 用 Node test 測試 `electron/*.node.cjs`

它比 GUI QA 快，適合每次修改後先執行。

### 3. 建立 production 前端

```bash
npm run build
```

執行順序是：

1. `prebuild` 再次準備修補、ONNX 資產與 macOS helper。
2. `tsc -b` 做型別檢查。
3. `vite build` 把 React/TypeScript/CSS 等資產最佳化並輸出到 `dist/`。
4. 驗證 production bundle 仍包含必要的 Gemma 修補。

這只建立網頁資產與 helper，還沒有封裝成 `.app`。

### 4. 測試 production build

```bash
npm run smoke:electron
npm run smoke:electron-main
```

- `smoke:electron` 載入 `dist/index.html`，檢查 UI、preload bridge、本機加密、WebGPU 與部分外部網路端點。
- `smoke:electron-main` 啟動真正的 Electron main process，並用 Playwright 經由 Chromium DevTools Protocol 操作畫面。
- smoke scripts 使用臨時 user-data 目錄，結束後會清除，較不容易污染日常資料。
- 部分 smoke/QA 會連到 OpenRouter、許願池或其他外部服務；完全離線時不一定能通過。

## Playwright 與瀏覽器安裝

許多 `scripts/qa-*.mjs`、`electron-main-smoke.mjs`，以及打包前會用到的 `scripts/build-icon.mjs` 都直接 import `playwright`。本分支已將它正式加入 `devDependencies`；執行 `npm ci` 就會安裝 Node package。

Playwright 使用的 Chromium binary 另外存放在使用者 cache，第一次設定還要執行：

```bash
npx playwright install chromium
```

`npm run icons` 使用 Playwright 啟動 headless Chromium，把 HTML/CSS/SVG 圖示渲染成 1024px PNG；接著由 Sharp 產生各尺寸，最後在 macOS 用 `iconutil` 組成 `build/icon.icns`。因此 Playwright 不只供 QA 使用，也是目前打包流程的必要建置依賴。

Playwright 安裝完成後，可先跑最小範圍：

```bash
npm run build
npm run smoke:electron-main
```

再逐步執行：

```bash
npm run qa
npm run qa:functional
```

不必第一次就跑 README 裡所有 `qa:*`；其中有些是特定功能、外部服務或已封裝 App 的驗收。

## macOS App：不必先生成 DMG

macOS 測試可以分四層：

| 層級 | 指令／產物 | 適合測什麼 |
| --- | --- | --- |
| 開發模式 | `npm run dev` | 日常功能、UI、快速迭代 |
| Production renderer | `npm run build` 後跑 smoke | 最佳化後的前端與 Electron 整合 |
| 未封裝安裝器的 App | electron-builder `--dir`，產生 `.app` | 真正 packaged App、資源路徑、選單列、helper |
| DMG | `npm run dist:mac` | 拖曳安裝、簽章、Gatekeeper、發佈檔案 |

所以，一般 macOS App 測試不需要建立或安裝 DMG。

### 官方 `.app` 建置入口

```bash
npm run dist:dir
```

它會建立 production build，再以 electron-builder 的 directory 模式輸出未包成 DMG 的 `.app`。不需要安裝，直接從 `release/` 內開啟即可。

找出實際產物：

```bash
find release -name '*.app' -type d -prune -print
```

注意：目前 `dist:dir` 和 `dist:mac` 都會以 `--required` 檢查 Google OAuth credential。如果沒有 credential，會在封裝前停止。

### 沒有 Google OAuth、只想做本機 `.app` 測試

先確認已解決上一節的 Playwright dependency 缺口，再明確略過官方發佈前置檢查。以下指令請逐行執行，確認前一行成功後才執行下一行：

```bash
npm run icons
npm run build
npx electron-builder --mac --dir
```

這會產生可直接執行的 `.app`，但 Google Drive 登入／備份不會是有效的發佈設定，因此只能視為本機工程測試產物。

如果把多行指令一起貼進一般 shell，前一行失敗時，後面的行預設仍可能繼續執行。這種情況下即使看到 `.app`，也可能用了 repo 中既有的舊 icon；不要把它當成有效的乾淨建置結果。

### 對 packaged `.app` 跑測試

部分腳本接受 `CHENGJING_PACKAGED_APP`，值必須是 `.app` 內真正的 executable，而不是 `.app` 目錄本身。先找 executable：

```bash
find release -path '*.app/Contents/MacOS/*' -type f -print
```

再執行，例如：

```bash
CHENGJING_PACKAGED_APP="/絕對路徑/澄境.app/Contents/MacOS/澄境" npm run smoke:electron-main
```

### 何時才需要 DMG

只有要測以下項目時才需要：

- 使用者開啟 DMG、把 App 拖到「應用程式」的流程
- DMG 內容與圖示
- 簽章、notarization、Gatekeeper 與 quarantine 行為
- 最終 Release artifact 名稱與架構

建立 DMG：

```bash
npm run dist:mac
```

目前專案使用 ad-hoc 簽章，尚未做 Apple Developer ID notarization；正式散佈時仍可能需要到「系統設定 → 隱私權與安全性」選擇 Open Anyway。

## 建議第一次完整操作

```bash
# 1. 檢查工具
xcrun --find clang
node --version
npm --version

# 2. 安裝依賴與 Playwright 的 Chromium
npm ci
npx playwright install chromium

# 3. 開發執行；確認基本功能後按 Ctrl+C
npm run dev

# 4. 快速品質檢查
npm run typecheck
npm test
npm run build

# 5. icons 與 GUI QA 都需要 Playwright
npm run icons
npm run smoke:electron-main

# 6. 需要測 packaged App 時才建立 .app
npm run dist:dir

# 7. 準備發佈／安裝流程時才建立 DMG
npm run dist:mac
```

## 常見問題

### 為什麼不是用 Xcode Run？

因為 App 主體是 Electron。Xcode 不理解 npm scripts、Vite HMR 與 Electron 的打包流程。只有深入修改 macOS 原生 helper 時，才可能單獨使用 Xcode/LLDB 協助除錯 Objective-C。

### `npm start` 和 `npm run dev` 有什麼不同？

- `npm run dev`：啟動 Vite，Electron 載入開發網址，有前端熱更新。
- `npm start`：Electron 直接載入既有的 `dist/index.html`；應先執行 `npm run build`。

### `.app` 和 `.dmg` 是什麼關係？

`.app` 才是可以執行的 macOS 應用程式 bundle；`.dmg` 是用來運送／安裝 `.app` 的磁碟映像。測 App 本身用 `.app` 即可，測發佈體驗才需要 `.dmg`。

### 修改 React 後為何會自動更新，修改 Electron 卻不會？

Vite 監看 `src/` 並提供 Hot Module Replacement。Electron main process 是另一個 Node/Electron 程序，目前的 `dev` script 沒有替它設定自動重啟。
