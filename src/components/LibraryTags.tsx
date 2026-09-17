import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Tag, X } from "lucide-react";
import { createTag, db } from "../db";
import { useI18n } from "../hooks/useI18n";
import { showContextMenuFromPointer } from "../lib/contextMenu";
import { matchesCardCollection, type CardCollection } from "../lib/cardVisibility";
import { isMaterializedCard } from "../lib/journalVisibility";
import { getLibraryIntegrationCopy } from "../lib/libraryIntegrationCopy";

export function LibraryTags({ collection, selectedId, onSelect }: { collection: CardCollection; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const { language, t } = useI18n();
  const copy = getLibraryIntegrationCopy(language);
  const tags = useLiveQuery(() => db.tags.orderBy("name").toArray(), [], []);
  const counts = useLiveQuery(async () => {
    const result: Record<string, number> = {};
    await db.cards.filter((card) => matchesCardCollection(card, collection) && isMaterializedCard(card)).each((card) => {
      for (const id of new Set(card.tagIds)) result[id] = (result[id] || 0) + 1;
    });
    return result;
  }, [collection], {} as Record<string, number>);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const composing = useRef(false);
  const saving = useRef(false);
  async function save() {
    if (!name.trim() || composing.current || saving.current) return;
    saving.current = true; setError("");
    try { const tag = await createTag(name); setName(""); setAdding(false); onSelect(tag.id); }
    catch { setError(copy.failed); }
    finally { saving.current = false; }
  }
  return <section className="library-tags" aria-label={t("database.byTag")}>
    <header><h3>{t("database.byTag")}</h3><button type="button" className="bare-button" aria-label={t("database.addTag")} onClick={() => { setAdding(!adding); setError(""); }}><Plus size={15} /></button></header>
    {adding && <form className="sidebar-tag-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <input autoFocus aria-label={t("database.newTag")} value={name} onChange={(event) => setName(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={(event) => { composing.current = false; setName(event.currentTarget.value); }} onKeyDown={(event) => { if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing)) event.preventDefault(); }} placeholder={t("database.newTag")} />
      <button type="submit">{t("common.add")}</button><button type="button" onClick={() => setAdding(false)} aria-label={t("common.close")}><X size={13} /></button>
    </form>}
    {error && <p role="alert">{error}</p>}
    <button type="button" className={!selectedId ? "is-active" : ""} aria-pressed={!selectedId} onClick={() => onSelect(null)}><Tag size={15} /><span>{copy.allTags}</span></button>
    {tags.map((tag) => <button type="button" key={tag.id} data-library-tag={tag.id} className={selectedId === tag.id ? "is-active" : ""} aria-pressed={selectedId === tag.id} onClick={() => onSelect(tag.id)} onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "tag", id: tag.id })}><i className={`tone-${tag.color}`} /><span>{tag.name}</span><b>{counts[tag.id] || 0}</b></button>)}
    <p className="knowledge-drop-hint">{copy.tagHint}</p>
  </section>;
}
