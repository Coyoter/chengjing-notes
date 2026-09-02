import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useAppStore } from "../store";
import { communityApi, getCommunityIdentity } from "../lib/community";
import { journalBrainTitle } from "../lib/brain";
import { getTaskIntegrationCopy, taskCopyFormat } from "../lib/taskIntegrationCopy";
import { intlLocale } from "../i18n";

interface SyncItem {
  shareId: string;
  remoteId: string;
  title: string;
  body: string;
  sourceUpdatedAt: number;
  shareUpdatedAt: number;
  missing: boolean;
}

/**
 * 共享不是一次性匯出。這個安靜的同步器只在本機來源真的改變或被永久
 * 刪除時呼叫 Worker；平常不輪詢，也不讀取陌生人的內容。
 */
export function SharedBrainSyncManager() {
  const language = useAppStore((state) => state.language);
  const [identity, setIdentity] = useState(() => getCommunityIdentity());
  const running = useRef(new Set<string>());
  const items = useLiveQuery(async (): Promise<SyncItem[]> => {
    const shares = await db.brainShares.where("status").equals("shared").toArray();
    return Promise.all(shares.map(async (share) => {
      if (share.localType === "card") {
        const card = await db.cards.get(share.localId);
        return card ? { shareId: share.id, remoteId: share.remoteId, title: card.kind === "journal" ? journalBrainTitle(card, language) : card.title, body: card.plainText.trim() || card.title, sourceUpdatedAt: card.updatedAt, shareUpdatedAt: share.updatedAt, missing: false } : { shareId: share.id, remoteId: share.remoteId, title: "", body: "", sourceUpdatedAt: 0, shareUpdatedAt: share.updatedAt, missing: true };
      }
      if (share.localType === "board") {
        const board = await db.boards.get(share.localId);
        if (!board) return { shareId: share.id, remoteId: share.remoteId, title: "", body: "", sourceUpdatedAt: 0, shareUpdatedAt: share.updatedAt, missing: true };
        const looseText = (await db.boardNodes.where("boardId").equals(board.id).toArray()).filter((node) => !node.cardId).map((node) => node.title || node.text || "").filter(Boolean).join("\n");
        return { shareId: share.id, remoteId: share.remoteId, title: board.title, body: [board.description, looseText].filter(Boolean).join("\n") || board.title, sourceUpdatedAt: board.updatedAt, shareUpdatedAt: share.updatedAt, missing: false };
      }
      if (share.localType === "fragment") {
        const fragment = await db.fragments.get(share.localId);
        return fragment ? { shareId: share.id, remoteId: share.remoteId, title: fragment.text.slice(0, 36), body: fragment.text, sourceUpdatedAt: fragment.updatedAt, shareUpdatedAt: share.updatedAt, missing: false } : { shareId: share.id, remoteId: share.remoteId, title: "", body: "", sourceUpdatedAt: 0, shareUpdatedAt: share.updatedAt, missing: true };
      }
      const task = await db.tasks.get(share.localId);
      if (!task) return { shareId: share.id, remoteId: share.remoteId, title: "", body: "", sourceUpdatedAt: 0, shareUpdatedAt: share.updatedAt, missing: true };
      const taskCopy = getTaskIntegrationCopy(language);
      const due = task.dueAt ? new Intl.DateTimeFormat(intlLocale[language], { year: "numeric", month: "short", day: "numeric" }).format(task.dueAt) : "";
      const body = [task.done ? taskCopy.taskDone : taskCopy.taskOpen, due ? taskCopyFormat(taskCopy.due, { date: due }) : taskCopy.noDue].join("\n");
      return { shareId: share.id, remoteId: share.remoteId, title: task.title, body, sourceUpdatedAt: task.updatedAt, shareUpdatedAt: share.updatedAt, missing: false };
    }));
  }, [language], []);

  useEffect(() => {
    const sync = () => setIdentity(getCommunityIdentity());
    window.addEventListener("chengjing-community-identity", sync);
    return () => window.removeEventListener("chengjing-community-identity", sync);
  }, []);

  useEffect(() => {
    if (!identity) return;
    for (const item of items) {
      if (running.current.has(item.shareId) || (!item.missing && item.sourceUpdatedAt <= item.shareUpdatedAt)) continue;
      running.current.add(item.shareId);
      const request = item.missing
        ? communityApi.deleteNeuron(item.remoteId, identity).then(() => db.brainShares.update(item.shareId, { status: "deleted", updatedAt: Date.now() }))
        : communityApi.updateNeuron(identity, item.remoteId, { title: item.title, body: item.body }).then(() => db.brainShares.update(item.shareId, { updatedAt: Date.now() }));
      void request.catch(() => {}).finally(() => running.current.delete(item.shareId));
    }
  }, [identity, items]);

  return null;
}
