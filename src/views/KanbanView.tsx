import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  CheckSquare2,
  ClipboardPaste,
  ChevronDown,
  CircleAlert,
  Copy,
  Files,
  GripVertical,
  ListTodo,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { db } from "../db";
import { TagPicker } from "../components/TagPicker";
import { TaskDatePicker } from "../components/TaskDatePicker";
import { useI18n } from "../hooks/useI18n";
import { useAppStore } from "../store";
import type { AttachmentRecord, CardRecord, KanbanListRecord, KanbanPlacementRecord } from "../types";
import {
  checklistProgress,
  createKanbanBoard,
  createKanbanCard,
  createKanbanList,
  deleteKanbanBoard,
  deleteKanbanList,
  moveKanbanPlacement,
  placeCardOnKanban,
  reorderKanbanList,
} from "../lib/kanban";
import { getKanbanCopy } from "../lib/kanbanCopy";
import { localDateKey, timestampForLocalDateKey } from "../lib/taskTimeline";
import { dataUrlToBlob, truncate } from "../lib/utils";
import { storeAttachment } from "../lib/importers";
import { removeStoredAttachment } from "../lib/attachments";
import { showContextMenuFromPointer } from "../lib/contextMenu";
import { isMaterializedCard } from "../lib/journalVisibility";
import { setTaskDone } from "../lib/taskSync";
import type { TaskRecord } from "../types";
import { duplicateCardFromId, readAppClipboard, writeAppClipboard } from "../lib/appClipboard";
import { createUnscheduledContentTask } from "../lib/contentTask";
import { getContentTaskCopy } from "../lib/contentTaskCopy";

type DateFilter = "all" | "overdue" | "today" | "upcoming" | "none";
type SortMode = "manual" | "title" | "due";

function isDateMatch(card: CardRecord, filter: DateFilter, todayKey: string) {
  const dueKey = card.dueAt ? localDateKey(card.dueAt) : "";
  if (filter === "all") return true;
  if (filter === "none") return !dueKey;
  if (!dueKey) return false;
  if (filter === "today") return dueKey === todayKey;
  if (filter === "overdue") return dueKey < todayKey;
  return dueKey > todayKey;
}

function dateLabel(value: number | undefined, locale: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(value));
}

export function KanbanView() {
  const { language, intlLocale, t } = useI18n();
  const copy = getKanbanCopy(language);
  const contentTaskCopy = getContentTaskCopy(language);
  const selectedBoardId = useAppStore((state) => state.selectedKanbanBoardId);
  const openKanbanBoard = useAppStore((state) => state.openKanbanBoard);
  const openCard = useAppStore((state) => state.openCard);
  const boards = useLiveQuery(() => db.kanbanBoards.toArray(), [], []);
  const lists = useLiveQuery<KanbanListRecord[], KanbanListRecord[]>(() => selectedBoardId ? db.kanbanLists.where("boardId").equals(selectedBoardId).sortBy("order") : Promise.resolve([]), [selectedBoardId], []);
  const placements = useLiveQuery<KanbanPlacementRecord[], KanbanPlacementRecord[]>(() => selectedBoardId ? db.kanbanPlacements.where("boardId").equals(selectedBoardId).sortBy("order") : Promise.resolve([]), [selectedBoardId], []);
  const cards = useLiveQuery(async () => (await db.cards.where("state").notEqual("trash").toArray()).filter(isMaterializedCard), [], []);
  const tags = useLiveQuery(() => db.tags.orderBy("name").toArray(), [], []);
  const attachmentIds = useMemo(() => {
    const cardById = new Map(cards.map((card) => [card.id, card]));
    return [...new Set(placements.flatMap((placement) => cardById.get(placement.cardId)?.attachmentIds || []))];
  }, [cards, placements]);
  const attachments = useLiveQuery(async () => (await db.attachments.bulkGet(attachmentIds)).filter(Boolean) as AttachmentRecord[], [attachmentIds.join("|")], []);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("manual");
  const [boardDraft, setBoardDraft] = useState("");
  const [creatingBoard, setCreatingBoard] = useState(false);
  const [renamingBoard, setRenamingBoard] = useState(false);
  const [listDraft, setListDraft] = useState("");
  const [creatingList, setCreatingList] = useState(false);
  const [renamingListId, setRenamingListId] = useState<string | null>(null);
  const [listRenameDraft, setListRenameDraft] = useState("");
  const [addingToList, setAddingToList] = useState<string | null>(null);
  const [cardDraft, setCardDraft] = useState("");
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [boardMenu, setBoardMenu] = useState<{ x: number; y: number } | null>(null);
  const [listMenu, setListMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [existingTargetListId, setExistingTargetListId] = useState<string | null>(null);
  const [existingQuery, setExistingQuery] = useState("");
  const [inspectorTitleDraft, setInspectorTitleDraft] = useState("");
  const [dropTarget, setDropTarget] = useState<{ listId: string; index: number } | null>(null);
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"success" | "error">("success");
  const composing = useRef(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sortedBoards = useMemo(() => [...boards].sort((left, right) => Number(right.favorite) - Number(left.favorite) || right.updatedAt - left.updatedAt), [boards]);
  const board = sortedBoards.find((item) => item.id === selectedBoardId);
  const cardMap = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const tagMap = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const attachmentMap = useMemo(() => new Map(attachments.map((attachment) => [attachment.id, attachment])), [attachments]);
  const selectedPlacement = placements.find((placement) => placement.id === selectedPlacementId);
  const selectedCard = selectedPlacement ? cardMap.get(selectedPlacement.cardId) : undefined;
  const selectedCardTasks = useLiveQuery<TaskRecord[], TaskRecord[]>(() => selectedCard ? db.tasks.where("cardId").equals(selectedCard.id).filter((task) => Boolean(task.sourceTaskId)).sortBy("createdAt") : Promise.resolve([]), [selectedCard?.id], []);
  const todayKey = localDateKey(Date.now());

  useEffect(() => {
    if (selectedBoardId && sortedBoards.some((item) => item.id === selectedBoardId)) return;
    if (sortedBoards[0]) openKanbanBoard(sortedBoards[0].id);
  }, [openKanbanBoard, selectedBoardId, sortedBoards]);

  useEffect(() => {
    const close = () => { setBoardMenu(null); setListMenu(null); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);

  useEffect(() => {
    if (selectedPlacementId && !placements.some((placement) => placement.id === selectedPlacementId)) setSelectedPlacementId(null);
  }, [placements, selectedPlacementId]);

  useEffect(() => {
    setInspectorTitleDraft(selectedCard?.title || "");
  }, [selectedCard?.id, selectedCard?.title]);

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  useEffect(() => {
    const handleClipboard = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      if (key === "c" && selectedPlacement) {
        event.preventDefault();
        const card = cardMap.get(selectedPlacement.cardId);
        if (card) void writeAppClipboard({ kind: "card-ref", cardId: card.id }, `${card.title}\n\n${card.plainText}`);
      } else if (key === "c" && selectedListId) {
        event.preventDefault();
        const list = lists.find((item) => item.id === selectedListId);
        if (list && board) void writeAppClipboard({ kind: "kanban-list-ref", listId: list.id, boardId: board.id }, list.title);
      } else if (key === "v") {
        const targetListId = selectedPlacement?.listId || selectedListId || lists[0]?.id;
        if (targetListId) { event.preventDefault(); void pasteIntoKanban(targetListId); }
      }
    };
    window.addEventListener("keydown", handleClipboard);
    return () => window.removeEventListener("keydown", handleClipboard);
  }, [board, cardMap, lists, selectedListId, selectedPlacement]);

  function filteredPlacements(listId: string) {
    const normalized = query.trim().toLocaleLowerCase(language);
    const results = placements.filter((placement) => placement.listId === listId).filter((placement) => {
      const card = cardMap.get(placement.cardId);
      if (!card) return false;
      const matchesQuery = !normalized || `${card.title} ${card.plainText}`.toLocaleLowerCase(language).includes(normalized);
      const matchesTag = tagFilter === "all" || card.tagIds.includes(tagFilter);
      return matchesQuery && matchesTag && isDateMatch(card, dateFilter, todayKey);
    });
    if (sortMode === "title") return results.sort((left, right) => (cardMap.get(left.cardId)?.title || "").localeCompare(cardMap.get(right.cardId)?.title || "", language));
    if (sortMode === "due") return results.sort((left, right) => (cardMap.get(left.cardId)?.dueAt || Number.MAX_SAFE_INTEGER) - (cardMap.get(right.cardId)?.dueAt || Number.MAX_SAFE_INTEGER));
    return results.sort((left, right) => left.order - right.order);
  }

  async function submitBoard(event: React.FormEvent) {
    event.preventDefault();
    if (composing.current) return;
    const created = await createKanbanBoard(boardDraft.trim() || copy.untitledBoard, [...copy.defaultLists]);
    setBoardDraft(""); setCreatingBoard(false); openKanbanBoard(created.id);
  }

  async function submitList(event: React.FormEvent) {
    event.preventDefault();
    if (!board || composing.current || !listDraft.trim()) return;
    await createKanbanList(board.id, listDraft);
    setListDraft(""); setCreatingList(false);
  }

  async function createCardInList(listId: string) {
    if (!board || composing.current || !cardDraft.trim()) return;
    const placement = await createKanbanCard(board.id, listId, cardDraft);
    setCardDraft(""); setAddingToList(null); setSelectedPlacementId(placement.id);
  }

  async function submitCard(event: React.FormEvent, listId: string) {
    event.preventDefault();
    await createCardInList(listId);
  }

  async function updateCard(patch: Partial<CardRecord>) {
    if (!selectedCard) return;
    await db.cards.update(selectedCard.id, { ...patch, updatedAt: Date.now() });
  }

  function showNotice(message: string, tone: "success" | "error" = "success", duration = 2600) {
    setNotice(message);
    setNoticeTone(tone);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), duration);
  }

  async function addSelectedCardAsTask() {
    if (!selectedCard) return;
    const result = await createUnscheduledContentTask({ title: selectedCard.title, sourceKey: `card:${selectedCard.id}`, cardId: selectedCard.id });
    showNotice(result.created ? contentTaskCopy.added : contentTaskCopy.alreadyExists);
  }

  async function removeSelectedPlacement() {
    if (!selectedPlacement) return;
    await db.kanbanPlacements.delete(selectedPlacement.id);
    setSelectedPlacementId(null);
  }

  async function addAttachment() {
    if (!selectedCard || !window.chengjing) return;
    try {
      const result = await window.chengjing.files.open({ title: copy.addAttachment, multiple: true, metadataOnly: true, filters: [{ name: copy.attachments, extensions: ["*"] }] });
      if (result.canceled || !result.files.length) return;
      const ids: string[] = [];
      for (const file of result.files) {
        const source = window.chengjing?.attachments ? new Blob([], { type: "application/octet-stream" }) : dataUrlToBlob(`data:application/octet-stream;base64,${file.data}`);
        const attachment = await storeAttachment(file.name, source, file.path);
        ids.push(attachment.id);
      }
      await updateCard({ attachmentIds: [...selectedCard.attachmentIds, ...ids] });
      showNotice(copy.attachmentAdded);
    } catch {
      showNotice(copy.attachmentFailed, "error", 3200);
    }
  }

  async function removeAttachment(attachmentId: string) {
    if (!selectedCard) return;
    await updateCard({ attachmentIds: selectedCard.attachmentIds.filter((id) => id !== attachmentId) });
    const usedElsewhere = await db.cards.filter((card) => card.id !== selectedCard.id && card.attachmentIds.includes(attachmentId)).count();
    if (!usedElsewhere) {
      const attachment = await db.attachments.get(attachmentId);
      if (attachment) await removeStoredAttachment(attachment);
    }
  }

  async function deleteCurrentBoard() {
    if (!board || !window.confirm(copy.confirmDeleteBoard(board.title))) return;
    await deleteKanbanBoard(board.id);
    const next = sortedBoards.find((item) => item.id !== board.id);
    setSelectedPlacementId(null); setBoardMenu(null);
    if (next) openKanbanBoard(next.id);
  }

  async function deleteList(list: KanbanListRecord) {
    if (!window.confirm(copy.confirmDeleteList(list.title))) return;
    await deleteKanbanList(list.id);
    setListMenu(null);
  }

  async function copyList(list: KanbanListRecord) {
    if (!board) return;
    await writeAppClipboard({ kind: "kanban-list-ref", listId: list.id, boardId: board.id }, list.title);
    setListMenu(null);
  }

  async function duplicateListIntoBoard(sourceListId: string) {
    if (!board) return;
    const source = await db.kanbanLists.get(sourceListId);
    if (!source) return;
    const next = await createKanbanList(board.id, t("context.copySuffix", { title: source.title }));
    const sourcePlacements = await db.kanbanPlacements.where("listId").equals(source.id).sortBy("order");
    for (const placement of sourcePlacements) {
      const sourceCard = await db.cards.get(placement.cardId);
      if (!sourceCard) continue;
      const copyCard = await duplicateCardFromId(sourceCard.id, t("context.copySuffix", { title: sourceCard.title }));
      if (copyCard) await placeCardOnKanban(board.id, next.id, copyCard.id);
    }
    setSelectedListId(next.id);
  }

  async function pasteIntoKanban(targetListId: string) {
    if (!board) return;
    const clipboard = await readAppClipboard();
    if (clipboard.payload?.kind === "kanban-list-ref") {
      await duplicateListIntoBoard(clipboard.payload.listId);
      setListMenu(null);
      return;
    }
    if (clipboard.payload?.kind === "card-ref") {
      const source = await db.cards.get(clipboard.payload.cardId);
      const copyCard = source ? await duplicateCardFromId(source.id, t("context.copySuffix", { title: source.title })) : null;
      if (copyCard) {
        const placement = await placeCardOnKanban(board.id, targetListId, copyCard.id);
        setSelectedPlacementId(placement.id);
      }
      setListMenu(null);
      return;
    }
    const text = clipboard.text.trim();
    if (text) {
      const placement = await createKanbanCard(board.id, targetListId, text.split(/\r?\n/)[0].slice(0, 120));
      setSelectedPlacementId(placement.id);
    }
    setListMenu(null);
  }

  async function handleColumnDrop(event: React.DragEvent, list: KanbanListRecord, listIndex: number) {
    event.preventDefault();
    setDropTarget(null);
    const draggedListId = event.dataTransfer.getData("application/x-chengjing-kanban-list");
    if (draggedListId) { await reorderKanbanList(board!.id, draggedListId, listIndex); return; }
    const placementId = event.dataTransfer.getData("application/x-chengjing-kanban-placement");
    if (placementId) await moveKanbanPlacement(placementId, list.id, placements.filter((item) => item.listId === list.id).length);
  }

  async function handleCardDrop(event: React.DragEvent, targetListId: string, targetIndex: number) {
    event.preventDefault(); event.stopPropagation(); setDropTarget(null);
    const placementId = event.dataTransfer.getData("application/x-chengjing-kanban-placement");
    if (placementId) await moveKanbanPlacement(placementId, targetListId, targetIndex);
  }

  const placedCardIds = new Set(placements.map((placement) => placement.cardId));
  const existingCards = cards.filter((card) => {
    const normalized = existingQuery.trim().toLocaleLowerCase(language);
    return !placedCardIds.has(card.id) && (!normalized || `${card.title} ${card.plainText}`.toLocaleLowerCase(language).includes(normalized));
  }).slice(0, 18);

  if (!board) return <div className="project-kanban-empty"><div><span>{copy.eyebrow}</span><h2>{copy.emptyTitle}</h2><p>{copy.emptyDescription}</p>{creatingBoard ? <form onSubmit={submitBoard}><input autoFocus value={boardDraft} placeholder={copy.boardPlaceholder} onChange={(event) => setBoardDraft(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} /><button type="submit">{copy.save}</button></form> : <button type="button" className="primary-button" onClick={() => setCreatingBoard(true)}><Plus size={16} />{copy.createFirst}</button>}</div></div>;

  return <div className={`project-kanban-layout ${selectedCard ? "has-inspector" : ""}`}>
    <aside className="project-kanban-sidebar">
      <header><span>{copy.boardLibrary}</span><button type="button" onClick={() => setCreatingBoard(true)} aria-label={copy.newBoard}><Plus size={15} /></button></header>
      {creatingBoard && <form className="project-kanban-inline-form" onSubmit={submitBoard}><input autoFocus value={boardDraft} placeholder={copy.boardPlaceholder} onChange={(event) => setBoardDraft(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} /><button type="submit">{copy.save}</button><button type="button" onClick={() => setCreatingBoard(false)}><X size={13} /></button></form>}
      <div>{sortedBoards.map((item) => <button type="button" key={item.id} className={item.id === board.id ? "is-active" : ""} onClick={() => { openKanbanBoard(item.id); setSelectedPlacementId(null); }}><span>{item.title}</span>{item.favorite && <Star size={12} fill="currentColor" />}</button>)}</div>
      <p>{copy.dragHint}</p>
    </aside>

    <section className="project-kanban-main">
      <header className="project-kanban-header">
        <div className="project-kanban-heading">
          <span>{copy.eyebrow}</span>
          {renamingBoard ? <form onSubmit={(event) => { event.preventDefault(); if (!boardDraft.trim() || composing.current) return; void db.kanbanBoards.update(board.id, { title: boardDraft.trim(), updatedAt: Date.now() }); setRenamingBoard(false); }}><input autoFocus value={boardDraft} onChange={(event) => setBoardDraft(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} /><button type="submit">{copy.save}</button></form> : <h2>{board.title}</h2>}
          <p contentEditable suppressContentEditableWarning onBlur={(event) => void db.kanbanBoards.update(board.id, { description: event.currentTarget.textContent?.trim() === copy.description && !board.description ? "" : event.currentTarget.textContent?.trim() || "", updatedAt: Date.now() })}>{board.description || copy.description}</p>
        </div>
        <div className="project-kanban-actions">
          <button type="button" className={board.favorite ? "is-active" : ""} onClick={() => db.kanbanBoards.update(board.id, { favorite: !board.favorite, updatedAt: Date.now() })} aria-label={board.favorite ? copy.unfavorite : copy.favorite}><Star size={17} fill={board.favorite ? "currentColor" : "none"} /></button>
          <button type="button" onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setBoardMenu({ x: rect.right - 210, y: rect.bottom + 5 }); }} aria-label={copy.boardActions}><MoreHorizontal size={18} /></button>
        </div>
      </header>

      <div className="project-kanban-tools">
        <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} /></label>
        <div><span>{copy.filter}</span><select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} aria-label={copy.allTags}><option value="all">{copy.allTags}</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select><select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as DateFilter)} aria-label={copy.allDates}><option value="all">{copy.allDates}</option><option value="overdue">{copy.overdue}</option><option value="today">{copy.today}</option><option value="upcoming">{copy.upcoming}</option><option value="none">{copy.noDate}</option></select></div>
        <div><span>{copy.sort}</span><select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}><option value="manual">{copy.manual}</option><option value="title">{copy.byTitle}</option><option value="due">{copy.byDue}</option></select></div>
      </div>

      <div className="project-kanban-scroll">
        <div className="project-kanban-board" style={{ gridTemplateColumns: `repeat(${Math.max(1, lists.length + 1)}, 280px)` }}>
          {lists.map((list, listIndex) => {
            const listPlacements = filteredPlacements(list.id);
            const isDrop = dropTarget?.listId === list.id;
            return <section key={list.id} className={`${isDrop ? "is-drop-target" : ""} ${selectedListId === list.id && !selectedPlacement ? "is-list-selected" : ""}`.trim()} onDragOver={(event) => { event.preventDefault(); setDropTarget({ listId: list.id, index: listPlacements.length }); }} onDrop={(event) => void handleColumnDrop(event, list, listIndex)}>
              <header draggable={renamingListId !== list.id} onClick={() => { setSelectedListId(list.id); setSelectedPlacementId(null); }} onContextMenu={(event) => { event.preventDefault(); setSelectedListId(list.id); setSelectedPlacementId(null); setListMenu({ id: list.id, x: event.clientX, y: event.clientY }); }} onDragStart={(event) => { event.dataTransfer.setData("application/x-chengjing-kanban-list", list.id); event.dataTransfer.effectAllowed = "move"; }}>
                <GripVertical size={15} />{renamingListId === list.id ? <form onSubmit={(event) => { event.preventDefault(); if (!listRenameDraft.trim() || composing.current) return; void db.kanbanLists.update(list.id, { title: listRenameDraft.trim(), updatedAt: Date.now() }); setRenamingListId(null); }} onPointerDown={(event) => event.stopPropagation()}><input autoFocus value={listRenameDraft} onChange={(event) => setListRenameDraft(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={(event) => { if (event.key === "Escape") setRenamingListId(null); }} /></form> : <span>{list.title}</span>}<b>{listPlacements.length}</b><button type="button" onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setListMenu({ id: list.id, x: rect.right - 190, y: rect.bottom + 4 }); }} aria-label={copy.listActions}><MoreHorizontal size={15} /></button>
              </header>
              <div className="project-kanban-cards">
                {listPlacements.map((placement, index) => {
                  const card = cardMap.get(placement.cardId)!;
                  const progress = checklistProgress(card.contentHtml);
                  const dueKey = card.dueAt ? localDateKey(card.dueAt) : "";
                  const dueTone = dueKey && dueKey < todayKey ? "is-overdue" : dueKey === todayKey ? "is-today" : "";
                  return <article key={placement.id} draggable onDragStart={(event) => { event.dataTransfer.setData("application/x-chengjing-kanban-placement", placement.id); event.dataTransfer.effectAllowed = "move"; }} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); setDropTarget({ listId: list.id, index }); }} onDrop={(event) => void handleCardDrop(event, list.id, index)} onClick={() => { setSelectedListId(list.id); setSelectedPlacementId(placement.id); }} onContextMenu={(event) => { setSelectedListId(list.id); setSelectedPlacementId(placement.id); showContextMenuFromPointer(event, { kind: "card", id: card.id }); }} className={selectedPlacementId === placement.id ? "is-selected" : ""}>
                    <div className="project-kanban-card-tags">{card.tagIds.slice(0, 4).map((tagId) => { const tag = tagMap.get(tagId); return tag ? <i key={tag.id} className={`tone-${tag.color}`} title={tag.name} /> : null; })}</div>
                    <h3>{card.title}</h3>
                    {card.plainText && <p>{truncate(card.plainText, 92)}</p>}
                    <footer>{card.dueAt && <span className={dueTone}><CalendarDays size={13} />{dateLabel(card.dueAt, intlLocale)}</span>}{progress.total > 0 && <span><CheckSquare2 size={13} />{progress.done}/{progress.total}</span>}{card.attachmentIds.length > 0 && <span><Paperclip size={13} />{card.attachmentIds.length}</span>}</footer>
                  </article>;
                })}
                {listPlacements.length === 0 && (query || tagFilter !== "all" || dateFilter !== "all") && <p className="project-kanban-no-results">{copy.noResults}</p>}
                {listPlacements.length === 0 && !query && tagFilter === "all" && dateFilter === "all" && <p className="project-kanban-list-empty">{copy.emptyList}</p>}
              </div>
              {addingToList === list.id ? <form className="project-kanban-card-form" onSubmit={(event) => void submitCard(event, list.id)}><textarea autoFocus value={cardDraft} placeholder={copy.cardPlaceholder} onChange={(event) => setCardDraft(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={(event) => { if (event.key !== "Enter" || composing.current || (event.nativeEvent as KeyboardEvent).isComposing) return; if (event.altKey) { event.preventDefault(); const target = event.currentTarget; const start = target.selectionStart; const end = target.selectionEnd; setCardDraft((current) => `${current.slice(0, start)}\n${current.slice(end)}`); window.requestAnimationFrame(() => target.setSelectionRange(start + 1, start + 1)); return; } event.preventDefault(); void createCardInList(list.id); }} /><footer><button type="submit">{copy.addCard}</button><small>{copy.enterToAdd}</small><button type="button" onClick={() => { setAddingToList(null); setCardDraft(""); }}><X size={15} /></button></footer></form> : <footer><button type="button" onClick={() => { setAddingToList(list.id); setCardDraft(""); }}><Plus size={15} />{copy.addCard}</button><button type="button" onClick={() => { setExistingTargetListId(list.id); setExistingQuery(""); }} aria-label={copy.addExisting}><Files size={15} /></button></footer>}
            </section>;
          })}
          <section className="project-kanban-add-list">{creatingList ? <form onSubmit={submitList}><input autoFocus value={listDraft} placeholder={copy.listPlaceholder} onChange={(event) => setListDraft(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} /><footer><button type="submit">{copy.save}</button><button type="button" onClick={() => setCreatingList(false)}><X size={15} /></button></footer></form> : <button type="button" onClick={() => setCreatingList(true)}><Plus size={16} />{copy.addList}</button>}</section>
        </div>
      </div>
      <footer className="project-kanban-status"><span>{copy.saved}</span><span>{copy.dragHint}</span></footer>
    </section>

    {selectedCard && selectedPlacement && <aside className="project-kanban-inspector">
      <header><div><span>{copy.detail}</span><b>{selectedCard.title}</b></div><button type="button" onClick={() => setSelectedPlacementId(null)} aria-label={copy.closeDetail}><X size={18} /></button></header>
      <div className="project-kanban-inspector-scroll">
        <input className="project-kanban-title-input" value={inspectorTitleDraft} onChange={(event) => setInspectorTitleDraft(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onBlur={() => { const title = inspectorTitleDraft.trim() || t("common.untitledCard"); if (title !== selectedCard.title) void updateCard({ title }); }} onKeyDown={(event) => { if (event.key === "Enter" && !composing.current && !(event.nativeEvent as KeyboardEvent).isComposing) event.currentTarget.blur(); }} />
        {selectedCard.plainText && <p className="project-kanban-card-summary">{truncate(selectedCard.plainText, 260)}</p>}
        <section><label>{copy.moveToList}</label><select value={selectedPlacement.listId} onChange={(event) => void moveKanbanPlacement(selectedPlacement.id, event.target.value, placements.filter((item) => item.listId === event.target.value).length)}>{lists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}</select></section>
        <section className="project-kanban-dates"><label>{copy.startDate}</label><TaskDatePicker value={selectedCard.startAt ? localDateKey(selectedCard.startAt) : ""} onChange={(value) => void updateCard({ startAt: value ? timestampForLocalDateKey(value) : undefined })} label={copy.startDate} /><label>{copy.dueDate}</label><TaskDatePicker value={selectedCard.dueAt ? localDateKey(selectedCard.dueAt) : ""} onChange={(value) => void updateCard({ dueAt: value ? timestampForLocalDateKey(value) : undefined })} label={copy.dueDate} /></section>
        <section><label>{copy.labels}</label><TagPicker selectedIds={selectedCard.tagIds} onChange={(tagIds) => updateCard({ tagIds })} maxVisible={5} /></section>
        <section><label>{copy.checklist}</label>{selectedCardTasks.length ? <><div className="project-kanban-progress"><span style={{ width: `${(selectedCardTasks.filter((task) => task.done).length / selectedCardTasks.length) * 100}%` }} /><b>{copy.checklistProgress(selectedCardTasks.filter((task) => task.done).length, selectedCardTasks.length)}</b></div><div className="project-kanban-checklist">{selectedCardTasks.map((task) => <button type="button" key={task.id} className={task.done ? "is-done" : ""} onClick={() => void setTaskDone(task.id, !task.done)} aria-pressed={task.done}><i>{task.done && <Check size={12} />}</i><span>{task.title}</span></button>)}</div></> : <p>{copy.noChecklist}</p>}</section>
        <section className="project-kanban-task-conversion"><label>{contentTaskCopy.section}</label><button type="button" className="project-kanban-secondary" onClick={() => void addSelectedCardAsTask()}><ListTodo size={14} />{contentTaskCopy.menuLabel}</button></section>
        <section><label>{copy.attachments}</label><div className="project-kanban-attachments">{selectedCard.attachmentIds.map((id) => { const attachment = attachmentMap.get(id); return attachment ? <div key={id}><Paperclip size={14} /><span>{attachment.name}</span><button type="button" onClick={() => void removeAttachment(id)}><X size={13} /></button></div> : null; })}</div><button type="button" className="project-kanban-secondary" onClick={() => void addAttachment()}><Plus size={14} />{copy.addAttachment}</button></section>
        {notice && <div className={`project-kanban-notice ${noticeTone === "error" ? "is-error" : ""}`} role="status" aria-live="polite">{noticeTone === "error" ? <CircleAlert size={14} /> : <CheckCircle2 size={14} />}{notice}</div>}
      </div>
      <footer><button type="button" onClick={() => openCard(selectedCard.id)}><Pencil size={15} />{copy.openContent}</button><button type="button" className="is-danger" onClick={() => void removeSelectedPlacement()}><Trash2 size={15} />{copy.removeFromBoard}</button></footer>
    </aside>}

    {boardMenu && <div className="project-kanban-menu" style={{ left: boardMenu.x, top: boardMenu.y }} onPointerDown={(event) => event.stopPropagation()}><header>{copy.boardActions}</header><button type="button" onClick={() => { setBoardDraft(board.title); setRenamingBoard(true); setBoardMenu(null); }}><Pencil size={14} />{copy.rename}</button><button type="button" className="is-danger" onClick={() => void deleteCurrentBoard()}><Trash2 size={14} />{copy.remove}</button></div>}
    {listMenu && (() => { const list = lists.find((item) => item.id === listMenu.id); return list ? <div className="project-kanban-menu" style={{ left: listMenu.x, top: listMenu.y }} onPointerDown={(event) => event.stopPropagation()}><header>{copy.listActions}</header><button type="button" onClick={() => { setRenamingListId(list.id); setListRenameDraft(list.title); setListMenu(null); }}><Pencil size={14} />{copy.rename}</button><button type="button" onClick={() => void copyList(list)}><Copy size={14} />{copy.copyList}</button><button type="button" onClick={() => void pasteIntoKanban(list.id)}><ClipboardPaste size={14} />{copy.paste}</button><button type="button" className="is-danger" onClick={() => void deleteList(list)}><Trash2 size={14} />{copy.remove}</button></div> : null; })()}

    {existingTargetListId && <div className="project-kanban-modal" onMouseDown={() => setExistingTargetListId(null)}><section onMouseDown={(event) => event.stopPropagation()}><header><div><span>{copy.addExisting}</span><b>{lists.find((list) => list.id === existingTargetListId)?.title}</b></div><button type="button" onClick={() => setExistingTargetListId(null)}><X size={18} /></button></header><label><Search size={16} /><input autoFocus value={existingQuery} onChange={(event) => setExistingQuery(event.target.value)} placeholder={copy.existingSearch} /></label><div>{existingCards.map((card) => <button type="button" key={card.id} onClick={async () => { const placement = await placeCardOnKanban(board.id, existingTargetListId, card.id); setExistingTargetListId(null); setSelectedPlacementId(placement.id); }}><span><b>{card.title}</b><small>{truncate(card.plainText, 70)}</small></span><Plus size={15} /></button>)}{existingCards.length === 0 && <p>{copy.noResults}</p>}</div></section></div>}
  </div>;
}
