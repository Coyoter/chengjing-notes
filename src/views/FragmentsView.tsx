import { useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { BrainCircuit, Feather, MoreHorizontal, Pin, Sparkles } from "lucide-react";
import { createFleetingCard, db } from "../db";
import { useAppStore } from "../store";
import { relativeTime } from "../lib/utils";
import { showContextMenuFromButton, showContextMenuFromPointer } from "../lib/contextMenu";
import { useI18n } from "../hooks/useI18n";
import { isWindows } from "../lib/platform";
import { TagPicker } from "../components/TagPicker";

export function FragmentsView() {
  const [visibleLimit, setVisibleLimit] = useState(160);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const fragments = useLiveQuery(async () => {
    const [pinned, recent] = await Promise.all([
      db.cards.where("state").equals("inbox").filter(card => card.favorite).limit(visibleLimit).toArray(),
      db.cards.orderBy("updatedAt").reverse().filter(card => card.state === "inbox" && !card.favorite).limit(visibleLimit).toArray(),
    ]);
    return [...new Map([...pinned, ...recent].map(card => [card.id, card])).values()]
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt).slice(0, visibleLimit);
  }, [visibleLimit], []);
  const totalCount = useLiveQuery(() => db.cards.where("state").equals("inbox").count(), [], 0);
  const [value, setValue] = useState("");
  const [status, setStatus] = useState("");
  const [draftTagIds, setDraftTagIds] = useState<string[]>([]);
  const setView = useAppStore((state) => state.setView);
  const { language, t } = useI18n();
  const sorted = useMemo(() => [...fragments].sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt), [fragments]);
  const displayed = sorted;
  const loadMoreLabel = ({ "zh-TW": "顯示更多片語", "zh-CN": "显示更多片语", en: "Show more fragments", ja: "さらに表示", ko: "더 보기" } as const)[language];

  async function save() {
    const text = value.trim();
    if (!text || saving.current) return;
    saving.current = true; setBusy(true);
    try {
      await createFleetingCard(text, draftTagIds);
      setValue(""); setDraftTagIds([]); setStatus(t("fragments.saved"));
    } catch (error) { setStatus(error instanceof Error ? error.message : t("context.failed")); }
    finally { saving.current = false; setBusy(false); }
  }

  return (
    <div className="page-scroll fragments-page">
      <header className="fragments-heading">
        <div><span>{t("fragments.eyebrow")}</span><h2>{t("nav.fragments")}</h2><p>{t("fragments.description")}</p></div>
        <button type="button" className="secondary-button" onClick={() => setView("brain")}><BrainCircuit size={16} />{t("fragments.openBrain")}</button>
      </header>

      <section className="fragment-capture">
        <Feather size={21} />
        <textarea
          autoFocus
          value={value}
          maxLength={500}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              save();
            }
          }}
          placeholder={t("fragments.placeholder")}
        />
        <TagPicker className="fragment-draft-tags" selectedIds={draftTagIds} onChange={setDraftTagIds} />
        <footer><span>{status || `${value.length}/500`}</span><small><kbd>{isWindows() ? "Ctrl" : "⌘"}</kbd><kbd>Enter</kbd> {t("fragments.saveShortcut")}</small><button type="button" disabled={!value.trim() || busy} onClick={save}><Sparkles size={15} />{t("fragments.save")}</button></footer>
      </section>

      <section className="fragment-stream" aria-label={t("fragments.list")}>
        <header><span>{t("fragments.neurons", { count: totalCount })}</span><p>{t("fragments.hint")}</p></header>
        {displayed.map((fragment) => (
          <article
            key={fragment.id}
            className={fragment.favorite ? "is-pinned" : ""}
            onDoubleClick={() => useAppStore.getState().openCard(fragment.id)}
            onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "card", id: fragment.id })}
          >
            <div className="fragment-dot" aria-hidden="true" />
            <div>
              <p>{fragment.plainText || fragment.title}</p>
              <TagPicker className="fragment-item-tags" selectedIds={fragment.tagIds} onChange={(tagIds) => db.cards.update(fragment.id, { tagIds, updatedAt: Date.now() })} />
              <footer>{fragment.favorite && <span><Pin size={12} />{t("fragments.pinned")}</span>}<time>{relativeTime(fragment.updatedAt, language)}</time></footer>
            </div>
            <button type="button" className="bare-button" aria-label={t("fragments.more")} onClick={(event) => showContextMenuFromButton(event, { kind: "card", id: fragment.id })}><MoreHorizontal size={17} /></button>
          </article>
        ))}
        {displayed.length < totalCount && <button type="button" className="content-load-more" onClick={() => setVisibleLimit((value) => value + 160)}>{loadMoreLabel}</button>}
        {sorted.length === 0 && <div className="fragment-empty"><Feather size={26} /><h3>{t("fragments.empty")}</h3><p>{t("fragments.emptyDescription")}</p></div>}
      </section>
    </div>
  );
}
