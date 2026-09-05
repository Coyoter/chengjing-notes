import { _electron as electron } from "playwright";
import electronPath from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

for (const failure of [false, true]) {
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-quit-"));
  const reportFile = path.join(data, "report.json");
  const client = await electron.launch({ executablePath: electronPath, args: ["scripts/qa-backup-quit-bootstrap.cjs", "--dev"],
    env: { ...process.env, CHENGJING_SMOKE: "0", CHENGJING_SMOKE_USER_DATA: data, QA_QUIT_REPORT: reportFile, QA_QUIT_FAIL: failure ? "1" : "0" } });
  try {
    let page;
    for (let attempt = 0; attempt < 100 && !page; attempt++) {
      page = client.windows().find((candidate) => candidate.url().startsWith("http://127.0.0.1:5173") && !candidate.url().includes("quick-capture"));
      if (!page) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(page, "main window must load");
    await page.locator(".app-shell").waitFor();
    await page.getByRole("button", { name: "卡片庫", exact: true }).click();
    await page.locator(".library-card").first().click();
    await page.locator(".prose-editor").fill("quit-final-edit");
    const closed = client.waitForEvent("close", { timeout: 20_000 });
    await page.evaluate(() => window.chengjing.app.quit());
    await closed;
    const report = JSON.parse(await fs.readFile(reportFile, "utf8"));
    assert.equal(report.includedLastEdit, true);
    assert.equal(report.dialogs, failure ? 1 : 0);
    assert.ok(report.writes >= (failure ? 2 : 1));
    console.log(JSON.stringify({ failureThenRetry: failure, ...report }));
  } finally { await client.close().catch(() => {}); await fs.rm(data, { recursive: true, force: true }); }
}
