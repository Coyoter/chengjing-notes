import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Archive, ArrowUpRight, FileStack, Folder, FolderOpen, FolderTree, Grid2X2, List, LoaderCircle, MoreHorizontal, Pencil, Pin, Plus, Search, Trash2, X } from "lucide-react";
import { createKnowledgeGroup, db, deleteKnowledgeGroup, moveCardToKnowledgeGroup, renameKnowledgeGroup } from "../db";
import { useAppStore } from "../store";
import { localizedKindLabel, relativeTime, truncate } from "../lib/utils";
import { importWebUrl } from "../lib/importers";
import { showContextMenuFromButton, showContextMenuFromPointer } from "../lib/contextMenu";
import { useI18n } from "../hooks/useI18n";
import { getKnowledgeCopy } from "../lib/knowledgeCopy";
import type { CardKind, CardRecord, KnowledgeGroupKind } from "../types";
import { searchQueryTerms } from "../lib/searchIndex";
import { isMaterializedCard } from "../lib/journalVisibility";

const cardKinds: CardKind[] = ["note", "journal", "web", "pdf", "image", "audio", "video", "ai"];
type SelectedGroup = "all" | "pinned" | "unassigned" | string;
type GroupForm = { mode: "create" | "rename"; kind: KnowledgeGroupKind; parentId?: string; id?: string; value: string };

export function LibraryView() {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [collection, setCollection] = useState<"library" | "archive" | "trash">("library");
  const [selectedGroup, setSelectedGroup] = useState<SelectedGroup>("all");
  const [groupForm, setGroupForm] = useState<GroupForm | null>(null);
  const [groupMenu, setGroupMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  const [urlStatus, setUrlStatus] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(120);
  const composing = useRef(false);
  const { language, t } = useI18n();
  const groups = useLiveQuery(() => db.knowledgeGroups.orderBy("order").toArray(), [], []);
  const openCard = useAppStore((state) => state.openCard);
  const setCreateCardOpen = useAppStore((state) => state.setCreateCardOpen);
  const copy = getKnowledgeCopy(language);
  const areas = useMemo(() => groups.filter((group) => group.kind === "area"), [groups]);
  const topics = useMemo(() => groups.filter((group) => group.kind === "topic"), [groups]);
  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const selectedTopicIds = useMemo(() => {
    const selected = groupById.get(selectedGroup);
    if (!selected) return null;
    return new Set(selected.kind === "area" ? topics.filter((topic) => topic.parentId === selected.id).map((topic) => topic.id) : [selected.id]);
  }, [groupById, selectedGroup, topics]);
  function matchesCurrent(card: CardRecord) {
    const collectionMatches = collection === "library" ? card.state !== "archived" && card.state !== "trash" : card.state === collection.replace("archive", "archived");
    const groupMatches = selectedGroup === "all"
      || (selectedGroup === "pinned" && card.favorite)
      || (selectedGroup === "unassigned" && !card.collectionId)
      || Boolean(card.collectionId && selectedTopicIds?.has(card.collectionId));
    const q = query.trim().toLocaleLowerCase(language);
    return isMaterializedCard(card) && collectionMatches && groupMatches && (kind === "all" || card.kind === kind) && (!q || `${card.title} ${card.plainText}`.toLocaleLowerCase(language).includes(q));
  }
  const cards = useLiveQuery(async () => {
    const terms = searchQueryTerms(query, language);
    if (terms.length) return (await db.cards.where("searchTerms").anyOf(terms).distinct().toArray()).filter(matchesCurrent).sort((left, right) => Number(right.favorite) - Number(left.favorite) || right.updatedAt - left.updatedAt).slice(0, visibleLimit);
    const recent = await db.cards.orderBy("updatedAt").reverse().filter(matchesCurrent).limit(visibleLimit).toArray();
    if (selectedGroup === "pinned") return recent;
    const pinned = await db.cards.filter((card) => card.favorite && matchesCurrent(card)).limit(visibleLimit).toArray();
    return [...new Map([...pinned, ...recent].map((card) => [card.id, card])).values()].sort((left, right) => Number(right.favorite) - Number(left.favorite) || right.updatedAt - left.updatedAt).slice(0, visibleLimit);
  }, [collection, kind, language, query, selectedGroup, [...(selectedTopicIds || [])].join("|"), visibleLimit], []);
  const filteredTotal = useLiveQuery(async () => {
    const terms = searchQueryTerms(query, language);
    if (terms.length) return (await db.cards.where("searchTerms").anyOf(terms).distinct().toArray()).filter(matchesCurrent).length;
    return db.cards.orderBy("updatedAt").filter(matchesCurrent).count();
  }, [collection, kind, language, query, selectedGroup, [...(selectedTopicIds || [])].join("|")], 0);
  const counts = useLiveQuery(async () => {
    const topicCounts = await Promise.all(topics.map(async (topic) => [topic.id, await db.cards.where("collectionId").equals(topic.id).filter((card) => card.state !== "trash" && isMaterializedCard(card)).count()] as const));
    const [all, pinned, unassigned] = await Promise.all([
      db.cards.filter((card) => card.state !== "trash" && isMaterializedCard(card)).count(),
      db.cards.filter((card) => card.state !== "trash" && card.favorite && isMaterializedCard(card)).count(),
      db.cards.filter((card) => card.state !== "trash" && !card.collectionId && isMaterializedCard(card)).count(),
    ]);
    return { all, pinned, unassigned, topics: Object.fromEntries(topicCounts) as Record<string, number> };
  }, [topics.map((topic) => topic.id).join("|")], { all: 0, pinned: 0, unassigned: 0, topics: {} as Record<string, number> });

  useEffect(() => {
    const close = () => setGroupMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);

  const displayed = cards;

  useEffect(() => { setVisibleLimit(120); }, [collection, kind, query, selectedGroup]);

  function topicCount(topicId: string) { return counts.topics[topicId] || 0; }
  function areaCount(areaId: string) { return topics.filter((topic) => topic.parentId === areaId).reduce((sum, topic) => sum + (counts.topics[topic.id] || 0), 0); }
  function breadcrumb(collectionId?: string) { const topic = collectionId ? groupById.get(collectionId) : undefined; if (!topic) return copy.noTopic; const area = topic.parentId ? groupById.get(topic.parentId) : undefined; return area ? `${area.name} / ${topic.name}` : topic.name; }

  async function captureUrl(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim()) return;
    setUrlBusy(true); setUrlStatus(t("library.capturing"));
    try { const card = await importWebUrl(url); if (selectedGroup !== "all" && selectedGroup !== "unassigned" && groupById.get(selectedGroup)?.kind === "topic") await moveCardToKnowledgeGroup(card.id, selectedGroup); setUrl(""); setUrlStatus(t("library.urlSaved")); window.setTimeout(() => setUrlStatus(""), 3500); }
    catch (error) { setUrlStatus(error instanceof Error ? error.message : t("library.urlFailed")); }
    finally { setUrlBusy(false); }
  }

  async function submitGroupForm(event: React.FormEvent) {
    event.preventDefault();
    if (!groupForm || composing.current || !groupForm.value.trim()) return;
    if (groupForm.mode === "rename" && groupForm.id) await renameKnowledgeGroup(groupForm.id, groupForm.value);
    else await createKnowledgeGroup(groupForm.kind, groupForm.value, groupForm.parentId);
    setGroupForm(null);
  }

  async function removeGroup(id: string) { const group = groupById.get(id); if (!group || !window.confirm(group.kind === "area" ? copy.confirmRemoveArea(group.name) : copy.confirmRemove(group.name))) return; await deleteKnowledgeGroup(id); if (selectedGroup === id) setSelectedGroup("all"); setGroupMenu(null); }
  async function dropCard(event: React.DragEvent, collectionId?: string) { event.preventDefault(); const cardId = event.dataTransfer.getData("application/x-chengjing-card"); setDragTarget(null); if (cardId) await moveCardToKnowledgeGroup(cardId, collectionId); }

  function groupButton(id: string, name: string, count: number, depth: "area" | "topic") {
    return <button type="button" key={id} className={`${selectedGroup === id ? "is-active" : ""} ${dragTarget === id ? "is-drop-target" : ""} knowledge-${depth}`} onClick={() => setSelectedGroup(id)} onContextMenu={(event) => { event.preventDefault(); setGroupMenu({ id, x: event.clientX, y: event.clientY }); }} onDragOver={(event) => { event.preventDefault(); if (depth === "topic") setDragTarget(id); }} onDragLeave={() => setDragTarget(null)} onDrop={(event) => { if (depth === "topic") void dropCard(event, id); }}>{depth === "area" ? <FolderOpen size={15} /> : <Folder size={14} />}<span>{name}</span><b>{count}</b></button>;
  }

  function activateCard(card: (typeof cards)[number]) { if (card.state !== "trash" && card.kind === "web" && card.sourceUrl) window.open(card.sourceUrl, "_blank", "noopener,noreferrer"); else openCard(card.id); }

  const selectedForCreate = selectedGroup !== "all" && selectedGroup !== "pinned" && selectedGroup !== "unassigned" && groupById.get(selectedGroup)?.kind === "topic" ? selectedGroup : null;
  const currentGroup = selectedGroup === "all" ? copy.allCards : selectedGroup === "pinned" ? t("library.pinned") : selectedGroup === "unassigned" ? copy.unassigned : groupById.get(selectedGroup)?.name || copy.allCards;

  return <div className="library-layout">
    <aside className="library-organizer">
      <header><div><span>{copy.organizer}</span><b>{copy.areas}</b></div><button type="button" aria-label={copy.addArea} onClick={() => setGroupForm({ mode: "create", kind: "area", value: "" })}><Plus size={15} /></button></header>
      <button type="button" className={selectedGroup === "all" ? "is-active" : ""} onClick={() => setSelectedGroup("all")}><FileStack size={15} /><span>{copy.allCards}</span><b>{counts.all}</b></button>
      <button type="button" className={selectedGroup === "pinned" ? "is-active" : ""} onClick={() => setSelectedGroup("pinned")}><Pin size={15} /><span>{t("library.pinned")}</span><b>{counts.pinned}</b></button>
      <button type="button" className={`${selectedGroup === "unassigned" ? "is-active" : ""} ${dragTarget === "unassigned" ? "is-drop-target" : ""}`} onClick={() => setSelectedGroup("unassigned")} onDragOver={(event) => { event.preventDefault(); setDragTarget("unassigned"); }} onDragLeave={() => setDragTarget(null)} onDrop={(event) => void dropCard(event)}><FolderTree size={15} /><span>{copy.unassigned}</span><b>{counts.unassigned}</b></button>
      {groupForm?.mode === "create" && groupForm.kind === "area" && <form className="knowledge-group-form" onSubmit={submitGroupForm}><input autoFocus value={groupForm.value} placeholder={copy.areaPlaceholder} onChange={(event) => setGroupForm({ ...groupForm, value: event.target.value })} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} /><button type="submit">{copy.save}</button><button type="button" onClick={() => setGroupForm(null)}><X size={13} /></button></form>}
      <div className="knowledge-tree">{areas.map((area) => <section key={area.id}><div>{groupButton(area.id, area.name, areaCount(area.id), "area")}<button type="button" className="knowledge-add-topic" aria-label={`${copy.addTopic} · ${area.name}`} onClick={() => setGroupForm({ mode: "create", kind: "topic", parentId: area.id, value: "" })}><Plus size={13} /></button></div>{topics.filter((topic) => topic.parentId === area.id).map((topic) => groupButton(topic.id, topic.name, topicCount(topic.id), "topic"))}{groupForm?.mode === "create" && groupForm.kind === "topic" && groupForm.parentId === area.id && <form className="knowledge-group-form is-topic" onSubmit={submitGroupForm}><input autoFocus value={groupForm.value} placeholder={copy.topicPlaceholder} onChange={(event) => setGroupForm({ ...groupForm, value: event.target.value })} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} /><button type="submit">{copy.save}</button><button type="button" onClick={() => setGroupForm(null)}><X size={13} /></button></form>}</section>)}</div>
      {topics.some((topic) => !topic.parentId) && <><h3>{copy.orphanTopics}</h3>{topics.filter((topic) => !topic.parentId).map((topic) => groupButton(topic.id, topic.name, topicCount(topic.id), "topic"))}</>}
      <p className="knowledge-drop-hint">{copy.dropHint}</p>
    </aside>

    <div className="page-scroll standard-page library-content">
      <header className="page-intro compact-intro"><div><span>{selectedForCreate ? breadcrumb(selectedForCreate) : copy.organizer}</span><h2>{currentGroup} · {collection === "trash" ? t("library.deletedCount", { count: filteredTotal }) : collection === "archive" ? t("library.archivedCount", { count: filteredTotal }) : t("library.count", { count: filteredTotal })}</h2><p>{collection === "trash" ? t("library.trashDescription") : t("library.description")}</p></div><button type="button" className="primary-button" onClick={() => setCreateCardOpen(true, selectedForCreate)}><Plus size={16} />{t("today.newCard")}</button></header>
      <form className="url-capture-bar" onSubmit={captureUrl}><ArrowUpRight size={17} /><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder={t("library.urlPlaceholder")} /><button type="submit" disabled={urlBusy || !url.trim()}>{urlBusy ? <LoaderCircle size={15} className="spin" /> : <ArrowUpRight size={15} />}{urlBusy ? t("library.capture") : t("library.saveUrl")}</button></form>
      {urlStatus && <div className="url-capture-status" role="status">{urlStatus}</div>}
      <div className="collection-tabs" aria-label={t("library.categories")}><button type="button" className={collection === "library" ? "is-active" : ""} onClick={() => setCollection("library")}><FileStack size={15} />{t("nav.library")}</button><button type="button" className={collection === "archive" ? "is-active" : ""} onClick={() => setCollection("archive")}><Archive size={15} />{t("library.archive")}</button><button type="button" className={collection === "trash" ? "is-active" : ""} onClick={() => setCollection("trash")}><Trash2 size={15} />{t("library.trash")}</button></div>
      <div className="filter-bar"><label className="inline-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("library.search")} /></label><div className="view-toggle"><button type="button" className={layout === "grid" ? "is-active" : ""} onClick={() => setLayout("grid")} aria-label={t("library.grid")}><Grid2X2 size={16} /></button><button type="button" className={layout === "list" ? "is-active" : ""} onClick={() => setLayout("list")} aria-label={t("library.list")}><List size={16} /></button></div></div>
      <div className="kind-filter-strip" aria-label={t("library.allTypes")}><button type="button" className={kind === "all" ? "is-active" : ""} onClick={() => setKind("all")}>{t("library.allTypes")}</button>{cardKinds.map((value) => <button type="button" key={value} className={kind === value ? "is-active" : ""} onClick={() => setKind(value)}>{localizedKindLabel(value, language)}</button>)}</div>
      <section className={`library-grid ${layout === "list" ? "is-list" : ""}`}>{displayed.map((card) => <article key={card.id} className="library-card" role="button" tabIndex={0} draggable={card.state !== "trash"} data-card-kind={card.kind} data-pinned={card.favorite || undefined} onDragStart={(event) => { event.dataTransfer.setData("application/x-chengjing-card", card.id); event.dataTransfer.effectAllowed = "move"; }} onClick={() => activateCard(card)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activateCard(card); } }} onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "card", id: card.id })} aria-label={card.kind === "web" && card.sourceUrl ? t("library.openWeb", { title: card.title }) : t("library.openCard", { title: card.title })}><header><span>{localizedKindLabel(card.kind, language)}</span><time>{relativeTime(card.updatedAt, language)}</time></header><button type="button" className="library-card-menu" aria-label={t("library.more", { title: card.title })} onClick={(event) => showContextMenuFromButton(event, { kind: "card", id: card.id })}><MoreHorizontal size={16} /></button><h3>{card.title}</h3><p>{truncate(card.plainText, layout === "grid" ? 145 : 220) || t("common.noContent")}</p><footer><span>{breadcrumb(card.collectionId)}</span>{card.kind === "web" && card.sourceUrl ? <ArrowUpRight size={13} /> : card.favorite && <b><Pin size={12} />{t("library.pinned")}</b>}</footer></article>)}{displayed.length === 0 && <div className="empty-state library-empty"><FileStack size={28} /><h3>{collection === "trash" ? t("library.trashEmpty") : t("library.empty")}</h3><p>{collection === "trash" ? t("library.trashEmptyDescription") : t("library.emptyDescription")}</p></div>}</section>
      {displayed.length < filteredTotal && <button type="button" className="content-load-more" onClick={() => setVisibleLimit((value) => value + 120)}>{copy.loadMore(Math.min(120, filteredTotal - displayed.length))}</button>}
    </div>

    {groupMenu && (() => { const group = groupById.get(groupMenu.id); return group ? <div className="knowledge-context-menu" role="menu" style={{ left: groupMenu.x, top: groupMenu.y }} onPointerDown={(event) => event.stopPropagation()}><header><span>{group.kind === "area" ? copy.area : copy.topic}</span><b>{group.name}</b></header>{group.kind === "area" && <button type="button" role="menuitem" onClick={() => { setGroupForm({ mode: "create", kind: "topic", parentId: group.id, value: "" }); setGroupMenu(null); }}><Plus size={14} />{copy.addTopic}</button>}<button type="button" role="menuitem" onClick={() => { setGroupForm({ mode: "rename", kind: group.kind, parentId: group.parentId, id: group.id, value: group.name }); setGroupMenu(null); }}><Pencil size={14} />{copy.rename}</button><button type="button" role="menuitem" className="is-danger" onClick={() => void removeGroup(group.id)}><Trash2 size={14} />{copy.remove}</button></div> : null; })()}
    {groupForm?.mode === "rename" && <div className="knowledge-rename-backdrop" onMouseDown={() => setGroupForm(null)}><form className="knowledge-rename-dialog" onSubmit={submitGroupForm} onMouseDown={(event) => event.stopPropagation()}><span>{groupForm.kind === "area" ? copy.area : copy.topic}</span><input autoFocus value={groupForm.value} onChange={(event) => setGroupForm({ ...groupForm, value: event.target.value })} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} /><footer><button type="button" onClick={() => setGroupForm(null)}>{copy.cancel}</button><button type="submit">{copy.save}</button></footer></form></div>}
  </div>;
}
