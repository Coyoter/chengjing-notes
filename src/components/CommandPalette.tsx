import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight, FilePlus2, FileText, Import, Map, Search, Sparkles, SquareKanban } from "lucide-react";
import { db } from "../db";
import { useI18n } from "../hooks/useI18n";
import { primaryShortcut } from "../lib/platform";
import { useAppStore } from "../store";
import { localizedKindLabel, truncate } from "../lib/utils";
import { includesQuery, searchRecords } from "../lib/searchRecords";
import { isMaterializedCard } from "../lib/journalVisibility";

export function CommandPalette() {
  const { language, t } = useI18n();
  const open = useAppStore((state) => state.commandOpen);
  const setOpen = useAppStore((state) => state.setCommandOpen);
  const openCard = useAppStore((state) => state.openCard);
  const openBoard = useAppStore((state) => state.openBoard);
  const openKanbanBoard = useAppStore((state) => state.openKanbanBoard);
  const setCreateCardOpen = useAppStore((state) => state.setCreateCardOpen);
  const setImportOpen = useAppStore((state) => state.setImportOpen);
  const openAI = useAppStore((state) => state.openAI);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const cards = useLiveQuery(async () => {
    if (!open) return [];
    return searchRecords(db.cards, query, language, (card) => card.state !== "trash" && isMaterializedCard(card) && includesQuery(`${card.title} ${card.plainText}`, query, language), 6);
  }, [language, open, query], []);
  const boards = useLiveQuery(() => open ? searchRecords(db.boards, query, language, (board) => includesQuery(`${board.title} ${board.description}`, query, language), 4) : [], [language, open, query], []);
  const kanbanBoards = useLiveQuery(() => open ? searchRecords(db.kanbanBoards, query, language, (board) => includesQuery(`${board.title} ${board.description}`, query, language), 4) : [], [language, open, query], []);

  useEffect(() => {
    if (open) { setQuery(""); setActive(0); }
  }, [open]);

  const results = useMemo(() => {
    const cardResults = cards.map((card) => ({ id: card.id, type: "card" as const, title: card.title, detail: `${localizedKindLabel(card.kind, language)} · ${truncate(card.plainText, 70)}` }));
    const boardResults = boards.map((board) => ({ id: board.id, type: "board" as const, title: board.title, detail: board.description || t("brain.typeBoard") }));
    const kanbanResults = kanbanBoards.map((board) => ({ id: board.id, type: "kanban" as const, title: board.title, detail: t("nav.kanban") }));
    return [...cardResults, ...boardResults, ...kanbanResults];
  }, [boards, cards, kanbanBoards, language, query, t]);

  function choose(index: number) {
    const item = results[index];
    if (!item) return;
    setOpen(false);
    if (item.type === "card") openCard(item.id);
    else if (item.type === "board") openBoard(item.id);
    else openKanbanBoard(item.id);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="command-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setOpen(false)}>
          <motion.section className="command-palette" initial={{ opacity: 0, y: -10, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.99 }} onMouseDown={(event) => event.stopPropagation()}>
            <label className="command-input"><Search size={18} /><input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} placeholder={t("command.placeholder")} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(results.length - 1, value + 1)); } if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(0, value - 1)); } if (event.key === "Enter") { event.preventDefault(); choose(active); } }} /><kbd>ESC</kbd></label>
            {!query && <div className="quick-command-row"><button type="button" onClick={() => { setOpen(false); setCreateCardOpen(true); }}><FilePlus2 size={16} /><span>{t("command.newCard")}</span></button><button type="button" onClick={() => { setOpen(false); setImportOpen(true); }}><Import size={16} /><span>{t("command.import")}</span></button><button type="button" onClick={() => { setOpen(false); openAI(); }}><Sparkles size={16} /><span>{t("command.askAI")}</span></button></div>}
            <div className="command-results">
              <header><span>{query ? t("command.results") : t("command.recent")}</span><b>{results.length}</b></header>
              {results.map((item, index) => (
                <button type="button" key={`${item.type}-${item.id}`} className={active === index ? "is-active" : ""} onMouseEnter={() => setActive(index)} onClick={() => choose(index)}>
                  <i>{item.type === "card" ? <FileText size={16} /> : item.type === "board" ? <Map size={16} /> : <SquareKanban size={16} />}</i>
                  <span><b>{item.title}</b><small>{item.detail}</small></span>
                  <ArrowRight size={15} />
                </button>
              ))}
              {results.length === 0 && <div className="command-empty">{t("command.notFound", { query })}</div>}
            </div>
            <footer><span><kbd>↑</kbd><kbd>↓</kbd> {t("command.move")}</span><span><kbd>↵</kbd> {t("command.open")}</span><span><kbd>{primaryShortcut("K")}</kbd> {t("command.close")}</span></footer>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
