import { Check, CheckCircle2, CheckSquare2, Circle, Pin, Square } from "lucide-react";
import { db } from "../db";
import { useI18n } from "../hooks/useI18n";
import type { MessageKey } from "../i18n";
import type { CardRecord, TagRecord, TaskRecord } from "../types";
import { localizedKindLabel, relativeTime } from "../lib/utils";
import { showContextMenuFromPointer } from "../lib/contextMenu";
import { setTaskDone } from "../lib/taskSync";
import { getTaskIntegrationCopy, taskCopyFormat } from "../lib/taskIntegrationCopy";

const defaultStages = ["待整理", "研究中", "進行中", "已驗證", "已整理", "完成"];
const stageKeys: Record<string, MessageKey> = { 待整理: "stage.unsorted", 研究中: "stage.research", 進行中: "stage.progress", 已驗證: "stage.verified", 已整理: "stage.organized", 完成: "stage.done" };

interface Props {
  cards: CardRecord[]; tasks: TaskRecord[]; tags: TagRecord[]; taskTags: Record<string, string[]>; layout: "table" | "kanban";
  selectionMode: boolean; selectedIds: ReadonlySet<string>; total: number;
  toggleCard: (id: string) => void; toggleAllFiltered: () => void;
  openCard: (id: string) => void; openTasks: () => void;
}
export function LibraryStructuredContent({ cards: displayedCards, tasks: displayedTasks, tags, taskTags, layout, selectionMode, selectedIds, total: totalFiltered, toggleCard, toggleAllFiltered, openCard, openTasks }: Props) {
  const { language, t } = useI18n();
  const copy = getTaskIntegrationCopy(language);
  const stages = [...new Set([...defaultStages, ...displayedCards.map((card) => String(card.properties.階段 || "待整理"))])];
  const allFilteredSelected = displayedCards.length > 0 && displayedCards.every((card) => selectedIds.has(card.id));
  async function updateStage(card: CardRecord, stage: string) {
    await db.cards.update(card.id, { properties: { ...card.properties, 階段: stage }, updatedAt: Date.now() });
  }
  function activateCard(card: CardRecord) { if (selectionMode) toggleCard(card.id); else openCard(card.id); }
  function activateTask() { if (!selectionMode) openTasks(); }
  function taskDue(task: TaskRecord) { return task.dueAt ? taskCopyFormat(copy.due, { date: new Intl.DateTimeFormat(language, { year: "numeric", month: "short", day: "numeric" }).format(task.dueAt) }) : copy.noDue; }
  function tagNames(ids: string[]) { return ids.slice(0, 3).map((id) => tags.find((tag) => tag.id === id)?.name).filter(Boolean); }
  return <div className="library-structured-content">
      {layout === "table" ? <div className="data-table-wrap"><table className="data-table">
        <thead><tr>{selectionMode && <th className="selection-column"><button type="button" onClick={toggleAllFiltered} aria-label={allFilteredSelected ? t("database.cancelSelectAll") : t("database.selectAll")}>{allFilteredSelected ? <CheckSquare2 size={16} /> : <Square size={16} />}</button></th>}<th>{t("database.name")}</th><th>{t("database.type")}</th><th>{copy.status}</th><th>{copy.tagsAndDue}</th><th>{t("database.updated")}</th></tr></thead>
        <tbody>
          {displayedCards.map((card) => <tr key={`card:${card.id}`} className={selectedIds.has(card.id) ? "is-selected" : ""} onClick={() => selectionMode && toggleCard(card.id)} onDoubleClick={() => !selectionMode && openCard(card.id)} onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "card", id: card.id })}>
            {selectionMode && <td className="selection-column"><button type="button" aria-label={selectedIds.has(card.id) ? t("database.unselectCard", { title: card.title }) : t("database.selectCard", { title: card.title })} onClick={(event) => { event.stopPropagation(); toggleCard(card.id); }}>{selectedIds.has(card.id) ? <CheckSquare2 size={16} /> : <Square size={16} />}</button></td>}
            <td className="card-name-column"><button type="button" onClick={(event) => { event.stopPropagation(); activateCard(card); }}>{card.favorite && <Pin size={12} aria-label={t("database.pinned")} />}<span>{card.title}</span></button></td><td>{localizedKindLabel(card.kind, language)}</td>
            <td><select value={String(card.properties.階段 || "待整理")} aria-label={`${t("database.stage")} · ${card.title}`} onClick={(event) => event.stopPropagation()} onChange={(event) => updateStage(card, event.target.value)}>{stages.map((stage) => <option key={stage} value={stage}>{stageKeys[stage] ? t(stageKeys[stage]) : stage}</option>)}</select></td>
            <td><span className="table-tags">{tagNames(card.tagIds).map((name) => <i key={name}>{name}</i>)}</span></td><td>{relativeTime(card.updatedAt, language)}</td>
          </tr>)}
          {displayedTasks.map((task) => <tr key={`task:${task.id}`} className="database-task-row" onDoubleClick={activateTask} onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "task", id: task.id })}>
            {selectionMode && <td className="selection-column" aria-hidden="true" />}
            <td className="card-name-column"><button type="button" onClick={activateTask}>{task.title}</button></td><td>{copy.tasksOnly}</td>
            <td><button type="button" className={`database-task-state ${task.done ? "is-done" : ""}`} onClick={(event) => { event.stopPropagation(); void setTaskDone(task.id, !task.done); }}>{task.done ? <CheckCircle2 size={14} /> : <Circle size={14} />}{task.done ? copy.taskDone : copy.taskOpen}</button></td>
            <td><span className="table-tags">{tagNames(taskTags[task.id] || []).map((name) => <i key={name}>{name}</i>)}<i className="task-due-chip">{taskDue(task)}</i></span></td><td>{relativeTime(task.updatedAt, language)}</td>
          </tr>)}
          {totalFiltered === 0 && <tr><td colSpan={selectionMode ? 6 : 5} className="database-empty-row">{copy.empty}</td></tr>}
        </tbody>
      </table></div> : <div className={`kanban-board ${selectionMode ? "is-selecting" : ""}`}>
        {stages.map((stage) => {
          const cardList = displayedCards.filter((card) => String(card.properties.階段 || "待整理") === stage);
          const taskList = stage === "待整理" ? displayedTasks.filter((task) => !task.done) : stage === "完成" ? displayedTasks.filter((task) => task.done) : [];
          return <section key={stage}><header><span>{stageKeys[stage] ? t(stageKeys[stage]) : stage}</span><b>{cardList.length + taskList.length}</b></header><div>
            {cardList.map((card) => <button type="button" key={`card:${card.id}`} className={selectedIds.has(card.id) ? "is-selected" : ""} onClick={() => activateCard(card)} onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "card", id: card.id })}>{selectionMode && <i className="kanban-selection-mark">{selectedIds.has(card.id) ? <Check size={12} /> : null}</i>}<h3>{card.favorite && <Pin size={12} aria-label={t("database.pinned")} />}<span>{card.title}</span></h3><p>{localizedKindLabel(card.kind, language)} · {relativeTime(card.updatedAt, language)}</p><span>{tagNames(card.tagIds).join("、") || t("database.noTags")}</span></button>)}
            {taskList.map((task) => <button type="button" key={`task:${task.id}`} className="database-task-card" onClick={activateTask} onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "task", id: task.id })}><i>{task.done ? <CheckCircle2 size={13} /> : <Circle size={13} />}</i><h3>{task.title}</h3><p>{copy.tasksOnly} · {relativeTime(task.updatedAt, language)}</p><span>{taskDue(task)}</span></button>)}
          </div></section>;
        })}
      </div>}
  </div>;
}
