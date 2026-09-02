import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import dayjs from "dayjs";
import { CalendarDays, ChevronLeft, ChevronRight, Circle, Highlighter, Sparkles } from "lucide-react";
import { db, getOrCreateJournal, updateCardWithHistory } from "../db";
import { useAppStore } from "../store";
import { RichEditor } from "../components/RichEditor";
import { TagPicker } from "../components/TagPicker";
import { TaskDatePicker } from "../components/TaskDatePicker";
import { showContextMenuFromPointer } from "../lib/contextMenu";
import { useI18n } from "../hooks/useI18n";
import { setTaskDone } from "../lib/taskSync";

export function JournalView() {
  const journalDate = useAppStore((state) => state.journalDate);
  const setJournalDate = useAppStore((state) => state.setJournalDate);
  const openAI = useAppStore((state) => state.openAI);
  const [journalId, setJournalId] = useState<string | null>(null);
  const [highlightNotice, setHighlightNotice] = useState("");
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const journal = useLiveQuery(() => journalId ? db.cards.get(journalId) : undefined, [journalId]);
  const tasks = useLiveQuery(() => db.tasks.orderBy("dueAt").filter((task) => !task.done && !task.parentTaskId).limit(6).toArray(), [], []);
  const { dayjsLocale, intlLocale, t } = useI18n();

  useEffect(() => {
    getOrCreateJournal(journalDate).then((card) => setJournalId(card.id));
  }, [journalDate]);

  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
  }, []);

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => dayjs(journalDate).add(index - 3, "day")), [journalDate]);

  if (!journal) return <div className="workspace-loading">{t("journal.opening")}</div>;
  const currentJournalId = journal.id;

  function showHighlightNotice(message: string) {
    setHighlightNotice(message);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightNotice(""), 2400);
  }

  async function createJournalHighlight(text: string) {
    const cleanText = text.trim();
    if (!cleanText) return;
    const existing = await db.highlights.where("cardId").equals(currentJournalId).filter((item) => item.text.trim() === cleanText).first();
    if (existing) {
      showHighlightNotice(t("card.highlightExists"));
      return;
    }
    await db.highlights.add({ id: crypto.randomUUID(), cardId: currentJournalId, text: cleanText, note: "", color: "amber", createdAt: Date.now() });
    showHighlightNotice(t("card.highlightAdded"));
  }

  return (
    <div className="journal-layout">
      <section className="journal-main">
        <div className="journal-calendar-strip">
          <button type="button" className="icon-button" aria-label={t("journal.previous")} onClick={() => setJournalDate(dayjs(journalDate).subtract(1, "day").format("YYYY-MM-DD"))}><ChevronLeft size={17} /></button>
          <div className="journal-week-days">
            {days.map((date) => (
              <button type="button" key={date.format("YYYY-MM-DD")} className={date.format("YYYY-MM-DD") === journalDate ? "is-active" : ""} aria-label={new Intl.DateTimeFormat(intlLocale, { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(date.toDate())} onClick={() => setJournalDate(date.format("YYYY-MM-DD"))}>
                <span>{date.locale(dayjsLocale).format("dd")}</span><b>{new Intl.DateTimeFormat(intlLocale, { month: "numeric", day: "numeric" }).format(date.toDate())}</b>
              </button>
            ))}
          </div>
          <button type="button" className="icon-button" aria-label={t("journal.next")} onClick={() => setJournalDate(dayjs(journalDate).add(1, "day").format("YYYY-MM-DD"))}><ChevronRight size={17} /></button>
          <div className="journal-date-navigation-actions">
            <button type="button" className={`journal-today-button ${journalDate === dayjs().format("YYYY-MM-DD") ? "is-active" : ""}`} onClick={() => setJournalDate(dayjs().format("YYYY-MM-DD"))}>{t("journal.today")}</button>
            <TaskDatePicker value={journalDate} onChange={setJournalDate} label={t("journal.chooseDate")} buttonText={t("journal.chooseDate")} calendarLabel={t("journal.calendarLabel")} clearable={false} showPresets={false} className="journal-date-picker" />
          </div>
        </div>
        <article className="journal-paper">
          <header onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "card", id: journal.id })}>
            <div className="journal-heading-copy">
              <span>{dayjs(journalDate).locale(dayjsLocale).format("dddd")}</span>
              <h2>{new Intl.DateTimeFormat(intlLocale, { year: "numeric", month: "long", day: "numeric" }).format(dayjs(journalDate).toDate())}</h2>
            </div>
            <div className="journal-header-actions">
              <button type="button" className="secondary-button" onClick={openAI}><Sparkles size={15} />{t("journal.review")}</button>
            </div>
          </header>
          <div className="journal-tags"><TagPicker selectedIds={journal.tagIds} onChange={(tagIds) => db.cards.update(journal.id, { tagIds, updatedAt: Date.now() })} /></div>
          {highlightNotice && <div className="journal-highlight-notice" role="status"><Highlighter size={14} /><span>{highlightNotice}</span></div>}
          <RichEditor
            content={journal.contentHtml}
            onChange={(contentHtml, plainText) => updateCardWithHistory(journal.id, { contentHtml, plainText })}
            onHighlight={createJournalHighlight}
            taskOwnerId={journal.id}
            placeholder={t("journal.placeholder")}
          />
        </article>
      </section>
      <aside className="journal-aside">
        <header><CalendarDays size={16} /><span>{t("journal.upcoming")}</span></header>
        {tasks.map((task) => (
          <label key={task.id} onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "task", id: task.id })}>
            <button type="button" className="task-check" aria-label={t("journal.markDone")} onClick={() => setTaskDone(task.id, true)}><Circle size={16} /></button>
            <span>{task.title}</span>
          </label>
        ))}
        {tasks.length === 0 && <p className="aside-empty">{t("journal.noTasks")}</p>}
      </aside>
    </div>
  );
}
