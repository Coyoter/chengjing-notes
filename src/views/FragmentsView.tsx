import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { BrainCircuit, Feather, MoreHorizontal, Pin, Sparkles } from "lucide-react";
import { createFragment, db } from "../db";
import { captureInboxCards, captureInboxCount } from "../lib/captureCards";
import { useAppStore } from "../store";
import { relativeTime } from "../lib/utils";
import { showContextMenuFromButton, showContextMenuFromPointer } from "../lib/contextMenu";
import { useI18n } from "../hooks/useI18n";
import { isWindows } from "../lib/platform";
import { TagPicker } from "../components/TagPicker";

export function FragmentsView() {
  const [visibleLimit, setVisibleLimit] = useState(160);
  const cards = useLiveQuery(() => captureInboxCards(visibleLimit), [visibleLimit], []);
  const totalCount = useLiveQuery(captureInboxCount, [], 0);
  const [value, setValue] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [draftTagIds, setDraftTagIds] = useState<string[]>([]);
  const setView = useAppStore((state) => state.setView);
  const openCard = useAppStore((state) => state.openCard);
  const { language, t } = useI18n();
  const loadMoreLabel = ({ "zh-TW": "顯示更多未整理卡片", "zh-CN": "显示更多未整理卡片", en: "Show more unfiled cards", ja: "未整理カードをさらに表示", ko: "미분류 카드 더 보기" } as const)[language];

  async function save() {
    const text = value.trim();
    if (!text || savingRef.current) return;
    savingRef.current = true; setSaving(true); setError("");
    try {
      await createFragment(text, draftTagIds);
      setValue(""); setDraftTagIds([]); setStatus(t("fragments.saved"));
    } catch (error) { setError(error instanceof Error ? error.message : t("context.failed")); }
    finally { savingRef.current = false; setSaving(false); }
  }

  return <div className="page-scroll fragments-page">
    <header className="fragments-heading">
      <div><span>{t("fragments.eyebrow")}</span><h2>{t("nav.fragments")}</h2><p>{t("fragments.description")}</p></div>
      <button type="button" className="secondary-button" onClick={() => setView("brain")}><BrainCircuit size={16} />{t("fragments.openBrain")}</button>
    </header>
    <section className="fragment-capture">
      <Feather size={21} />
      <textarea autoFocus value={value} disabled={saving} maxLength={500} onChange={(event) => { setValue(event.target.value); setStatus(""); }}
        onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void save(); } }} placeholder={t("fragments.placeholder")} />
      <TagPicker className="fragment-draft-tags" selectedIds={draftTagIds} onChange={setDraftTagIds} />
      <footer><span>{status || `${value.length}/500`}</span><small><kbd>{isWindows() ? "Ctrl" : "⌘"}</kbd><kbd>Enter</kbd> {t("fragments.saveShortcut")}</small><button type="button" disabled={!value.trim() || saving} onClick={() => void save()}><Sparkles size={15} />{t("fragments.save")}</button></footer>
      {error && <p role="alert">{error}</p>}
    </section>
    <section className="fragment-stream" aria-label={t("fragments.list")}>
      <header><span>{t("fragments.neurons", { count: totalCount })}</span><p>{t("fragments.hint")}</p></header>
      {cards.map((card) => <article key={card.id} data-capture-card-id={card.id} className={card.favorite ? "is-pinned" : ""}
        onDoubleClick={() => openCard(card.id)} onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "card", id: card.id })}>
        <div className="fragment-dot" aria-hidden="true" />
        <div><p>{card.plainText || card.title}</p>
          <TagPicker className="fragment-item-tags" selectedIds={card.tagIds} onChange={(tagIds) => db.cards.update(card.id, { tagIds, updatedAt: Date.now() })} />
          <footer>{card.favorite && <span><Pin size={12} />{t("fragments.pinned")}</span>}<time>{relativeTime(card.updatedAt, language)}</time></footer>
        </div>
        <button type="button" className="bare-button" aria-label={t("fragments.more")} onClick={(event) => showContextMenuFromButton(event, { kind: "card", id: card.id })}><MoreHorizontal size={17} /></button>
      </article>)}
      {cards.length < totalCount && <button type="button" className="content-load-more" onClick={() => setVisibleLimit((value) => value + 160)}>{loadMoreLabel}</button>}
      {totalCount === 0 && <div className="fragment-empty"><Feather size={26} /><h3>{t("fragments.empty")}</h3><p>{t("fragments.emptyDescription")}</p></div>}
    </section>
  </div>;
}
