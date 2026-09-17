import { db, finishOrganizingCard, moveCardToKnowledgeGroup, touchBoard } from "../db";
import { placeCardOnKanban } from "./kanban";
import { isActiveCard } from "./cardVisibility";
export type CardDestination = { kind: "topic" | "board" | "kanban"; id: string; listId?: string };

/** Membership, not conversion: every destination points at the same card ID. */
export async function organizeCard(cardId: string, destination: CardDestination) {
  await db.transaction("rw", [db.cards, db.knowledgeGroups, db.boards, db.boardNodes, db.kanbanBoards, db.kanbanLists, db.kanbanPlacements], async () => {
    const card = await db.cards.get(cardId);
    if (!isActiveCard(card) || !destination.id) throw new Error("organize-card-unavailable");
    if (destination.kind === "topic") await moveCardToKnowledgeGroup(cardId, destination.id);
    else if (destination.kind === "kanban") {
      if (!destination.listId || !await db.kanbanBoards.get(destination.id)) throw new Error("organize-destination-missing");
      await placeCardOnKanban(destination.id, destination.listId, cardId);
    } else {
      if (!await db.boards.get(destination.id)) throw new Error("organize-destination-missing");
      const nodes = await db.boardNodes.where("boardId").equals(destination.id).toArray();
      if (!nodes.some(node => node.cardId === cardId)) await db.boardNodes.add({ id: crypto.randomUUID(), boardId: destination.id, kind: "card", cardId, x: 100 + (nodes.length % 3) * 315, y: 100 + Math.floor(nodes.length / 3) * 215, width: 265, height: 190 });
      await touchBoard(destination.id);
    }
    await finishOrganizingCard(cardId);
  });
}
