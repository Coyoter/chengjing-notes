import "fake-indexeddb/auto";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { createCard, db } from "../db";
import { permanentlyDeleteTrashItems } from "./trash";
import { cardInDatabaseScope } from "./databaseScope";
beforeAll(() => db.open());
beforeEach(() => db.transaction("rw", db.tables, () => Promise.all(db.tables.map(table => table.clear()))));

it("deletes beyond the visible page but never active, archived or newly restored cards", async () => {
  const active = await createCard({ title: "Active" });
  const archive = await createCard({ title: "Archived", state: "archived" });
  const cards = [];
  for (let i = 0; i < 205; i++) cards.push(await createCard({ title: `Trash ${i}`, state: "trash" }));
  await db.cards.update(cards[0].id, { state: "active" });
  const result = await permanentlyDeleteTrashItems([...cards.map(card => card.id), active.id, archive.id]);
  expect(result.deleted).toBe(204);
  expect(await db.cards.count()).toBe(3);
  expect(await db.cards.get(cards[0].id)).toBeDefined();
  expect(cardInDatabaseScope(archive, "archive")).toBe(true);
  expect(cardInDatabaseScope(archive, "all")).toBe(false);
  expect(cardInDatabaseScope(active, "trash")).toBe(false);
});

it("keeps attachments shared with surviving cards and removes dangling links", async () => {
  const keep = await createCard({ title: "Keep", attachmentIds: ["shared"] });
  const trash = await createCard({ title: "Trash", state: "trash", attachmentIds: ["shared", "exclusive"] });
  await db.attachments.bulkAdd([{ id: "shared", name: "shared", mime: "text/plain", size: 1, createdAt: 1 }, { id: "exclusive", name: "exclusive", mime: "text/plain", size: 1, createdAt: 1 }]);
  await db.brainEdges.add({ id: "link", sourceType: "card", sourceId: keep.id, targetType: "card", targetId: trash.id, origin: "manual", createdAt: 1 });
  await permanentlyDeleteTrashItems([trash.id]);
  expect(await db.attachments.get("shared")).toBeDefined();
  expect(await db.attachments.get("exclusive")).toBeUndefined();
  expect(await db.brainEdges.count()).toBe(0);
});
