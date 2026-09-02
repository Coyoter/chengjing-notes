import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, CheckCircle2, CheckSquare2, Circle, Columns3, LayoutGrid, ListTodo, Pin, Plus, Search, Square, Table2, Trash2, X } from "lucide-react";
import { createTag, db, deleteCardPermanently, moveCardToTrash } from "../db";
import { useAppStore } from "../store";
import type { CardRecord, TaskRecord } from "../types";
import { localizedKindLabel, relativeTime } from "../lib/utils";
import { showContextMenuFromPointer } from "../lib/contextMenu";
import { useI18n } from "../hooks/useI18n";
import type { MessageKey } from "../i18n";
import { setTaskDone } from "../lib/taskSync";
import { getTaskIntegrationCopy, taskCopyFormat } from "../lib/taskIntegrationCopy";
import { searchQueryTerms } from "../lib/searchIndex";
import { isMaterializedCard } from "../lib/journalVisibility";

const stages = ["待整理", "研究中", "進行中", "已驗證", "已整理", "完成"];
const stageKeys: Record<string, MessageKey> = { 待整理: "stage.unsorted", 研究中: "stage.research", 進行中: "stage.progress", 已驗證: "stage.verified", 已整理: "stage.organized", 完成: "stage.done" };
type ContentScope = "all" | "cards" | "tasks" | "pinned";

export function DatabaseView() {
  const [layout, setLayout] = useState<"table" | "kanban">("table");
  const [scope, setScope] = useState<ContentScope>("all");
  const [query, setQuery] = useState("");
  const [newTag, setNewTag] = useState("");
  const [showAddTag, setShowAddTag] = useState(false);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(180);
  const tagComposing = useRef(false);
  const tagSaving = useRef(false);
  const { language, t } = useI18n();
  const tags = useLiveQuery(() => db.tags.orderBy("name").toArray(), [], []);
  const selectedTag = tags.find((tag) => tag.id === selectedTagId);
  const taggedCardIds = useLiveQuery(async () => selectedTagId
    ? (await db.cards.where("tagIds").equals(selectedTagId).filter((card) => card.state !== "trash" && isMaterializedCard(card)).primaryKeys()).map(String)
    : [], [selectedTagId], []);
  const taggedCardSet = useMemo(() => new Set(taggedCardIds), [taggedCardIds]);
  const normalized = query.trim().toLocaleLowerCase(language);
  const cardMatches = (card: CardRecord) => card.state !== "trash"
    && isMaterializedCard(card)
    && scope !== "tasks"
    && (scope !== "pinned" || card.favorite)
    && (!selectedTagId || card.tagIds.includes(selectedTagId))
    && (!normalized || `${card.title} ${card.plainText}`.toLocaleLowerCase(language).includes(normalized));
  const cards = useLiveQuery(async () => {
    const terms = searchQueryTerms(query, language);
    if (scope === "tasks") return [];
    if (terms.length) return (await db.cards.where("searchTerms").anyOf(terms).distinct().toArray()).filter(cardMatches).sort((left, right) => Number(right.favorite) - Number(left.favorite) || right.updatedAt - left.updatedAt).slice(0, displayLimit);
    const recent = await db.cards.orderBy("updatedAt").reverse().filter(cardMatches).limit(displayLimit).toArray();
    if (scope === "pinned") return recent;
    const pinned = await db.cards.filter((card) => card.favorite && cardMatches(card)).limit(displayLimit).toArray();
    return [...new Map([...pinned, ...recent].map((card) => [card.id, card])).values()].sort((left, right) => Number(right.favorite) - Number(left.favorite) || right.updatedAt - left.updatedAt).slice(0, displayLimit);
  }, [displayLimit, language, query, scope, selectedTagId], []);
  const tasks = useLiveQuery(async () => {
    if (scope === "cards" || scope === "pinned") return [];
    const terms = searchQueryTerms(query, language);
    const candidates = terms.length
      ? await db.tasks.where("searchTerms").anyOf(terms).distinct().toArray()
      : await db.tasks.orderBy("updatedAt").reverse().filter((task) => !selectedTagId || Boolean(task.cardId && taggedCardSet.has(task.cardId))).limit(displayLimit).toArray();
    const filtered = candidates.filter((task) => (!selectedTagId || Boolean(task.cardId && taggedCardSet.has(task.cardId))) && (!normalized || task.title.toLocaleLowerCase(language).includes(normalized)));
    const sourceCards = await db.cards.bulkGet([...new Set(filtered.map((task) => task.cardId).filter(Boolean) as string[])]);
    const sourceStates = new Map(sourceCards.filter(Boolean).map((card) => [card!.id, card!.state]));
    return filtered.filter((task) => !task.cardId || sourceStates.get(task.cardId) !== "trash").slice(0, displayLimit);
  }, [displayLimit, language, normalized, query, scope, selectedTagId, taggedCardIds.join("|")], []);
  const openCard = useAppStore((state) => state.openCard);
  const setView = useAppStore((state) => state.setView);
  const copy = getTaskIntegrationCopy(language);
  const sourceCardIds = useMemo(() => [...new Set(tasks.map((task) => task.cardId).filter(Boolean) as string[])], [tasks]);
  const sourceCards = useLiveQuery(async () => (await db.cards.bulkGet(sourceCardIds)).filter(Boolean) as CardRecord[], [sourceCardIds.join("|")], []);
  const cardMap = useMemo(() => new Map([...cards, ...sourceCards].map((card) => [card.id, card])), [cards, sourceCards]);
  const taskTagIds = (task: TaskRecord) => task.cardId ? cardMap.get(task.cardId)?.tagIds || [] : [];
  const filteredCards = cards;
  const filteredTasks = tasks;
  const filteredIds = useMemo(() => filteredCards.map((card) => card.id), [filteredCards]);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));
  const totalFiltered = useLiveQuery(async () => {
    const terms = searchQueryTerms(query, language);
    const cardCount = scope === "tasks" ? 0 : terms.length
      ? (await db.cards.where("searchTerms").anyOf(terms).distinct().toArray()).filter(cardMatches).length
      : await db.cards.filter(cardMatches).count();
    if (scope === "cards" || scope === "pinned") return cardCount;
    const taskCandidates = terms.length ? await db.tasks.where("searchTerms").anyOf(terms).distinct().toArray() : null;
    const taskCount = taskCandidates
      ? taskCandidates.filter((task) => (!selectedTagId || Boolean(task.cardId && taggedCardSet.has(task.cardId))) && (!normalized || task.title.toLocaleLowerCase(language).includes(normalized))).length
      : await db.tasks.filter((task) => !selectedTagId || Boolean(task.cardId && taggedCardSet.has(task.cardId))).count();
    return cardCount + taskCount;
  }, [language, normalized, query, scope, selectedTagId, taggedCardIds.join("|")], 0);
  const databaseCounts = useLiveQuery(async () => {
    const [allCards, pinnedCards, allTasks, tagCounts] = await Promise.all([
      db.cards.filter((card) => card.state !== "trash" && isMaterializedCard(card)).count(),
      db.cards.filter((card) => card.state !== "trash" && card.favorite && isMaterializedCard(card)).count(),
      db.tasks.count(),
      Promise.all(tags.map(async (tag) => {
        const cardIds = (await db.cards.where("tagIds").equals(tag.id).filter((card) => card.state !== "trash" && isMaterializedCard(card)).primaryKeys()).map(String);
        const taskCount = cardIds.length ? await db.tasks.where("cardId").anyOf(cardIds).count() : 0;
        return [tag.id, cardIds.length + taskCount] as const;
      })),
    ]);
    return { allCards, pinnedCards, allTasks, tagCounts: Object.fromEntries(tagCounts) as Record<string, number> };
  }, [tags.map((tag) => tag.id).join("|")], { allCards: 0, pinnedCards: 0, allTasks: 0, tagCounts: {} as Record<string, number> });
  const displayedCards = filteredCards;
  const displayedTasks = useMemo(() => filteredTasks.slice(0, Math.max(0, displayLimit - displayedCards.length)), [displayLimit, displayedCards.length, filteredTasks]);
  const displayedCount = displayedCards.length + displayedTasks.length;
  const loadMoreLabel = ({ "zh-TW": "顯示更多內容", "zh-CN": "显示更多内容", en: "Show more", ja: "さらに表示", ko: "더 보기" } as const)[language];

  useEffect(() => { setSelectedIds(new Set()); }, [selectedTagId, scope]);
  useEffect(() => { setDisplayLimit(180); }, [layout, query, scope, selectedTagId]);
  useEffect(() => { if (selectedTagId && !tags.some((tag) => tag.id === selectedTagId)) setSelectedTagId(null); }, [selectedTagId, tags]);

  async function updateStage(card: CardRecord, stage: string) { await db.cards.update(card.id, { properties: { ...card.properties, 階段: stage }, updatedAt: Date.now() }); }
  async function saveNewTag() {
    const name = newTag.trim();
    if (!name || tagSaving.current) return;
    tagSaving.current = true;
    try { const tag = await createTag(name); setNewTag(""); setShowAddTag(false); setSelectedTagId(tag.id); }
    finally { tagSaving.current = false; }
  }
  function chooseScope(value: ContentScope) { setScope(value); setSelectedTagId(null); }
  function toggleCard(id: string) { setSelectedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function toggleAllFiltered() { setSelectedIds((current) => { const next = new Set(current); if (allFilteredSelected) filteredIds.forEach((id) => next.delete(id)); else filteredIds.forEach((id) => next.add(id)); return next; }); }
  function leaveSelectionMode() { setSelectionMode(false); setSelectedIds(new Set()); }
  async function moveSelectedToTrash() {
    const ids = [...selectedIds]; if (!ids.length) return;
    if (ids.length > 5 && !window.confirm(t("database.confirmTrash", { count: ids.length }))) return;
    setBulkBusy(true); try { await Promise.all(ids.map((id) => moveCardToTrash(id))); leaveSelectionMode(); } finally { setBulkBusy(false); }
  }
  async function permanentlyDeleteSelected() {
    const ids = [...selectedIds]; if (!ids.length) return;
    if (!window.confirm(t("database.confirmDelete", { count: ids.length }))) return;
    setBulkBusy(true); try { for (const id of ids) await deleteCardPermanently(id); leaveSelectionMode(); } finally { setBulkBusy(false); }
  }
  function activateCard(card: CardRecord) { if (selectionMode) toggleCard(card.id); else openCard(card.id); }
  function activateTask() { if (!selectionMode) setView("tasks"); }
  function taskDue(task: TaskRecord) { return task.dueAt ? taskCopyFormat(copy.due, { date: new Intl.DateTimeFormat(language, { year: "numeric", month: "short", day: "numeric" }).format(task.dueAt) }) : copy.noDue; }
  function tagNames(ids: string[]) { return ids.slice(0, 3).map((id) => tags.find((tag) => tag.id === id)?.name).filter(Boolean); }
  function scopeTitle() { if (selectedTag) return selectedTag.name; return scope === "tasks" ? copy.tasksOnly : scope === "cards" ? copy.cardsOnly : scope === "pinned" ? t("database.pinned") : copy.allContent; }

  return <div className="database-page">
    <div className="database-sidebar">
      <header><span>{t("nav.database")}</span><button type="button" className="bare-button" aria-label={t("database.addTag")} onClick={() => setShowAddTag(!showAddTag)}><Plus size={15} /></button></header>
      {showAddTag && <form className="sidebar-tag-form" onSubmit={(event) => { event.preventDefault(); if (!tagComposing.current) void saveNewTag(); }}><input autoFocus value={newTag} onChange={(event) => setNewTag(event.target.value)} onCompositionStart={() => { tagComposing.current = true; }} onCompositionEnd={(event) => { tagComposing.current = false; setNewTag(event.currentTarget.value); }} onBlur={() => { if (!tagComposing.current) void saveNewTag(); }} onKeyDown={(event) => { if (event.key === "Enter" && ((event.nativeEvent as KeyboardEvent).isComposing || tagComposing.current)) event.preventDefault(); }} placeholder={t("database.newTag")} /><button type="submit">{t("common.add")}</button></form>}
      <button type="button" className={scope === "all" && selectedTagId === null ? "is-active" : ""} aria-pressed={scope === "all" && selectedTagId === null} onClick={() => chooseScope("all")}><LayoutGrid size={15} /><span>{copy.allContent}</span><b>{databaseCounts.allCards + databaseCounts.allTasks}</b></button>
      <button type="button" className={scope === "cards" && selectedTagId === null ? "is-active" : ""} aria-pressed={scope === "cards" && selectedTagId === null} onClick={() => chooseScope("cards")}><Table2 size={15} /><span>{copy.cardsOnly}</span><b>{databaseCounts.allCards}</b></button>
      <button type="button" className={scope === "pinned" && selectedTagId === null ? "is-active" : ""} aria-pressed={scope === "pinned" && selectedTagId === null} onClick={() => chooseScope("pinned")}><Pin size={15} /><span>{t("database.pinned")}</span><b>{databaseCounts.pinnedCards}</b></button>
      <button type="button" className={scope === "tasks" && selectedTagId === null ? "is-active" : ""} aria-pressed={scope === "tasks" && selectedTagId === null} onClick={() => chooseScope("tasks")}><ListTodo size={15} /><span>{copy.tasksOnly}</span><b>{databaseCounts.allTasks}</b></button>
      <h3>{t("database.byTag")}</h3>
      {tags.map((tag) => <button type="button" key={tag.id} className={selectedTagId === tag.id ? "is-active" : ""} aria-pressed={selectedTagId === tag.id} onClick={() => setSelectedTagId(tag.id)} onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "tag", id: tag.id })}><i className={`tone-${tag.color}`} /><span>{tag.name}</span><b>{databaseCounts.tagCounts[tag.id] || 0}</b></button>)}
    </div>

    <section className="database-content">
      <header className="database-header">
        <div><span>{selectedTag ? t("database.filterByTag") : t("database.structured")}</span><h2>{scopeTitle()}</h2><small>{taskCopyFormat(copy.matching, { count: totalFiltered })}</small></div>
        <div className="database-tools">
          <label className="inline-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("database.search")} /></label>
          {scope !== "tasks" && <button type="button" className={selectionMode ? "database-select-mode is-active" : "database-select-mode"} onClick={() => selectionMode ? leaveSelectionMode() : setSelectionMode(true)}><CheckSquare2 size={15} />{t("database.batch")}</button>}
          <div className="view-toggle"><button type="button" className={layout === "table" ? "is-active" : ""} onClick={() => setLayout("table")} aria-label={t("database.table")}><Table2 size={16} /></button><button type="button" className={layout === "kanban" ? "is-active" : ""} onClick={() => setLayout("kanban")} aria-label={t("database.kanban")}><Columns3 size={16} /></button></div>
        </div>
      </header>

      {selectionMode && <div className="database-bulk-bar" role="toolbar" aria-label={t("database.batchToolbar")}>
        <button type="button" className="bulk-select-all" onClick={toggleAllFiltered}>{allFilteredSelected ? <CheckSquare2 size={16} /> : <Square size={16} />}{allFilteredSelected ? t("database.cancelSelectAll") : t("database.selectCurrent", { count: filteredCards.length })}</button>
        <span>{selectedIds.size > 0 ? t("database.selected", { count: selectedIds.size }) : copy.batchCardsOnly}</span>
        <button type="button" disabled={bulkBusy || selectedIds.size === 0} onClick={moveSelectedToTrash}><Trash2 size={15} />{t("database.moveTrash")}</button>
        <button type="button" className="is-danger" disabled={bulkBusy || selectedIds.size === 0} onClick={permanentlyDeleteSelected}><Trash2 size={15} />{t("database.deleteForever")}</button>
        <button type="button" className="bulk-close" onClick={leaveSelectionMode} aria-label={t("database.endBatch")}><X size={16} /></button>
      </div>}

      {layout === "table" ? <div className="data-table-wrap"><table className="data-table">
        <thead><tr>{selectionMode && <th className="selection-column"><button type="button" onClick={toggleAllFiltered} aria-label={allFilteredSelected ? t("database.cancelSelectAll") : t("database.selectAll")}>{allFilteredSelected ? <CheckSquare2 size={16} /> : <Square size={16} />}</button></th>}<th>{t("database.name")}</th><th>{t("database.type")}</th><th>{copy.status}</th><th>{copy.tagsAndDue}</th><th>{t("database.updated")}</th></tr></thead>
        <tbody>
          {displayedCards.map((card) => <tr key={`card:${card.id}`} className={selectedIds.has(card.id) ? "is-selected" : ""} onClick={() => selectionMode && toggleCard(card.id)} onDoubleClick={() => !selectionMode && openCard(card.id)} onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "card", id: card.id })}>
            {selectionMode && <td className="selection-column"><button type="button" aria-label={selectedIds.has(card.id) ? t("database.unselectCard", { title: card.title }) : t("database.selectCard", { title: card.title })} onClick={(event) => { event.stopPropagation(); toggleCard(card.id); }}>{selectedIds.has(card.id) ? <CheckSquare2 size={16} /> : <Square size={16} />}</button></td>}
            <td className="card-name-column"><button type="button" onClick={(event) => { event.stopPropagation(); activateCard(card); }}>{card.favorite && <Pin size={12} aria-label={t("database.pinned")} />}<span>{card.title}</span></button></td><td>{localizedKindLabel(card.kind, language)}</td>
            <td><select value={String(card.properties.階段 || "待整理")} onClick={(event) => event.stopPropagation()} onChange={(event) => updateStage(card, event.target.value)}>{stages.map((stage) => <option key={stage} value={stage}>{t(stageKeys[stage])}</option>)}</select></td>
            <td><span className="table-tags">{tagNames(card.tagIds).map((name) => <i key={name}>{name}</i>)}</span></td><td>{relativeTime(card.updatedAt, language)}</td>
          </tr>)}
          {displayedTasks.map((task) => <tr key={`task:${task.id}`} className="database-task-row" onDoubleClick={activateTask} onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "task", id: task.id })}>
            {selectionMode && <td className="selection-column" aria-hidden="true" />}
            <td className="card-name-column"><button type="button" onClick={activateTask}>{task.title}</button></td><td>{copy.tasksOnly}</td>
            <td><button type="button" className={`database-task-state ${task.done ? "is-done" : ""}`} onClick={(event) => { event.stopPropagation(); void setTaskDone(task.id, !task.done); }}>{task.done ? <CheckCircle2 size={14} /> : <Circle size={14} />}{task.done ? copy.taskDone : copy.taskOpen}</button></td>
            <td><span className="table-tags">{tagNames(taskTagIds(task)).map((name) => <i key={name}>{name}</i>)}<i className="task-due-chip">{taskDue(task)}</i></span></td><td>{relativeTime(task.updatedAt, language)}</td>
          </tr>)}
          {totalFiltered === 0 && <tr><td colSpan={selectionMode ? 6 : 5} className="database-empty-row">{copy.empty}</td></tr>}
        </tbody>
      </table></div> : <div className={`kanban-board ${selectionMode ? "is-selecting" : ""}`}>
        {stages.map((stage) => {
          const cardList = displayedCards.filter((card) => String(card.properties.階段 || "待整理") === stage);
          const taskList = stage === "待整理" ? displayedTasks.filter((task) => !task.done) : stage === "完成" ? displayedTasks.filter((task) => task.done) : [];
          return <section key={stage}><header><span>{t(stageKeys[stage])}</span><b>{cardList.length + taskList.length}</b></header><div>
            {cardList.map((card) => <button type="button" key={`card:${card.id}`} className={selectedIds.has(card.id) ? "is-selected" : ""} onClick={() => activateCard(card)} onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "card", id: card.id })}>{selectionMode && <i className="kanban-selection-mark">{selectedIds.has(card.id) ? <Check size={12} /> : null}</i>}<h3>{card.favorite && <Pin size={12} aria-label={t("database.pinned")} />}<span>{card.title}</span></h3><p>{localizedKindLabel(card.kind, language)} · {relativeTime(card.updatedAt, language)}</p><span>{tagNames(card.tagIds).join("、") || t("database.noTags")}</span></button>)}
            {taskList.map((task) => <button type="button" key={`task:${task.id}`} className="database-task-card" onClick={activateTask} onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "task", id: task.id })}><i>{task.done ? <CheckCircle2 size={13} /> : <Circle size={13} />}</i><h3>{task.title}</h3><p>{copy.tasksOnly} · {relativeTime(task.updatedAt, language)}</p><span>{taskDue(task)}</span></button>)}
          </div></section>;
        })}
      </div>}
      {displayedCount < totalFiltered && <button type="button" className="content-load-more" onClick={() => setDisplayLimit((value) => value + 180)}>{loadMoreLabel}</button>}
    </section>
  </div>;
}
