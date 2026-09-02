import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Archive,
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  FileText,
  FolderTree,
  Highlighter,
  Info,
  Link2,
  MapPin,
  MoreHorizontal,
  PanelsTopLeft,
  Pin,
  History,
  Plus,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react";
import { db, moveCardToTrash, restoreCardVersion, updateCardWithHistory } from "../db";
import { useAppStore } from "../store";
import type { AttachmentRecord, CardRecord } from "../types";
import { localizedKindLabel, relativeTime } from "../lib/utils";
import { RichEditor } from "./RichEditor";
import { showContextMenuFromButton } from "../lib/contextMenu";
import { useI18n } from "../hooks/useI18n";
import { TagPicker } from "./TagPicker";
import { KnowledgeGroupPicker } from "./KnowledgeGroupPicker";
import { getCardPropertyCopy } from "../lib/cardPropertyCopy";
import { attachmentUrl, removeStoredAttachment, shouldRevokeAttachmentUrl } from "../lib/attachments";
import { searchQueryTerms } from "../lib/searchIndex";
import { isMaterializedCard } from "../lib/journalVisibility";

const PdfAttachmentViewer = lazy(() => import("./PdfAttachmentViewer").then((module) => ({ default: module.PdfAttachmentViewer })));

function StandardAttachmentPreview({ attachment, downloadLabel }: { attachment: AttachmentRecord; downloadLabel: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = attachmentUrl(attachment);
    setUrl(next);
    return () => { if (next && shouldRevokeAttachmentUrl(attachment)) URL.revokeObjectURL(next); };
  }, [attachment]);
  if (!url) return null;
  if (attachment.mime.startsWith("image/")) return <img className="attachment-image" src={url} alt={attachment.name} />;
  if (attachment.mime.startsWith("audio/")) return <audio className="attachment-media" controls src={url} />;
  if (attachment.mime.startsWith("video/")) return <video className="attachment-video" controls src={url} />;
  return <a className="attachment-download" href={url} download={attachment.name}><FileText size={16} />{downloadLabel}</a>;
}

function AttachmentPreview({ attachment, downloadLabel, onRemove }: { attachment: AttachmentRecord; downloadLabel: string; onRemove: () => void | Promise<void> }) {
  if (attachment.mime === "application/pdf") return <Suspense fallback={<div className="pdf-document-preview is-loading" aria-label={attachment.name}><span className="pdf-preview-state" /></div>}><PdfAttachmentViewer attachment={attachment} onRemove={onRemove} /></Suspense>;
  return <StandardAttachmentPreview attachment={attachment} downloadLabel={downloadLabel} />;
}

export function CardEditorPanel() {
  const cardId = useAppStore((state) => state.selectedCardId);
  const view = useAppStore((state) => state.view);
  const close = useAppStore((state) => state.closeCard);
  const openAI = useAppStore((state) => state.openAI);
  const openAIWithAction = useAppStore((state) => state.openAIWithAction);
  const { intlLocale, language, t } = useI18n();
  const card = useLiveQuery(() => cardId ? db.cards.get(cardId) : undefined, [cardId]);
  const attachments = useLiveQuery(async () => card ? (await Promise.all(card.attachmentIds.map((id) => db.attachments.get(id)))).filter(Boolean) as AttachmentRecord[] : [], [card?.attachmentIds.join("|")], []);
  const locations = useLiveQuery(async () => {
    if (!cardId) return [];
    const nodes = await db.boardNodes.where("cardId").equals(cardId).toArray();
    return (await Promise.all(nodes.map(async (node) => ({ node, board: await db.boards.get(node.boardId) })))).filter((item) => item.board);
  }, [cardId], []);
  const backlinks = useLiveQuery(async () => {
    if (!card?.title) return [];
    const terms = searchQueryTerms(card.title, language);
    const cards = terms.length ? await db.cards.where("searchTerms").anyOf(terms).distinct().limit(500).toArray() : [];
    return cards.filter((item) => item.state !== "trash" && isMaterializedCard(item) && item.id !== card.id && (item.plainText.includes(card.title) || item.contentHtml.includes(`data-card-id=\"${card.id}\"`)));
  }, [card?.id, card?.title, language], []);
  const highlights = useLiveQuery(() => cardId ? db.highlights.where("cardId").equals(cardId).toArray() : [], [cardId], []);
  const versions = useLiveQuery(() => cardId ? db.cardVersions.where("cardId").equals(cardId).reverse().sortBy("createdAt") : [], [cardId], []);
  const [tab, setTab] = useState<"content" | "info">("content");
  const [highlightNotice, setHighlightNotice] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [addingProperty, setAddingProperty] = useState(false);
  const [propertyName, setPropertyName] = useState("");
  const [propertyValue, setPropertyValue] = useState("");
  const selectedTextRef = useRef("");
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleComposing = useRef(false);
  const propertyCopy = getCardPropertyCopy(language);

  useEffect(() => {
    if (!titleComposing.current) setTitleDraft(card?.title || "");
  }, [card?.id, card?.title]);

  useEffect(() => {
    const rememberSelection = () => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() || "";
      const anchor = selection?.anchorNode;
      const editorElement = document.querySelector(".card-editor-panel .prose-editor");
      if (!text || !anchor || !editorElement) return;
      const anchorElement = anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor as Element;
      if (anchorElement && editorElement.contains(anchorElement)) selectedTextRef.current = text;
    };
    document.addEventListener("selectionchange", rememberSelection);
    return () => document.removeEventListener("selectionchange", rememberSelection);
  }, [cardId]);

  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    if (titleTimer.current) clearTimeout(titleTimer.current);
  }, []);

  if (!card) return <div className="panel-loading">{t("card.loading")}</div>;
  const activeCard = card;

  async function update(patch: Partial<CardRecord>) {
    await updateCardWithHistory(activeCard.id, patch);
  }

  async function detachAttachment(attachment: AttachmentRecord) {
    await update({ attachmentIds: activeCard.attachmentIds.filter((id) => id !== attachment.id) });
    const usedElsewhere = await db.cards.filter((item) => item.id !== activeCard.id && item.attachmentIds.includes(attachment.id)).count();
    if (!usedElsewhere) await removeStoredAttachment(attachment);
  }

  function saveTitle(value: string, immediate = false) {
    const nextTitle = value || t("common.untitledCard");
    if (titleTimer.current) clearTimeout(titleTimer.current);
    if (immediate) void updateCardWithHistory(activeCard.id, { title: nextTitle });
    else titleTimer.current = setTimeout(() => updateCardWithHistory(activeCard.id, { title: nextTitle }), 280);
  }

  function showHighlightNotice(message: string) {
    setHighlightNotice(message);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightNotice(""), 2400);
  }

  async function createHighlight(text: string) {
    const cleanText = text.trim();
    if (!cleanText) return;
    const existing = await db.highlights.where("cardId").equals(activeCard.id).filter((item) => item.text === cleanText).first();
    if (existing) {
      showHighlightNotice(t("card.highlightExists"));
      return;
    }
    await db.highlights.add({ id: crypto.randomUUID(), cardId: activeCard.id, text: cleanText, note: "", color: "amber", createdAt: Date.now() });
    selectedTextRef.current = "";
    showHighlightNotice(t("card.highlightAdded"));
  }

  async function captureHighlight() {
    const text = window.getSelection()?.toString().trim() || selectedTextRef.current;
    if (!text) {
      window.alert(t("card.selectHighlight"));
      return;
    }
    await createHighlight(text);
  }

  async function addProperty(event: React.FormEvent) {
    event.preventDefault();
    const name = propertyName.trim();
    if (!name) return;
    if (Object.prototype.hasOwnProperty.call(activeCard.properties, name)) { showHighlightNotice(propertyCopy.exists); return; }
    await update({ properties: { ...activeCard.properties, [name]: propertyValue.trim() } });
    setPropertyName(""); setPropertyValue(""); setAddingProperty(false); showHighlightNotice(propertyCopy.added);
  }

  async function removeProperty(name: string) {
    const next = { ...activeCard.properties };
    delete next[name];
    await update({ properties: next });
  }

  return (
    <div className="card-editor-panel">
      <header className="panel-header">
        <div className="card-focus-heading"><button type="button" className="card-back-button" onClick={close}><ArrowLeft size={15} /><span>{view === "kanban" ? t("nav.kanban") : view === "boards" ? t("nav.boards") : t("card.backToLibrary")}</span></button><div className="panel-breadcrumb"><span>{localizedKindLabel(card.kind, language)}</span><i /> <span>{card.state === "inbox" ? t("card.inbox") : card.state === "archived" ? t("card.archive") : card.state === "trash" ? t("card.trash") : t("card.library")}</span></div></div>
        <div>
          <button type="button" className="icon-button" onClick={captureHighlight} aria-label={t("card.captureHighlight")} title={t("card.captureHighlight")}><Highlighter size={16} /></button>
          <button type="button" className={card.favorite ? "icon-button is-active" : "icon-button"} onClick={() => update({ favorite: !card.favorite })} aria-label={card.favorite ? t("card.unpin") : t("card.pin")} title={card.favorite ? t("card.unpin") : t("card.pin")}><Pin size={16} fill={card.favorite ? "currentColor" : "none"} /></button>
          <button type="button" className="icon-button" data-card-menu-trigger aria-label={t("card.more")} title={t("card.more")} onClick={(event) => showContextMenuFromButton(event, { kind: "card", id: card.id })}><MoreHorizontal size={17} /></button>
        </div>
      </header>
      <div className="panel-tabs"><button type="button" className={tab === "content" ? "is-active" : ""} onClick={() => setTab("content")}><FileText size={14} />{t("card.content")}</button><button type="button" className={tab === "info" ? "is-active" : ""} onClick={() => setTab("info")}><Info size={14} />{t("card.info")}</button></div>
      {highlightNotice && <div className="card-highlight-notice" role="status"><Highlighter size={14} /><span>{highlightNotice}</span></div>}

      {tab === "content" ? (
        <div className="card-panel-content">
          <input className="card-title-input" value={titleDraft} onChange={(event) => { const value = event.target.value; setTitleDraft(value); if (!titleComposing.current && !(event.nativeEvent as InputEvent).isComposing) saveTitle(value); }} onCompositionStart={() => { titleComposing.current = true; if (titleTimer.current) clearTimeout(titleTimer.current); }} onCompositionEnd={(event) => { titleComposing.current = false; const value = event.currentTarget.value; setTitleDraft(value); saveTitle(value, true); }} onBlur={() => { if (!titleComposing.current) saveTitle(titleDraft, true); }} onKeyDown={(event) => { if (event.key === "Enter" && !(event.nativeEvent as KeyboardEvent).isComposing) event.currentTarget.blur(); }} placeholder={t("common.untitledCard")} />
          <div className="card-meta-line">
            <TagPicker selectedIds={card.tagIds} onChange={(tagIds) => update({ tagIds })} />
            <span>{relativeTime(card.updatedAt, language)}</span>
          </div>
          {attachments.map((attachment) => <AttachmentPreview key={attachment.id} attachment={attachment} downloadLabel={t("card.download", { name: attachment.name })} onRemove={() => detachAttachment(attachment)} />)}
          {card.sourceUrl && <a className="source-link" href={card.sourceUrl} target="_blank" rel="noreferrer"><ArrowUpRight size={14} /><span>{t("card.source")}</span><code>{new URL(card.sourceUrl).hostname}</code></a>}
          <RichEditor content={card.contentHtml} onChange={(contentHtml, plainText) => update({ contentHtml, plainText })} onHighlight={createHighlight} taskOwnerId={card.id} compact />
        </div>
      ) : (
        <div className="card-info-panel">
          <section className="card-knowledge-section"><header><FolderTree size={15} /><span>{t("library.categories")}</span></header><KnowledgeGroupPicker value={card.collectionId} onChange={(collectionId) => update({ collectionId })} /></section>
          <section><header><MapPin size={15} /><span>{t("card.locations")}</span><b>{locations.length}</b></header>{locations.map(({ board }) => <button type="button" key={board!.id} onClick={() => useAppStore.getState().openBoard(board!.id)}><i /><span>{board!.title}</span><ArrowUpRight size={13} /></button>)}{locations.length === 0 && <p>{t("card.noLocations")}</p>}</section>
          <section><header><Link2 size={15} /><span>{t("card.backlinks")}</span><b>{backlinks.length}</b></header>{backlinks.map((item) => <button type="button" key={item.id} onClick={() => useAppStore.getState().openCard(item.id)}><i /><span>{item.title}</span><ArrowUpRight size={13} /></button>)}{backlinks.length === 0 && <p>{t("card.noBacklinks")}</p>}</section>
          <section><header><Highlighter size={15} /><span>{t("card.sourceHighlights")}</span><b>{highlights.length}</b></header>{highlights.map((item) => <blockquote key={item.id}>{item.text}</blockquote>)}{highlights.length === 0 && <p>{t("card.noHighlights")}</p>}</section>
          <section className="version-section"><header><History size={15} /><span>{t("card.versions")}</span><b>{versions.length}</b></header>{versions.slice(0, 8).map((version) => <button type="button" key={version.id} onClick={() => restoreCardVersion(version.id)}><i /><span>{new Intl.DateTimeFormat(intlLocale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(version.createdAt)}</span><small>{t("card.restore")}</small></button>)}{versions.length === 0 && <p>{t("card.noVersions")}</p>}</section>
          <section className="property-section"><header><Tag size={15} /><span>{t("card.properties")}</span></header>{Object.entries(card.properties).map(([key, value]) => <div className="property-row" key={key}><span>{key}</span><input aria-label={key} value={Array.isArray(value) ? value.join("、") : String(value ?? "")} onChange={(event) => update({ properties: { ...card.properties, [key]: event.target.value } })} /><button type="button" aria-label={`${propertyCopy.remove}：${key}`} title={propertyCopy.remove} onClick={() => void removeProperty(key)}><Trash2 size={13} /></button></div>)}{addingProperty ? <form className="property-add-form" onSubmit={addProperty}><input autoFocus aria-label={propertyCopy.name} value={propertyName} onChange={(event) => setPropertyName(event.target.value)} placeholder={propertyCopy.name} /><input aria-label={propertyCopy.value} value={propertyValue} onChange={(event) => setPropertyValue(event.target.value)} placeholder={propertyCopy.value} /><footer><button type="button" onClick={() => { setAddingProperty(false); setPropertyName(""); setPropertyValue(""); }}>{t("common.cancel")}</button><button type="submit" disabled={!propertyName.trim()}>{t("common.save")}</button></footer></form> : <button type="button" className="text-button" onClick={() => setAddingProperty(true)}><Plus size={13} />{t("card.addProperty")}</button>}</section>
          <section className="danger-zone">
            <button type="button" onClick={() => update({ state: card.state === "archived" ? "active" : "archived" })}><Archive size={15} />{card.state === "archived" ? t("card.moveLibrary") : t("card.moveArchive")}</button>
            <button type="button" className="danger-text" data-card-trash onClick={async () => { await moveCardToTrash(card.id); close(); }}><Trash2 size={15} />{t("card.moveTrash")}</button>
          </section>
        </div>
      )}

      <footer className="card-panel-footer">
        {card.state === "inbox" ? <button type="button" className="secondary-button" onClick={() => update({ state: "active" })}><Check size={15} />{t("card.organized")}</button> : <span>{t("card.savedLocal")}</span>}
        <div className="ai-actions">
          <button type="button" className="secondary-button card-convert-board" onClick={() => openAIWithAction(t("card.convertToBoardPrompt"))}><PanelsTopLeft size={15} />{t("card.convertToBoard")}</button>
          <button type="button" className="ai-button" onClick={openAI}><Sparkles size={15} />{t("card.aiAction")}<ChevronDown size={13} /></button>
        </div>
      </footer>
    </div>
  );
}
