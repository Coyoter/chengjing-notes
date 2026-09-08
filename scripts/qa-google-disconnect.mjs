import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const out = "qa-artifacts/google-disconnect";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-TW", colorScheme: "dark" });
  const page = await context.newPage();
  await page.goto(process.env.CHENGJING_URL || "http://127.0.0.1:5199", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const { mount } = await import("/scripts/qa-google-disconnect-fixture.tsx");
    window.__unlinkQa = mount();
    document.documentElement.dataset.platform = "android";
  });
  const control = page.locator(".sync-account-control").last();
  await control.getByRole("button", { name: "解除 Google 綁定", exact: true }).click();
  await control.getByRole("button", { name: "保留連結", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__unlinkQa.calls), 0);
  await control.getByRole("button", { name: "解除 Google 綁定", exact: true }).click();
  const layout = await control.locator(".sync-unlink-confirm").evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return { inViewport: bounds.left >= 0 && bounds.right <= innerWidth, wraps: element.scrollWidth <= element.clientWidth, heights: [...element.querySelectorAll("button")].map(button => button.getBoundingClientRect().height) };
  });
  assert.ok(layout.inViewport && layout.wraps && layout.heights.every(height => height >= 44));
  await page.screenshot({ path: `${out}/mobile-confirmation.png` });
  await control.getByRole("button", { name: "解除綁定", exact: true }).click();
  await control.getByText("已解除 Google 綁定，內容仍保留在這台裝置。", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__unlinkQa.calls), 1);
  assert.deepEqual(await page.evaluate(() => window.__unlinkQa.errors), []);
  await page.screenshot({ path: `${out}/mobile-unlinked.png` });
  console.log(JSON.stringify({ cancelDoesNotDisconnect: true, confirmedOnce: true, layout }));
} finally { await browser.close(); }
