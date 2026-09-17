import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import type { AppLanguage } from "../types";
import type { SyncRecord } from "../lib/syncProtocol";
import { SyncRecoverySection } from "./SyncRecoverySection";
import { SyncConflictReview } from "./SyncConflictReview";
import { CloudBackupImport } from "./CloudBackupImport";

vi.mock("../db", () => ({ db: {} }));
vi.mock("../hooks/useI18n", () => ({
  useI18n: () => ({ language: "zh-TW" }),
}));

function render(children: ReactNode, language: AppLanguage = "zh-TW") {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <article className="backup-method-card cloud-method sync-settings" id="sync-settings">
      <SyncRecoverySection language={language}>{children}</SyncRecoverySection>
    </article>,
  );
  return host;
}

const languages: Array<[AppLanguage, string]> = [
  ["zh-TW", "版本復原"],
  ["zh-CN", "版本恢复"],
  ["en", "Version recovery"],
  ["ja", "バージョンの復元"],
  ["ko", "버전 복원"],
];

for (const [language, title] of languages) {
  it(`uses the localized recovery heading for ${language}`, () => {
    const host = render(<p>content</p>, language);
    expect(host.querySelector(".sync-recovery > summary b")?.textContent).toBe(title);
  });
}

it("is one collapsed disclosure inside the Google Sync card, not a separate feature card", () => {
  const host = render(<p>tools</p>);
  expect(host.querySelectorAll(".backup-method-card")).toHaveLength(1);
  const details = host.querySelector("#sync-settings > details.sync-recovery");
  expect(details).not.toBeNull();
  expect(details?.hasAttribute("open")).toBe(false);
  expect(details?.querySelector(":scope > summary")).not.toBeNull();
  expect(details?.querySelector(":scope > .sync-recovery-content")?.textContent).toBe("tools");
});

it("keeps decorative icons separate from the wrapping text and hides them from accessibility names", () => {
  const host = render(<p>tools</p>);
  const summary = host.querySelector(".sync-recovery > summary")!;
  expect(summary.children).toHaveLength(3);
  expect(summary.children[0].tagName.toLowerCase()).toBe("svg");
  expect(summary.children[1].classList.contains("sync-recovery-label")).toBe(true);
  expect(summary.children[2].tagName.toLowerCase()).toBe("svg");
  expect(summary.children[0].getAttribute("aria-hidden")).toBe("true");
  expect(summary.children[2].getAttribute("aria-hidden")).toBe("true");
});

it("contains both existing recovery and legacy migration as collapsed subordinate tools", () => {
  const record: SyncRecord = {
    id: "fragments:sample",
    heads: [{
      id: "current", table: "fragments", key: "sample", clock: { current: 1 },
      changedAt: 2, value: { id: "sample", text: "current content" },
    }],
    recovery: [{
      id: "earlier", table: "fragments", key: "sample", clock: { other: 1 },
      changedAt: 1, value: { id: "sample", text: "earlier content" },
    }],
  };
  const host = render(
    <>
      <SyncConflictReview records={[record]} language="zh-TW" />
      <CloudBackupImport />
    </>,
  );
  expect(host.querySelectorAll(".sync-recovery-content > .sync-conflict-review")).toHaveLength(1);
  expect(host.querySelectorAll(".sync-recovery-content > .backup-import-tools")).toHaveLength(1);
  expect(host.querySelectorAll("details[open]")).toHaveLength(0);
  expect(host.textContent).toContain("個別內容的較早版本");
  expect(host.textContent).toContain("舊版 Google 備份搬移");
  expect(host.textContent).not.toContain("復原同步前的內容");
});

it("removes the standalone legacy migration entry from SettingsView", () => {
  const settings = readFileSync(resolve(process.cwd(), "src/views/SettingsView.tsx"), "utf8");
  const sync = readFileSync(resolve(process.cwd(), "src/components/SyncSettings.tsx"), "utf8");
  expect(settings).not.toContain("CloudBackupImport");
  expect(sync).toContain("<SyncRecoverySection language={language}");
  expect(sync).toContain("<CloudBackupImport");
  expect(sync).toContain("</SyncRecoverySection>");
});
