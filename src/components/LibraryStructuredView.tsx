import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, CheckCircle2, CheckSquare2, Circle, Pin, Square, Trash2, X } from "lucide-react";
import { db, deleteCardPermanently, moveCardToTrash } from "../db";
import { useAppStore } from "../store";
import { useI18n } from "../hooks/useI18n";
import type { MessageKey } from "../i18n";
import type { CardRecord, TagRecord, TaskRecord } from "../types";
import type { CardCollection } from "../lib/cardVisibility";
import { getHiddenTaskIds } from "../lib/visibleContent";
import { includesQuery, searchRecords } from "../lib/searchRecords";
import { showContextMenuFromPointer } from "../lib/contextMenu";
import { localizedKindLabel, relativeTime } from "../lib/utils";
import { getTaskIntegrationCopy, taskCopyFormat } from "../lib/taskIntegrationCopy";
import { getLibraryIntegrationCopy } from "../lib/libraryIntegrationCopy";
import { setTaskDone } from "../lib/taskSync";

const standardStages = ["待整理", "研究中", "進行中", "已驗證", "已整理", "完成"];
const stageKeys: Record<string, MessageKey> = { 待整理: "stage.unsorted", 研究中: "stage.research", 進行中: "stage.progress", 已驗證: "stage.verified", 已整理: "stage.organized", 完成: "stage.done" };

type Props = {
  cards: CardRecord[]; totalCards: number; tags: TagRecord[]; collection: CardCollection;
  layout: "table" | "stages"; query: string; filterKey: string;
  matchesSource: (card: CardRecord) => boolean; allowStandaloneTasks: boolean; onLoadMore: () => void;
};

/** The former database's structured tools, using the library's ONE set of filters. */
export function LibraryStructuredView({ cards, totalCards, tags, collection, layout, query, filterKey, matchesSource, allowStandaloneTasks, onLoadMore }: Props) {
  const { language, t } = useI18n();
  const copy = getTaskIntegrationCopy(language);
  const labels = getLibraryIntegrationCopy(language);
  const openCard = useAppStore((state) => state.openCard);
  const setView = useAppStore((state) => state.setView);
  const [scope, setScope] = useState<"all" | "cards" | "tasks">("all");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [taskLimit, setTaskLimit] = useState(120);
  const effectiveScope = collection === "library" ? scope : "cards";
  const taskResult = useLiveQuery(async () => {
    if (collection !== "library" || effectiveScope === "cards") return { tasks: [] as TaskRecord[], sources: [] as CardRecord[], count: 0 };
    const hidden = await getHiddenTaskIds();
    const sources = await db.cards.filter(matchesSource).toArray();
    const sourceIds = new Set(sources.map((card) => card.id));
    const matches = (task: TaskRecord) => !hidden.has(task.id) && (task.cardId ? sourceIds.has(task.cardId) : allowStandaloneTasks) && includesQuery(task.title, query, language);
    const [tasks, count] = await Promise.all([searchRecords(db.tasks, query, language, matches, taskLimit), db.tasks.filter(matches).count()]);
    return { tasks, sources, count };
  }, [filterKey, language, effectiveScope, taskLimit], { tasks: [] as TaskRecord[], sources: [] as CardRecord[], count: 0 });
  const sourceMap = useMemo(() => new Map(taskResult.sources.map((card) => [card.id, card])), [taskResult.sources]);
  const displayedCards = effectiveScope === "tasks" ? [] : cards;
  const displayedTasks = taskResult.tasks;
  const filteredIds = displayedCards.map((card) => card.id);
  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));
  // Never leave archived/deleted cards silently selected for destructive actions.
  useEffect(() => { setSelectedIds(new Set()); setSelectionMode(false); setTaskLimit(120); setError(""); }, [filterKey, effectiveScope]);
  useEffect(() => { const visible = new Set(filteredIds); setSelectedIds((current) => new Set([...current].filter((id) => visible.has(id)))); }, [filteredIds.join("|")]);
  const stageOf = (card: CardRecord) => String(card.properties.階段 || "待整理");
  const stages = [...new Set([...standardStages, ...displayedCards.map(stageOf)])];
  const stageLabel = (stage: string) => stageKeys[stage] ? t(stageKeys[stage]) : stage;
  const tagNames = (ids: string[]) => ids.map((id) => tags.find((tag) => tag.id === id)?.name).filter(Boolean).join("、");
  const taskDue = (task: TaskRecord) => task.dueAt ? taskCopyFormat(copy.due, { date: new Intl.DateTimeFormat(language, { year: "numeric", month: "short", day: "numeric" }).format(task.dueAt) }) : copy.noDue;
  function toggle(id: string) { setSelectedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function toggleAll() { setSelectedIds(allSelected ? new Set() : new Set(filteredIds)); }
  function activate(card: CardRecord) { if (selectionMode) toggle(card.id); else openCard(card.id, collection); }
  async function changeStage(card: CardRecord, stage: string) {
    setError("");
    try { const current = await db.cards.get(card.id); if (current && matchesSource(current)) await db.cards.update(card.id, { properties: { ...current.properties, 階段: stage }, updatedAt: Date.now() }); }
    catch { setError(labels.failed); }
  }
  async function removeSelected(permanent: boolean) {
    if (busy) return;
    const ids = [...selectedIds];
    if (!ids.length) return;
    if ((permanent || ids.length > 5) && !window.confirm(t(permanent ? "database.confirmDelete" : "database.confirmTrash", { count: ids.length }))) return;
    setBusy(true); setError("");
    try {
      for (const id of ids) {
        const current = await db.cards.get(id);
        if (!current || !matchesSource(current)) continue;
        if (permanent) await deleteCardPermanently(id); else await moveCardToTrash(id);
      }
      setSelectedIds(new Set()); setSelectionMode(false);
    } catch { setError(labels.failed); }
    finally { setBusy(false); }
  }
  const count = (effectiveScope === "tasks" ? 0 : totalCards) + taskResult.count;
  const more = (effectiveScope !== "tasks" && displayedCards.length < totalCards) || displayedTasks.length < taskResult.count;
  return <section className="library-structured">
    <div className="library-structured-tools">
      {collection === "library" && <div className="collection-tabs">{(["all", "cards", "tasks"] as const).map((value) => <button type="button" key={value} aria-pressed={effectiveScope === value} className={effectiveScope === value ? "is-active" : ""} onClick={() => setScope(value)}>{value === "all" ? copy.allContent : value === "cards" ? copy.cardsOnly : copy.tasksOnly}</button>)}</div>}
      <small>{taskCopyFormat(copy.matching, { count })}</small>
      {effectiveScope !== "tasks" && <button type="button" className={`secondary-button ${selectionMode ? "is-active" : ""}`} onClick={() => { setSelectionMode(!selectionMode); setSelectedIds(new Set()); }}><CheckSquare2 size={15} />{t("database.batch")}</button>}
    </div>
    {error && <p role="alert">{error}</p>}
    {selectionMode && <div className="database-bulk-bar" role="toolbar" aria-label={t("database.batchToolbar")}>
      <button type="button" onClick={toggleAll}>{allSelected ? <CheckSquare2 size={16} /> : <Square size={16} />}{allSelected ? t("database.cancelSelectAll") : t("database.selectCurrent", { count: filteredIds.length })}</button>
      <span>{selectedIds.size ? t("database.selected", { count: selectedIds.size }) : copy.batchCardsOnly}</span>
      {collection !== "trash" && <button type="button" disabled={busy || !selectedIds.size} onClick={() => void removeSelected(false)}><Trash2 size={15} />{t("database.moveTrash")}</button>}
      <button type="button" className="is-danger" disabled={busy || !selectedIds.size} onClick={() => void removeSelected(true)}><Trash2 size={15} />{t("database.deleteForever")}</button>
      <button type="button" className="bulk-close" aria-label={t("database.endBatch")} onClick={() => { setSelectionMode(false); setSelectedIds(new Set()); }}><X size={16} /></button>
    </div>}
    {layout === "table" ? <div className="data-table-wrap"><table className="data-table">
      <thead><tr>{selectionMode && <th className="selection-column"><button type="button" aria-label={t("database.selectAll")} onClick={toggleAll}>{allSelected ? <CheckSquare2 size={16} /> : <Square size={16} />}</button></th>}<th>{t("database.name")}</th><th>{t("database.type")}</th><th>{copy.status}</th><th>{copy.tagsAndDue}</th><th>{t("database.updated")}</th></tr></thead>
      <tbody>{displayedCards.map((card) => <tr key={card.id} data-library-row={card.id} className={selectedIds.has(card.id) ? "is-selected" : ""} onDoubleClick={() => !selectionMode && openCard(card.id, collection)} onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "card", id: card.id })}>
        {selectionMode && <td className="selection-column"><button type="button" aria-label={t(selectedIds.has(card.id) ? "database.unselectCard" : "database.selectCard", { title: card.title })} onClick={() => toggle(card.id)}>{selectedIds.has(card.id) ? <CheckSquare2 size={16} /> : <Square size={16} />}</button></td>}
        <td className="card-name-column"><button type="button" onClick={() => activate(card)}>{card.favorite && <Pin size={12} />}<span>{card.title}</span></button></td><td>{localizedKindLabel(card.kind, language)}</td>
        <td><select disabled={collection === "trash"} aria-label={`${copy.status} · ${card.title}`} value={stageOf(card)} onChange={(event) => void changeStage(card, event.target.value)}>{stages.map((stage) => <option key={stage} value={stage}>{stageLabel(stage)}</option>)}</select></td>
        <td><span className="table-tags">{tagNames(card.tagIds)}</span></td><td>{relativeTime(card.updatedAt, language)}</td>
      </tr>)}
      {displayedTasks.map((task) => <tr key={`task:${task.id}`} data-library-task={task.id} className="database-task-row" onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "task", id: task.id })}>
        {selectionMode && <td />}<td className="card-name-column"><button type="button" onClick={() => setView("tasks")}>{task.title}</button></td><td>{copy.tasksOnly}</td>
        <td><button type="button" className={`database-task-state ${task.done ? "is-done" : ""}`} onClick={() => void setTaskDone(task.id, !task.done).catch(() => setError(labels.failed))}>{task.done ? <CheckCircle2 size={14} /> : <Circle size={14} />}{task.done ? copy.taskDone : copy.taskOpen}</button></td>
        <td><span className="table-tags">{tagNames(task.cardId ? sourceMap.get(task.cardId)?.tagIds || [] : [])}<i className="task-due-chip">{taskDue(task)}</i></span></td><td>{relativeTime(task.updatedAt, language)}</td>
      </tr>)}{count === 0 && <tr><td colSpan={selectionMode ? 6 : 5} className="database-empty-row">{copy.empty}</td></tr>}</tbody>
    </table></div> : <div className={`kanban-board library-stage-board ${selectionMode ? "is-selecting" : ""}`}>{stages.map((stage) => {
      const stageCards = displayedCards.filter((card) => stageOf(card) === stage);
      const stageTasks = stage === "待整理" ? displayedTasks.filter((task) => !task.done) : stage === "完成" ? displayedTasks.filter((task) => task.done) : [];
      return <section key={stage}><header><span>{stageLabel(stage)}</span><b>{stageCards.length + stageTasks.length}</b></header><div>
        {stageCards.map((card) => <button type="button" key={card.id} data-library-stage-card={card.id} className={selectedIds.has(card.id) ? "is-selected" : ""} onClick={() => activate(card)} onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "card", id: card.id })}>{selectionMode && <i className="kanban-selection-mark">{selectedIds.has(card.id) && <Check size={12} />}</i>}<h3>{card.favorite && <Pin size={12} />}<span>{card.title}</span></h3><p>{localizedKindLabel(card.kind, language)} · {relativeTime(card.updatedAt, language)}</p><span>{tagNames(card.tagIds) || t("database.noTags")}</span></button>)}
        {stageTasks.map((task) => <button type="button" key={task.id} data-library-task={task.id} className="database-task-card" onClick={() => setView("tasks")} onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "task", id: task.id })}><h3>{task.title}</h3><p>{task.done ? copy.taskDone : copy.taskOpen}</p><span>{taskDue(task)}</span></button>)}
      </div></section>;
    })}</div>}
    {more && <button type="button" className="content-load-more" onClick={() => { onLoadMore(); setTaskLimit((value) => value + 120); }}>{labels.more}</button>}
  </section>;
}
