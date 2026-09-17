import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (file: string) => readFileSync(path.resolve("src", file), "utf8");
const css = read("./library.css");
const styles = read("./styles.css");
const library = read("./views/LibraryView.tsx");
const picker = read("./components/TagPicker.tsx");

describe("library tag color contract", () => {
  it("uses the same shared tone variable and fallback as TagPicker", () => {
    expect(css).toMatch(/\.library-tag-section\s*>\s*button\s*>\s*i\s*\{[^}]*background:\s*var\(--tone-color,\s*var\(--accent\)\)/);
  });
  it("does not maintain a second, incomplete palette", () => {
    expect(css).not.toMatch(/\.library-tag-section[^{}]*\.tone-[a-z]+/);
  });
  it.each(["jade", "sky", "violet", "rose", "amber", "slate"])("recognizes the existing %s tone without renaming stored colors", (color) => {
    expect(styles).toMatch(new RegExp(`\\.tone-${color}\\s*\\{\\s*--tone-color:`));
  });
  it("renders the persisted color in both the library and shared picker", () => {
    for (const source of [library, picker]) expect(source).toContain('className={`tone-${tag.color}`}');
  });
});
