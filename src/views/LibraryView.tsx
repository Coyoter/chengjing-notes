import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CheckCircle2, CheckSquare2, Circle, Columns3, ListTodo, Square, Table2, Tags, Archive, ArrowUpRight, FileStack, Folder, FolderOpen, FolderTree, Grid2X2, List, LoaderCircle, MoreHorizontal, Pencil, Pin, Plus, Search, Trash2, X } from "lucide-react";
import { createTag, createKnowledgeGroup, db, deleteCardPermanently, deleteKnowledgeGroup, moveCardToKnowledgeGroup, moveCardToTrash, renameKnowledgeGroup } from "../db";
import { useAppStore } from "../store";
import { localizedKindLabel, relativeTime, truncate } from "../lib/utils";
import { importWebUrl } from "../lib/importers";
import { showContextMenuFromButton, showContextMenuFromPointer } from "../lib/contextMenu";
import { useI18n } from "../hooks/useI18n";
import { getKnowledgeCopy } from "../lib/knowledgeCopy";
import type { CardKind, CardRecord, KnowledgeGroupKind } from "../types";
import { includesQuery, searchRecords } from "../lib/searchRecords";
import { isCardInCollection } from "../lib/cardVisibility";
import { getHiddenTaskIds } from "../lib/activeContent";
import { matchesLibraryCard, matchesLibraryTask, type LibraryFilters } from "../lib/libraryFilters";
import { getTaskIntegrationCopy, taskCopyFormat } from "../lib/taskIntegrationCopy";
import { setTaskDone } from "../lib/taskSync";
import { LibraryStructuredContent } from "../components/LibraryStructuredContent";
import { useMobileBack } from "../lib/mobileBack";
import { ChevronDown } from "lucide-react";

const cardKinds: CardKind[] = ["note", "journal", "web", "pdf", "image", "audio", "video", "ai"];
type SelectedGroup = "all" | "pinned" | "unassigned" | string;
type GroupForm = { mode: "create" | "rename"; kind: KnowledgeGroupKind; parentId?: string; id?: string; value: string };

export function LibraryView() {
  const [organizerOpen,setOrganizerOpen]=useState(false);
  useMobileBack(organizerOpen,()=>setOrganizerOpen(false));
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [layout, setLayout] = useState<"grid" | "list" | "table" | "kanban">("grid");
  const [collection, setCollection] = useState<"library" | "archive" | "trash">("library");
  const [selectedGroup, setSelectedGroup] = useState<SelectedGroup>("all");
  const [groupForm, setGroupForm] = useState<GroupForm | null>(null);
  const [groupMenu, setGroupMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  const [urlStatus, setUrlStatus] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(120);
  const [scope, setScope] = useState<"cards" | "all" | "tasks">("cards");
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [newTag, setNewTag] = useState("");
  const [showAddTag, setShowAddTag] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const tagSaving = useRef(false);
  const tagComposing = useRef(false);
  const composing = useRef(false);
  const { language, t } = useI18n();
  const groups = useLiveQuery(() => db.knowledgeGroups.orderBy("order").toArray(), [], []);
  const openStoredCard = useAppStore((state) => state.openCard);
  const setView = useAppStore((state) => state.setView);
  const tags = useLiveQuery(() => db.tags.orderBy("name").toArray(), [], []);
  const selectedTag = tags.find((tag) => tag.id === selectedTagId);
  const taskCopy = getTaskIntegrationCopy(language);
  const stageLabel = ({ "zh-TW": "階段看板", "zh-CN": "阶段看板", en: "Stage board", ja: "ステージボード", ko: "단계 보드" } as const)[language];
  function openCard(id: string) { openStoredCard(id, { allowInactive: collection !== "library" }); }
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
  const filters: LibraryFilters = { collection, group: selectedGroup, topicIds: selectedTopicIds, tagId: selectedTagId, kind, query, language };
  function matchesCurrent(card: CardRecord) { return matchesLibraryCard(card, filters); }
  const cards = useLiveQuery(async () => {
    if (scope === "tasks") return [];
    if (query.trim()) return (await searchRecords(db.cards, query, language, matchesCurrent, visibleLimit)).sort((left, right) => Number(right.favorite) - Number(left.favorite) || right.updatedAt - left.updatedAt);
    const recent = await db.cards.orderBy("updatedAt").reverse().filter(matchesCurrent).limit(visibleLimit).toArray();
    if (selectedGroup === "pinned") return recent;
    const pinned = await db.cards.filter((card) => card.favorite && matchesCurrent(card)).limit(visibleLimit).toArray();
    return [...new Map([...pinned, ...recent].map((card) => [card.id, card])).values()].sort((left, right) => Number(right.favorite) - Number(left.favorite) || right.updatedAt - left.updatedAt).slice(0, visibleLimit);
  }, [collection, kind, language, query, selectedGroup, scope, selectedTagId, [...(selectedTopicIds || [])].join("|"), visibleLimit], []);
  const filteredCardTotal = useLiveQuery(async () => {
    if (scope === "tasks") return 0;
    return db.cards.orderBy("updatedAt").filter(matchesCurrent).count();
  }, [collection, kind, language, query, selectedGroup, scope, selectedTagId, [...(selectedTopicIds || [])].join("|")], 0);
  const taskResults = useLiveQuery(async () => {
    if (scope === "cards" || collection !== "library") return { items: [], total: 0, taskTags: {} as Record<string, string[]> };
    const hidden = await getHiddenTaskIds();
    const candidates = await db.tasks.orderBy("updatedAt").reverse().filter((task) => !hidden.has(task.id) && includesQuery(task.title, query, language)).toArray();
    const sourceIds = [...new Set(candidates.map((task) => task.cardId).filter(Boolean) as string[])];
    const sources = new Map((await db.cards.bulkGet(sourceIds)).filter(Boolean).map((card) => [card!.id, card!]));
    const matching = candidates.filter((task) => matchesLibraryTask(task, task.cardId ? sources.get(task.cardId) : undefined, filters));
    const items = matching.slice(0, visibleLimit);
    return { items, total: matching.length, taskTags: Object.fromEntries(items.map((task) => [task.id, task.cardId ? sources.get(task.cardId)?.tagIds || [] : []])) };
  }, [collection, kind, language, query, selectedGroup, scope, selectedTagId, [...(selectedTopicIds || [])].join("|"), visibleLimit], { items: [], total: 0, taskTags: {} as Record<string, string[]> });
  const tasks = taskResults.items;
  const filteredTotal = filteredCardTotal + taskResults.total;
  const displayedCount = cards.length + tasks.length;
  const allFilteredSelected = cards.length > 0 && cards.every((card) => selectedIds.has(card.id));
  const counts = useLiveQuery(async () => {
    const topicCounts = await Promise.all(topics.map(async (topic) => [topic.id, await db.cards.where("collectionId").equals(topic.id).filter((card) => isCardInCollection(card, collection)).count()] as const));
    const [all, pinned, unassigned] = await Promise.all([
      db.cards.filter((card) => isCardInCollection(card, collection)).count(),
      db.cards.filter((card) => isCardInCollection(card, collection) && card.favorite).count(),
      db.cards.filter((card) => isCardInCollection(card, collection) && !card.collectionId).count(),
    ]);
    return { all, pinned, unassigned, topics: Object.fromEntries(topicCounts) as Record<string, number> };
  }, [collection, topics.map((topic) => topic.id).join("|")], { all: 0, pinned: 0, unassigned: 0, topics: {} as Record<string, number> });

  useEffect(() => {
    const close = () => setGroupMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);

  const tagCounts = useLiveQuery(async () => Object.fromEntries(await Promise.all(tags.map(async (tag) => [tag.id, await db.cards.where("tagIds").equals(tag.id).filter((card) => isCardInCollection(card, collection)).count()]))), [collection, tags.map((tag) => tag.id).join("|")], {} as Record<string, number>);
  const displayed = cards;
  useEffect(() => { if (selectedTagId && !tags.some((tag) => tag.id === selectedTagId)) setSelectedTagId(null); }, [selectedTagId, tags]);
  useEffect(() => { setSelectedIds(new Set()); }, [collection, kind, query, scope, selectedGroup, selectedTagId]);
  useEffect(() => {
    const visible = new Set(cards.map((card) => card.id));
    setSelectedIds((previous) => previous.size && [...previous].some((id) => !visible.has(id)) ? new Set([...previous].filter((id) => visible.has(id))) : previous);
  }, [cards]);
  async function saveNewTag() {
    const name = newTag.trim();
    if (!name || tagSaving.current || tagComposing.current) return;
    tagSaving.current = true;
    try { const tag = await createTag(name); setNewTag(""); setShowAddTag(false); setSelectedTagId(tag.id); }
    catch (error) { setUrlStatus(error instanceof Error ? error.message : String(error)); }
    finally { tagSaving.current = false; }
  }
  function toggleCard(id: string) { setSelectedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function toggleAllFiltered() { setSelectedIds(allFilteredSelected ? new Set() : new Set(cards.map((card) => card.id))); }
  function leaveSelectionMode() { setSelectionMode(false); setSelectedIds(new Set()); }
  async function bulkRemove(permanent: boolean) {
    const ids = [...selectedIds]; if (!ids.length || bulkBusy) return;
    if ((permanent || ids.length > 5) && !window.confirm(t(permanent ? "database.confirmDelete" : "database.confirmTrash", { count: ids.length }))) return;
    setBulkBusy(true);
    try { for (const id of ids) { if (permanent) await deleteCardPermanently(id); else await moveCardToTrash(id); } leaveSelectionMode(); }
    catch (error) { setUrlStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBulkBusy(false); }
  }
  function chooseCollection(next: "library" | "archive" | "trash") {
    setCollection(next); setSelectedGroup("all"); setSelectedTagId(null); setQuery(""); setKind("all"); setScope("cards"); leaveSelectionMode();
  }

  useEffect(() => { setVisibleLimit(120); }, [collection, kind, query, selectedGroup, scope, selectedTagId]);

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

  function activateCard(card: (typeof cards)[number]) { if (selectionMode) { toggleCard(card.id); return; } if (card.state !== "trash" && card.kind === "web" && card.sourceUrl) window.open(card.sourceUrl, "_blank", "noopener,noreferrer"); else openCard(card.id); }

  const selectedForCreate = selectedGroup !== "all" && selectedGroup !== "pinned" && selectedGroup !== "unassigned" && groupById.get(selectedGroup)?.kind === "topic" ? selectedGroup : null;
  const currentGroup = scope === "tasks" ? taskCopy.tasksOnly : scope === "all" && selectedGroup === "all" ? taskCopy.allContent : selectedGroup === "all" ? copy.allCards : selectedGroup === "pinned" ? t("library.pinned") : selectedGroup === "unassigned" ? copy.unassigned : groupById.get(selectedGroup)?.name || copy.allCards;

  return <div className="library-layout">
    <button type="button" className="mobile-section-picker" onClick={()=>setOrganizerOpen(true)} aria-expanded={organizerOpen}><FolderTree size={18}/><span>{currentGroup}</span><ChevronDown size={17}/></button>
    {organizerOpen&&<button type="button" className="mobile-organizer-backdrop" aria-label={t("common.close")} onClick={()=>setOrganizerOpen(false)}/>}
    <aside className={`library-organizer ${organizerOpen?"is-open":""}`} onClick={event=>{if((event.target as HTMLElement).closest(".library-organizer > button,.knowledge-area,.knowledge-topic"))setOrganizerOpen(false)}}>
      <button type="button" className="mobile-organizer-close" onClick={()=>setOrganizerOpen(false)} aria-label={t("common.close")}><X size={20}/></button>
      <header><div><span>{copy.organizer}</span><b>{copy.areas}</b></div><button type="button" aria-label={copy.addArea} onClick={() => setGroupForm({ mode: "create", kind: "area", value: "" })}><Plus size={15} /></button></header>
      <button type="button" className={selectedGroup === "all" ? "is-active" : ""} onClick={() => setSelectedGroup("all")}><FileStack size={15} /><span>{copy.allCards}</span><b>{counts.all}</b></button>
      <button type="button" className={selectedGroup === "pinned" ? "is-active" : ""} onClick={() => setSelectedGroup("pinned")}><Pin size={15} /><span>{t("library.pinned")}</span><b>{counts.pinned}</b></button>
      <button type="button" className={`${selectedGroup === "unassigned" ? "is-active" : ""} ${dragTarget === "unassigned" ? "is-drop-target" : ""}`} onClick={() => setSelectedGroup("unassigned")} onDragOver={(event) => { event.preventDefault(); setDragTarget("unassigned"); }} onDragLeave={() => setDragTarget(null)} onDrop={(event) => void dropCard(event)}><FolderTree size={15} /><span>{copy.unassigned}</span><b>{counts.unassigned}</b></button>
      {groupForm?.mode === "create" && groupForm.kind === "area" && <form className="knowledge-group-form" onSubmit={submitGroupForm}><input autoFocus value={groupForm.value} placeholder={copy.areaPlaceholder} onChange={(event) => setGroupForm({ ...groupForm, value: event.target.value })} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} /><button type="submit">{copy.save}</button><button type="button" onClick={() => setGroupForm(null)}><X size={13} /></button></form>}
      <div className="knowledge-tree">{areas.map((area) => <section key={area.id}><div>{groupButton(area.id, area.name, areaCount(area.id), "area")}<button type="button" className="knowledge-add-topic" aria-label={`${copy.addTopic} · ${area.name}`} onClick={() => setGroupForm({ mode: "create", kind: "topic", parentId: area.id, value: "" })}><Plus size={13} /></button></div>{topics.filter((topic) => topic.parentId === area.id).map((topic) => groupButton(topic.id, topic.name, topicCount(topic.id), "topic"))}{groupForm?.mode === "create" && groupForm.kind === "topic" && groupForm.parentId === area.id && <form className="knowledge-group-form is-topic" onSubmit={submitGroupForm}><input autoFocus value={groupForm.value} placeholder={copy.topicPlaceholder} onChange={(event) => setGroupForm({ ...groupForm, value: event.target.value })} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} /><button type="submit">{copy.save}</button><button type="button" onClick={() => setGroupForm(null)}><X size={13} /></button></form>}</section>)}</div>
      {topics.some((topic) => !topic.parentId) && <><h3>{copy.orphanTopics}</h3>{topics.filter((topic) => !topic.parentId).map((topic) => groupButton(topic.id, topic.name, topicCount(topic.id), "topic"))}</>}
      <section className="library-tag-section">
        <header><h3><Tags size={14} />{t("database.byTag")}</h3><button type="button" className="bare-button" aria-label={t("database.addTag")} onClick={() => setShowAddTag(!showAddTag)}><Plus size={15} /></button></header>
        {showAddTag && <form className="sidebar-tag-form" onSubmit={(event) => { event.preventDefault(); void saveNewTag(); }}><input autoFocus aria-label={t("database.newTag")} value={newTag} onChange={(event) => setNewTag(event.target.value)} onCompositionStart={() => { tagComposing.current = true; }} onCompositionEnd={(event) => { tagComposing.current = false; setNewTag(event.currentTarget.value); }} onBlur={() => void saveNewTag()} onKeyDown={(event) => { if (event.key === "Enter" && (event.nativeEvent.isComposing || tagComposing.current)) event.preventDefault(); }} /><button type="submit">{t("common.add")}</button></form>}
        {tags.map((tag) => <button type="button" key={tag.id} className={selectedTagId === tag.id ? "is-active" : ""} aria-pressed={selectedTagId === tag.id} onClick={() => { setSelectedTagId(selectedTagId === tag.id ? null : tag.id); setOrganizerOpen(false); }} onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "tag", id: tag.id })}><i className={`tone-${tag.color}`} /><span>{tag.name}</span><b>{tagCounts[tag.id] || 0}</b></button>)}
      </section>
      <p className="knowledge-drop-hint">{copy.dropHint}</p>
    </aside>

    <div className="page-scroll standard-page library-content">
      <header className="page-intro compact-intro"><div><span>{selectedForCreate ? breadcrumb(selectedForCreate) : copy.organizer}</span><h2>{currentGroup}{selectedTag ? ` / ${selectedTag.name}` : ""} · {collection === "trash" ? t("library.deletedCount", { count: filteredTotal }) : collection === "archive" ? t("library.archivedCount", { count: filteredTotal }) : scope === "cards" ? t("library.count", { count: filteredTotal }) : taskCopyFormat(taskCopy.matching, { count: filteredTotal })}</h2><p>{collection === "trash" ? t("library.trashDescription") : t("library.description")}</p></div><button type="button" className="primary-button" onClick={() => setCreateCardOpen(true, selectedForCreate)}><Plus size={16} />{t("today.newCard")}</button></header>
      <form className="url-capture-bar" onSubmit={captureUrl}><ArrowUpRight size={17} /><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder={t("library.urlPlaceholder")} /><button type="submit" disabled={urlBusy || !url.trim()}>{urlBusy ? <LoaderCircle size={15} className="spin" /> : <ArrowUpRight size={15} />}{urlBusy ? t("library.capture") : t("library.saveUrl")}</button></form>
      {urlStatus && <div className="url-capture-status" role="status">{urlStatus}</div>}
      <div className="collection-tabs" aria-label={t("library.categories")}><button type="button" className={collection === "library" ? "is-active" : ""} onClick={() => chooseCollection("library")}><FileStack size={15} />{t("nav.library")}</button><button type="button" className={collection === "archive" ? "is-active" : ""} onClick={() => chooseCollection("archive")}><Archive size={15} />{t("library.archive")}</button><button type="button" className={collection === "trash" ? "is-active" : ""} onClick={() => chooseCollection("trash")}><Trash2 size={15} />{t("library.trash")}</button></div>
      <div className="library-unified-tools">
        {collection === "library" && <label><ListTodo size={15} /><select aria-label={taskCopy.allContent} value={scope} onChange={(event) => { setScope(event.target.value as typeof scope); leaveSelectionMode(); }}><option value="cards">{taskCopy.cardsOnly}</option><option value="all">{taskCopy.allContent}</option><option value="tasks">{taskCopy.tasksOnly}</option></select></label>}
        {selectedTag && <button type="button" className="secondary-button" onClick={() => setSelectedTagId(null)}><Tags size={14} />{selectedTag.name}<X size={13} /></button>}
        {scope !== "tasks" && <button type="button" className={selectionMode ? "secondary-button is-active" : "secondary-button"} onClick={() => selectionMode ? leaveSelectionMode() : setSelectionMode(true)}><CheckSquare2 size={15} />{t("database.batch")}</button>}
      </div>
      {selectionMode && <div className="database-bulk-bar" role="toolbar" aria-label={t("database.batchToolbar")}>
        <button type="button" disabled={bulkBusy} onClick={toggleAllFiltered}>{allFilteredSelected ? <CheckSquare2 size={16} /> : <Square size={16} />}{allFilteredSelected ? t("database.cancelSelectAll") : t("database.selectCurrent", { count: cards.length })}</button>
        <span>{t("database.selected", { count: selectedIds.size })}</span>
        {collection !== "trash" && <button type="button" disabled={bulkBusy || !selectedIds.size} onClick={() => void bulkRemove(false)}><Trash2 size={15} />{t("database.moveTrash")}</button>}
        <button type="button" className="is-danger" disabled={bulkBusy || !selectedIds.size} onClick={() => void bulkRemove(true)}><Trash2 size={15} />{t("database.deleteForever")}</button>
        <button type="button" disabled={bulkBusy} onClick={leaveSelectionMode} aria-label={t("database.endBatch")}><X size={16} /></button>
      </div>}
      <div className="filter-bar"><label className="inline-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("library.search")} /></label><div className="view-toggle"><button type="button" className={layout === "grid" ? "is-active" : ""} onClick={() => setLayout("grid")} aria-label={t("library.grid")}><Grid2X2 size={16} /></button><button type="button" className={layout === "list" ? "is-active" : ""} onClick={() => setLayout("list")} aria-label={t("library.list")}><List size={16} /></button><button type="button" className={layout === "table" ? "is-active" : ""} onClick={() => setLayout("table")} aria-label={t("database.table")} title={t("database.table")}><Table2 size={16} /></button><button type="button" className={layout === "kanban" ? "is-active" : ""} onClick={() => setLayout("kanban")} aria-label={stageLabel} title={stageLabel}><Columns3 size={16} /></button></div></div>
      <div className="kind-filter-strip" aria-label={t("library.allTypes")}><button type="button" className={kind === "all" ? "is-active" : ""} onClick={() => setKind("all")}>{t("library.allTypes")}</button>{cardKinds.map((value) => <button type="button" key={value} className={kind === value ? "is-active" : ""} onClick={() => setKind(value)}>{localizedKindLabel(value, language)}</button>)}</div>
      {(layout === "table" || layout === "kanban") ? <LibraryStructuredContent cards={cards} tasks={tasks} tags={tags} taskTags={taskResults.taskTags} layout={layout} selectionMode={selectionMode} selectedIds={selectedIds} total={filteredTotal} toggleCard={toggleCard} toggleAllFiltered={toggleAllFiltered} openCard={openCard} openTasks={() => setView("tasks")} /> : <section className={`library-grid ${layout === "list" ? "is-list" : ""}`}>{displayed.map((card) => <article key={card.id} className={`library-card ${selectedIds.has(card.id) ? "is-selected" : ""}`} role="button" tabIndex={0} draggable={!selectionMode && collection === "library"} data-card-kind={card.kind} data-pinned={card.favorite || undefined} onDragStart={(event) => { event.dataTransfer.setData("application/x-chengjing-card", card.id); event.dataTransfer.effectAllowed = "move"; }} onClick={() => activateCard(card)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activateCard(card); } }} onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "card", id: card.id })} aria-label={card.kind === "web" && card.sourceUrl ? t("library.openWeb", { title: card.title }) : t("library.openCard", { title: card.title })}><header><span>{selectionMode && (selectedIds.has(card.id) ? <CheckSquare2 size={15} /> : <Square size={15} />)}{localizedKindLabel(card.kind, language)}</span><time>{relativeTime(card.updatedAt, language)}</time></header><button type="button" className="library-card-menu" aria-label={t("library.more", { title: card.title })} onClick={(event) => showContextMenuFromButton(event, { kind: "card", id: card.id })}><MoreHorizontal size={16} /></button><h3>{card.title}</h3><p>{truncate(card.plainText, layout === "grid" ? 145 : 220) || t("common.noContent")}</p><footer><span title={card.tagIds.map((id) => tags.find((tag) => tag.id === id)?.name).filter(Boolean).join(" · ")}>{breadcrumb(card.collectionId)}{card.tagIds.length > 0 ? ` · ${card.tagIds.map((id) => tags.find((tag) => tag.id === id)?.name).filter(Boolean).join(" · ")}` : ""}</span>{card.kind === "web" && card.sourceUrl ? <ArrowUpRight size={13} /> : card.favorite && <b><Pin size={12} />{t("library.pinned")}</b>}</footer></article>)}{tasks.map((task) => <article key={task.id} className="library-card library-task-card" onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "task", id: task.id })}><header><span>{taskCopy.tasksOnly}</span><time>{relativeTime(task.updatedAt, language)}</time></header><h3><button type="button" onClick={() => setView("tasks")}>{task.title}</button></h3><button type="button" className="database-task-state" onClick={() => void setTaskDone(task.id, !task.done)}>{task.done ? <CheckCircle2 size={15} /> : <Circle size={15} />}{task.done ? taskCopy.taskDone : taskCopy.taskOpen}</button><footer><span>{(taskResults.taskTags[task.id] || []).map((id) => tags.find((tag) => tag.id === id)?.name).filter(Boolean).join(" · ")}</span><time>{task.dueAt ? taskCopyFormat(taskCopy.due, { date: new Intl.DateTimeFormat(language, { month: "short", day: "numeric" }).format(task.dueAt) }) : taskCopy.noDue}</time></footer></article>)}{displayedCount === 0 && <div className="empty-state library-empty"><FileStack size={28} /><h3>{collection === "trash" ? t("library.trashEmpty") : t("library.empty")}</h3><p>{collection === "trash" ? t("library.trashEmptyDescription") : t("library.emptyDescription")}</p></div>}</section>}
      {displayedCount < filteredTotal && <button type="button" className="content-load-more" onClick={() => setVisibleLimit((value) => value + 120)}>{copy.loadMore(Math.min(120, filteredTotal - displayedCount))}</button>}
    </div>

    {groupMenu && (() => { const group = groupById.get(groupMenu.id); return group ? <div className="knowledge-context-menu" role="menu" style={{ left: groupMenu.x, top: groupMenu.y }} onPointerDown={(event) => event.stopPropagation()}><header><span>{group.kind === "area" ? copy.area : copy.topic}</span><b>{group.name}</b></header>{group.kind === "area" && <button type="button" role="menuitem" onClick={() => { setGroupForm({ mode: "create", kind: "topic", parentId: group.id, value: "" }); setGroupMenu(null); }}><Plus size={14} />{copy.addTopic}</button>}<button type="button" role="menuitem" onClick={() => { setGroupForm({ mode: "rename", kind: group.kind, parentId: group.parentId, id: group.id, value: group.name }); setGroupMenu(null); }}><Pencil size={14} />{copy.rename}</button><button type="button" role="menuitem" className="is-danger" onClick={() => void removeGroup(group.id)}><Trash2 size={14} />{copy.remove}</button></div> : null; })()}
    {groupForm?.mode === "rename" && <div className="knowledge-rename-backdrop" onMouseDown={() => setGroupForm(null)}><form className="knowledge-rename-dialog" onSubmit={submitGroupForm} onMouseDown={(event) => event.stopPropagation()}><span>{groupForm.kind === "area" ? copy.area : copy.topic}</span><input autoFocus value={groupForm.value} onChange={(event) => setGroupForm({ ...groupForm, value: event.target.value })} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} /><footer><button type="button" onClick={() => setGroupForm(null)}>{copy.cancel}</button><button type="submit">{copy.save}</button></footer></form></div>}
  </div>;
}
