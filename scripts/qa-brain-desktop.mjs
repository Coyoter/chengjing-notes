import { _electron as electron } from "playwright";
import electronPath from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const data = await fs.mkdtemp(path.join(os.tmpdir(), "chengjing-brain-desktop-"));
const client = await electron.launch({ executablePath: electronPath, args: ["."], env: { ...process.env, CHENGJING_SMOKE: "1", CHENGJING_SMOKE_USER_DATA: data } });
try {
  const page = await client.firstWindow();
  await page.locator(".app-shell").waitFor();
  const helper = process.env.CHENGJING_TYPESAFE_HELPER;
  if (helper) {
    const { collectBrowserState, executeBrowserAction } = await import(path.join(helper, "src/browser-accelerator.mjs"));
    const { chooseBrowserAction, checkResult } = await import(path.join(helper, "src/decision-engine.mjs"));
    const before = await collectBrowserState(page, { goal: "開啟第二大腦", maxCandidates: 35 });
    const state = { ...before, actions: before.actions.filter((action) => action.name === "第二大腦") };
    const choice = await chooseBrowserAction({ state });
    if (choice.candidate) await executeBrowserAction(page, choice);
    else await page.getByRole("button", { name: "第二大腦", exact: true }).click();
    await page.waitForFunction(() => Number(document.querySelector(".second-brain-page")?.getAttribute("data-brain-nodes")) > 0);
    const after = await collectBrowserState(page, { goal: "確認第二大腦已顯示神經元" });
    const checked = await checkResult({ state: { goal: "確認第二大腦已顯示神經元", after, evidence: { nodes: Number(await page.locator(".second-brain-page").getAttribute("data-brain-nodes")) } } });
    console.log(JSON.stringify({ decisionUsage: choice.usage, verificationUsage: checked.usage, verification: checked.status }));
  } else {
    await page.getByRole("button", { name: "第二大腦", exact: true }).click();
    await page.waitForFunction(() => Number(document.querySelector(".second-brain-page")?.getAttribute("data-brain-nodes")) > 0);
  }
  const nodes = Number(await page.locator(".second-brain-page").getAttribute("data-brain-nodes"));
  assert.ok(nodes > 0); assert.ok(page.url().startsWith("file:"));
  console.log(JSON.stringify({ productionFileProtocol: true, backgroundWorkerReadRealDatabase: true, nodes }));
} finally { await client.close(); await fs.rm(data, { recursive: true, force: true }); }
