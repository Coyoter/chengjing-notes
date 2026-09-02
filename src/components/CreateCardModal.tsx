import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Feather, FileStack, FileText, Globe2, Image, LayoutDashboard, Link2, LoaderCircle, Music2, Paperclip, Plus, Upload, Video, X } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { createCard, createFragment, db, moveCardToKnowledgeGroup, touchBoard } from "../db";
import { useI18n } from "../hooks/useI18n";
import { importFile, importWebUrl } from "../lib/importers";
import { useAppStore } from "../store";
import { KnowledgeGroupPicker } from "./KnowledgeGroupPicker";
import { dataUrlToBlob } from "../lib/utils";

type CreateMode = "note" | "web" | "file";

export function CreateCardModal() {
  const { t } = useI18n();
  const open = useAppStore((state) => state.createCardOpen);
  const initialCollectionId = useAppStore((state) => state.createCardCollectionId);
  const setOpen = useAppStore((state) => state.setCreateCardOpen);
  const selectedBoardId = useAppStore((state) => state.selectedBoardId);
  const openCard = useAppStore((state) => state.openCard);
  const boards = useLiveQuery(() => db.boards.orderBy("updatedAt").reverse().toArray(), [], []);
  const [mode, setMode] = useState<CreateMode>("note");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [collectionId, setCollectionId] = useState<string | undefined>();
  const [destination, setDestination] = useState<"fragment" | "library" | "board">("fragment");
  const [boardId, setBoardId] = useState(selectedBoardId || "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!open) return;
    setBoardId(selectedBoardId || boards[0]?.id || "");
    setCollectionId(initialCollectionId || undefined);
  }, [boards, initialCollectionId, open, selectedBoardId]);

  async function organizeCard(cardId: string) {
    if (collectionId) await moveCardToKnowledgeGroup(cardId, collectionId);
    await db.cards.update(cardId, { state: "active", updatedAt: Date.now() });
    if (destination === "board" && boardId) {
      const count = await db.boardNodes.where("boardId").equals(boardId).count();
      await db.boardNodes.add({ id: crypto.randomUUID(), boardId, kind: "card", cardId, x: 120 + (count % 3) * 320, y: 120 + Math.floor(count / 3) * 220, width: 265, height: 180 });
      await touchBoard(boardId);
    }
  }

  function resetAndClose(cardId?: string) {
    setTitle(""); setBody(""); setUrl(""); setStatus(""); setBusy(false); setMode("note"); setDestination("fragment"); setOpen(false);
    if (cardId) openCard(cardId);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || mode === "file") return;
    setBusy(true);
    try {
      if (mode === "web") {
        setStatus(t("import.capturing"));
        const card = await importWebUrl(url);
        await organizeCard(card.id);
        resetAndClose(card.id);
        return;
      }
      const cleanBody = body.trim();
      if (destination === "fragment") {
        const text = [title.trim(), cleanBody].filter(Boolean).join("\n\n");
        if (!text) { setBusy(false); return; }
        await createFragment(text);
        resetAndClose();
        return;
      }
      const contentHtml = cleanBody ? `<p>${cleanBody.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char] || char)).replace(/\n/g, "<br>")}</p>` : "<p></p>";
      const card = await createCard({ title: title.trim() || t("common.untitledCard"), kind: "note", state: "active", contentHtml, plainText: cleanBody, collectionId });
      await organizeCard(card.id);
      resetAndClose(card.id);
    } catch (error) { setStatus(error instanceof Error ? error.message : t("import.filesFailed")); setBusy(false); }
  }

  async function chooseFiles() {
    if (!window.chengjing || busy) return;
    setBusy(true); setStatus(t("import.readingFiles"));
    try {
      const result = await window.chengjing.files.open({ title: t("import.dialogTitle"), multiple: true, metadataOnly: true, filters: [{ name: t("import.supported"), extensions: ["pdf", "md", "txt", "html", "docx", "png", "jpg", "jpeg", "webp", "gif", "mp3", "m4a", "wav", "ogg", "flac", "mp4", "mov", "webm", "mkv"] }, { name: t("import.allFiles"), extensions: ["*"] }] });
      if (result.canceled) { setBusy(false); return; }
      const imported = [];
      for (const file of result.files) {
        setStatus(t("import.importingFile", { name: file.name }));
        const source = window.chengjing?.attachments ? new Blob([], { type: "application/octet-stream" }) : dataUrlToBlob(`data:application/octet-stream;base64,${file.data}`);
        const card = await importFile(file.name, source, file.path);
        await organizeCard(card.id);
        imported.push(card);
      }
      if (imported[0]) resetAndClose(imported[0].id); else setBusy(false);
    } catch (error) { setStatus(error instanceof Error ? error.message : t("import.filesFailed")); setBusy(false); }
  }

  return <AnimatePresence>{open && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setOpen(false)}><motion.form className="modal create-card-modal unified-create-modal" initial={{ opacity: 0, y: 12, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.99 }} onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
    <header className="modal-header"><div><span>{t("create.eyebrow")}</span><h2>{t("create.title")}</h2></div><button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label={t("common.close")}><X size={18} /></button></header>
    <div className="create-source-tabs"><button type="button" className={mode === "note" ? "is-active" : ""} onClick={() => { setMode("note"); setDestination("fragment"); }}><FileText size={17} /><span><b>{t("kind.note")}</b><small>{t("create.bodyPlaceholder")}</small></span></button><button type="button" className={mode === "web" ? "is-active" : ""} onClick={() => { setMode("web"); setDestination("library"); }}><Globe2 size={17} /><span><b>{t("kind.web")}</b><small>{t("import.webTitle")}</small></span></button><button type="button" className={mode === "file" ? "is-active" : ""} onClick={() => { setMode("file"); setDestination("library"); }}><Paperclip size={17} /><span><b>{t("import.file")}</b><small>PDF · Word · Markdown · Media</small></span></button></div>
    <div className="create-card-fields">
      {mode === "note" && <><input className="create-card-title" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("create.titlePlaceholder")} /><textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder={t("create.bodyPlaceholder")} /></>}
      {mode === "web" && <div className="create-web-source"><Globe2 size={24} /><h3>{t("import.webTitle")}</h3><p>{t("import.webDescription")}</p><label><Link2 size={16} /><input autoFocus type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" /></label></div>}
      {mode === "file" && <div className="create-file-source"><Upload size={25} /><h3>{t("import.fileTitle")}</h3><p>{t("import.fileDescription")}</p><div><span><FileText size={15} />PDF / DOCX / MD</span><span><Image size={15} />PNG / JPG / WebP</span><span><Music2 size={15} />MP3 / WAV</span><span><Video size={15} />MP4 / MOV</span></div><button type="button" className="primary-button" disabled={busy} onClick={chooseFiles}>{busy ? <LoaderCircle size={16} className="spin" /> : <Upload size={16} />}{t("import.chooseFiles")}</button></div>}
      {destination !== "fragment" && <KnowledgeGroupPicker value={collectionId} onChange={setCollectionId} />}
    </div>
    <div className="destination-choice">{mode === "note" ? <button type="button" className={destination === "fragment" ? "is-active" : ""} onClick={() => setDestination("fragment")}><Feather size={18} /><span><b>{t("create.fragment")}</b><small>{t("create.fragmentHint")}</small></span></button> : <button type="button" className={destination === "library" ? "is-active" : ""} onClick={() => setDestination("library")}><FileStack size={18} /><span><b>{t("create.library")}</b><small>{t("create.libraryHint")}</small></span></button>}<button type="button" className={destination === "board" ? "is-active" : ""} onClick={() => setDestination("board")}><LayoutDashboard size={18} /><span><b>{t("create.board")}</b><small>{t("create.visual")}</small></span></button></div>
    {destination === "board" && <label className="board-destination"><span>{t("create.chooseBoard")}</span><select value={boardId} onChange={(event) => setBoardId(event.target.value)}>{boards.map((board) => <option key={board.id} value={board.id}>{board.title}</option>)}</select></label>}
    {status && <div className="create-card-status" role="status">{busy && <LoaderCircle size={14} className="spin" />}<span>{status}</span></div>}
    <footer className="modal-actions"><span><FileText size={14} />{t("create.local")}</span>{mode !== "file" && <button type="submit" className="primary-button" disabled={busy || (mode === "web" ? !url.trim() : destination === "fragment" ? !title.trim() && !body.trim() : false)}>{busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}{mode === "web" ? t("import.urlSubmit") : destination === "fragment" ? t("fragments.save") : t("create.submit")}</button>}</footer>
  </motion.form></motion.div>}</AnimatePresence>;
}
