import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Archive,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  ClipboardPaste,
  Copy,
  FilePlus2,
  FolderOpen,
  Heart,
  HeartOff,
  ListTodo,
  ListTree,
  PanelsTopLeft,
  Pin,
  PinOff,
  Pencil,
  RotateCcw,
  SquareKanban,
  Trash2,
} from "lucide-react";
import {
  createCard,
  db,
  deleteBoardPermanently,
  deleteCardPermanently,
  deleteFragmentPermanently,
  deleteTag,
  moveCardToTrash,
  restoreCardFromTrash,
  renameTag,
  touchBoard,
} from "../db";
import { useAppStore } from "../store";
import type { BoardEdgeRecord, BoardNodeRecord, TaskRecord } from "../types";
import type { ContextMenuRequest } from "../lib/contextMenu";
import { useI18n } from "../hooks/useI18n";
import { createTaskChild, deleteTaskEverywhere, setTaskDone, setTaskDueAt, taskDescendants, timestampToDueDateInput, dueDateInputToTimestamp, updateTaskEverywhere } from "../lib/taskSync";
import { getTaskEnhancementCopy } from "../lib/taskEnhancementCopy";
import { TaskDatePicker } from "./TaskDatePicker";
import { duplicateCardFromId, readAppClipboard, writeAppClipboard } from "../lib/appClipboard";
import { createKanbanBoard, createKanbanList, placeCardOnKanban } from "../lib/kanban";
import { getKanbanCopy } from "../lib/kanbanCopy";
import { getContentEditCopy } from "../lib/contentEditCopy";
import { createUnscheduledContentTask } from "../lib/contentTask";
import { getContentTaskCopy } from "../lib/contentTaskCopy";
import { getTaskHierarchyCopy } from "../lib/taskHierarchyCopy";

type ContentEditDialog =
  | { kind: "task"; id: string; draft: string }
  | { kind: "fragment"; id: string; draft: string }
  | { kind: "highlight"; id: string; draft: string; noteDraft: string };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] || character);
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

export function GlobalContextMenu() {
  const [request, setRequest] = useState<ContextMenuRequest | null>(null);
  const [renameDialog, setRenameDialog] = useState<{ id: string; name: string } | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [dueDialog, setDueDialog] = useState<{ id: string; title: string; hadDue: boolean } | null>(null);
  const [editDialog, setEditDialog] = useState<ContentEditDialog | null>(null);
  const [childDialog, setChildDialog] = useState<{ parentId: string; parentTitle: string; draft: string; inheritsDue: boolean } | null>(null);
  const [notice, setNotice] = useState("");
  const [dueDraft, setDueDraft] = useState("");
  const [task, setTask] = useState<TaskRecord | undefined>();
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const renameComposing = useRef(false);
  const editComposing = useRef(false);
  const childComposing = useRef(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedAt = useRef(0);
  const cardId = request?.target.kind === "card" ? request.target.id : null;
  const taskId = request?.target.kind === "task" ? request.target.id : null;
  const highlightId = request?.target.kind === "highlight" ? request.target.id : null;
  const fragmentId = request?.target.kind === "fragment" ? request.target.id : null;
  const boardId = request?.target.kind === "board" ? request.target.id : null;
  const tagId = request?.target.kind === "tag" ? request.target.id : null;
  const card = useLiveQuery(() => cardId ? db.cards.get(cardId) : undefined, [cardId]);
  const highlight = useLiveQuery(() => highlightId ? db.highlights.get(highlightId) : undefined, [highlightId]);
  const fragment = useLiveQuery(() => fragmentId ? db.fragments.get(fragmentId) : undefined, [fragmentId]);
  const board = useLiveQuery(() => boardId ? db.boards.get(boardId) : undefined, [boardId]);
  const tag = useLiveQuery(() => tagId ? db.tags.get(tagId) : undefined, [tagId]);
  const { language, t } = useI18n();
  const taskCopy = getTaskEnhancementCopy(language);
  const kanbanCopy = getKanbanCopy(language);
  const editCopy = getContentEditCopy(language);
  const contentTaskCopy = getContentTaskCopy(language);
  const hierarchyCopy = getTaskHierarchyCopy(language);

  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<ContextMenuRequest>).detail;
      if (detail.target.kind === "task") setTask(undefined);
      openedAt.current = Date.now();
      setPosition({ x: detail.x, y: detail.y });
      setRequest(detail);
    };
    const close = () => setRequest(null);
    const closeAfterInitialPositioning = () => { if (Date.now() - openedAt.current > 180) close(); };
    const keydown = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("chengjing:context-menu", open);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", keydown);
    document.addEventListener("scroll", closeAfterInitialPositioning, true);
    return () => {
      window.removeEventListener("chengjing:context-menu", open);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", keydown);
      document.removeEventListener("scroll", closeAfterInitialPositioning, true);
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!taskId) {
      setTask(undefined);
      return () => { active = false; };
    }
    void db.tasks.get(taskId).then((value) => { if (active) setTask(value); });
    return () => { active = false; };
  }, [taskId]);

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  useLayoutEffect(() => {
    if (!request || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(request.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(request.y, window.innerHeight - rect.height - 8)),
    });
  }, [request, card, task, highlight, fragment, board, tag]);

  function run(action: () => unknown | Promise<unknown>) {
    setRequest(null);
    Promise.resolve(action()).catch((error) => window.alert(error instanceof Error ? error.message : t("context.failed")));
  }

  function showNotice(message: string) {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 2600);
  }

  async function addCardAsTask() {
    if (!card) return;
    const result = await createUnscheduledContentTask({ title: card.title, sourceKey: `card:${card.id}`, cardId: card.id });
    showNotice(result.created ? contentTaskCopy.added : contentTaskCopy.alreadyExists);
  }

  async function addFragmentAsTask() {
    if (!fragment) return;
    const result = await createUnscheduledContentTask({ title: fragment.text, sourceKey: `fragment:${fragment.id}` });
    showNotice(result.created ? contentTaskCopy.added : contentTaskCopy.alreadyExists);
  }

  async function duplicateCard() {
    if (!card) return;
    const attachmentCopies = (await Promise.all(card.attachmentIds.map(async (id) => {
      const attachment = await db.attachments.get(id);
      return attachment ? { ...attachment, id: crypto.randomUUID(), createdAt: Date.now() } : null;
    }))).filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (attachmentCopies.length) await db.attachments.bulkAdd(attachmentCopies);
    const copy = await createCard({
      ...card,
      id: undefined,
      title: t("context.copySuffix", { title: card.title }),
      state: card.state === "trash" ? "active" : card.state,
      favorite: false,
      deletedAt: undefined,
      attachmentIds: attachmentCopies.map((attachment) => attachment.id),
      tagIds: [...card.tagIds],
      properties: { ...card.properties },
    });
    useAppStore.getState().openCard(copy.id);
  }

  async function pasteAsCard() {
    const clipboard = await readAppClipboard();
    if (clipboard.payload?.kind === "card-ref") {
      const source = await db.cards.get(clipboard.payload.cardId);
      const copy = source ? await duplicateCardFromId(source.id, t("context.copySuffix", { title: source.title })) : null;
      if (copy) useAppStore.getState().openCard(copy.id);
      return;
    }
    const text = clipboard.text.trim();
    if (!text) return;
    const escaped = escapeHtml(text).replace(/\r?\n/g, "<br>");
    const next = await createCard({ title: text.split(/\r?\n/)[0].slice(0, 80), plainText: text, contentHtml: `<p>${escaped}</p>`, state: "active" });
    useAppStore.getState().openCard(next.id);
  }

  async function cardFromFragment() {
    if (!fragment) return null;
    return createCard({ title: fragment.text.slice(0, 34), plainText: fragment.text, contentHtml: `<p>${escapeHtml(fragment.text)}</p>`, state: "active", tagIds: [...fragment.tagIds] });
  }

  async function sendFragmentToBoard() {
    const card = await cardFromFragment();
    if (!card) return;
    let board = useAppStore.getState().selectedBoardId ? await db.boards.get(useAppStore.getState().selectedBoardId!) : undefined;
    if (!board) board = (await db.boards.orderBy("updatedAt").reverse().first()) || undefined;
    if (!board) {
      const timestamp = Date.now();
      board = { id: crypto.randomUUID(), title: t("common.untitledBoard"), description: "", favorite: false, tagIds: [], createdAt: timestamp, updatedAt: timestamp };
      await db.boards.add(board);
    }
    const count = await db.boardNodes.where("boardId").equals(board.id).count();
    await db.boardNodes.add({ id: crypto.randomUUID(), boardId: board.id, kind: "card", cardId: card.id, x: 100 + (count % 3) * 315, y: 100 + Math.floor(count / 3) * 215, width: 265, height: 190 });
    await touchBoard(board.id);
    useAppStore.getState().openBoard(board.id);
  }

  async function sendFragmentToKanban() {
    const card = await cardFromFragment();
    if (!card) return;
    let board = useAppStore.getState().selectedKanbanBoardId ? await db.kanbanBoards.get(useAppStore.getState().selectedKanbanBoardId!) : undefined;
    if (!board) board = (await db.kanbanBoards.orderBy("updatedAt").reverse().first()) || undefined;
    if (!board) board = await createKanbanBoard(kanbanCopy.untitledBoard, [...kanbanCopy.defaultLists]);
    let list = await db.kanbanLists.where("boardId").equals(board.id).sortBy("order").then((items) => items[0]);
    if (!list) list = await createKanbanList(board.id, kanbanCopy.defaultLists[0]);
    if (list) await placeCardOnKanban(board.id, list.id, card.id);
    useAppStore.getState().openKanbanBoard(board.id);
  }

  async function duplicateBoard() {
    if (!board) return;
    const nodes = await db.boardNodes.where("boardId").equals(board.id).toArray();
    const edges = await db.boardEdges.where("boardId").equals(board.id).toArray();
    const newBoardId = crypto.randomUUID();
    const nodeIds = new Map(nodes.map((node) => [node.id, crypto.randomUUID()]));
    const nextNodes: BoardNodeRecord[] = nodes.map((node) => ({
      ...node,
      id: nodeIds.get(node.id)!,
      boardId: newBoardId,
      parentNodeId: node.parentNodeId ? nodeIds.get(node.parentNodeId) : undefined,
      mindmapRootId: node.mindmapRootId ? nodeIds.get(node.mindmapRootId) : undefined,
    }));
    const nextEdges: BoardEdgeRecord[] = edges.map((edge) => ({
      ...edge,
      id: crypto.randomUUID(),
      boardId: newBoardId,
      source: nodeIds.get(edge.source) || edge.source,
      target: nodeIds.get(edge.target) || edge.target,
    }));
    await db.transaction("rw", [db.boards, db.boardNodes, db.boardEdges], async () => {
      await db.boards.add({ ...board, id: newBoardId, title: t("context.copySuffix", { title: board.title }), favorite: false, createdAt: Date.now(), updatedAt: Date.now() });
      await db.boardNodes.bulkAdd(nextNodes);
      await db.boardEdges.bulkAdd(nextEdges);
    });
    useAppStore.getState().openBoard(newBoardId);
  }

  async function submitTagRename(event: React.FormEvent) {
    event.preventDefault();
    if (!renameDialog || renameComposing.current) return;
    await renameTag(renameDialog.id, renameDraft);
    setRenameDialog(null);
    setRenameDraft("");
  }

  async function submitTaskDue(event: React.FormEvent) {
    event.preventDefault();
    if (!dueDialog) return;
    const dueAt = dueDraft ? dueDateInputToTimestamp(dueDraft) : undefined;
    if (dueDraft && !dueAt) return;
    await setTaskDueAt(dueDialog.id, dueAt);
    setDueDialog(null);
    setDueDraft("");
  }

  async function submitContentEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editDialog || editComposing.current) return;
    const value = editDialog.draft.trim();
    if (!value) return;
    try {
      if (editDialog.kind === "task") await updateTaskEverywhere(editDialog.id, { title: value });
      if (editDialog.kind === "fragment") await db.fragments.update(editDialog.id, { text: value, updatedAt: Date.now() });
      if (editDialog.kind === "highlight") await db.highlights.update(editDialog.id, { text: value, note: editDialog.noteDraft.trim() });
      setEditDialog(null);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : t("context.failed"));
    }
  }

  async function submitChildTask(event: React.FormEvent) {
    event.preventDefault();
    if (!childDialog || childComposing.current || !childDialog.draft.trim()) return;
    try {
      const result = await createTaskChild(childDialog.parentId, childDialog.draft);
      setChildDialog(null);
      showNotice(result.created ? hierarchyCopy.added : hierarchyCopy.alreadyExists);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : t("context.failed"));
    }
  }

  if (!request && !renameDialog && !dueDialog && !editDialog && !childDialog && !notice) return null;

  return (
    <>
    {request &&
    <div
      ref={ref}
      className="global-context-menu"
      style={{ left: position.x, top: position.y }}
      role="menu"
      data-context-menu={request.target.kind}
      data-context-id={request.target.id}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {card && <>
        <header><span>{t("context.cardActions")}</span><b>{card.title}</b></header>
        <button type="button" role="menuitem" data-menu-action="edit" onClick={() => run(() => useAppStore.getState().openCard(card.id))}><Pencil size={15} />{editCopy.edit}</button>
        {card.sourceUrl && <button type="button" role="menuitem" onClick={() => run(() => window.open(card.sourceUrl, "_blank", "noopener,noreferrer"))}><ArrowUpRight size={15} />{t("context.openOriginal")}</button>}
        {card.state !== "trash" && <button type="button" role="menuitem" data-menu-action="convert-board" onClick={() => run(() => { useAppStore.getState().openCard(card.id); useAppStore.getState().openAIWithAction(t("card.convertToBoardPrompt")); })}><PanelsTopLeft size={15} />{t("card.convertToBoard")}</button>}
        {card.state !== "trash" && <button type="button" role="menuitem" data-menu-action="to-task" onClick={() => run(addCardAsTask)}><ListTodo size={15} />{contentTaskCopy.menuLabel}</button>}
        <button type="button" role="menuitem" onClick={() => run(() => db.cards.update(card.id, { favorite: !card.favorite, updatedAt: Date.now() }))}>{card.favorite ? <PinOff size={15} /> : <Pin size={15} />}{card.favorite ? t("context.unpinCard") : t("context.pinCard")}</button>
        <button type="button" role="menuitem" data-menu-action="duplicate" onClick={() => run(duplicateCard)}><FilePlus2 size={15} />{t("context.duplicate")}</button>
        <button type="button" role="menuitem" onClick={() => run(() => writeAppClipboard({ kind: "card-ref", cardId: card.id }, `${card.title}\n\n${card.plainText}`))}><Copy size={15} />{t("context.copyCard")}</button>
        <button type="button" role="menuitem" onClick={() => run(pasteAsCard)}><ClipboardPaste size={15} />{t("context.pasteCard")}</button>
        <i className="context-separator" />
        {card.state !== "trash" ? <>
          <button type="button" role="menuitem" onClick={() => run(() => db.cards.update(card.id, { state: card.state === "archived" ? "active" : "archived", updatedAt: Date.now() }))}><Archive size={15} />{card.state === "archived" ? t("context.restoreLibrary") : t("context.moveArchive")}</button>
          <button type="button" role="menuitem" className="is-danger" data-menu-action="trash" onClick={() => run(async () => { await moveCardToTrash(card.id); if (useAppStore.getState().selectedCardId === card.id) { useAppStore.getState().closeCard(); useAppStore.getState().closeRightPanel(); } })}><Trash2 size={15} />{t("context.moveTrash")}</button>
        </> : <>
          <button type="button" role="menuitem" data-menu-action="restore" onClick={() => run(() => restoreCardFromTrash(card.id))}><RotateCcw size={15} />{t("context.restoreCard")}</button>
          <button type="button" role="menuitem" className="is-danger" data-menu-action="delete-permanently" onClick={() => run(async () => { if (window.confirm(t("context.confirmDeleteCard", { title: card.title }))) await deleteCardPermanently(card.id); })}><Trash2 size={15} />{t("context.deleteForever")}</button>
        </>}
      </>}

      {task && <>
        <header><span>{t("context.taskActions")}</span><b>{task.title}</b></header>
        <button type="button" role="menuitem" data-menu-action="edit" onClick={() => { setRequest(null); setEditDialog({ kind: "task", id: task.id, draft: task.title }); }}><Pencil size={15} />{editCopy.edit}</button>
        <button type="button" role="menuitem" data-menu-action="add-child" onClick={() => { setRequest(null); setChildDialog({ parentId: task.id, parentTitle: task.title, draft: "", inheritsDue: Boolean(task.dueAt) }); }}><ListTree size={15} />{hierarchyCopy.addChild}</button>
        <button type="button" role="menuitem" onClick={() => run(() => setTaskDone(task.id, !task.done))}><CheckCircle2 size={15} />{task.done ? t("context.reopen") : t("context.markDone")}</button>
        <button type="button" role="menuitem" onClick={() => { setRequest(null); setDueDialog({ id: task.id, title: task.title, hadDue: Boolean(task.dueAt) }); setDueDraft(timestampToDueDateInput(task.dueAt)); }}><Calendar size={15} />{task.dueAt ? taskCopy.changeDue : taskCopy.setDue}</button>
        {task.dueAt && <button type="button" role="menuitem" onClick={() => run(() => setTaskDueAt(task.id, undefined))}><RotateCcw size={15} />{taskCopy.removeDue}</button>}
        {task.cardId && <button type="button" role="menuitem" onClick={() => run(() => useAppStore.getState().openCard(task.cardId!))}><FolderOpen size={15} />{t("context.openSourceCard")}</button>}
        <button type="button" role="menuitem" onClick={() => run(() => copyText(task.title))}><Copy size={15} />{t("context.copyTask")}</button>
        <i className="context-separator" />
        <button type="button" role="menuitem" className="is-danger" onClick={() => run(async () => { const descendants = await taskDescendants(task.id); if (descendants.length && !window.confirm(hierarchyCopy.confirmDelete(task.title, descendants.length))) return; await deleteTaskEverywhere(task.id); })}><Trash2 size={15} />{t("context.deleteTask")}</button>
      </>}

      {highlight && <>
        <header><span>{t("context.highlightActions")}</span><b>{highlight.text.slice(0, 42)}</b></header>
        <button type="button" role="menuitem" data-menu-action="edit" onClick={() => { setRequest(null); setEditDialog({ kind: "highlight", id: highlight.id, draft: highlight.text, noteDraft: highlight.note }); }}><Pencil size={15} />{editCopy.edit}</button>
        <button type="button" role="menuitem" onClick={() => run(() => useAppStore.getState().openCard(highlight.cardId))}><FolderOpen size={15} />{t("context.openSourceCard")}</button>
        <button type="button" role="menuitem" onClick={() => run(() => copyText(highlight.text))}><Copy size={15} />{t("context.copyHighlight")}</button>
        <i className="context-separator" />
        <button type="button" role="menuitem" className="is-danger" onClick={() => run(() => db.highlights.delete(highlight.id))}><Trash2 size={15} />{t("context.deleteHighlight")}</button>
      </>}

      {fragment && <>
        <header><span>{t("context.fragmentActions")}</span><b>{fragment.text.slice(0, 42)}</b></header>
        <button type="button" role="menuitem" data-menu-action="edit" onClick={() => { setRequest(null); setEditDialog({ kind: "fragment", id: fragment.id, draft: fragment.text }); }}><Pencil size={15} />{editCopy.edit}</button>
        <button type="button" role="menuitem" onClick={() => run(() => db.fragments.update(fragment.id, { pinned: !fragment.pinned, updatedAt: Date.now() }))}>{fragment.pinned ? <PinOff size={15} /> : <Pin size={15} />}{fragment.pinned ? t("context.unpin") : t("context.pin")}</button>
        <button type="button" role="menuitem" onClick={() => run(async () => { const card = await cardFromFragment(); if (card) useAppStore.getState().openCard(card.id); })}><FilePlus2 size={15} />{t("context.toCard")}</button>
        <button type="button" role="menuitem" onClick={() => run(sendFragmentToBoard)}><PanelsTopLeft size={15} />{t("context.toBoard")}</button>
        <button type="button" role="menuitem" onClick={() => run(sendFragmentToKanban)}><SquareKanban size={15} />{t("context.toKanban")}</button>
        <button type="button" role="menuitem" data-menu-action="to-task" onClick={() => run(addFragmentAsTask)}><ListTodo size={15} />{contentTaskCopy.menuLabel}</button>
        <button type="button" role="menuitem" onClick={() => run(() => writeAppClipboard({ kind: "fragment-ref", fragmentId: fragment.id }, fragment.text))}><Copy size={15} />{t("context.copyText")}</button>
        <i className="context-separator" />
        <button type="button" role="menuitem" className="is-danger" onClick={() => run(() => deleteFragmentPermanently(fragment.id))}><Trash2 size={15} />{t("context.deleteFragment")}</button>
      </>}

      {board && <>
        <header><span>{t("context.boardActions")}</span><b>{board.title}</b></header>
        <button type="button" role="menuitem" data-menu-action="edit" onClick={() => run(() => useAppStore.getState().openBoard(board.id))}><Pencil size={15} />{editCopy.edit}</button>
        <button type="button" role="menuitem" onClick={() => run(() => db.boards.update(board.id, { favorite: !board.favorite, updatedAt: Date.now() }))}>{board.favorite ? <HeartOff size={15} /> : <Heart size={15} />}{board.favorite ? t("context.unfavorite") : t("context.favorite")}</button>
        <button type="button" role="menuitem" onClick={() => run(duplicateBoard)}><FilePlus2 size={15} />{t("context.duplicateBoard")}</button>
        <i className="context-separator" />
        <button type="button" role="menuitem" className="is-danger" onClick={() => run(async () => { if (window.confirm(t("context.confirmDeleteBoard", { title: board.title }))) await deleteBoardPermanently(board.id); })}><Trash2 size={15} />{t("context.deleteBoard")}</button>
      </>}
      {tag && <>
        <header><span>{t("tags.contextTitle")}</span><b>{tag.name}</b></header>
        <button type="button" role="menuitem" onClick={() => { setRequest(null); setRenameDialog({ id: tag.id, name: tag.name }); setRenameDraft(tag.name); }}><Pencil size={15} />{t("tags.rename")}</button>
        <i className="context-separator" />
        <button type="button" role="menuitem" className="is-danger" onClick={() => run(async () => { if (window.confirm(t("tags.confirmDelete", { name: tag.name }))) await deleteTag(tag.id); })}><Trash2 size={15} />{t("tags.remove")}</button>
      </>}
    </div>}
    {renameDialog && <div className="tag-rename-backdrop" onMouseDown={() => setRenameDialog(null)}>
      <form className="tag-rename-dialog" role="dialog" aria-modal="true" aria-labelledby="tag-rename-title" onSubmit={submitTagRename} onMouseDown={(event) => event.stopPropagation()}>
        <header><span>{t("tags.contextTitle")}</span><h2 id="tag-rename-title">{t("tags.renameTitle", { name: renameDialog.name })}</h2></header>
        <input autoFocus value={renameDraft} aria-label={t("tags.inputLabel")} onChange={(event) => setRenameDraft(event.target.value)} onCompositionStart={() => { renameComposing.current = true; }} onCompositionEnd={(event) => { renameComposing.current = false; setRenameDraft(event.currentTarget.value); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setRenameDialog(null); } if (event.key === "Enter" && ((event.nativeEvent as KeyboardEvent).isComposing || renameComposing.current)) event.preventDefault(); }} />
        <footer><button type="button" className="secondary-button" onClick={() => setRenameDialog(null)}>{t("common.cancel")}</button><button type="submit" className="primary-button" disabled={!renameDraft.trim()}>{t("common.save")}</button></footer>
      </form>
    </div>}
    {dueDialog && <div className="tag-rename-backdrop" onMouseDown={() => setDueDialog(null)}>
      <form className="tag-rename-dialog task-due-dialog" role="dialog" aria-modal="true" aria-labelledby="task-due-title" onSubmit={submitTaskDue} onMouseDown={(event) => event.stopPropagation()}>
        <header><span>{taskCopy.dialogEyebrow}</span><h2 id="task-due-title">{taskCopy.dialogTitle(dueDialog.title)}</h2></header>
        <TaskDatePicker value={dueDraft} onChange={setDueDraft} label={taskCopy.dueDate} autoFocus className="task-dialog-date-picker" />
        <footer><button type="button" className="secondary-button" onClick={() => setDueDialog(null)}>{t("common.cancel")}</button><button type="submit" className="primary-button" disabled={!dueDraft && !dueDialog.hadDue}>{taskCopy.saveDue}</button></footer>
      </form>
    </div>}
    {editDialog && <div className="tag-rename-backdrop content-edit-backdrop" onMouseDown={() => setEditDialog(null)}>
      <form className="tag-rename-dialog content-edit-dialog" data-content-edit={editDialog.kind} role="dialog" aria-modal="true" aria-labelledby="content-edit-title" onSubmit={submitContentEdit} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <span>{editDialog.kind === "task" ? editCopy.taskEyebrow : editDialog.kind === "fragment" ? editCopy.fragmentEyebrow : editCopy.highlightEyebrow}</span>
          <h2 id="content-edit-title">{editDialog.kind === "task" ? editCopy.taskTitle : editDialog.kind === "fragment" ? editCopy.fragmentTitle : editCopy.highlightTitle}</h2>
        </header>
        <div className="content-edit-fields">
          <label>
            <span>{editDialog.kind === "task" ? editCopy.taskLabel : editDialog.kind === "fragment" ? editCopy.fragmentLabel : editCopy.highlightTextLabel}</span>
            {editDialog.kind === "task"
              ? <input autoFocus maxLength={240} value={editDialog.draft} onChange={(event) => setEditDialog({ ...editDialog, draft: event.target.value })} onCompositionStart={() => { editComposing.current = true; }} onCompositionEnd={(event) => { editComposing.current = false; setEditDialog({ ...editDialog, draft: event.currentTarget.value }); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setEditDialog(null); } if (event.key === "Enter" && ((event.nativeEvent as KeyboardEvent).isComposing || editComposing.current)) event.preventDefault(); }} />
              : <textarea autoFocus rows={editDialog.kind === "highlight" ? 4 : 6} maxLength={editDialog.kind === "fragment" ? 500 : 2000} value={editDialog.draft} onChange={(event) => setEditDialog({ ...editDialog, draft: event.target.value })} onCompositionStart={() => { editComposing.current = true; }} onCompositionEnd={(event) => { editComposing.current = false; setEditDialog({ ...editDialog, draft: event.currentTarget.value }); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setEditDialog(null); } if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !editComposing.current && !(event.nativeEvent as KeyboardEvent).isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />}
          </label>
          {editDialog.kind === "highlight" && <label>
            <span>{editCopy.highlightNoteLabel}</span>
            <textarea rows={3} maxLength={1000} value={editDialog.noteDraft} placeholder={editCopy.highlightNotePlaceholder} onChange={(event) => setEditDialog({ ...editDialog, noteDraft: event.target.value })} onCompositionStart={() => { editComposing.current = true; }} onCompositionEnd={(event) => { editComposing.current = false; setEditDialog({ ...editDialog, noteDraft: event.currentTarget.value }); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setEditDialog(null); } if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !editComposing.current && !(event.nativeEvent as KeyboardEvent).isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
          </label>}
        </div>
        <footer><button type="button" className="secondary-button" onClick={() => setEditDialog(null)}>{t("common.cancel")}</button><button type="submit" className="primary-button" disabled={!editDialog.draft.trim()}>{t("common.save")}</button></footer>
      </form>
    </div>}
    {childDialog && <div className="tag-rename-backdrop content-edit-backdrop" onMouseDown={() => setChildDialog(null)}>
      <form className="tag-rename-dialog content-edit-dialog task-child-dialog" data-content-edit="task-child" role="dialog" aria-modal="true" aria-labelledby="task-child-title" onSubmit={submitChildTask} onMouseDown={(event) => event.stopPropagation()}>
        <header><span>{hierarchyCopy.dialogEyebrow}</span><h2 id="task-child-title">{hierarchyCopy.dialogTitle(childDialog.parentTitle)}</h2></header>
        <div className="content-edit-fields"><label><span>{hierarchyCopy.inputLabel}</span><input autoFocus maxLength={240} value={childDialog.draft} placeholder={hierarchyCopy.placeholder} onChange={(event) => setChildDialog({ ...childDialog, draft: event.target.value })} onCompositionStart={() => { childComposing.current = true; }} onCompositionEnd={(event) => { childComposing.current = false; setChildDialog({ ...childDialog, draft: event.currentTarget.value }); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setChildDialog(null); } if (event.key === "Enter" && ((event.nativeEvent as KeyboardEvent).isComposing || childComposing.current)) event.preventDefault(); }} /></label></div>
        {childDialog.inheritsDue && <p className="task-child-hint">{hierarchyCopy.inheritsDue}</p>}
        <footer><button type="button" className="secondary-button" onClick={() => setChildDialog(null)}>{t("common.cancel")}</button><button type="submit" className="primary-button" disabled={!childDialog.draft.trim()}>{t("common.add")}</button></footer>
      </form>
    </div>}
    {notice && <div className="context-action-notice" role="status" aria-live="polite"><CheckCircle2 size={15} /><span>{notice}</span></div>}
    </>
  );
}
