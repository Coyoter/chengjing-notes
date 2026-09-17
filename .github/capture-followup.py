from pathlib import Path

def replace(path, old, new):
    p = Path(path)
    s = p.read_text()
    assert s.count(old) == 1, (path, old, s.count(old))
    p.write_text(s.replace(old, new))

replace('src/lib/captureModel.ts', ': card is CardRecord {', ': card is CardRecord & { captureStatus: "unfiled" | "filed" } {')
replace('src/lib/captureCards.test.ts', 'const request = (tool: McpWorkspaceTool, args: Record<string, unknown> = {}) =>', 'const request = (tool: McpWorkspaceTool, args: Record<string, unknown> = {}): Promise<unknown> =>')
replace('src/db.ts', '  const keep = new Set(sorted.slice(0, 30).map((version) => version.id));', '  // Legacy conflicts are recovery records, not disposable editing snapshots.\n  const keep = new Set([...sorted.slice(0, 30), ...sorted.filter((version) => version.legacyFragment)].map((version) => version.id));')
replace('src/lib/captureCards.test.ts', 'restoreCardVersion } from "../db";', 'restoreCardVersion, pruneCardVersions } from "../db";')
replace('src/lib/captureCards.test.ts', 'describe("舊片語安全搬移", () => {', '''describe("舊片語安全搬移", () => {
  it("自動清理版本不會移除舊片語衝突的復原紀錄", async () => {
    const item = await createFragment("Current content");
    const now = Date.now();
    await db.cardVersions.bulkAdd(Array.from({ length: 35 }, (_, i) => ({ id: `edit-${i}`, cardId: item.id, title: "Edit", contentHtml: "<p>edit</p>", plainText: "edit", createdAt: now - i * 1000 })));
    await db.cardVersions.bulkAdd([1, 2, 3].map((i) => ({ id: `legacy-version-${i}`, cardId: item.id, title: "Legacy", contentHtml: "<p>legacy</p>", plainText: "legacy", createdAt: i, legacyFragment: legacy(item.id, `Old content ${i}`) })));
    await pruneCardVersions(item.id);
    expect((await db.cardVersions.where("cardId").equals(item.id).toArray()).filter((v) => v.legacyFragment)).toHaveLength(3);
  });''')

# Dexie adds computed index keys to inserted fixtures; compare all six user data fields.
p = Path("src/lib/captureCards.test.ts")
s = p.read_text()
old = 'expect(cardAsFragment(await card(old.id))).toEqual(old);'
new = 'expect(cardAsFragment(await card(old.id))).toEqual({ id: old.id, text: old.text, pinned: old.pinned, tagIds: old.tagIds, createdAt: old.createdAt, updatedAt: old.updatedAt });'
assert s.count(old) == 2
p.write_text(s.replace(old, new))

replace('README.md', '- 隻言片語：兩三個字即可保存、釘選、修改、複製、轉成卡片、送進白板／看板或第二大腦', '- 隻言片語：輸入即成為未整理卡片，標籤與卡片庫共用；可直接修改、釘選、歸類或加入待辦／白板／看板')

replace('README.en.md', '- Snippets that can be saved, pinned, edited, copied, converted into cards, or sent to a whiteboard, board, or Second Brain', '- Quick captures are unfiled cards from the start, sharing library tags and supporting direct editing, pinning, filing, and task/whiteboard/kanban placement')

replace("scripts/qa-capture-cards.mjs", '    await poll(() => page.evaluate(() => window.__qa.db.kanbanPlacements.count()), 1);\n    await navigate(page, "library"); await page.locator(".library-tag-section > button").filter({ hasText: "AI" }).click();', '    await poll(() => page.evaluate(() => window.__qa.db.kanbanPlacements.count()), 1);\n    await navigate(page, "library"); await page.locator(".mobile-section-picker").click();\n    await page.locator(".library-tag-section > button").filter({ hasText: "AI" }).click();\n    await page.locator(".library-organizer.is-open").waitFor({ state: "detached" });')
