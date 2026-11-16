import { useEffect, useRef, useState } from "react";
import { ChevronDown, Info, Repeat2 } from "lucide-react";
import { useI18n } from "../hooks/useI18n";
import { useMobileBack } from "../lib/mobileBack";
import { timestampForLocalDateKey } from "../lib/taskTimeline";
import type { TaskRecurrence } from "../lib/taskRecurrence";

export type RecurrenceMode = "none" | TaskRecurrence["frequency"];
export interface RecurrenceDraft {
  mode: RecurrenceMode;
  weekday: number;
  monthDay: number;
}

const labels = {
  "zh-TW": { repeat: "重複", hint: "循環待辦", never: "不重複", daily: "每天", weekly: "每週", monthly: "每月", weeklyDay: "每週執行日期", monthlyDay: "每月執行日期", day: "日", note: "每期依日期自動出現，未完成的任務會保留。", done: "完成" },
  "zh-CN": { repeat: "重复", hint: "循环待办", never: "不重复", daily: "每天", weekly: "每周", monthly: "每月", weeklyDay: "每周执行日期", monthlyDay: "每月执行日期", day: "日", note: "每期按照日期自动出现，未完成的任务会保留。", done: "完成" },
  en: { repeat: "Repeat", hint: "Recurring task", never: "Never", daily: "Daily", weekly: "Weekly", monthly: "Monthly", weeklyDay: "Day of the week", monthlyDay: "Day of the month", day: "", note: "Each occurrence appears on schedule. Unfinished tasks remain.", done: "Done" },
  ja: { repeat: "繰り返し", hint: "定期タスク", never: "なし", daily: "毎日", weekly: "毎週", monthly: "毎月", weeklyDay: "曜日", monthlyDay: "日付", day: "日", note: "予定日ごとに追加され、未完了のタスクは残ります。", done: "完了" },
  ko: { repeat: "반복", hint: "반복 할 일", never: "안 함", daily: "매일", weekly: "매주", monthly: "매월", weeklyDay: "요일", monthlyDay: "날짜", day: "일", note: "일정에 따라 새 항목이 나타나며 미완료 항목은 유지됩니다.", done: "완료" },
} as const;

export function draftFromRecurrence(rule?: TaskRecurrence, reference = Date.now()): RecurrenceDraft {
  const date = new Date(reference);
  return { mode: rule?.frequency || "none", weekday: rule?.frequency === "weekly" ? rule.weekday : date.getDay(), monthDay: rule?.frequency === "monthly" ? rule.day : date.getDate() };
}

export function ruleFromDraft(draft: RecurrenceDraft): TaskRecurrence | undefined {
  if (draft.mode === "daily") return { frequency: "daily" };
  if (draft.mode === "weekly") return { frequency: "weekly", weekday: draft.weekday };
  if (draft.mode === "monthly") return { frequency: "monthly", day: draft.monthDay };
  return undefined;
}

export function draftWithSelectedDate(draft: RecurrenceDraft, dateKey: string): RecurrenceDraft {
  const timestamp = timestampForLocalDateKey(dateKey);
  if (!timestamp) return draft;
  const date = new Date(timestamp);
  return { ...draft, weekday: draft.mode === "weekly" ? date.getDay() : draft.weekday, monthDay: draft.mode === "monthly" ? date.getDate() : draft.monthDay };
}

export function TaskRecurrenceOptions({ value, onChange }: { value: RecurrenceDraft; onChange: (value: RecurrenceDraft) => void }) {
  const { language, intlLocale } = useI18n();
  const copy = labels[language] || labels.en;
  const weekdays = Array.from({ length: 7 }, (_, index) => ({
    index,
    narrow: new Intl.DateTimeFormat(intlLocale, { weekday: "narrow" }).format(new Date(2026, 7, 23 + index, 12)),
    long: new Intl.DateTimeFormat(intlLocale, { weekday: "long" }).format(new Date(2026, 7, 23 + index, 12)),
  }));
  const summary = value.mode === "monthly"
    ? `${copy.monthly} ${value.monthDay} ${copy.day}`.trim()
    : weekdays[value.weekday]?.long || "";
  return <div className="task-recurrence-options">
    <div className="task-recurrence-frequency" role="group" aria-label={copy.repeat}>
      {(["none", "daily", "weekly", "monthly"] as RecurrenceMode[]).map((mode) =>
        <button key={mode} type="button" className={value.mode === mode ? "is-selected" : ""} aria-pressed={value.mode === mode} onClick={() => onChange({ ...value, mode })}>{mode === "none" ? copy.never : copy[mode]}</button>)}
    </div>
    {value.mode === "weekly" && <div className="task-recurrence-rule">
      <div className="task-recurrence-rule-heading"><span>{copy.weeklyDay}</span><b>{summary}</b></div>
      <div className="task-recurrence-weekdays" role="group" aria-label={copy.weeklyDay}>
        {weekdays.map(({ index, narrow, long }) => <button key={index} type="button" title={long} aria-label={long} aria-pressed={value.weekday === index} className={value.weekday === index ? "is-selected" : ""} onClick={() => onChange({ ...value, weekday: index })}>{narrow}</button>)}
      </div>
    </div>}
    {value.mode === "monthly" && <div className="task-recurrence-rule">
      <div className="task-recurrence-rule-heading"><span>{copy.monthlyDay}</span><b>{summary}</b></div>
      <div className="task-recurrence-stepper">
        <button type="button" aria-label={language === "en" ? "Previous day" : "前一天"} onClick={() => onChange({ ...value, monthDay: value.monthDay === 1 ? 31 : value.monthDay - 1 })}>−</button>
        <b aria-live="polite">{value.monthDay}</b>
        <button type="button" aria-label={language === "en" ? "Next day" : "後一天"} onClick={() => onChange({ ...value, monthDay: value.monthDay === 31 ? 1 : value.monthDay + 1 })}>＋</button>
      </div>
    </div>}
    <p className="task-recurrence-note"><Info size={14} aria-hidden="true" />{copy.note}</p>
  </div>;
}

export function TaskRecurrencePicker({ value, onChange }: { value: RecurrenceDraft; onChange: (value: RecurrenceDraft) => void }) {
  const { language, intlLocale } = useI18n();
  const copy = labels[language] || labels.en;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useMobileBack(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [open]);
  const weekday = new Intl.DateTimeFormat(intlLocale, { weekday: "long" }).format(new Date(2026, 7, 23 + value.weekday, 12));
  const summary = value.mode === "none" ? copy.repeat : value.mode === "monthly" ? `${copy.monthly} ${value.monthDay} ${copy.day}`.trim() : value.mode === "weekly" ? `${copy.weekly} · ${weekday}` : copy.daily;
  return <div className="task-recurrence-picker" ref={root}>
    <button ref={trigger} type="button" className={`task-date-trigger task-recurrence-trigger ${value.mode !== "none" ? "has-value" : ""}`} aria-label={copy.repeat} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
      <Repeat2 size={15} aria-hidden="true" /><span>{summary}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && <div className="task-recurrence-popover" role="dialog" aria-label={copy.repeat} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); } }}>
      <header><b>{copy.repeat}</b><span>{copy.hint}</span></header>
      <TaskRecurrenceOptions value={value} onChange={onChange} />
      <footer><button type="button" onClick={() => { setOpen(false); trigger.current?.focus(); }}>{copy.done}</button></footer>
    </div>}
  </div>;
}
