import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "../hooks/useI18n";
import { getTaskEnhancementCopy } from "../lib/taskEnhancementCopy";
import { localDateKey, timestampForLocalDateKey } from "../lib/taskTimeline";

interface TaskDatePickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  buttonText?: string;
  calendarLabel?: string;
  clearable?: boolean;
  showPresets?: boolean;
  autoFocus?: boolean;
  className?: string;
}

function dateFromKey(value: string) {
  const timestamp = timestampForLocalDateKey(value);
  return timestamp ? new Date(timestamp) : null;
}

function addCalendarDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

export function TaskDatePicker({ value, onChange, label, buttonText, calendarLabel, clearable = true, showPresets = true, autoFocus = false, className = "" }: TaskDatePickerProps) {
  const { language, intlLocale } = useI18n();
  const copy = getTaskEnhancementCopy(language);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const today = new Date(timestampForLocalDateKey(localDateKey(Date.now())));
  const selectedDate = dateFromKey(value);
  const [viewMonth, setViewMonth] = useState(() => new Date((selectedDate || today).getFullYear(), (selectedDate || today).getMonth(), 1, 12));
  const [focusedKey, setFocusedKey] = useState(() => value || localDateKey(today));

  useEffect(() => {
    if (autoFocus) triggerRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focusedKey}"]`)?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [focusedKey, open, viewMonth]);

  const days = useMemo(() => {
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1, 12);
    const start = addCalendarDays(first, -first.getDay());
    return Array.from({ length: 42 }, (_, index) => addCalendarDays(start, index));
  }, [viewMonth]);

  const weekdayLabels = useMemo(() => {
    const sunday = new Date(2026, 7, 23, 12);
    return Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(intlLocale, { weekday: "narrow" }).format(addCalendarDays(sunday, index)));
  }, [intlLocale]);

  function openPicker() {
    const initial = selectedDate || today;
    setViewMonth(new Date(initial.getFullYear(), initial.getMonth(), 1, 12));
    setFocusedKey(localDateKey(initial));
    setOpen(true);
  }

  function finish(nextValue: string) {
    onChange(nextValue);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function selectRelative(daysFromToday: number) {
    finish(localDateKey(addCalendarDays(today, daysFromToday)));
  }

  function moveFocusedDate(daysToMove: number) {
    const current = dateFromKey(focusedKey) || today;
    const next = addCalendarDays(current, daysToMove);
    setFocusedKey(localDateKey(next));
    if (next.getMonth() !== viewMonth.getMonth() || next.getFullYear() !== viewMonth.getFullYear()) setViewMonth(new Date(next.getFullYear(), next.getMonth(), 1, 12));
  }

  function handleDayKey(event: React.KeyboardEvent<HTMLButtonElement>) {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in moves) {
      event.preventDefault();
      moveFocusedDate(moves[event.key]);
    }
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      const current = dateFromKey(focusedKey) || today;
      const next = new Date(current.getFullYear(), current.getMonth() + (event.key === "PageUp" ? -1 : 1), current.getDate(), 12);
      setFocusedKey(localDateKey(next));
      setViewMonth(new Date(next.getFullYear(), next.getMonth(), 1, 12));
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  const displayValue = selectedDate
    ? new Intl.DateTimeFormat(intlLocale, { year: "numeric", month: "short", day: "numeric" }).format(selectedDate)
    : copy.chooseDate;
  const monthTitle = new Intl.DateTimeFormat(intlLocale, { year: "numeric", month: "long" }).format(viewMonth);
  const todayKey = localDateKey(today);

  return (
    <div ref={rootRef} className={`task-date-picker ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        className={`task-date-trigger ${value ? "has-value" : ""}`}
        aria-label={label || copy.dueOptional}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => open ? setOpen(false) : openPicker()}
        onKeyDown={(event) => { if (!open && (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ")) { event.preventDefault(); openPicker(); } }}
      >
        <CalendarDays size={15} />
        <span>{buttonText || displayValue}</span>
        <ChevronDown size={14} />
      </button>

      {open && <div className="task-calendar-popover" role="dialog" aria-modal="false" aria-label={calendarLabel || copy.calendarLabel} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); } }}>
        <header>
          <button type="button" aria-label={copy.previousMonth} onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1, 12))}><ChevronLeft size={17} /></button>
          <b aria-live="polite">{monthTitle}</b>
          <button type="button" aria-label={copy.nextMonth} onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1, 12))}><ChevronRight size={17} /></button>
        </header>
        {showPresets && <div className="task-date-presets">
          <button type="button" onClick={() => selectRelative(0)}>{copy.today}</button>
          <button type="button" onClick={() => selectRelative(1)}>{copy.tomorrow}</button>
          <button type="button" onClick={() => selectRelative(7)}>{copy.inOneWeek}</button>
        </div>}
        <div className="task-calendar-weekdays" aria-hidden="true">{weekdayLabels.map((weekday, index) => <span key={`${weekday}-${index}`}>{weekday}</span>)}</div>
        <div className="task-calendar-days">
          {days.map((day) => {
            const key = localDateKey(day);
            const isSelected = key === value;
            const isToday = key === todayKey;
            const outside = day.getMonth() !== viewMonth.getMonth();
            return <button
              type="button"
              key={key}
              data-date={key}
              tabIndex={key === focusedKey ? 0 : -1}
              className={`${isSelected ? "is-selected" : ""} ${isToday ? "is-today" : ""} ${outside ? "is-outside" : ""}`.trim()}
              aria-pressed={isSelected}
              aria-label={new Intl.DateTimeFormat(intlLocale, { dateStyle: "full" }).format(day)}
              onClick={() => finish(key)}
              onKeyDown={handleDayKey}
            >{day.getDate()}</button>;
          })}
        </div>
        <footer>{clearable && value ? <button type="button" onClick={() => finish("")}>{copy.clearDate}</button> : <span />}{selectedDate && <b>{displayValue}</b>}</footer>
      </div>}
    </div>
  );
}
