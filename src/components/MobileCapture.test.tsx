import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileCapture } from "./MobileCapture";

const fixture = vi.hoisted(() => ({
  language: "zh-TW",
  fragments: [] as Array<{
    id: string; text: string; createdAt: number; updatedAt: number;
    tagIds: string[]; pinned: boolean;
  }>,
}));

// Render the real mobile component without opening the application's database.
vi.mock("../db", () => ({ createFragment: vi.fn(), db: {} }));
vi.mock("../lib/captureCards", () => ({ captureInboxCards: vi.fn() }));
vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: (_query: unknown, dependencies: unknown[]) =>
    dependencies.length ? fixture.fragments : 0,
}));
vi.mock("../hooks/useI18n", () => ({ useI18n: () => ({ language: fixture.language }) }));
vi.mock("../lib/utils", () => ({ relativeTime: () => "just now" }));
vi.mock("../lib/contextMenu", () => ({ showContextMenuFromButton: vi.fn() }));
vi.mock("./TagPicker", () => ({
  TagPicker: ({ className, selectedIds }: { className: string; selectedIds: string[] }) =>
    <button className={className} data-selected-tags={selectedIds.join(",")}>Tags</button>,
}));

function render() {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<MobileCapture />);
  return host;
}

beforeEach(() => {
  localStorage.clear();
  fixture.language = "zh-TW";
  fixture.fragments = [];
});

for (const language of ["zh-TW", "zh-CN", "en", "ja", "ko"]) {
  describe(`minimal Android capture in ${language}`, () => {
    for (const count of [0, 2, 40]) {
      it(`omits redundant copy and its entire row with ${count} cards`, () => {
        fixture.language = language;
        fixture.fragments = Array.from({ length: count }, (_, index) => ({
          id: `capture-${index}`, text: `Saved thought ${index}`,
          createdAt: 1, updatedAt: 1, tagIds: ["AI"], pinned: false,
        }));
        const host = render();
        const composer = host.querySelector(".mobile-capture-composer");
        const stream = host.querySelector(".mobile-thought-stream");

        expect(host.querySelector(".capture-inbox-note")).toBeNull();
        expect(host.querySelector(".mobile-stream-heading")).toBeNull();
        expect(host.textContent).not.toContain("每則記錄都是卡片");
        expect(host.textContent).not.toContain("最近留下的");
        expect(host.textContent).not.toContain("Every thought is a card");
        expect(host.textContent).not.toContain("Recently captured");
        // No empty heading or replacement wrapper between the composer and cards.
        expect(composer).not.toBeNull();
        expect(stream).not.toBeNull();
        expect(composer?.nextElementSibling).toBe(stream);
        expect(host.querySelectorAll(".mobile-capture-page > *")).toHaveLength(3);

        expect(composer?.querySelectorAll('[role="tab"]')).toHaveLength(2);
        expect(composer?.querySelector('textarea[aria-label]')).not.toBeNull();
        expect(composer?.querySelector(".fragment-draft-tags")).not.toBeNull();
        expect(composer?.querySelector("footer button[aria-label]")).not.toBeNull();
        expect(stream?.querySelectorAll("article")).toHaveLength(count);
        expect(stream?.querySelectorAll(".fragment-item-tags")).toHaveLength(count);
        expect(stream?.querySelectorAll(".mobile-thought-meta button[aria-label]")).toHaveLength(count);
        expect(Boolean(stream?.querySelector(".mobile-capture-empty"))).toBe(count === 0);
        expect(Boolean(stream?.querySelector(".content-load-more"))).toBe(count === 40);
      });
    }
  });
}

it("keeps the existing local draft when rendering the simplified screen", () => {
  localStorage.setItem("chengjing-mobile-draft-fragment", "Unfinished thought");
  const host = render();
  expect(host.querySelector("textarea")?.textContent).toBe("Unfinished thought");
  expect(localStorage.getItem("chengjing-mobile-draft-fragment")).toBe("Unfinished thought");
  expect(host.querySelector(".mobile-capture-composer footer button")?.hasAttribute("disabled")).toBe(false);
});
