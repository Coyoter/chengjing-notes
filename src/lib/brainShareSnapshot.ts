import type { db } from "../db";
import type { AppLanguage } from "../types";
import { intlLocale } from "../i18n";
import { journalBrainTitle, type BrainNodeView } from "./brain";
import { isVisibleCard } from "./cardVisibility";
import { cardAsFragment, isCaptureCard } from "./captureModel";
import { getTaskIntegrationCopy, taskCopyFormat } from "./taskIntegrationCopy";

type ShareDatabase = Pick<typeof db, "transaction" | "cards" | "tasks" | "boards" | "boardNodes" | "fragments">;

/** The working graph contains excerpts. Read the full source once, before the public-share preview. */
export async function readBrainShareSnapshot(database: ShareDatabase, node: BrainNodeView, language: AppLanguage): Promise<BrainNodeView | null> {
  return database.transaction("r", [database.cards, database.tasks, database.boards, database.boardNodes, database.fragments], async () => {
    if (node.type === "card") {
      const card = await database.cards.get(node.id);
      return isVisibleCard(card) ? { ...node, title: card.kind === "journal" ? journalBrainTitle(card, language) : card.title, text: card.plainText, updatedAt: card.updatedAt } : null;
    }
    if (node.type === "board") {
      const board = await database.boards.get(node.id);
      if (!board) return null;
      const looseText = (await database.boardNodes.where("boardId").equals(board.id).toArray()).filter((item) => !item.cardId).map((item) => item.title || item.text || "").filter(Boolean).join("\n");
      return { ...node, title: board.title, text: [board.description, looseText].filter(Boolean).join("\n"), updatedAt: board.updatedAt };
    }
    if (node.type === "fragment") {
      const direct = await database.cards.get(node.id);
      const card = isCaptureCard(direct) ? direct : await database.cards.where("legacyFragmentId").equals(node.id).first();
      if (card && !isVisibleCard(card)) return null;
      const fragment = card ? cardAsFragment(card) : await database.fragments.get(node.id);
      return fragment ? { ...node, title: fragment.text.slice(0, 36), text: fragment.text, updatedAt: fragment.updatedAt } : null;
    }
    const task = await database.tasks.get(node.id);
    if (!task) return null;
    const source = task.cardId ? await database.cards.get(task.cardId) : undefined;
    if (task.cardId && !isVisibleCard(source)) return null;
    const copy = getTaskIntegrationCopy(language);
    const due = task.dueAt ? new Intl.DateTimeFormat(intlLocale[language], { year: "numeric", month: "short", day: "numeric" }).format(task.dueAt) : "";
    const text = [task.done ? copy.taskDone : copy.taskOpen, source ? `${copy.source}: ${source.title}` : "", due ? taskCopyFormat(copy.due, { date: due }) : copy.noDue].filter(Boolean).join("\n");
    return { ...node, title: task.title, text, updatedAt: task.updatedAt };
  });
}
