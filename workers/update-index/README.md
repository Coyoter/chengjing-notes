# 澄境更新索引 Worker

這個 Cloudflare Worker 只提供澄境最新版的輕量 JSON 索引，不代理 DMG，也不保存任何使用者資料。

可靠性順序：

1. Cloudflare KV 先提供全球最後可靠版本，版本號同時作為各資料中心的快取世代。
2. 15 分鐘 Cloudflare 邊緣新鮮快取；KV 版本變更後舊世代不再命中。
3. GitHub Releases REST API。
4. API 無法使用時會保留 KV 中最後一次驗證成功的版本，不要求 Release 額外放置校驗檔。
5. 同一邊緣節點保留 24 小時的最後成功回應，但會先和 KV 比較並選擇較新版本。
6. Cloudflare KV 全球保留 30 天；相同版本每 7 天續期，不會因長時間沒有新版而自然消失。

Worker 只接受 `GET`／`HEAD /v1/latest`。每份可下載資料都必須包含 GitHub 安裝檔網址與平台提供的 digest；拿不到校驗值時不會把未驗證的新資料覆蓋到最後可靠版本。

常用指令：

```bash
npm install
npm run cf-typegen
npm test
npm run check
npm run dry-run
npm run deploy
```
