import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  addEdge,
  BaseEdge,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  NodeResizer,
  Position,
  ReactFlow,
  ReactFlowProvider,
  reconnectEdge,
  getSmoothStepPath,
  useEdgesState,
  useInternalNode,
  useNodesState,
  useStore,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  AlignHorizontalDistributeCenter,
  ArrowLeftRight,
  BrainCircuit,
  Check,
  ChevronDown,
  CircleDot,
  ClipboardPaste,
  Copy,
  FileText,
  FilePlus2,
  Frame,
  ImagePlus,
  Link2,
  Map as MapIcon,
  Maximize2,
  MousePointer2,
  Music2,
  Paperclip,
  Pencil,
  Plus,
  Rows3,
  Search,
  Sparkles,
  StickyNote,
  TextCursorInput,
  Trash2,
  Unlink,
  Video,
  X,
} from "lucide-react";
import { createCard, db, touchBoard } from "../db";
import { useI18n } from "../hooks/useI18n";
import { TagPicker } from "../components/TagPicker";
import { useAppStore } from "../store";
import type { AttachmentRecord, BoardEdgeRecord, BoardNodeRecord, CardRecord } from "../types";
import { dataUrlToBlob, localizedKindLabel, truncate } from "../lib/utils";
import { boardPreviewBlocks, normalizeBoardPlainText } from "../lib/boardContent";
import { appendBoardSnapshot, boardHistoryTarget, boardSnapshotKey, createBoardSnapshot, type BoardHistoryState } from "../lib/boardHistory";
import { getBoardPolishCopy } from "../lib/boardPolishCopy";
import { importFile } from "../lib/importers";
import { duplicateCardFromId, readAppClipboard, writeAppClipboard } from "../lib/appClipboard";
import { attachmentUrl, shouldRevokeAttachmentUrl } from "../lib/attachments";
import { searchQueryTerms } from "../lib/searchIndex";
import { isMaterializedCard } from "../lib/journalVisibility";
import { getContentEditCopy } from "../lib/contentEditCopy";
import { hasPrimaryModifier, primaryShortcut } from "../lib/platform";

type CardNodeData = { card: CardRecord; pendingConnection: boolean; onTitleChange: (value: string) => void; onResize: (width: number, height: number) => void };
type SectionNodeData = { title: string; onChange: (value: string) => void; onResize: (width: number, height: number) => void };
type TextNodeData = { text: string; pendingConnection: boolean; onChange: (value: string) => void };
type MindmapNodeData = {
  card: CardRecord;
  depth: number;
  childCount: number;
  collapsed: boolean;
  pendingConnection: boolean;
  onTitleChange: (value: string) => void;
  onAddChild: () => void;
  onAddSibling: () => void;
  onToggleCollapse: () => void;
  onResize: (width: number, height: number) => void;
};

type BoardContextMenu =
  | { kind: "pane"; x: number; y: number; flowX: number; flowY: number }
  | { kind: "node"; x: number; y: number; nodeId: string }
  | { kind: "edge"; x: number; y: number; edgeId: string };

type BoardStatus = { tone: "success" | "error" | "info"; message: string };

function ConnectionHandles() {
  const { t } = useI18n();
  return (
    <>
      <Handle id="left" type="source" position={Position.Left} className="easy-handle" aria-label={t("board.handleLeft")} />
      <Handle id="right" type="source" position={Position.Right} className="easy-handle" aria-label={t("board.handleRight")} />
      <Handle id="top" type="source" position={Position.Top} className="easy-handle" aria-label={t("board.handleTop")} />
      <Handle id="bottom" type="source" position={Position.Bottom} className="easy-handle" aria-label={t("board.handleBottom")} />
    </>
  );
}

function BoardAttachmentPreview({ attachmentId }: { attachmentId: string }) {
  const attachment = useLiveQuery<AttachmentRecord | undefined>(() => db.attachments.get(attachmentId), [attachmentId]);
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!attachment) { setUrl(""); return; }
    const next = attachmentUrl(attachment);
    setUrl(next);
    return () => { if (next && shouldRevokeAttachmentUrl(attachment)) URL.revokeObjectURL(next); };
  }, [attachment]);
  if (!attachment) return null;
  if (attachment.mime.startsWith("image/") && url) return <div className="flow-card-media is-image"><img src={url} alt={attachment.name} /></div>;
  if (attachment.mime.startsWith("video/") && url) return <div className="flow-card-media is-video"><video src={url} muted preload="metadata" aria-label={attachment.name} /></div>;
  const Icon = attachment.mime === "application/pdf" ? FileText : attachment.mime.startsWith("audio/") ? Music2 : attachment.mime.startsWith("video/") ? Video : Paperclip;
  return <div className="flow-card-file"><Icon size={18} /><span>{attachment.name}</span><small>{Math.max(1, Math.round(attachment.size / 1024))} KB</small></div>;
}

function CardNode({ data, selected }: NodeProps<Node<CardNodeData>>) {
  const { language, t } = useI18n();
  const card = data.card;
  const preview = boardPreviewBlocks(card.plainText, language);
  return (
    <article className={`flow-card ${card.attachmentIds.length ? "has-attachment" : ""} ${selected ? "is-selected" : ""} ${data.pendingConnection ? "is-connection-source" : ""}`}>
      <NodeResizer isVisible={selected} minWidth={220} minHeight={150} maxWidth={760} maxHeight={720} keepAspectRatio={card.attachmentIds.length > 0} color="var(--accent)" onResizeEnd={(_event, size) => data.onResize(size.width, size.height)} />
      <ConnectionHandles />
      <header><span>{localizedKindLabel(card.kind, language)}</span>{card.favorite && <b>{t("library.pinned")}</b>}</header>
      {card.attachmentIds[0] && <BoardAttachmentPreview attachmentId={card.attachmentIds[0]} />}
      <h3 className="board-card-title nodrag" contentEditable suppressContentEditableWarning onBlur={(event) => data.onTitleChange(event.currentTarget.textContent?.trim() || t("board.newIdea"))}>{card.title}</h3>
      <div className="flow-card-preview">{preview.length ? preview.map((block, index) => block.kind === "bullet" ? <div className="is-bullet" key={`${block.text}-${index}`}><i>•</i><p>{block.text}</p></div> : <p key={`${block.text}-${index}`}>{block.text}</p>) : <p>{t("board.openToEdit")}</p>}</div>
      <footer>{card.tagIds.length ? t("board.tagCount", { count: card.tagIds.length }) : t("board.unclassified")}</footer>
    </article>
  );
}

function SectionNode({ data, selected }: NodeProps<Node<SectionNodeData>>) {
  const { t } = useI18n();
  return <section className={`flow-section ${selected ? "is-selected" : ""}`}><NodeResizer isVisible={selected} minWidth={280} minHeight={180} maxWidth={1800} maxHeight={1400} color="var(--accent)" onResizeEnd={(_event, size) => data.onResize(size.width, size.height)} /><span className="nodrag" contentEditable suppressContentEditableWarning onBlur={(event) => data.onChange(event.currentTarget.textContent?.trim() || t("board.untitledSection"))}>{data.title || t("board.untitledSection")}</span></section>;
}

function TextNode({ data, selected }: NodeProps<Node<TextNodeData>>) {
  const { language, t } = useI18n();
  return <div className={`flow-text ${selected ? "is-selected" : ""} ${data.pendingConnection ? "is-connection-source" : ""}`}><ConnectionHandles /><p className="nodrag" contentEditable suppressContentEditableWarning onBlur={(event) => data.onChange(event.currentTarget.textContent?.trim() || t("board.text"))}>{normalizeBoardPlainText(data.text, language)}</p></div>;
}

function MindmapNode({ id, data, selected }: NodeProps<Node<MindmapNodeData>>) {
  const { t } = useI18n();
  return (
    <article className={`mindmap-node depth-${Math.min(data.depth, 4)} ${selected ? "is-selected" : ""} ${data.pendingConnection ? "is-connection-source" : ""}`} data-node-id={id}>
      <NodeResizer isVisible={selected} minWidth={170} minHeight={66} maxWidth={620} maxHeight={360} color="var(--accent)" onResizeEnd={(_event, size) => data.onResize(size.width, size.height)} />
      <ConnectionHandles />
      <span className="mindmap-level">{data.depth === 0 ? t("board.center") : t("board.level", { count: data.depth })}</span>
      <div className="mindmap-title nodrag" contentEditable suppressContentEditableWarning onBlur={(event) => data.onTitleChange(event.currentTarget.textContent?.trim() || t("board.untitledNode"))} onKeyDown={(event) => { if ((event.nativeEvent as KeyboardEvent).isComposing) return; if (event.key === "Tab") { event.preventDefault(); data.onAddChild(); } else if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); data.onAddSibling(); } else if (event.key === "Escape") event.currentTarget.blur(); }}>{data.card.title}</div>
      <button type="button" className="mindmap-add-child nodrag" onClick={(event) => { event.stopPropagation(); data.onAddChild(); }} aria-label={t("board.addChild")} data-tooltip={t("board.addChildHint")}><Plus size={15} /></button>
      {data.childCount > 0 && <button type="button" className="mindmap-collapse nodrag" onClick={(event) => { event.stopPropagation(); data.onToggleCollapse(); }} aria-label={data.collapsed ? t("board.expandBranch") : t("board.collapseBranch")}>{data.collapsed ? `+${data.childCount}` : <><ChevronDown size={12} />{data.childCount}</>}</button>}
    </article>
  );
}

const nodeTypes = { card: CardNode, section: SectionNode, text: TextNode, mindmap: MindmapNode };
const emptyBoardNodes: BoardNodeRecord[] = [];
const emptyBoardEdges: BoardEdgeRecord[] = [];
const emptyBoardCards: CardRecord[] = [];

function SmartEdge({ source, target, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, markerEnd, style, label, interactionWidth }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const allNodes = useStore((state) => state.nodes);
  const transform = useStore((state) => state.transform);
  const viewportWidth = useStore((state) => state.width);
  const viewportHeight = useStore((state) => state.height);
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 14, offset: 26 });
  const horizontal = Math.abs(targetX - sourceX) >= Math.abs(targetY - sourceY);
  const sourceBox = sourceNode ? { left: sourceNode.internals.positionAbsolute.x, top: sourceNode.internals.positionAbsolute.y, right: sourceNode.internals.positionAbsolute.x + (sourceNode.measured.width || 0), bottom: sourceNode.internals.positionAbsolute.y + (sourceNode.measured.height || 0) } : null;
  const targetBox = targetNode ? { left: targetNode.internals.positionAbsolute.x, top: targetNode.internals.positionAbsolute.y, right: targetNode.internals.positionAbsolute.x + (targetNode.measured.width || 0), bottom: targetNode.internals.positionAbsolute.y + (targetNode.measured.height || 0) } : null;
  const top = Math.min(sourceBox?.top ?? sourceY, targetBox?.top ?? targetY);
  const bottom = Math.max(sourceBox?.bottom ?? sourceY, targetBox?.bottom ?? targetY);
  const left = Math.min(sourceBox?.left ?? sourceX, targetBox?.left ?? targetX);
  const right = Math.max(sourceBox?.right ?? sourceX, targetBox?.right ?? targetX);
  const labelText = String(label || "");
  const estimatedWidth = Math.min(180, Math.max(44, [...labelText].reduce((width, character) => width + (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(character) ? 12.5 : 7.2), 14)));
  const estimatedHeight = 25;
  const candidates = horizontal
    ? [{ x: labelX, y: top - 22 }, { x: labelX, y: bottom + 22 }, { x: labelX, y: labelY - 22 }, { x: labelX, y: labelY + 22 }]
    : [{ x: left - estimatedWidth / 2 - 12, y: labelY }, { x: right + estimatedWidth / 2 + 12, y: labelY }, { x: labelX - estimatedWidth / 2 - 12, y: labelY }, { x: labelX + estimatedWidth / 2 + 12, y: labelY }];
  const nodeBoxes = allNodes.filter((node) => !node.hidden && node.type !== "section").map((node) => ({ left: node.position.x, top: node.position.y, right: node.position.x + (node.measured?.width || node.width || 0), bottom: node.position.y + (node.measured?.height || node.height || 0) }));
  const [translateX, translateY, zoom] = transform;
  const usable = candidates.find((candidate) => {
    const box = { left: candidate.x - estimatedWidth / 2 - 6, right: candidate.x + estimatedWidth / 2 + 6, top: candidate.y - estimatedHeight / 2 - 5, bottom: candidate.y + estimatedHeight / 2 + 5 };
    const collisionFree = nodeBoxes.every((node) => box.right <= node.left || box.left >= node.right || box.bottom <= node.top || box.top >= node.bottom);
    const screenBox = { left: box.left * zoom + translateX, right: box.right * zoom + translateX, top: box.top * zoom + translateY, bottom: box.bottom * zoom + translateY };
    return collisionFree && screenBox.left >= 8 && screenBox.top >= 8 && screenBox.right <= viewportWidth - 8 && screenBox.bottom <= viewportHeight - 8;
  }) || candidates[0];
  const { x, y } = usable;
  return <><BaseEdge path={path} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth} />{label ? <EdgeLabelRenderer><div className="smart-edge-label" style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}>{String(label)}</div></EdgeLabelRenderer> : null}</>;
}

const edgeTypes = { smart: SmartEdge };

function ToolButton({ label, shortcut, active = false, disabled = false, onClick, children }: { label: string; shortcut?: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className={active ? "is-active" : ""} disabled={disabled} onClick={onClick} aria-label={label} data-tooltip={shortcut ? `${label} · ${shortcut}` : label}>{children}</button>;
}

function BoardCanvas({ boardId, focusNodeId, onFocusConsumed }: { boardId: string; focusNodeId: string | null; onFocusConsumed: () => void }) {
  const { language, t } = useI18n();
  const historyCopy = getBoardPolishCopy(language);
  const editCopy = getContentEditCopy(language);
  const boardRecordsQuery = useLiveQuery(() => db.boardNodes.where("boardId").equals(boardId).toArray(), [boardId]);
  const edgeRecordsQuery = useLiveQuery(() => db.boardEdges.where("boardId").equals(boardId).toArray(), [boardId]);
  const boardRecords = boardRecordsQuery || emptyBoardNodes;
  const edgeRecords = edgeRecordsQuery || emptyBoardEdges;
  const boardCardIds = useMemo(() => [...new Set(boardRecords.map((record) => record.cardId).filter(Boolean) as string[])], [boardRecords]);
  const cardsQuery = useLiveQuery(async () => (await db.cards.bulkGet(boardCardIds)).filter((card) => card && card.state !== "trash") as CardRecord[], [boardCardIds.join("|")]);
  const cards = cardsQuery || emptyBoardCards;
  const cardMap = useMemo(() => new globalThis.Map(cards.map((card) => [card.id, card])), [cards]);
  const recordMap = useMemo(() => new globalThis.Map(boardRecords.map((record) => [record.id, record])), [boardRecords]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [flow, setFlow] = useState<ReactFlowInstance | null>(null);
  const [activeTool, setActiveTool] = useState<"select" | "connect">("select");
  const [pendingConnectionNodeId, setPendingConnectionNodeId] = useState<string | null>(null);
  const [selectedMindmapId, setSelectedMindmapId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<BoardContextMenu | null>(null);
  const [edgeLabelDraft, setEdgeLabelDraft] = useState("");
  const [status, setStatus] = useState<BoardStatus | null>(null);
  const [recentEdgeId, setRecentEdgeId] = useState<string | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionCreatedRef = useRef(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<BoardHistoryState>({ entries: [], index: -1 });
  const historyBoardRef = useRef("");
  const historyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoringSnapshotKeyRef = useRef<string | null>(null);
  const latestSnapshotRef = useRef<ReturnType<typeof createBoardSnapshot> | null>(null);
  const [historyMeta, setHistoryMeta] = useState({ index: -1, length: 0 });
  const [historyRestoring, setHistoryRestoring] = useState(false);
  const historyRestoringRef = useRef(false);
  const showMiniMap = useAppStore((state) => state.showMiniMap);
  const setShowMiniMap = useAppStore((state) => state.setShowMiniMap);
  const openCard = useAppStore((state) => state.openCard);
  const openAIWithPrompt = useAppStore((state) => state.openAIWithPrompt);

  const showStatus = useCallback((tone: BoardStatus["tone"], message: string, duration = 2600) => {
    setStatus({ tone, message });
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(null), duration);
  }, []);

  useEffect(() => () => { if (statusTimer.current) clearTimeout(statusTimer.current); }, []);

  useEffect(() => {
    if (boardRecordsQuery === undefined || edgeRecordsQuery === undefined || cardsQuery === undefined) return;
    const boardCardIds = new Set(boardRecords.map((record) => record.cardId).filter(Boolean));
    const snapshot = createBoardSnapshot(boardRecords, edgeRecords, cards.filter((card) => boardCardIds.has(card.id)).map((card) => ({ id: card.id, title: card.title, contentHtml: card.contentHtml, plainText: card.plainText, updatedAt: card.updatedAt })));
    latestSnapshotRef.current = snapshot;
    const key = boardSnapshotKey(snapshot);
    if (historyBoardRef.current !== boardId) {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
      historyBoardRef.current = boardId;
      historyRef.current = { entries: [snapshot], index: 0 };
      restoringSnapshotKeyRef.current = null;
      setHistoryMeta({ index: 0, length: 1 });
      return;
    }
    if (historyRestoringRef.current) {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
      if (restoringSnapshotKeyRef.current === key) restoringSnapshotKeyRef.current = null;
      setHistoryMeta({ index: historyRef.current.index, length: historyRef.current.entries.length });
      return;
    }
    if (restoringSnapshotKeyRef.current === key) {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
      restoringSnapshotKeyRef.current = null;
      setHistoryMeta({ index: historyRef.current.index, length: historyRef.current.entries.length });
      return;
    }
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(() => {
      historyRef.current = appendBoardSnapshot(historyRef.current, snapshot);
      setHistoryMeta({ index: historyRef.current.index, length: historyRef.current.entries.length });
    }, 140);
    return () => { if (historyTimerRef.current) clearTimeout(historyTimerRef.current); };
  }, [boardId, boardRecords, boardRecordsQuery, cards, cardsQuery, edgeRecords, edgeRecordsQuery]);

  async function restoreHistory(direction: "undo" | "redo") {
    if (historyRestoringRef.current) return;
    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = null;
    if (latestSnapshotRef.current) {
      historyRef.current = appendBoardSnapshot(historyRef.current, latestSnapshotRef.current);
      setHistoryMeta({ index: historyRef.current.index, length: historyRef.current.entries.length });
    }
    const target = boardHistoryTarget(historyRef.current, direction);
    if (!target) return;
    historyRestoringRef.current = true;
    setHistoryRestoring(true);
    historyRef.current = { entries: historyRef.current.entries, index: target.index };
    restoringSnapshotKeyRef.current = boardSnapshotKey(target.snapshot);
    setHistoryMeta({ index: target.index, length: historyRef.current.entries.length });
    try {
      await db.transaction("rw", [db.boardNodes, db.boardEdges, db.cards], async () => {
        await db.boardEdges.where("boardId").equals(boardId).delete();
        await db.boardNodes.where("boardId").equals(boardId).delete();
        if (target.snapshot.nodes.length) await db.boardNodes.bulkPut(target.snapshot.nodes);
        if (target.snapshot.edges.length) await db.boardEdges.bulkPut(target.snapshot.edges);
        for (const card of target.snapshot.cards) await db.cards.update(card.id, card);
      });
      await touchBoard(boardId);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      showStatus("info", direction === "undo" ? historyCopy.undoDone : historyCopy.redoDone);
    } finally {
      historyRestoringRef.current = false;
      setHistoryRestoring(false);
    }
  }

  useEffect(() => {
    const fitAfterAI = () => window.setTimeout(() => flow?.fitView({ padding: 0.12, duration: 520 }), 220);
    window.addEventListener("chengjing:board-fit-after-ai", fitAfterAI);
    return () => window.removeEventListener("chengjing:board-fit-after-ai", fitAfterAI);
  }, [flow]);

  useEffect(() => {
    const runHistory = (event: Event) => {
      const direction = (event as CustomEvent<"undo" | "redo">).detail;
      if (direction === "undo" || direction === "redo") void restoreHistory(direction);
    };
    window.addEventListener("chengjing:board-history", runHistory);
    return () => window.removeEventListener("chengjing:board-history", runHistory);
  });

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("chengjing:board-history-state", { detail: { canUndo: !historyRestoring && historyMeta.index > 0, canRedo: !historyRestoring && historyMeta.index >= 0 && historyMeta.index < historyMeta.length - 1, restoring: historyRestoring, index: historyMeta.index, length: historyMeta.length, nodeCounts: historyRef.current.entries.map((entry) => entry.nodes.length) } }));
  }, [historyMeta, historyRestoring]);

  function hasCollapsedAncestor(record: BoardNodeRecord) {
    let parentId = record.parentNodeId;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = recordMap.get(parentId);
      if (!parent) return false;
      if (parent.collapsed) return true;
      parentId = parent.parentNodeId;
    }
    return false;
  }

  useEffect(() => {
    const converted = boardRecords.flatMap((record): Node[] => {
      const hidden = record.kind === "mindmap" && hasCollapsedAncestor(record);
      const pendingConnection = pendingConnectionNodeId === record.id;
      if (record.kind === "card" || record.kind === "mindmap") {
        const card = record.cardId ? cardMap.get(record.cardId) : undefined;
        if (!card) return [];
        if (record.kind === "mindmap") {
          let depth = 0;
          let parentId = record.parentNodeId;
          const visited = new Set<string>();
          while (parentId && !visited.has(parentId)) { visited.add(parentId); depth += 1; parentId = recordMap.get(parentId)?.parentNodeId; }
          const childCount = boardRecords.filter((item) => item.parentNodeId === record.id).length;
          return [{
            id: record.id,
            type: "mindmap",
            position: { x: record.x, y: record.y },
            selected: selectedMindmapId === record.id,
            hidden,
            data: {
              card, depth, childCount, collapsed: Boolean(record.collapsed), pendingConnection,
              onTitleChange: (title: string) => db.cards.update(card.id, { title, updatedAt: Date.now() }),
              onAddChild: () => addMindmapChild(record.id),
              onAddSibling: () => addMindmapSibling(record.id),
              onToggleCollapse: () => toggleMindmapBranch(record.id),
              onResize: (width: number, height: number) => { void db.boardNodes.update(record.id, { width: Math.round(width), height: Math.round(height) }).then(() => touchBoard(boardId)); },
            },
            style: { width: record.width || 210, height: record.height || 90 },
            zIndex: 3,
          }];
        }
        return [{ id: record.id, type: "card", position: { x: record.x, y: record.y }, data: { card, pendingConnection, onTitleChange: (title: string) => db.cards.update(card.id, { title, updatedAt: Date.now() }), onResize: (width: number, height: number) => { void db.boardNodes.update(record.id, { width: Math.round(width), height: Math.round(height) }).then(() => touchBoard(boardId)); } }, style: { width: record.width || 265, height: record.height || 190 }, zIndex: 2 }];
      }
      if (record.kind === "section") {
        return [{ id: record.id, type: "section", position: { x: record.x, y: record.y }, data: { title: record.title || t("board.section"), onChange: (title: string) => db.boardNodes.update(record.id, { title }), onResize: (width: number, height: number) => { void db.boardNodes.update(record.id, { width: Math.round(width), height: Math.round(height) }).then(() => touchBoard(boardId)); } }, style: { width: record.width || 600, height: record.height || 400 }, zIndex: 0 }];
      }
      return [{ id: record.id, type: "text", position: { x: record.x, y: record.y }, data: { text: record.text || t("board.text"), pendingConnection, onChange: (text: string) => db.boardNodes.update(record.id, { text }) }, style: { width: record.width || 300 }, zIndex: 3 }];
    });
    setNodes(converted);
  }, [boardId, boardRecords, cardMap, pendingConnectionNodeId, recordMap, selectedMindmapId, setNodes, t]);

  useEffect(() => {
    setEdges(edgeRecords.filter((edge) => {
      const sourceRecord = recordMap.get(edge.source);
      const targetRecord = recordMap.get(edge.target);
      const sourceVisible = sourceRecord && (!(sourceRecord.kind === "card" || sourceRecord.kind === "mindmap") || Boolean(sourceRecord.cardId && cardMap.has(sourceRecord.cardId)));
      const targetVisible = targetRecord && (!(targetRecord.kind === "card" || targetRecord.kind === "mindmap") || Boolean(targetRecord.cardId && cardMap.has(targetRecord.cardId)));
      return Boolean(sourceVisible && targetVisible);
    }).map((edge) => {
      const source = recordMap.get(edge.source);
      const target = recordMap.get(edge.target);
      const mindmapEdge = source?.kind === "mindmap" && target?.kind === "mindmap";
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle || undefined,
        targetHandle: edge.targetHandle || undefined,
        label: edge.label,
        hidden: Boolean(source && hasCollapsedAncestor(source)) || Boolean(target && hasCollapsedAncestor(target)),
        type: mindmapEdge ? "default" : "smart",
        zIndex: 1,
        animated: recentEdgeId === edge.id,
        interactionWidth: 28,
        markerEnd: mindmapEdge ? undefined : { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "var(--flow-edge)" },
        style: { stroke: edge.color || "var(--flow-edge)", strokeWidth: mindmapEdge ? 2.2 : 2 },
        labelStyle: { fill: "var(--text-2)", fontSize: 12, fontWeight: 600 },
        labelBgStyle: { fill: "var(--surface-1)", fillOpacity: 0.96 },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 5,
      };
    }));
  }, [cardMap, edgeRecords, recentEdgeId, recordMap, setEdges]);

  useEffect(() => {
    const targetNode = nodes.find((node) => node.id === focusNodeId);
    if (!flow || !focusNodeId || !targetNode) return;
    flow.fitView({ nodes: [targetNode], padding: 1.6, minZoom: 0.75, maxZoom: 1.15, duration: 480 });
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === focusNodeId })));
    onFocusConsumed();
  }, [flow, focusNodeId, nodes, onFocusConsumed, setNodes]);

  const findOpenPosition = useCallback((x: number, y: number, width: number, height: number, reserved: Array<{ x: number; y: number; width: number; height: number }> = []) => {
    const occupied = [
      ...(flow?.getNodes().filter((node) => !node.hidden && node.type !== "section").map((node) => ({
        x: node.position.x,
        y: node.position.y,
        width: node.measured?.width || node.width || Number(node.style?.width) || 265,
        height: node.measured?.height || node.height || Number(node.style?.height) || 190,
      })) || []),
      ...reserved,
    ];
    const overlaps = (candidate: { x: number; y: number }) => occupied.some((item) =>
      candidate.x < item.x + item.width + 24
      && candidate.x + width + 24 > item.x
      && candidate.y < item.y + item.height + 24
      && candidate.y + height + 24 > item.y,
    );
    for (let ring = 0; ring <= 5; ring += 1) {
      for (let row = -ring; row <= ring; row += 1) {
        for (let column = -ring; column <= ring; column += 1) {
          if (ring > 0 && Math.abs(row) !== ring && Math.abs(column) !== ring) continue;
          const candidate = { x: x + column * (width + 42), y: y + row * (height + 42) };
          if (!overlaps(candidate)) return candidate;
        }
      }
    }
    return { x: x + occupied.length * 28, y: y + occupied.length * 24 };
  }, [flow]);

  const addCardAt = useCallback(async (x: number, y: number, title?: string) => {
    const position = findOpenPosition(x, y, 265, 190);
    const card = await createCard({ title: title || t("board.newIdea"), state: "active", color: "slate" });
    const record: BoardNodeRecord = { id: crypto.randomUUID(), boardId, kind: "card", cardId: card.id, x: position.x, y: position.y, width: 265, height: 190 };
    await db.boardNodes.add(record);
    await touchBoard(boardId);
    showStatus("success", historyCopy.cardCreated);
    setTimeout(() => {
      flow?.setCenter(record.x + 132.5, record.y + 95, { zoom: Math.min(1.1, Math.max(0.72, flow.getZoom())), duration: 360 });
      (boardRef.current?.querySelector(`.react-flow__node[data-id="${record.id}"] .board-card-title`) as HTMLElement | null)?.focus();
    }, 180);
    return record;
  }, [boardId, findOpenPosition, flow, historyCopy.cardCreated, showStatus, t]);

  const createConnection = useCallback(async (connection: Connection, successMessage?: string) => {
    if (!connection.source || !connection.target || connection.source === connection.target) { showStatus("error", t("board.selfConnection")); return false; }
    const duplicate = edgeRecords.some((edge) => (edge.source === connection.source && edge.target === connection.target) || (edge.source === connection.target && edge.target === connection.source));
    if (duplicate) { showStatus("info", t("board.duplicateConnection")); return false; }
    const id = crypto.randomUUID();
    setEdges((current) => addEdge({ ...connection, id, type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed } }, current));
    await db.boardEdges.add({ id, boardId, source: connection.source, target: connection.target, sourceHandle: connection.sourceHandle, targetHandle: connection.targetHandle });
    await touchBoard(boardId);
    setRecentEdgeId(id);
    setTimeout(() => setRecentEdgeId(null), 900);
    showStatus("success", successMessage || t("board.connectionCreated"));
    return true;
  }, [boardId, edgeRecords, setEdges, showStatus, t]);

  async function addAtPoint(kind: "card" | "section" | "text", x: number, y: number) {
    if (kind === "card") return addCardAt(x, y);
    const record: BoardNodeRecord = kind === "section"
      ? { id: crypto.randomUUID(), boardId, kind, x: x - 80, y: y - 80, width: 580, height: 390, title: t("board.newSection") }
      : { id: crypto.randomUUID(), boardId, kind, x, y, width: 300, height: 60, text: t("board.textPrompt") };
    await db.boardNodes.add(record);
    await touchBoard(boardId);
    showStatus("success", kind === "section" ? t("board.sectionCreated") : t("board.textCreated"));
    return record;
  }

  async function addAtCenter(kind: "card" | "section" | "text") {
    const center = flow?.screenToFlowPosition({ x: window.innerWidth * 0.55, y: window.innerHeight * 0.5 }) || { x: 350, y: 250 };
    return addAtPoint(kind, center.x, center.y);
  }

  async function createMindmapAt(x: number, y: number) {
    const position = findOpenPosition(x, y, 210, 90);
    const card = await createCard({ title: t("board.coreTopic"), state: "active", color: "slate" });
    const nodeId = crypto.randomUUID();
    await db.boardNodes.add({ id: nodeId, boardId, kind: "mindmap", cardId: card.id, x: position.x, y: position.y, width: 210, height: 90, mindmapRootId: nodeId, collapsed: false });
    await touchBoard(boardId);
    setSelectedMindmapId(nodeId);
    showStatus("success", t("board.centerCreated"), 4200);
    setTimeout(() => {
      flow?.setCenter(position.x + 105, position.y + 45, { zoom: Math.min(1.1, Math.max(0.72, flow.getZoom())), duration: 360 });
      (boardRef.current?.querySelector(`[data-node-id="${nodeId}"] .mindmap-title`) as HTMLElement | null)?.focus();
    }, 180);
    return nodeId;
  }

  async function createMindmap() {
    const center = flow?.screenToFlowPosition({ x: window.innerWidth * 0.53, y: window.innerHeight * 0.44 }) || { x: 420, y: 250 };
    return createMindmapAt(center.x, center.y);
  }

  async function layoutMindmap(rootId: string) {
    const records = (await db.boardNodes.where("boardId").equals(boardId).toArray()).filter((record) => record.kind === "mindmap" && (record.mindmapRootId === rootId || record.id === rootId));
    const root = records.find((record) => record.id === rootId);
    if (!root) return;
    const children = new globalThis.Map<string, BoardNodeRecord[]>();
    records.forEach((record) => { if (record.parentNodeId) children.set(record.parentNodeId, [...(children.get(record.parentNodeId) || []), record]); });
    children.forEach((items) => items.sort((a, b) => a.y - b.y));
    const positions = new globalThis.Map<string, { x: number; y: number }>();
    let cursor = 0;
    function place(nodeId: string, depth: number): number {
      const branch = children.get(nodeId) || [];
      if (!branch.length) { const y = cursor * 86; cursor += 1; positions.set(nodeId, { x: root!.x + depth * 255, y }); return y; }
      const childYs = branch.map((child) => place(child.id, depth + 1));
      const y = (childYs[0] + childYs.at(-1)!) / 2;
      positions.set(nodeId, { x: root!.x + depth * 255, y });
      return y;
    }
    place(rootId, 0);
    const offsetY = root.y - positions.get(rootId)!.y;
    await Promise.all([...positions.entries()].map(([id, position]) => db.boardNodes.update(id, { x: position.x, y: position.y + offsetY })));
    await touchBoard(boardId);
  }

  async function addMindmapChild(parentId: string) {
    const parent = await db.boardNodes.get(parentId);
    if (!parent || parent.kind !== "mindmap") return;
    const card = await createCard({ title: t("board.newBranch"), state: "active", color: "slate" });
    const childId = crypto.randomUUID();
    const rootId = parent.mindmapRootId || parent.id;
    const siblingCount = boardRecords.filter((record) => record.parentNodeId === parentId).length;
    await db.transaction("rw", [db.boardNodes, db.boardEdges], async () => {
      await db.boardNodes.add({ id: childId, boardId, kind: "mindmap", cardId: card.id, x: parent.x + 255, y: parent.y + siblingCount * 86, width: 200, height: 80, parentNodeId: parentId, mindmapRootId: rootId, collapsed: false });
      await db.boardEdges.add({ id: crypto.randomUUID(), boardId, source: parentId, target: childId, sourceHandle: "right", targetHandle: "left" });
      if (parent.collapsed) await db.boardNodes.update(parentId, { collapsed: false });
    });
    await layoutMindmap(rootId);
    setSelectedMindmapId(childId);
    showStatus("success", t("board.childCreated"), 3400);
    setTimeout(() => (boardRef.current?.querySelector(`[data-node-id="${childId}"] .mindmap-title`) as HTMLElement | null)?.focus(), 180);
  }

  async function addMindmapSibling(nodeId: string) {
    const node = await db.boardNodes.get(nodeId);
    if (node?.kind === "mindmap") await addMindmapChild(node.parentNodeId || node.id);
  }

  async function toggleMindmapBranch(nodeId: string) {
    const node = await db.boardNodes.get(nodeId);
    if (!node) return;
    await db.boardNodes.update(nodeId, { collapsed: !node.collapsed });
    showStatus("info", node.collapsed ? t("board.branchExpanded") : t("board.branchCollapsed"));
  }

  async function tidyBoard() {
    const roots = boardRecords.filter((record) => record.kind === "mindmap" && !record.parentNodeId);
    for (const root of roots) await layoutMindmap(root.id);
    const movable = boardRecords.filter((record) => record.kind === "card" || record.kind === "text");
    await Promise.all(movable.map((record, index) => db.boardNodes.update(record.id, { x: 100 + (index % 3) * 340, y: 120 + Math.floor(index / 3) * 240 })));
    await touchBoard(boardId);
    setTimeout(() => flow?.fitView({ padding: 0.16, duration: 500 }), 100);
    showStatus("success", t("board.tidied"));
  }

  async function addLinkedCard(sourceId: string) {
    const source = await db.boardNodes.get(sourceId);
    if (!source) return;
    const target = await addCardAt(source.x + 340, source.y, t("board.linkedIdea"));
    await createConnection({ source: sourceId, target: target.id, sourceHandle: "right", targetHandle: "left" }, t("board.linkedCardCreated"));
  }

  async function importFilesToBoard() {
    if (!window.chengjing) { showStatus("error", historyCopy.fileImportFailed); return; }
    try {
      const result = await window.chengjing.files.open({
        title: t("import.dialogTitle"),
        multiple: true,
        metadataOnly: true,
        filters: [
          { name: t("import.supported"), extensions: ["pdf", "md", "txt", "html", "docx", "png", "jpg", "jpeg", "webp", "gif", "mp3", "m4a", "wav", "ogg", "flac", "mp4", "mov", "webm", "mkv"] },
          { name: t("import.allFiles"), extensions: ["*"] },
        ],
      });
      if (result.canceled || !result.files.length) return;
      const center = flow?.screenToFlowPosition({ x: window.innerWidth * 0.55, y: window.innerHeight * 0.48 }) || { x: 360, y: 240 };
      const records: BoardNodeRecord[] = [];
      for (const [index, file] of result.files.entries()) {
        const source = window.chengjing?.attachments ? new Blob([], { type: "application/octet-stream" }) : dataUrlToBlob(`data:application/octet-stream;base64,${file.data}`);
        const card = await importFile(file.name, source, file.path);
        await db.cards.update(card.id, { state: "active", updatedAt: Date.now() });
        const attachment = Boolean(card.attachmentIds.length);
        const width = attachment ? 360 : 285;
        const height = attachment ? 250 : 190;
        const position = findOpenPosition(center.x + (index % 2) * 390, center.y + Math.floor(index / 2) * 290, width, height, records.map((record) => ({ x: record.x, y: record.y, width: record.width || 265, height: record.height || 190 })));
        const record: BoardNodeRecord = {
          id: crypto.randomUUID(), boardId, kind: "card", cardId: card.id,
          x: position.x, y: position.y, width, height,
        };
        records.push(record);
      }
      await db.boardNodes.bulkAdd(records);
      await touchBoard(boardId);
      showStatus("success", historyCopy.filesAdded.replace("{count}", String(records.length)));
      window.setTimeout(() => {
        const left = Math.min(...records.map((record) => record.x));
        const top = Math.min(...records.map((record) => record.y));
        const right = Math.max(...records.map((record) => record.x + (record.width || 265)));
        const bottom = Math.max(...records.map((record) => record.y + (record.height || 190)));
        if (records.length === 1) flow?.setCenter((left + right) / 2, (top + bottom) / 2, { zoom: 1, duration: 480 });
        else flow?.fitBounds({ x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }, { padding: 0.42, duration: 480 });
      }, 220);
    } catch {
      showStatus("error", historyCopy.fileImportFailed, 4200);
    }
  }

  async function removeNodeBranch(nodeId: string) {
    const descendants = new Set<string>([nodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      boardRecords.forEach((record) => { if (record.parentNodeId && descendants.has(record.parentNodeId) && !descendants.has(record.id)) { descendants.add(record.id); changed = true; } });
    }
    const edgeIds = edgeRecords.filter((edge) => descendants.has(edge.source) || descendants.has(edge.target)).map((edge) => edge.id);
    await db.transaction("rw", [db.boardNodes, db.boardEdges], async () => { await db.boardNodes.bulkDelete([...descendants]); if (edgeIds.length) await db.boardEdges.bulkDelete(edgeIds); });
    showStatus("success", descendants.size > 1 ? t("board.branchRemoved", { count: descendants.size }) : t("board.nodeRemoved"));
  }

  async function reverseEdge(edgeId: string) {
    const edge = await db.boardEdges.get(edgeId);
    if (!edge) return;
    await db.boardEdges.update(edgeId, { source: edge.target, target: edge.source, sourceHandle: edge.targetHandle, targetHandle: edge.sourceHandle });
    showStatus("success", t("board.directionReversed"));
  }

  async function saveEdgeLabel(event: React.FormEvent) {
    event.preventDefault();
    if (contextMenu?.kind !== "edge") return;
    await db.boardEdges.update(contextMenu.edgeId, { label: edgeLabelDraft.trim() || undefined });
    setContextMenu(null);
    showStatus("success", edgeLabelDraft.trim() ? t("board.labelUpdated") : t("board.labelRemoved"));
  }

  function menuPosition(event: React.MouseEvent | MouseEvent) {
    const clientX = Number.isFinite(event.clientX) ? event.clientX : window.innerWidth / 2;
    const clientY = Number.isFinite(event.clientY) ? event.clientY : window.innerHeight / 2;
    return { x: Math.max(8, Math.min(clientX, window.innerWidth - 250)), y: Math.max(8, Math.min(clientY, window.innerHeight - 330)) };
  }

  function startPointConnection(nodeId: string) {
    setActiveTool("connect");
    setPendingConnectionNodeId(nodeId);
    showStatus("info", t("board.originSelected"), 5000);
    setContextMenu(null);
  }

  function handleNodeClick(nodeId: string) {
    const record = recordMap.get(nodeId);
    setContextMenu(null);
    setSelectedMindmapId(record?.kind === "mindmap" ? nodeId : null);
    if (activeTool !== "connect") {
      setNodes((current) => current.map((node) => ({ ...node, selected: node.id === nodeId })));
      return;
    }
    if (!pendingConnectionNodeId) { setPendingConnectionNodeId(nodeId); showStatus("info", t("board.startSelected"), 5000); return; }
    if (pendingConnectionNodeId === nodeId) { setPendingConnectionNodeId(null); showStatus("error", t("board.chooseAnotherTarget")); return; }
    createConnection({ source: pendingConnectionNodeId, target: nodeId, sourceHandle: "right", targetHandle: "left" }).then((created) => { if (created) { setPendingConnectionNodeId(null); setActiveTool("select"); } });
  }

  async function copyBoardNodes(nodeIds = nodes.filter((node) => node.selected).map((node) => node.id)) {
    const records = boardRecords.filter((record) => nodeIds.includes(record.id));
    if (!records.length) return false;
    const plain = records.map((record) => {
      if (record.cardId) {
        const card = cardMap.get(record.cardId);
        return card ? `${card.title}${card.plainText ? `\n${card.plainText}` : ""}` : "";
      }
      return record.title || record.text || "";
    }).filter(Boolean).join("\n\n");
    await writeAppClipboard({ kind: "board-nodes", boardId, nodeIds: records.map((record) => record.id) }, plain);
    showStatus("success", historyCopy.copied.replace("{count}", String(records.length)));
    return true;
  }

  async function pasteBoardClipboard(at?: { x: number; y: number }) {
    const clipboard = await readAppClipboard();
    const preferred = at || flow?.screenToFlowPosition({ x: window.innerWidth * 0.55, y: window.innerHeight * 0.5 }) || { x: 360, y: 240 };
    if (clipboard.payload?.kind === "board-nodes") {
      const sources = (await db.boardNodes.bulkGet(clipboard.payload.nodeIds)).filter((record): record is BoardNodeRecord => Boolean(record));
      if (!sources.length) { showStatus("error", historyCopy.clipboardEmpty); return; }
      const nodeIds = new Map(sources.map((record) => [record.id, crypto.randomUUID()]));
      const cardIds = new Map<string, string>();
      for (const source of sources) {
        if (!source.cardId || cardIds.has(source.cardId)) continue;
        const sourceCard = await db.cards.get(source.cardId);
        const duplicate = sourceCard ? await duplicateCardFromId(source.cardId, t("context.copySuffix", { title: sourceCard.title })) : null;
        if (duplicate) cardIds.set(source.cardId, duplicate.id);
      }
      const left = Math.min(...sources.map((record) => record.x));
      const top = Math.min(...sources.map((record) => record.y));
      const nextNodes = sources.map((source): BoardNodeRecord => ({
        ...source,
        id: nodeIds.get(source.id)!,
        boardId,
        cardId: source.cardId ? cardIds.get(source.cardId) : undefined,
        x: preferred.x + source.x - left,
        y: preferred.y + source.y - top,
        parentNodeId: source.parentNodeId ? nodeIds.get(source.parentNodeId) : undefined,
        mindmapRootId: source.mindmapRootId ? nodeIds.get(source.mindmapRootId) : undefined,
      }));
      const sourceIdSet = new Set(sources.map((record) => record.id));
      const sourceEdges = await db.boardEdges.where("boardId").equals(clipboard.payload.boardId).filter((edge) => sourceIdSet.has(edge.source) && sourceIdSet.has(edge.target)).toArray();
      const nextEdges = sourceEdges.map((edge): BoardEdgeRecord => ({ ...edge, id: crypto.randomUUID(), boardId, source: nodeIds.get(edge.source)!, target: nodeIds.get(edge.target)! }));
      await db.transaction("rw", [db.boardNodes, db.boardEdges], async () => {
        await db.boardNodes.bulkAdd(nextNodes);
        if (nextEdges.length) await db.boardEdges.bulkAdd(nextEdges);
      });
      await touchBoard(boardId);
      const pastedIds = new Set(nextNodes.map((record) => record.id));
      window.setTimeout(() => setNodes((current) => current.map((node) => ({ ...node, selected: pastedIds.has(node.id) }))), 180);
      showStatus("success", historyCopy.pasted.replace("{count}", String(nextNodes.length)));
      return;
    }
    let cardId = "";
    if (clipboard.payload?.kind === "card-ref") {
      const source = await db.cards.get(clipboard.payload.cardId);
      const duplicate = source ? await duplicateCardFromId(source.id, t("context.copySuffix", { title: source.title })) : null;
      cardId = duplicate?.id || "";
    } else {
      let text = clipboard.text.trim();
      if (clipboard.payload?.kind === "fragment-ref") text = (await db.fragments.get(clipboard.payload.fragmentId))?.text || text;
      if (text) {
        const escaped = text.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character] || character);
        const card = await createCard({ title: text.split(/\r?\n/)[0].slice(0, 80), plainText: text, contentHtml: `<p>${escaped.replace(/\r?\n/g, "<br>")}</p>`, state: "active", color: "slate" });
        cardId = card.id;
      }
    }
    if (!cardId) { showStatus("error", historyCopy.clipboardEmpty); return; }
    const position = findOpenPosition(preferred.x, preferred.y, 265, 190);
    const record: BoardNodeRecord = { id: crypto.randomUUID(), boardId, kind: "card", cardId, x: position.x, y: position.y, width: 265, height: 190 };
    await db.boardNodes.add(record);
    await touchBoard(boardId);
    window.setTimeout(() => setNodes((current) => current.map((node) => ({ ...node, selected: node.id === record.id }))), 180);
    showStatus("success", historyCopy.pasted.replace("{count}", "1"));
  }

  function handleBoardKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
    const key = event.key.toLowerCase();
    const command = hasPrimaryModifier(event);
    if (command && !event.altKey && key === "c") { event.preventDefault(); void copyBoardNodes(); return; }
    if (command && !event.altKey && key === "v") { event.preventDefault(); void pasteBoardClipboard(); return; }
    if (command && !event.altKey && key === "z") { event.preventDefault(); void restoreHistory(event.shiftKey ? "redo" : "undo"); return; }
    if (command && !event.altKey && key === "x") { event.preventDefault(); void restoreHistory("redo"); return; }
    if (event.key.toLowerCase() === "l") { event.preventDefault(); setActiveTool("connect"); setPendingConnectionNodeId(null); showStatus("info", t("board.connectInstructions"), 5000); }
    if (event.key.toLowerCase() === "v") { event.preventDefault(); setActiveTool("select"); setPendingConnectionNodeId(null); }
    if (selectedMindmapId && event.key === "Tab") { event.preventDefault(); addMindmapChild(selectedMindmapId); }
    if (selectedMindmapId && event.key === "Enter") { event.preventDefault(); addMindmapSibling(selectedMindmapId); }
    if (event.key === "Escape") { setContextMenu(null); setPendingConnectionNodeId(null); setActiveTool("select"); }
  }

  function beginNodeEdit(record: BoardNodeRecord) {
    setContextMenu(null);
    if (record.cardId) {
      openCard(record.cardId);
      return;
    }
    window.requestAnimationFrame(() => {
      const node = [...(boardRef.current?.querySelectorAll<HTMLElement>(".react-flow__node") || [])]
        .find((element) => element.dataset.id === record.id);
      const editable = node?.querySelector<HTMLElement>('[contenteditable="true"]');
      if (!editable) return;
      editable.focus();
      const range = document.createRange();
      range.selectNodeContents(editable);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  }

  const contextRecord = contextMenu?.kind === "node" ? recordMap.get(contextMenu.nodeId) : undefined;
  const contextEdge = contextMenu?.kind === "edge" ? edgeRecords.find((edge) => edge.id === contextMenu.edgeId) : undefined;

  return (
    <div className={`board-canvas is-${activeTool}-tool`} ref={boardRef} tabIndex={0} onKeyDown={handleBoardKeyDown}>
      <div className="board-toolbar" role="toolbar" aria-label={t("board.tools")}>
        <ToolButton label={t("board.selectMove")} shortcut="V" active={activeTool === "select"} onClick={() => { setActiveTool("select"); setPendingConnectionNodeId(null); }}><MousePointer2 size={18} /></ToolButton>
        <ToolButton label={t("board.connect")} shortcut="L" active={activeTool === "connect"} onClick={() => { setActiveTool("connect"); setPendingConnectionNodeId(null); showStatus("info", t("board.connectInstructions"), 5000); }}><Link2 size={18} /></ToolButton>
        <i />
        <ToolButton label={t("board.addCard")} shortcut="N" onClick={() => addAtCenter("card")}><StickyNote size={18} /></ToolButton>
        <ToolButton label={t("board.addText")} shortcut="T" onClick={() => addAtCenter("text")}><TextCursorInput size={18} /></ToolButton>
        <ToolButton label={t("board.addSection")} onClick={() => addAtCenter("section")}><Frame size={18} /></ToolButton>
        <ToolButton label={t("board.addMindmap")} shortcut="M" onClick={createMindmap}><BrainCircuit size={18} /></ToolButton>
        <ToolButton label={t("board.importFile")} onClick={() => void importFilesToBoard()}><ImagePlus size={18} /></ToolButton>
        <i />
        <ToolButton label={t("board.autoArrange")} onClick={tidyBoard}><AlignHorizontalDistributeCenter size={18} /></ToolButton>
        <ToolButton label={t("board.showAll")} onClick={() => flow?.fitView({ padding: 0.14, duration: 450 })}><Maximize2 size={18} /></ToolButton>
        <ToolButton label={showMiniMap ? t("board.hideMinimap") : t("board.showMinimap")} active={showMiniMap} onClick={() => setShowMiniMap(!showMiniMap)}><MapIcon size={18} /></ToolButton>
      </div>
      <div className="board-ai-hint"><button type="button" onClick={() => openAIWithPrompt(t("ai.organizeBoardPrompt"))}><Sparkles size={15} /><span>{t("board.askAI")}</span></button></div>
      {status && <div className={`board-status is-${status.tone}`} role="status">{status.tone === "success" ? <Check size={15} /> : status.tone === "error" ? <X size={15} /> : <CircleDot size={15} />}<span>{status.message}</span></div>}
      {activeTool === "connect" && !status && <div className="board-connect-guide"><Link2 size={14} /><span>{pendingConnectionNodeId ? t("board.chooseTarget") : t("board.connectGuide")}</span></div>}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={(connection) => { connectionCreatedRef.current = true; createConnection(connection); }}
        onConnectStart={() => { connectionCreatedRef.current = false; showStatus("info", t("board.dragToHandle"), 5000); }}
        onConnectEnd={(_event, connectionState) => { if (!connectionCreatedRef.current && !connectionState.isValid) showStatus("error", t("board.connectFailed"), 4800); connectionCreatedRef.current = false; }}
        onReconnect={async (oldEdge, connection) => { setEdges((current) => reconnectEdge(oldEdge, connection, current)); await db.boardEdges.update(oldEdge.id, { source: connection.source, target: connection.target, sourceHandle: connection.sourceHandle, targetHandle: connection.targetHandle }); showStatus("success", t("board.reconnected")); }}
        onInit={setFlow}
        onNodeClick={(_event, node) => handleNodeClick(node.id)}
        onNodeDoubleClick={(_event, node) => { const record = recordMap.get(node.id); if (record?.cardId) openCard(record.cardId); }}
        onNodeContextMenu={(event, node) => { event.preventDefault(); const position = menuPosition(event); setContextMenu({ kind: "node", ...position, nodeId: node.id }); setSelectedMindmapId(recordMap.get(node.id)?.kind === "mindmap" ? node.id : null); }}
        onEdgeContextMenu={(event, edge) => { event.preventDefault(); const position = menuPosition(event); setContextMenu({ kind: "edge", ...position, edgeId: edge.id }); setEdgeLabelDraft(edgeRecords.find((item) => item.id === edge.id)?.label || ""); }}
        onEdgeDoubleClick={(event, edge) => { const position = menuPosition(event); setContextMenu({ kind: "edge", ...position, edgeId: edge.id }); setEdgeLabelDraft(edgeRecords.find((item) => item.id === edge.id)?.label || ""); }}
        onNodeDragStop={async (_event, node) => {
          const record = recordMap.get(node.id);
          if (record?.kind === "mindmap" && !record.parentNodeId) {
            const dx = node.position.x - record.x;
            const dy = node.position.y - record.y;
            const rootId = record.mindmapRootId || record.id;
            const branch = boardRecords.filter((item) => item.kind === "mindmap" && (item.mindmapRootId === rootId || item.id === rootId));
            await Promise.all(branch.map((item) => db.boardNodes.update(item.id, { x: item.x + dx, y: item.y + dy })));
          } else await db.boardNodes.update(node.id, { x: node.position.x, y: node.position.y });
          await touchBoard(boardId);
        }}
        onNodesDelete={async (deleted) => { for (const node of deleted) await removeNodeBranch(node.id); }}
        onEdgesDelete={async (deleted) => db.boardEdges.bulkDelete(deleted.map((edge) => edge.id))}
        onPaneClick={(event) => {
          setContextMenu(null);
          if (activeTool === "connect" && pendingConnectionNodeId) { setPendingConnectionNodeId(null); showStatus("error", t("board.connectCanceled")); return; }
          if (event.detail !== 2) return;
          const position = flow?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) || { x: 300, y: 220 };
          addCardAt(position.x, position.y);
        }}
        onPaneContextMenu={(event) => { event.preventDefault(); const position = flow?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) || { x: 300, y: 220 }; const menu = menuPosition(event); setContextMenu({ kind: "pane", ...menu, flowX: position.x, flowY: position.y }); }}
        isValidConnection={(connection) => Boolean(connection.source && connection.target && connection.source !== connection.target && !edgeRecords.some((edge) => (edge.source === connection.source && edge.target === connection.target) || (edge.source === connection.target && edge.target === connection.source)))}
        connectionMode={ConnectionMode.Loose}
        connectionRadius={44}
        connectionDragThreshold={1}
        connectOnClick
        edgesReconnectable
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: "var(--accent)", strokeWidth: 2.4 }}
        fitView
        fitViewOptions={{ padding: 0.16 }}
        minZoom={0.18}
        maxZoom={2}
        deleteKeyCode={["Backspace", "Delete"]}
        selectionOnDrag
        panOnScroll
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="var(--board-dot)" />
        <Controls showInteractive={false} position="bottom-right" />
        {showMiniMap && <MiniMap position="bottom-right" pannable zoomable nodeStrokeWidth={2} />}
      </ReactFlow>

      {contextMenu && <div className="board-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
        {contextMenu.kind === "pane" && <><header>{t("board.addHere")}</header><button type="button" onClick={() => { addAtPoint("card", contextMenu.flowX, contextMenu.flowY); setContextMenu(null); }}><StickyNote size={16} /><span>{t("board.card")}</span><kbd>{t("board.doubleClick")}</kbd></button><button type="button" onClick={() => { addAtPoint("text", contextMenu.flowX, contextMenu.flowY); setContextMenu(null); }}><TextCursorInput size={16} /><span>{t("board.text")}</span><kbd>T</kbd></button><button type="button" onClick={() => { addAtPoint("section", contextMenu.flowX, contextMenu.flowY); setContextMenu(null); }}><Frame size={16} /><span>{t("board.section")}</span></button><button type="button" onClick={() => { createMindmapAt(contextMenu.flowX, contextMenu.flowY); setContextMenu(null); }}><BrainCircuit size={16} /><span>{t("board.mindmap")}</span><kbd>M</kbd></button><i /><button type="button" onClick={() => { void pasteBoardClipboard({ x: contextMenu.flowX, y: contextMenu.flowY }); setContextMenu(null); }}><ClipboardPaste size={16} /><span>{historyCopy.paste}</span><kbd>{primaryShortcut("V")}</kbd></button><button type="button" onClick={() => { setActiveTool("connect"); setContextMenu(null); showStatus("info", t("board.clickTwoNodes"), 5000); }}><Link2 size={16} /><span>{t("board.enterConnectMode")}</span><kbd>L</kbd></button><button type="button" onClick={() => { tidyBoard(); setContextMenu(null); }}><AlignHorizontalDistributeCenter size={16} /><span>{t("board.autoArrange")}</span></button></>}
        {contextMenu.kind === "node" && contextRecord && <><header>{contextRecord.kind === "mindmap" ? t("board.mindmapNode") : contextRecord.kind === "card" ? t("board.card") : t("board.object")}</header><button type="button" onClick={() => beginNodeEdit(contextRecord)}><Pencil size={16} /><span>{editCopy.edit}</span>{contextRecord.cardId && <kbd>{t("board.doubleClick")}</kbd>}</button><button type="button" onClick={() => { void copyBoardNodes(nodes.some((node) => node.selected) ? nodes.filter((node) => node.selected).map((node) => node.id) : [contextRecord.id]); setContextMenu(null); }}><Copy size={16} /><span>{historyCopy.copy}</span><kbd>{primaryShortcut("C")}</kbd></button><button type="button" onClick={() => { void pasteBoardClipboard({ x: contextRecord.x + 42, y: contextRecord.y + 42 }); setContextMenu(null); }}><ClipboardPaste size={16} /><span>{historyCopy.paste}</span><kbd>{primaryShortcut("V")}</kbd></button><button type="button" onClick={() => startPointConnection(contextRecord.id)}><Link2 size={16} /><span>{t("board.connectFromHere")}</span><kbd>L</kbd></button>{contextRecord.kind === "card" && <button type="button" onClick={() => { addLinkedCard(contextRecord.id); setContextMenu(null); }}><Plus size={16} /><span>{t("board.addLinkedCard")}</span></button>}{contextRecord.kind === "mindmap" && <><button type="button" onClick={() => { addMindmapChild(contextRecord.id); setContextMenu(null); }}><Rows3 size={16} /><span>{t("board.addChild")}</span><kbd>Tab</kbd></button><button type="button" onClick={() => { addMindmapSibling(contextRecord.id); setContextMenu(null); }}><Plus size={16} /><span>{t("board.addSibling")}</span><kbd>Enter</kbd></button><button type="button" onClick={() => { layoutMindmap(contextRecord.mindmapRootId || contextRecord.id); setContextMenu(null); }}><AlignHorizontalDistributeCenter size={16} /><span>{t("board.arrangeBranch")}</span></button>{boardRecords.some((record) => record.parentNodeId === contextRecord.id) && <button type="button" onClick={() => { toggleMindmapBranch(contextRecord.id); setContextMenu(null); }}><ChevronDown size={16} /><span>{contextRecord.collapsed ? t("board.expandBranch") : t("board.collapseBranch")}</span></button>}</>}<i /><button type="button" className="is-danger" onClick={() => { removeNodeBranch(contextRecord.id); setContextMenu(null); }}><Trash2 size={16} /><span>{t("board.removeFromBoard")}</span></button></>}
        {contextMenu.kind === "edge" && contextEdge && <><header>{t("board.edge")}</header><form className="edge-label-form" onSubmit={saveEdgeLabel}><input autoFocus value={edgeLabelDraft} onChange={(event) => setEdgeLabelDraft(event.target.value)} placeholder={t("board.edgePlaceholder")} /><button type="submit">{t("common.save")}</button></form><button type="button" onClick={() => { reverseEdge(contextEdge.id); setContextMenu(null); }}><ArrowLeftRight size={16} /><span>{t("board.reverseDirection")}</span></button><button type="button" className="is-danger" onClick={() => { db.boardEdges.delete(contextEdge.id); setContextMenu(null); showStatus("success", t("board.edgeDeleted")); }}><Unlink size={16} /><span>{t("board.deleteEdge")}</span></button></>}
      </div>}
    </div>
  );
}

export function BoardView() {
  const { language, t } = useI18n();
  const selectedBoardId = useAppStore((state) => state.selectedBoardId);
  const openBoard = useAppStore((state) => state.openBoard);
  const boards = useLiveQuery(() => db.boards.orderBy("updatedAt").reverse().toArray(), [], []);
  const existingNodes = useLiveQuery(() => selectedBoardId ? db.boardNodes.where("boardId").equals(selectedBoardId).toArray() : [], [selectedBoardId], []);
  const board = useLiveQuery(() => selectedBoardId ? db.boards.get(selectedBoardId) : undefined, [selectedBoardId]);
  const [cardPickerOpen, setCardPickerOpen] = useState(false);
  const [cardQuery, setCardQuery] = useState("");
  const [boardMenuOpen, setBoardMenuOpen] = useState(false);
  const [boardSearchOpen, setBoardSearchOpen] = useState(false);
  const [boardSearchQuery, setBoardSearchQuery] = useState("");
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [renamingBoard, setRenamingBoard] = useState(false);
  const [boardTitleDraft, setBoardTitleDraft] = useState("");
  const boardTitleComposing = useRef(false);
  const existingCardIds = useMemo(() => [...new Set(existingNodes.map((node) => node.cardId).filter(Boolean) as string[])], [existingNodes]);
  const allCards = useLiveQuery(async () => {
    const current = (await db.cards.bulkGet(existingCardIds)).filter((card) => card && card.state !== "trash") as CardRecord[];
    if (!cardPickerOpen) return current;
    const terms = searchQueryTerms(cardQuery, language);
    const candidates = terms.length
      ? await db.cards.where("searchTerms").anyOf(terms).distinct().limit(120).toArray()
      : await db.cards.orderBy("updatedAt").reverse().filter((card) => card.state !== "trash" && isMaterializedCard(card)).limit(120).toArray();
    return [...new Map([...current, ...candidates.filter((card) => card.state !== "trash" && isMaterializedCard(card))].map((card) => [card.id, card])).values()];
  }, [cardPickerOpen, cardQuery, existingCardIds.join("|"), language], []);
  const cardMap = useMemo(() => new globalThis.Map(allCards.map((card) => [card.id, card])), [allCards]);

  useEffect(() => { if (!selectedBoardId && boards[0]) openBoard(boards[0].id); }, [boards, openBoard, selectedBoardId]);
  useEffect(() => {
    if (!renamingBoard) setBoardTitleDraft(board?.title || "");
  }, [board?.id, board?.title, renamingBoard]);

  async function createBoard() {
    const timestamp = Date.now();
    const id = crypto.randomUUID();
    const title = t("common.untitledBoard");
    await db.boards.add({ id, title, description: "", favorite: false, tagIds: [], createdAt: timestamp, updatedAt: timestamp });
    setBoardMenuOpen(false);
    setBoardTitleDraft(title);
    setRenamingBoard(true);
    openBoard(id);
  }

  function beginBoardRename() {
    if (!board) return;
    setBoardTitleDraft(board.title);
    setRenamingBoard(true);
    setBoardMenuOpen(false);
    setBoardSearchOpen(false);
    setCardPickerOpen(false);
  }

  async function saveBoardTitle() {
    if (!board) return;
    const title = boardTitleDraft.trim() || t("common.untitledBoard");
    await db.boards.update(board.id, { title, updatedAt: Date.now() });
    setBoardTitleDraft(title);
    setRenamingBoard(false);
  }

  async function addExistingCard(cardId: string) {
    if (!board || existingNodes.some((node) => node.cardId === cardId)) { setCardPickerOpen(false); return; }
    const index = existingNodes.filter((node) => node.kind === "card").length;
    await db.boardNodes.add({ id: crypto.randomUUID(), boardId: board.id, kind: "card", cardId, x: 120 + (index % 3) * 320, y: 120 + Math.floor(index / 3) * 220, width: 265, height: 180 });
    await touchBoard(board.id);
    setCardPickerOpen(false);
    setCardQuery("");
  }

  const boardSearchResults = useMemo(() => {
    const query = boardSearchQuery.trim().toLocaleLowerCase(language);
    return existingNodes.map((node) => {
      const card = node.cardId ? cardMap.get(node.cardId) : undefined;
      const title = card?.title || node.title || node.text || (node.kind === "section" ? t("board.untitledSection") : t("board.object"));
      const detail = card ? truncate(card.plainText, 70) : node.kind === "section" ? t("board.section") : node.kind === "text" ? t("board.text") : t("board.mindmapNode");
      return { node, card, title, detail };
    }).filter((item) => !query || `${item.title} ${item.detail}`.toLocaleLowerCase(language).includes(query)).slice(0, 12);
  }, [boardSearchQuery, cardMap, existingNodes, language, t]);

  if (!board) return <div className="empty-state board-empty"><MapIcon size={32} /><h3>{t("board.firstTitle")}</h3><p>{t("board.firstDescription")}</p><button type="button" className="primary-button" onClick={createBoard}><Plus size={16} />{t("board.newBoard")}</button></div>;

  return <div className="board-view">
    <div className="board-meta-bar">
      <div className="board-switcher">
        {renamingBoard ? <form className="board-title-form" onSubmit={(event) => { event.preventDefault(); saveBoardTitle(); }}><input autoFocus value={boardTitleDraft} onChange={(event) => setBoardTitleDraft(event.target.value)} onCompositionStart={() => { boardTitleComposing.current = true; }} onCompositionEnd={(event) => { boardTitleComposing.current = false; setBoardTitleDraft(event.currentTarget.value); }} onBlur={() => { if (!boardTitleComposing.current) saveBoardTitle(); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setBoardTitleDraft(board.title); setRenamingBoard(false); } }} aria-label={t("board.boardName")} /></form> : <button type="button" className="board-switcher-trigger" onClick={() => { setBoardMenuOpen(!boardMenuOpen); setBoardSearchOpen(false); setCardPickerOpen(false); }} onDoubleClick={beginBoardRename} aria-expanded={boardMenuOpen}><span>{board.title}</span><b>{boards.length}</b><ChevronDown size={14} /></button>}
        {!renamingBoard && <button type="button" className="board-rename-button" onClick={beginBoardRename} aria-label={t("board.rename")} title={t("board.rename")}><Pencil size={14} /></button>}
        {boardMenuOpen && <div className="board-switcher-menu">{boards.map((item) => <button type="button" key={item.id} className={item.id === board.id ? "is-active" : ""} onClick={() => { openBoard(item.id); setBoardMenuOpen(false); }}>{item.title}</button>)}<i /><button type="button" onClick={beginBoardRename}><Pencil size={14} />{t("board.renameCurrent")}</button><button type="button" onClick={createBoard}><Plus size={14} />{t("board.newBoard")}</button></div>}
      </div>
      <TagPicker className="board-tags" maxVisible={2} selectedIds={board.tagIds} onChange={(tagIds) => db.boards.update(board.id, { tagIds, updatedAt: Date.now() })} />
      <span>{board.description || t("board.description")}</span>
      <div className="board-meta-actions">
        <button type="button" className={boardSearchOpen ? "bare-button is-active" : "bare-button"} aria-label={t("board.searchCurrent")} onClick={() => { setBoardSearchOpen(!boardSearchOpen); setCardPickerOpen(false); setBoardMenuOpen(false); }}><Search size={16} /></button>
        <button type="button" className={cardPickerOpen ? "bare-button is-active" : "bare-button"} aria-label={t("board.addExisting")} onClick={() => { setCardPickerOpen(!cardPickerOpen); setBoardSearchOpen(false); setBoardMenuOpen(false); }}><FilePlus2 size={16} /></button>
        <button type="button" className="bare-button" aria-label={t("board.copyLink")} onClick={async () => navigator.clipboard.writeText(`chengjing://board/${board.id}`)}><Link2 size={16} /></button>
        {boardSearchOpen && <div className="board-search-panel"><label><Search size={15} /><input autoFocus value={boardSearchQuery} onChange={(event) => setBoardSearchQuery(event.target.value)} placeholder={t("board.searchPlaceholder")} /><button type="button" onClick={() => { setBoardSearchOpen(false); setBoardSearchQuery(""); }} aria-label={t("board.closeSearch")}><X size={14} /></button></label><div>{boardSearchResults.map((item) => <button type="button" key={item.node.id} onClick={() => { setFocusNodeId(item.node.id); setBoardSearchOpen(false); setBoardSearchQuery(""); }}><span><b>{item.title}</b><small>{item.detail || localizedKindLabel(item.card?.kind || "note", language)}</small></span><Maximize2 size={14} /></button>)}{boardSearchResults.length === 0 && <p>{t("board.noResults")}</p>}</div></div>}
        {cardPickerOpen && <div className="board-card-picker"><label><Search size={14} /><input autoFocus value={cardQuery} onChange={(event) => setCardQuery(event.target.value)} placeholder={t("board.searchCards")} /></label><div>{allCards.filter((card) => !cardQuery.trim() || `${card.title} ${card.plainText}`.toLocaleLowerCase(language).includes(cardQuery.trim().toLocaleLowerCase(language))).slice(0, 8).map((card) => <button type="button" key={card.id} onClick={() => addExistingCard(card.id)} disabled={existingNodes.some((node) => node.cardId === card.id)}><span>{card.title}</span><small>{existingNodes.some((node) => node.cardId === card.id) ? t("board.alreadyAdded") : localizedKindLabel(card.kind, language)}</small></button>)}</div></div>}
      </div>
    </div>
    <ReactFlowProvider><BoardCanvas boardId={board.id} focusNodeId={focusNodeId} onFocusConsumed={() => setFocusNodeId(null)} /></ReactFlowProvider>
  </div>;
}
