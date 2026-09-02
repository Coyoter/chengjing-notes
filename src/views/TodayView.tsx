import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight, CalendarClock, Check, Circle, Feather, FilePlus2, Sparkles } from "lucide-react";
import { db } from "../db";
import { useAppStore } from "../store";
import { CardListItem } from "../components/CardListItem";
import { showContextMenuFromPointer } from "../lib/contextMenu";
import { useI18n } from "../hooks/useI18n";
import { isMaterializedCard } from "../lib/journalVisibility";
import { setTaskDone } from "../lib/taskSync";

export function TodayView() {
  const recentCards = useLiveQuery(() => db.cards.orderBy("updatedAt").reverse().filter((card) => card.state !== "trash" && isMaterializedCard(card)).limit(4).toArray(), [], []);
  const tasks = useLiveQuery(() => db.tasks.orderBy("dueAt").filter((task) => !task.done && !task.parentTaskId).limit(4).toArray(), [], []);
  const boards = useLiveQuery(() => db.boards.orderBy("updatedAt").reverse().limit(3).toArray(), [], []);
  const fragmentCount = useLiveQuery(() => db.fragments.count(), [], 0);
  const cardCount = useLiveQuery(() => db.cards.filter((card) => card.state !== "trash" && isMaterializedCard(card)).count(), [], 0);
  const boardCount = useLiveQuery(() => db.boards.count(), [], 0);
  const setView = useAppStore((state) => state.setView);
  const openBoard = useAppStore((state) => state.openBoard);
  const setCreateCardOpen = useAppStore((state) => state.setCreateCardOpen);
  const openAI = useAppStore((state) => state.openAI);
  const { intlLocale, t } = useI18n();

  const hour = new Date().getHours();
  const greeting = hour < 11 ? t("today.morning") : hour < 18 ? t("today.afternoon") : t("today.evening");
  const formatDate = (value: number | Date) => new Intl.DateTimeFormat(intlLocale, { month: "numeric", day: "numeric" }).format(value);

  return (
    <div className="page-scroll today-page">
      <section className="today-hero">
        <div>
          <span>{new Intl.DateTimeFormat(intlLocale, { month: "long", day: "numeric", weekday: "long" }).format(new Date())}</span>
          <h2>{t("today.question", { greeting })}</h2>
          <p>{t("today.startCard")}</p>
        </div>
        <div className="hero-actions">
          <button type="button" className="primary-button" onClick={() => setCreateCardOpen(true)}><FilePlus2 size={16} />{t("today.newCard")}</button>
          <button type="button" className="secondary-button" onClick={openAI}><Sparkles size={16} />{t("today.discussAI")}</button>
        </div>
      </section>

      <section className="metric-row" aria-label={t("today.summary")}>
        <button type="button" onClick={() => setView("fragments")}>
          <Feather size={18} />
          <span><b>{fragmentCount}</b><small>{t("nav.fragments")}</small></span>
          <ArrowRight size={15} />
        </button>
        <button type="button" onClick={() => setView("library")}>
          <FilePlus2 size={18} />
          <span><b>{cardCount}</b><small>{t("today.allCards")}</small></span>
          <ArrowRight size={15} />
        </button>
        <button type="button" onClick={() => setView("boards")}>
          <CalendarClock size={18} />
          <span><b>{boardCount}</b><small>{t("today.researchBoards")}</small></span>
          <ArrowRight size={15} />
        </button>
      </section>

      <div className="today-grid">
        <section className="surface-panel recent-panel">
          <header className="section-heading">
            <div><span>{t("today.continue")}</span><h2>{t("today.recentCards")}</h2></div>
            <button type="button" className="text-button" onClick={() => setView("library")}>{t("today.viewAll")} <ArrowRight size={14} /></button>
          </header>
          <div className="card-list">
            {recentCards.map((card) => <CardListItem key={card.id} card={card} compact />)}
          </div>
        </section>

        <section className="surface-panel focus-panel">
          <header className="section-heading">
            <div><span>{t("today.visualContext")}</span><h2>{t("today.recentBoards")}</h2></div>
          </header>
          <div className="board-preview-list">
            {boards.map((board, index) => (
              <button type="button" key={board.id} onClick={() => openBoard(board.id)} onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "board", id: board.id })}>
                <div className={`mini-board mini-board-${index + 1}`} aria-hidden="true">
                  <i /><i /><i /><i />
                  <svg viewBox="0 0 100 54"><path d="M20 18 C35 18, 38 37, 52 36 S70 20, 83 28" /></svg>
                </div>
                <span><b>{board.title}</b><small>{board.description || t("today.noDescription")}</small></span>
                <ArrowRight size={15} />
              </button>
            ))}
          </div>
        </section>

        <section className="surface-panel task-panel">
          <header className="section-heading">
            <div><span>{t("today.next")}</span><h2>{t("today.tasks")}</h2></div>
            <button type="button" className="text-button" onClick={() => setView("tasks")}>{t("today.manageTasks")} <ArrowRight size={14} /></button>
          </header>
          <div className="task-list">
            {tasks.map((task) => (
              <label key={task.id} onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "task", id: task.id })}>
                <button
                  type="button"
                  className="task-check"
                  aria-label={t("today.completeTask", { title: task.title })}
                  onClick={() => void setTaskDone(task.id, true)}
                ><Circle size={17} /></button>
                <span><b>{task.title}</b><small>{task.dueAt ? t("today.due", { date: formatDate(task.dueAt) }) : t("today.noDue")}</small></span>
              </label>
            ))}
            {tasks.length === 0 && <div className="inline-empty"><Check size={18} /><span>{t("today.noTasks")}</span></div>}
          </div>
        </section>
      </div>
    </div>
  );
}
