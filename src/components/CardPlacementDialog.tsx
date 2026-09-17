import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, touchBoard } from "../db";
import { createKanbanBoard, createKanbanList, placeCardOnKanban } from "../lib/kanban";
import { getKanbanCopy } from "../lib/kanbanCopy";
import { captureCopy } from "../lib/captureCopy";
import { isActiveCard } from "../lib/cardVisibility";
import { useI18n } from "../hooks/useI18n";
import { useAppStore } from "../store";
import { useMobileBack } from "../lib/mobileBack";
import "./capture-cards.css";

export type CardPlacementMode = "topic" | "board" | "kanban";
export function CardPlacementDialog({ cardId, mode, onClose }: { cardId: string; mode: CardPlacementMode; onClose: () => void }) {
  const { language, t } = useI18n(); const copy = captureCopy(language); const kanban = getKanbanCopy(language);
  const saving = useRef(false);
  const [destination, setDestination] = useState(""); const [listId, setListId] = useState("");
  const [name, setName] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useMobileBack(true, () => { if (!busy) onClose(); });
  const card = useLiveQuery(() => db.cards.get(cardId), [cardId]);
  const destinations = useLiveQuery(async () => {
    if (mode === "topic") return (await db.knowledgeGroups.toArray()).filter((group) => group.kind === "topic").map((group) => ({ id: group.id, name: group.name }));
    return (await (mode === "board" ? db.boards.toArray() : db.kanbanBoards.toArray())).map((board) => ({ id: board.id, name: board.title }));
  }, [mode], []);
  const lists = useLiveQuery(() => mode === "kanban" && destination ? db.kanbanLists.where("boardId").equals(destination).sortBy("order") : [], [mode, destination], []);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (saving.current || !destination) return; saving.current = true; setBusy(true); setError("");
    try {
      let openId = "";
      await db.transaction("rw", [db.cards, db.boards, db.boardNodes, db.knowledgeGroups, db.kanbanBoards, db.kanbanLists, db.kanbanPlacements], async () => {
        const current = await db.cards.get(cardId); if (!isActiveCard(current)) throw new Error("card-not-active");
        if (mode === "topic") {
          if (destination !== "__none__" && (await db.knowledgeGroups.get(destination))?.kind !== "topic") throw new Error("topic-not-found");
          await db.cards.update(cardId, { collectionId: destination === "__none__" ? undefined : destination, updatedAt: Date.now() });
          return;
        }
        let id = destination;
        if (id === "__new__") {
          if (!name.trim()) throw new Error("name-required");
          if (mode === "kanban") id = (await createKanbanBoard(name.trim(), [...kanban.defaultLists])).id;
          else { const now = Date.now(); id = crypto.randomUUID(); await db.boards.add({ id, title: name.trim(), description: "", favorite: false, tagIds: [], createdAt: now, updatedAt: now }); }
        }
        if (mode === "board") {
          if (!await db.boards.get(id)) throw new Error("board-not-found");
          const nodes = await db.boardNodes.where("boardId").equals(id).toArray();
          if (!nodes.some((node) => node.cardId === cardId)) await db.boardNodes.add({ id: crypto.randomUUID(), boardId: id, kind: "card", cardId, x: 100 + (nodes.length % 3) * 315, y: 100 + Math.floor(nodes.length / 3) * 215, width: 265, height: 190 });
          await touchBoard(id);
        } else {
          if (!await db.kanbanBoards.get(id)) throw new Error("kanban-not-found");
          const available = await db.kanbanLists.where("boardId").equals(id).sortBy("order");
          if (listId && !available.some((list) => list.id === listId)) throw new Error("kanban-list-not-found");
          const selected = available.find((list) => list.id === listId) || available[0] || await createKanbanList(id, kanban.defaultLists[0]);
          await placeCardOnKanban(id, selected.id, cardId);
        }
        openId = id;
      });
      onClose();
      if (openId) { if (mode === "board") useAppStore.getState().openBoard(openId); else useAppStore.getState().openKanbanBoard(openId); }
    } catch (error) { setError(error instanceof Error ? error.message : t("context.failed")); }
    finally { saving.current = false; setBusy(false); }
  }
  return <div className="tag-rename-backdrop" onMouseDown={() => { if (!busy) onClose(); }}>
    <form className="tag-rename-dialog card-placement-dialog" role="dialog" aria-modal="true" aria-labelledby="card-placement-title" onSubmit={save} onKeyDown={(event) => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); if (event.key === "Escape" && !busy) onClose(); }} onMouseDown={(event) => event.stopPropagation()}>
      <header><span>{card?.title}</span><h2 id="card-placement-title">{copy[mode]}</h2></header>
      <p>{copy.hint}</p>
      <label>{copy.destination}<select autoFocus aria-label={copy.destination} value={destination} disabled={busy} onChange={(event) => { setDestination(event.target.value); setListId(""); }}>
        <option value="" disabled>{copy.destination}</option>
        {mode === "topic" ? <option value="__none__">{copy.none}</option> : <option value="__new__">{copy.create}</option>}
        {destinations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      {mode === "topic" && !destinations.length && <p>{copy.noTopics}</p>}
      {destination === "__new__" && <label>{copy.name}<input aria-label={copy.name} value={name} disabled={busy} maxLength={160} onChange={(event) => setName(event.target.value)} required /></label>}
      {mode === "kanban" && lists.length > 0 && <label>{copy.list}<select aria-label={copy.list} value={listId || lists[0].id} disabled={busy} onChange={(event) => setListId(event.target.value)}>{lists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}</select></label>}
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" disabled={busy || !destination || (destination === "__new__" && !name.trim())}>{copy.submit}</button></footer>
    </form>
  </div>;
}
