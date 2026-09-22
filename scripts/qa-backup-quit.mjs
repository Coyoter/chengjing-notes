import { _electron as electron } from "playwright";
import electronPath from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

for (const scenario of ["success", "retry", "cancel", "quit", "local-only"]) {
  const failure = !["success", "local-only"].includes(scenario);
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-quit-"));
  const reportFile = path.join(data, "report.json");
  const allowFile = path.join(data, "allow-sync");
  const client = await electron.launch({ executablePath: electronPath, args: ["scripts/qa-backup-quit-bootstrap.cjs", "--dev"],
    env: { ...process.env, CHENGJING_SMOKE: "0", CHENGJING_SMOKE_USER_DATA: data, QA_QUIT_REPORT: reportFile, QA_QUIT_FAIL: failure ? "1" : "0", QA_QUIT_CHOICE: scenario, QA_QUIT_ALLOW_FILE: allowFile } });
  try {
    let page;
    for (let attempt = 0; attempt < 100 && !page; attempt++) {
      page = client.windows().find((candidate) => candidate.url().startsWith("http://127.0.0.1:5173") && !candidate.url().includes("quick-capture"));
      if (!page) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(page, "main window must load");
    await page.locator(".app-shell").waitFor();
    // The isolated profile has local backups disabled. This must not skip editor
    // flushing or Google sync on quit. Enable the sync journal only for this fixture.
    await page.evaluate(enabled => {
      if (enabled) localStorage.setItem("chengjing-sync-enabled", "true");
    }, scenario !== "local-only");
    await page.getByRole("button", { name: "卡片庫", exact: true }).click();
    await page.locator(".library-card").first().click();
    await page.locator(".prose-editor").fill("quit-final-edit");
    const closed = client.waitForEvent("close", { timeout: 30_000 });
    await page.evaluate(() => window.chengjing.app.quit());
    if (scenario === "cancel") {
      for (let attempt = 0; attempt < 100; attempt++) {
        const intermediate = await fs.readFile(reportFile, "utf8").then(JSON.parse).catch(() => null);
        if (intermediate?.dialogs === 1) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const persisted = await page.evaluate(async () => {
        const { db } = await import("/src/db.ts");
        return { saved: (await db.cards.toArray()).some(card => card.plainText.includes("quit-final-edit")), pending: await db.table("syncOutbox").count() };
      });
      assert.equal(persisted.saved, true);
      assert.ok(persisted.pending > 0, "cancel keeps outgoing changes queued");
      await fs.writeFile(allowFile, "allow");
      await page.evaluate(() => window.chengjing.app.quit());
    }
    await closed;
    const report = JSON.parse(await fs.readFile(reportFile, "utf8"));
    assert.equal(report.includedLastEdit, !["quit", "local-only"].includes(scenario));
    assert.equal(report.dialogs, failure ? 1 : 0);
    if (scenario === "cancel") assert.ok(report.writes >= 2);
    else assert.equal(report.writes, scenario === "local-only" ? 0 : scenario === "retry" ? 2 : 1);
    assert.equal(report.legacyWrites, 0);
    console.log(JSON.stringify({ scenario, ...report }));
  } finally { await client.close().catch(() => {}); await fs.rm(data, { recursive: true, force: true }); }
}
