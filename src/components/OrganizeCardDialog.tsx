import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useI18n } from "../hooks/useI18n";
import { getFleetingCopy } from "../lib/fleetingCopy";
import { organizeCard, type CardDestination } from "../lib/cardOrganization";
import { useMobileBack } from "../lib/mobileBack";
import { runGlobalHistoryAction } from "../lib/globalHistory";
import "./organize-card.css";

export function OrganizeCardDialog({ cardId, onClose }: { cardId: string; onClose: () => void }) {
  const { language } = useI18n();
  const copy = getFleetingCopy(language);
  const [kind, setKind] = useState<CardDestination["kind"]>("topic");
  const [target, setTarget] = useState("");
  const [list, setList] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const options = useLiveQuery(async () => kind === "topic"
    ? (await db.knowledgeGroups.where("kind").equals("topic").toArray()).map(item => ({ id: item.id, title: item.name }))
    : kind === "board" ? db.boards.orderBy("updatedAt").reverse().toArray() : db.kanbanBoards.orderBy("updatedAt").reverse().toArray(), [kind], []);
  const lists = useLiveQuery(() => kind === "kanban" && target ? db.kanbanLists.where("boardId").equals(target).sortBy("order") : [], [kind, target], []);
  useMobileBack(true, () => { if (!saving.current) onClose(); });
  useEffect(() => { form.current?.querySelector<HTMLSelectElement>("select")?.focus(); }, []);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving.current) onClose(); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [onClose]);
  return <div className="tag-rename-backdrop content-edit-backdrop" onMouseDown={() => { if (!busy) onClose(); }}>
    <form ref={form} className="tag-rename-dialog content-edit-dialog organize-card-dialog" role="dialog" aria-modal="true" aria-labelledby="organize-card-title" onMouseDown={event => event.stopPropagation()} onSubmit={async event => {
      event.preventDefault(); if (saving.current || !target || (kind === "kanban" && !list)) return;
      saving.current = true; setBusy(true); setError("");
      try { await runGlobalHistoryAction(() => organizeCard(cardId, { kind, id: target, listId: list })); onClose(); }
      catch { setError(copy.failed); }
      finally { saving.current = false; setBusy(false); }
    }} onKeyDown={event => {
      if (event.key !== "Tab") return;
      const elements = [...event.currentTarget.querySelectorAll<HTMLElement>("select:not(:disabled), button:not(:disabled)")];
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <header><h2 id="organize-card-title">{copy.title}</h2><p>{copy.description}</p></header>
      <div className="content-edit-fields">
        <label><span>{copy.kind}</span><select data-organize="kind" disabled={busy} value={kind} onChange={event => { setKind(event.target.value as CardDestination["kind"]); setTarget(""); setList(""); }}><option value="topic">{copy.topic}</option><option value="board">{copy.board}</option><option value="kanban">{copy.kanban}</option></select></label>
        <label><span>{copy.target}</span><select data-organize="target" disabled={busy} value={target} required onChange={event => { setTarget(event.target.value); setList(""); }}><option value="">{copy.choose}</option>{options.map(option => <option key={option.id} value={option.id}>{option.title}</option>)}</select></label>
        {kind === "kanban" && <label><span>{copy.list}</span><select data-organize="list" disabled={busy} value={list} required onChange={event => setList(event.target.value)}><option value="">{copy.choose}</option>{lists.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
        {!options.length && <p>{copy.empty}</p>}{error && <p role="alert">{error}</p>}
      </div>
      <footer><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>{copy.cancel}</button><button type="submit" className="primary-button" disabled={busy || !target || (kind === "kanban" && !list)}>{copy.apply}</button></footer>
    </form>
  </div>;
}
