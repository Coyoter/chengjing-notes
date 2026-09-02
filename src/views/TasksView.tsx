import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import Dexie from "dexie";
import { AlertTriangle, CalendarDays, Check, CheckCircle2, Circle, Clock3, FileText, ListTree, Plus, Sunrise } from "lucide-react";
import { db } from "../db";
import { TaskDatePicker } from "../components/TaskDatePicker";
import { showContextMenuFromPointer } from "../lib/contextMenu";
import { useI18n } from "../hooks/useI18n";
import { dueDateInputToTimestamp, setTaskDone } from "../lib/taskSync";
import { getTaskEnhancementCopy } from "../lib/taskEnhancementCopy";
import { groupTasksByTimeline, localDateKey, timestampForLocalDateKey, type TaskDateGroup } from "../lib/taskTimeline";
import type { TaskRecord } from "../types";
import { getTaskHierarchyCopy } from "../lib/taskHierarchyCopy";

export function TasksView() {
  const [value, setValue] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [todayKey, setTodayKey] = useState(() => localDateKey(Date.now()));
  const [displayLimit, setDisplayLimit] = useState(240);
  const todayReference = timestampForLocalDateKey(todayKey);
  const todayStart = todayReference - 12 * 3_600_000;
  const tomorrowStart = todayReference + 12 * 3_600_000;
  const tasks = useLiveQuery(async () => {
    const [today, overdue, future, completed] = await Promise.all([
      db.tasks.where("[doneKey+scheduleKey]").between(["active", todayStart], ["active", tomorrowStart], true, false).filter((task) => !task.parentTaskId).limit(displayLimit).toArray(),
      db.tasks.where("[doneKey+scheduleKey]").between(["active", Dexie.minKey], ["active", todayStart], true, false).reverse().filter((task) => !task.parentTaskId).limit(displayLimit).toArray(),
      db.tasks.where("[doneKey+scheduleKey]").between(["active", tomorrowStart], ["active", Number.MAX_SAFE_INTEGER], true, true).filter((task) => !task.parentTaskId).limit(displayLimit).toArray(),
      db.tasks.where("doneKey").equals("done").filter((task) => !task.parentTaskId).toArray().then((items) => items.sort((left, right) => right.updatedAt - left.updatedAt).slice(0, displayLimit)),
    ]);
    const roots = [...new Map([...today, ...overdue, ...future, ...completed].map((task) => [task.id, task])).values()];
    const all = new Map(roots.map((task) => [task.id, task]));
    let frontier = roots.map((task) => task.id);
    while (frontier.length) {
      const children = await db.tasks.where("parentTaskId").anyOf(frontier).toArray();
      const next: string[] = [];
      children.forEach((task) => { if (!all.has(task.id)) { all.set(task.id, task); next.push(task.id); } });
      frontier = next;
    }
    return [...all.values()];
  }, [displayLimit, todayStart, tomorrowStart], []);
  const taskCounts = useLiveQuery(async () => {
    const [active, completed, today, overdue, noDate] = await Promise.all([
      db.tasks.where("doneKey").equals("active").filter((task) => !task.parentTaskId).count(),
      db.tasks.where("doneKey").equals("done").filter((task) => !task.parentTaskId).count(),
      db.tasks.where("[doneKey+scheduleKey]").between(["active", todayStart], ["active", tomorrowStart], true, false).filter((task) => !task.parentTaskId).count(),
      db.tasks.where("[doneKey+scheduleKey]").between(["active", Dexie.minKey], ["active", todayStart], true, false).filter((task) => !task.parentTaskId).count(),
      db.tasks.where("[doneKey+scheduleKey]").equals(["active", Number.MAX_SAFE_INTEGER]).filter((task) => !task.parentTaskId).count(),
    ]);
    const future = Math.max(0, active - today - overdue - noDate);
    return { active, completed, today, overdue, future, noDate };
  }, [todayStart, tomorrowStart], { active: 0, completed: 0, today: 0, overdue: 0, future: 0, noDate: 0 });
  const { intlLocale, language, t } = useI18n();
  const taskCopy = getTaskEnhancementCopy(language);
  const hierarchyCopy = getTaskHierarchyCopy(language);
  const rootTasks = useMemo(() => tasks.filter((task) => !task.parentTaskId), [tasks]);
  const timeline = useMemo(() => groupTasksByTimeline(rootTasks, timestampForLocalDateKey(todayKey)), [rootTasks, todayKey]);
  const childrenByParent = useMemo(() => {
    const map = new Map<string, TaskRecord[]>();
    tasks.forEach((task) => { if (task.parentTaskId) map.set(task.parentTaskId, [...(map.get(task.parentTaskId) || []), task]); });
    map.forEach((children) => children.sort((left, right) => left.createdAt - right.createdAt));
    return map;
  }, [tasks]);
  const activeCount = taskCounts.active;
  const todayDate = new Date(timestampForLocalDateKey(todayKey));
  const displayedTaskIds = useMemo(() => new Set([
    ...timeline.today,
    ...timeline.overdue.flatMap((group) => group.tasks),
    ...timeline.future.flatMap((group) => group.tasks),
    ...timeline.noDate,
    ...timeline.completed,
  ].slice(0, displayLimit).map((task) => task.id)), [displayLimit, timeline]);
  const loadMoreLabel = ({ "zh-TW": "顯示更多待辦", "zh-CN": "显示更多待办", en: "Show more tasks", ja: "さらに表示", ko: "더 보기" } as const)[language];

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = localDateKey(Date.now());
      setTodayKey((current) => current === next ? current : next);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  async function addTask(event: React.FormEvent) {
    event.preventDefault();
    const title = value.trim();
    if (!title) return;
    const timestamp = Date.now();
    await db.tasks.add({ id: crypto.randomUUID(), title, done: false, dueAt: dueDateInputToTimestamp(dueDate), createdAt: timestamp, updatedAt: timestamp });
    setValue("");
    setDueDate("");
  }

  function formatMonthDay(timestamp: number) {
    return new Intl.DateTimeFormat(intlLocale, { month: "long", day: "numeric" }).format(timestamp);
  }

  function formatWeekday(timestamp: number) {
    return new Intl.DateTimeFormat(intlLocale, { weekday: "long" }).format(timestamp);
  }

  function descendantProgress(taskId: string) {
    const visited = new Set<string>();
    let frontier = [...(childrenByParent.get(taskId) || [])];
    let done = 0;
    while (frontier.length) {
      const child = frontier.shift()!;
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      if (child.done) done += 1;
      frontier.push(...(childrenByParent.get(child.id) || []));
    }
    return { done, total: visited.size };
  }

  function taskRow(task: TaskRecord, meta: string, extraClass = "", depth = 0) {
    const progress = descendantProgress(task.id);
    return <article key={task.id} data-task-id={task.id} data-task-depth={depth} style={{ "--task-depth": Math.min(depth, 4) } as CSSProperties} className={`${task.done ? "is-done" : ""} ${depth ? "is-subtask" : ""} ${extraClass}`.trim()} onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "task", id: task.id })}>
      <button type="button" className="task-check" aria-label={task.done ? t("tasks.reopen") : t("tasks.markDone")} onClick={() => setTaskDone(task.id, !task.done)}>{task.done ? <CheckCircle2 size={19} /> : <Circle size={19} />}</button>
      <span><b>{task.title}</b><small>{depth > 0 && <em className="task-subtask-label"><ListTree size={11} />{hierarchyCopy.subtask}</em>}{task.dueAt && <><CalendarDays size={12} />{meta}</>}{!task.dueAt && <><Clock3 size={12} />{meta}</>}{task.cardId && <em><FileText size={11} />{taskCopy.fromNote}</em>}{progress.total > 0 && <em className="task-subtask-progress"><ListTree size={11} />{hierarchyCopy.progress(progress.done, progress.total)}</em>}</small></span>
    </article>;
  }

  function taskBranch(root: TaskRecord, meta: string, extraClass = "") {
    const rows: Array<{ task: TaskRecord; depth: number }> = [];
    const visited = new Set<string>();
    const visit = (task: TaskRecord, depth: number) => {
      if (visited.has(task.id)) return;
      visited.add(task.id);
      rows.push({ task, depth });
      (childrenByParent.get(task.id) || []).forEach((child) => visit(child, depth + 1));
    };
    visit(root, 0);
    return rows.map(({ task, depth }) => taskRow(task, depth === 0 ? meta : (task.dueAt ? formatMonthDay(task.dueAt) : t("tasks.noDue")), depth === 0 ? extraClass : "", depth));
  }

  function dateGroup(group: TaskDateGroup, kind: "overdue" | "future") {
    const visibleTasks = group.tasks.filter((task) => displayedTaskIds.has(task.id));
    if (!visibleTasks.length) return null;
    const title = group.distanceDays === 1 ? taskCopy.tomorrow : formatMonthDay(group.date);
    return <section className="task-date-segment" key={group.key} data-task-date={group.key}>
      <header><div><b>{title}</b><span>{formatWeekday(group.date)}</span></div><small>{taskCopy.taskCount(group.tasks.length)}</small></header>
      <div>{visibleTasks.map((task) => taskBranch(task, kind === "overdue" ? taskCopy.overdueDays(Math.abs(group.distanceDays)) : taskCopy.dueInDays(group.distanceDays)))}</div>
    </section>;
  }

  return (
    <div className="page-scroll standard-page narrow-page tasks-page">
      <header className="page-intro"><div><span>{t("tasks.eyebrow")}</span><h2>{t("tasks.remaining", { count: activeCount })}</h2><p>{t("tasks.description")}</p></div></header>

      <form className="task-add" onSubmit={addTask}>
        <label className="task-add-main"><Plus size={17} /><input value={value} onChange={(event) => setValue(event.target.value)} placeholder={t("tasks.placeholder")} /></label>
        <div className="task-add-actions"><TaskDatePicker value={dueDate} onChange={setDueDate} label={taskCopy.dueOptional} /><button type="submit" disabled={!value.trim()}>{t("tasks.add")}</button></div>
      </form>

      <div className="task-groups task-timeline">
        <section className="task-section task-today-segment" data-task-segment="today">
          <header>
            <div className="task-today-date"><b>{todayDate.getDate()}</b><span>{formatWeekday(todayDate.getTime())}</span></div>
            <div className="task-section-copy"><span><Sunrise size={14} />{taskCopy.todayTitle}</span><h3>{taskCopy.todayLead}</h3></div>
            <strong>{taskCopy.taskCount(taskCounts.today)}</strong>
          </header>
          {taskCounts.today > 0 ? <div className="task-section-list">{timeline.today.filter((task) => displayedTaskIds.has(task.id)).map((task) => taskBranch(task, taskCopy.dueToday, "is-today"))}</div> : <div className="task-section-empty"><Check size={17} /><span>{taskCopy.todayEmpty}</span></div>}
        </section>

        {taskCounts.overdue > 0 && <section className="task-section task-overdue-segment" data-task-segment="overdue">
          <header className="task-section-heading"><span><AlertTriangle size={15} /></span><div><h3>{taskCopy.overdueTitle}</h3><p>{taskCopy.overdueLead}</p></div><strong>{taskCopy.taskCount(taskCounts.overdue)}</strong></header>
          <div className="task-date-stack">{timeline.overdue.map((group) => dateGroup(group, "overdue"))}</div>
        </section>}

        {taskCounts.future > 0 && <section className="task-section task-future-segment" data-task-segment="future">
          <header className="task-section-heading"><span><CalendarDays size={15} /></span><div><h3>{taskCopy.futureTitle}</h3><p>{taskCopy.futureLead}</p></div><strong>{taskCopy.taskCount(taskCounts.future)}</strong></header>
          <div className="task-date-stack">{timeline.future.map((group) => dateGroup(group, "future"))}</div>
        </section>}

        {taskCounts.noDate > 0 && <section className="task-section task-no-date-segment" data-task-segment="no-date">
          <header className="task-section-heading"><span><Clock3 size={15} /></span><div><h3>{taskCopy.noDateTitle}</h3><p>{taskCopy.noDateLead}</p></div><strong>{taskCopy.taskCount(taskCounts.noDate)}</strong></header>
          <div className="task-section-list">{timeline.noDate.filter((task) => displayedTaskIds.has(task.id)).map((task) => taskBranch(task, t("tasks.noDue")))}</div>
        </section>}

        {taskCounts.completed > 0 && <section className="task-section task-completed-segment" data-task-segment="completed">
          <header className="task-section-heading"><span><CheckCircle2 size={15} /></span><div><h3>{t("tasks.completed")}</h3><p>{taskCopy.completedLead}</p></div><strong>{taskCopy.taskCount(taskCounts.completed)}</strong></header>
          <div className="task-section-list">{timeline.completed.filter((task) => displayedTaskIds.has(task.id)).map((task) => taskBranch(task, t("tasks.completed")))}</div>
        </section>}

        {activeCount === 0 && taskCounts.completed === 0 && <div className="inline-empty"><Check size={18} /><span>{t("tasks.none")}</span></div>}
        {displayedTaskIds.size < taskCounts.active + taskCounts.completed && <button type="button" className="content-load-more" onClick={() => setDisplayLimit((value) => value + 240)}>{loadMoreLabel}</button>}
      </div>
    </div>
  );
}
