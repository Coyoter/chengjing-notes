import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { BrainCircuit, Feather, MoreHorizontal, Pin, Sparkles } from "lucide-react";
import { createFragment, db } from "../db";
import { useAppStore } from "../store";
import { relativeTime } from "../lib/utils";
import { showContextMenuFromButton, showContextMenuFromPointer } from "../lib/contextMenu";
import { useI18n } from "../hooks/useI18n";
import { isWindows } from "../lib/platform";
import { TagPicker } from "../components/TagPicker";

export function FragmentsView() {
  const [visibleLimit, setVisibleLimit] = useState(160);
  const fragments = useLiveQuery(async () => {
    const [pinned, recent] = await Promise.all([
      db.fragments.where("pinnedKey").equals("pinned").toArray(),
      db.fragments.orderBy("updatedAt").reverse().filter((fragment) => !fragment.pinned).limit(visibleLimit).toArray(),
    ]);
    return [...new Map([...pinned, ...recent].map((fragment) => [fragment.id, fragment])).values()].sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt).slice(0, visibleLimit);
  }, [visibleLimit], []);
  const totalCount = useLiveQuery(() => db.fragments.count(), [], 0);
  const [value, setValue] = useState("");
  const [status, setStatus] = useState("");
  const [draftTagIds, setDraftTagIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const setView = useAppStore((state) => state.setView);
  const { language, t } = useI18n();
  const sorted = useMemo(() => [...fragments].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt), [fragments]);
  const displayed = sorted;
  const loadMoreLabel = ({ "zh-TW": "顯示更多片語", "zh-CN": "显示更多片语", en: "Show more fragments", ja: "さらに表示", ko: "더 보기" } as const)[language];

  async function save() {
    const text = value.trim();
    if (!text) return;
    await createFragment(text, draftTagIds);
    setValue("");
    setDraftTagIds([]);
    setStatus(t("fragments.saved"));
    window.setTimeout(() => setStatus(""), 2200);
  }

  async function commitEdit() {
    if (!editingId) return;
    const text = editingText.trim();
    if (text) await db.fragments.update(editingId, { text, updatedAt: Date.now() });
    setEditingId(null);
    setEditingText("");
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
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              save();
            }
          }}
          placeholder={t("fragments.placeholder")}
        />
        <TagPicker className="fragment-draft-tags" selectedIds={draftTagIds} onChange={setDraftTagIds} />
        <footer><span>{status || `${value.length}/500`}</span><small><kbd>{isWindows() ? "Ctrl" : "⌘"}</kbd><kbd>Enter</kbd> {t("fragments.saveShortcut")}</small><button type="button" disabled={!value.trim()} onClick={save}><Sparkles size={15} />{t("fragments.save")}</button></footer>
      </section>

      <section className="fragment-stream" aria-label={t("fragments.list")}>
        <header><span>{t("fragments.neurons", { count: totalCount })}</span><p>{t("fragments.hint")}</p></header>
        {displayed.map((fragment) => (
          <article
            key={fragment.id}
            className={fragment.pinned ? "is-pinned" : ""}
            onDoubleClick={() => { setEditingId(fragment.id); setEditingText(fragment.text); }}
            onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "fragment", id: fragment.id })}
          >
            <div className="fragment-dot" aria-hidden="true" />
            <div>
              {editingId === fragment.id ? (
                <textarea
                  autoFocus
                  value={editingText}
                  onChange={(event) => setEditingText(event.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); commitEdit(); } if (event.key === "Escape") setEditingId(null); }}
                />
              ) : <p>{fragment.text}</p>}
              <TagPicker className="fragment-item-tags" selectedIds={fragment.tagIds} onChange={(tagIds) => db.fragments.update(fragment.id, { tagIds, updatedAt: Date.now() })} />
              <footer>{fragment.pinned && <span><Pin size={12} />{t("fragments.pinned")}</span>}<time>{relativeTime(fragment.updatedAt, language)}</time></footer>
            </div>
            <button type="button" className="bare-button" aria-label={t("fragments.more")} onClick={(event) => showContextMenuFromButton(event, { kind: "fragment", id: fragment.id })}><MoreHorizontal size={17} /></button>
          </article>
        ))}
        {displayed.length < totalCount && <button type="button" className="content-load-more" onClick={() => setVisibleLimit((value) => value + 160)}>{loadMoreLabel}</button>}
        {sorted.length === 0 && <div className="fragment-empty"><Feather size={26} /><h3>{t("fragments.empty")}</h3><p>{t("fragments.emptyDescription")}</p></div>}
      </section>
    </div>
  );
}
