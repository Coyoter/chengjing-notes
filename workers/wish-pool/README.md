# 澄境社群 Worker

同一個 Worker 同時服務許願池與「共享大腦」。許願池資料按 UTC 月份分流到 SQLite Durable Objects；共享身分、共享神經元、回聲、通知與檢舉放在 D1，使用索引游標與五分鐘探索候選池，不會為每位使用者掃描整張表。

## API

- `GET /v1/wishes`：每次最多 20 則願望，每則先帶最新 3 則回覆。
- `POST /v1/wishes`：以統一共享身分新增願望；舊版 App 的匿名格式仍向下相容。
- `GET /v1/wishes/:id/replies`：按需載入較舊回覆。
- `POST /v1/wishes/:id/replies`：新增匿名或管理員回覆。
- `POST /v1/admin/login`：管理員登入，回傳 12 小時短期簽章。
- `GET /v1/admin/status`：驗證目前管理員簽章。
- `DELETE /v1/wishes/:id`、`DELETE /v1/replies/:id`：管理員刪除。
- `POST/GET/PATCH /v1/community/identity`：建立、驗證或重新命名共享身分；同名可共存，身分印記與密鑰不因改名而變。
- `GET /v1/community/neurons/discover`：每五分鐘最多 20 顆摘要，每位作者最多 2 顆；不回傳完整內文。
- `POST /v1/community/neurons`、`PATCH/DELETE /v1/community/neurons/:id`：共享、同步或永久刪除單顆神經元。
- `POST /v1/community/neurons/:id/fork`：建立仍為共享狀態的獨立副本並保留來源。
- `GET/POST /v1/community/neurons/:id/comments`：按需讀取或留下回聲。
- `GET /v1/community/notifications`：只增量讀取自己神經元收到的新回聲，不提供輪詢。
- `POST /v1/community/reports`、`GET/PATCH /v1/admin/community/reports`：檢舉與既有管理員簽章共用的處理佇列。

## 儲存與額度策略

- 探索只讀取索引化的 `sample_key` 候選，禁止 `ORDER BY RANDOM()` 全表掃描。
- 相同資料中心、五分鐘 epoch 與 pool 共用 Cache API 候選；用戶點開前不讀完整內文或回聲。
- 關閉「探索共享大腦」時，App 不發探索請求；啟動通知每天／每次啟動只做一次增量查詢。
- 私人神經元與陌生共享神經元在 App 內為兩個資料層；陌生內容不會進入 AI 整理、索引或今日反思。

## Secrets

正式環境需要兩個 Cloudflare Secrets，值不得放進 GitHub：

- `WISH_ADMIN_PASSWORD`
- `WISH_SIGNING_SECRET`

另外需要 D1 資料庫 `chengjing-community`，綁定名稱為 `COMMUNITY_DB`。首次部署前執行：

```bash
pnpm exec wrangler d1 migrations apply chengjing-community --remote
```

## 驗證與部署

```bash
pnpm install
pnpm run cf-typegen
pnpm test
pnpm run check
pnpm run dry-run
pnpm run deploy
```
