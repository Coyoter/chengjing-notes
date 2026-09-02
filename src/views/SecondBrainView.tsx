import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import dayjs from "dayjs";
import {
  BrainCircuit,
  ExternalLink,
  Link2,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Minus,
  MousePointer2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Tags,
  Trash2,
  Unlink,
  Waves,
  X,
} from "lucide-react";
import { createCard, db, deleteBoardPermanently, deleteCardPermanently, deleteFragmentPermanently } from "../db";
import { useI18n } from "../hooks/useI18n";
import { useAppStore } from "../store";
import type { BrainEdgeRecord, BrainShareRecord } from "../types";
import { BRAIN_CONNECTION_RESPONSE_FORMAT, LOCAL_BRAIN_SEMANTIC_LIMITS, PRIVATE_BRAIN_VIEWPORT_LIMIT, brainTemporalDistanceDays, buildBrainGraph, buildBrainSemanticContext, parseAIConnections, selectBrainViewportNodes, splitBrainKey, type BrainEdgeView, type BrainNodeView } from "../lib/brain";
import { runAI } from "../lib/ai";
import { showContextMenu } from "../lib/contextMenu";
import { getBrainSemanticCopy } from "../lib/brainSemanticCopy";
import { renderSafeMarkdown } from "../lib/safeMarkdown";
import { getTaskIntegrationCopy } from "../lib/taskIntegrationCopy";
import { segmentReflection } from "../lib/reflection";
import {
  CommunityApiError,
  COMMUNITY_OPEN_NEURON_KEY,
  communityApi,
  getCommunityDiscoveryEnabled,
  getCommunityIdentity,
  saveCommunityIdentity,
  setCommunityDiscoveryEnabled,
  type CommunityIdentity,
  type SharedIntention,
  type SharedNeuronDetail,
  type SharedNeuronSummary,
} from "../lib/community";
import { getSharedBrainCopy } from "../lib/sharedBrainCopy";
import { onlyOwnedNodesForAI, selectDiscoveryBatch, sharedNeuronSceneNodes, type SharedNeuronSceneNode } from "../lib/sharedBrain";
import { CommunityIdentityDialog } from "../components/CommunityIdentityDialog";
import { CommunityModerationDialog, CommunityReportDialog, DeleteSharedNeuronDialog, ShareNeuronDialog, SharedNeuronInspector } from "../components/SharedBrainPanels";
import { getWishAdminSession } from "../lib/wishPool";
import { IdentitySeal } from "../components/IdentitySeal";

const NODE_COLORS = {
  card: "#8fa69b",
  board: "#a89d84",
  fragment: "#b58f78",
  task: "#82939a",
};

function CameraControls({ onViewportFocus, focusRequest }: { onViewportFocus: (focus: [number, number, number]) => void; focusRequest: { key: string; position: [number, number, number] } | null }) {
  const controls = useRef<any>(null);
  const pressed = useRef(new Set<string>());
  const lastReportAt = useRef(0);
  const lastFocus = useRef(new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0));
  const focusDestination = useRef<THREE.Vector3 | null>(null);
  const { camera } = useThree();

  useEffect(() => {
    focusDestination.current = focusRequest ? new THREE.Vector3(...focusRequest.position) : null;
  }, [focusRequest?.key]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      if (["w", "a", "s", "d"].includes(key)) {
        event.preventDefault();
        pressed.current.add(key);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => pressed.current.delete(event.key.toLowerCase());
    const onBlur = () => pressed.current.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useFrame((state, delta) => {
    if (!controls.current) return;
    if (pressed.current.size) {
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward).normalize();
      const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
      const movement = new THREE.Vector3();
      if (pressed.current.has("w")) movement.add(forward);
      if (pressed.current.has("s")) movement.sub(forward);
      if (pressed.current.has("d")) movement.add(right);
      if (pressed.current.has("a")) movement.sub(right);
      if (movement.lengthSq()) {
        movement.normalize().multiplyScalar(Math.min(delta, 0.04) * 8.5);
        camera.position.add(movement);
        controls.current.target.add(movement);
      }
    }
    if (focusDestination.current) {
      const target = controls.current.target as THREE.Vector3;
      const before = target.clone();
      const factor = 1 - Math.exp(-Math.min(delta, 0.05) * 8);
      target.lerp(focusDestination.current, factor);
      camera.position.add(target.clone().sub(before));
      if (target.distanceToSquared(focusDestination.current) < 0.0025) {
        target.copy(focusDestination.current);
        focusDestination.current = null;
      }
    }
    if (state.clock.elapsedTime - lastReportAt.current < 0.16) return;
    lastReportAt.current = state.clock.elapsedTime;
    const target = controls.current.target as THREE.Vector3;
    if (target.distanceToSquared(lastFocus.current) < 0.12) return;
    lastFocus.current.copy(target);
    onViewportFocus([target.x, target.y, target.z]);
  });

  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} minDistance={3.5} maxDistance={58} rotateSpeed={0.55} panSpeed={0.65} zoomSpeed={0.72} />;
}

function BrainNeuron({
  node,
  selected,
  linking,
  shared,
  densityScale,
  dense,
  showAllLabels,
  onSelect,
  onOpen,
  onContext,
}: {
  node: BrainNodeView;
  selected: boolean;
  linking: boolean;
  shared: boolean;
  densityScale: number;
  dense: boolean;
  showAllLabels: boolean;
  onSelect: (node: BrainNodeView) => void;
  onOpen: (node: BrainNodeView) => void;
  onContext: (event: ThreeEvent<MouseEvent>, node: BrainNodeView) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const mesh = useRef<THREE.Mesh>(null);
  const dendrites = useMemo(() => {
    const seed = [...node.key].reduce((total, character) => total + character.charCodeAt(0), 0);
    return Array.from({ length: Math.min(6, 3 + Math.floor(node.weight)) }, (_, index) => {
      const theta = ((seed % 31) / 31 + index * 0.618) * Math.PI * 2;
      const phi = 0.55 + (((seed + index * 17) % 53) / 53) * (Math.PI - 1.1);
      const direction = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      const start = direction.clone().multiplyScalar(node.radius * 0.78);
      const end = direction.clone().multiplyScalar(node.radius * (1.45 + (index % 3) * 0.22));
      return { start: start.toArray() as [number, number, number], end: end.toArray() as [number, number, number] };
    });
  }, [node.key, node.radius, node.weight]);
  useFrame((state) => {
    if (!mesh.current) return;
    const pulse = selected || linking ? 1 + Math.sin(state.clock.elapsedTime * 2.4) * 0.045 : 1;
    mesh.current.scale.setScalar(pulse);
  });
  const color = selected || linking ? "#a8c0af" : NODE_COLORS[node.type];
  return (
    <group position={node.position} scale={densityScale}>
      {shared && <>
        <mesh scale={1.22}>
          <sphereGeometry args={[node.radius, 28, 20]} />
          <meshBasicMaterial color="#63b69d" transparent opacity={selected || hovered ? 0.16 : 0.09} depthWrite={false} side={THREE.BackSide} />
        </mesh>
        <mesh rotation={[Math.PI / 2.7, 0.25, 0]}>
          <torusGeometry args={[node.radius * 1.36, Math.max(0.012, node.radius * 0.024), 8, 54]} />
          <meshBasicMaterial color="#76b7a3" transparent opacity={selected || hovered ? 0.62 : 0.34} depthWrite={false} />
        </mesh>
      </>}
      {dendrites.map((dendrite, index) => <group key={index}>
        <Line points={[dendrite.start, dendrite.end]} color={color} lineWidth={0.45} transparent opacity={selected || hovered ? 0.58 : 0.26} />
        <mesh position={dendrite.end}>
          <sphereGeometry args={[Math.max(0.035, node.radius * 0.075), 10, 8]} />
          <meshStandardMaterial color={color} roughness={0.9} transparent opacity={selected || hovered ? 0.9 : 0.58} />
        </mesh>
      </group>)}
      <mesh
        ref={mesh}
        onClick={(event) => { event.stopPropagation(); onSelect(node); }}
        onDoubleClick={(event) => { event.stopPropagation(); onOpen(node); }}
        onContextMenu={(event) => onContext(event, node)}
        onPointerOver={(event) => { event.stopPropagation(); setHovered(true); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { setHovered(false); document.body.style.cursor = "default"; }}
      >
        <sphereGeometry args={[node.radius, 28, 20]} />
        <meshStandardMaterial color={color} roughness={0.82} metalness={0.04} emissive={selected || linking ? "#263b32" : "#111713"} emissiveIntensity={selected || linking ? 0.32 : 0.08} />
      </mesh>
      {(showAllLabels || hovered || selected || linking || (!dense && node.weight >= 1.9)) && (
        <Html center distanceFactor={12} position={[0, node.radius + 0.42, 0]} zIndexRange={[8, 1]} className="brain-node-label-wrap" pointerEvents="none">
          <span className={`brain-node-label type-${node.type} ${shared ? "is-own-shared" : ""}`}>{node.title}</span>
        </Html>
      )}
    </group>
  );
}

function SharedRemoteNeuron({ node, selected, showAllLabels, onSelect }: { node: SharedNeuronSceneNode; selected: boolean; showAllLabels: boolean; onSelect: (node: SharedNeuronSceneNode) => void }) {
  const [hovered, setHovered] = useState(false);
  const group = useRef<THREE.Group>(null);
  const seed = useMemo(() => [...node.id].reduce((total, character) => total + character.charCodeAt(0), 0), [node.id]);
  useFrame((state, delta) => {
    if (!group.current) return;
    group.current.rotation.y += delta * (selected ? 0.16 : 0.07);
    const pulse = 1 + Math.sin(state.clock.elapsedTime * 1.25 + seed) * (selected ? 0.045 : 0.018);
    group.current.scale.setScalar(pulse);
  });
  return <group ref={group} position={node.position}>
    <mesh scale={1.42}>
      <sphereGeometry args={[node.radius, 24, 18]} />
      <meshBasicMaterial color={node.seal} transparent opacity={selected || hovered ? 0.16 : 0.085} depthWrite={false} side={THREE.BackSide} />
    </mesh>
    {[0, 1, 2].map((index) => <mesh key={index} rotation={[0.35 + index * 0.8, (seed % 17) * 0.06 + index * 0.75, index * 0.42]}>
      <torusGeometry args={[node.radius * (1.07 + index * 0.08), Math.max(0.01, node.radius * 0.018), 7, 44]} />
      <meshBasicMaterial color={node.seal} transparent opacity={selected || hovered ? 0.62 - index * 0.09 : 0.33 - index * 0.055} depthWrite={false} />
    </mesh>)}
    <mesh
      onClick={(event) => { event.stopPropagation(); onSelect(node); }}
      onDoubleClick={(event) => { event.stopPropagation(); onSelect(node); }}
      onPointerOver={(event) => { event.stopPropagation(); setHovered(true); document.body.style.cursor = "pointer"; }}
      onPointerOut={() => { setHovered(false); document.body.style.cursor = "default"; }}
    >
      <sphereGeometry args={[node.radius, 30, 22]} />
      <meshStandardMaterial color="#7e8278" roughness={0.95} metalness={0.03} emissive={node.seal} emissiveIntensity={selected ? 0.34 : 0.13} />
    </mesh>
    {(showAllLabels || hovered || selected) && <Html center distanceFactor={15} position={[0, node.radius + 0.48, 0]} zIndexRange={[8, 1]} className="brain-node-label-wrap" pointerEvents="none"><span className="brain-node-label is-remote-shared"><IdentitySeal color={node.seal} pattern={node.authorPattern} size="tiny" />{node.title}<small>{node.authorName}</small></span></Html>}
  </group>;
}

function BrainEdgeLine({ edge, nodes, onContext }: { edge: BrainEdgeView; nodes: Map<string, BrainNodeView>; onContext: (event: ThreeEvent<MouseEvent>, edge: BrainEdgeView) => void }) {
  const source = nodes.get(edge.source);
  const target = nodes.get(edge.target);
  if (!source || !target) return null;
  const color = edge.origin === "manual" ? "#9fb3a5" : edge.origin === "ai" ? "#9b927c" : "#5e6962";
  const handleContext = (event: ThreeEvent<MouseEvent>) => onContext(event, edge);
  return <>
    {edge.persisted && <Line
      points={[source.position, target.position]}
      color={color}
      lineWidth={10}
      transparent
      opacity={0.001}
      depthWrite={false}
      onContextMenu={handleContext}
    />}
    <Line
      points={[source.position, target.position]}
      color={color}
      lineWidth={edge.origin === "structure" ? 0.65 : 1.45}
      transparent
      opacity={edge.origin === "structure" ? 0.2 : 0.58}
      dashed={edge.origin === "ai"}
      dashSize={0.18}
      gapSize={0.12}
      onContextMenu={handleContext}
    />
  </>;
}

function BrainScene({
  nodes,
  edges,
  remoteNodes,
  ownSharedKeys,
  selectedKey,
  selectedRemoteId,
  linkSource,
  showAllLabels,
  canvasColor,
  onSelect,
  onOpen,
  onNodeContext,
  onEdgeContext,
  onRemoteSelect,
  onViewportFocus,
  focusRequest,
}: {
  nodes: BrainNodeView[];
  edges: BrainEdgeView[];
  remoteNodes: SharedNeuronSceneNode[];
  ownSharedKeys: Set<string>;
  selectedKey: string | null;
  selectedRemoteId: string | null;
  linkSource: string | null;
  showAllLabels: boolean;
  canvasColor: string;
  onSelect: (node: BrainNodeView) => void;
  onOpen: (node: BrainNodeView) => void;
  onNodeContext: (event: ThreeEvent<MouseEvent>, node: BrainNodeView) => void;
  onEdgeContext: (event: ThreeEvent<MouseEvent>, edge: BrainEdgeView) => void;
  onRemoteSelect: (node: SharedNeuronSceneNode) => void;
  onViewportFocus: (focus: [number, number, number]) => void;
  focusRequest: { key: string; position: [number, number, number] } | null;
}) {
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.key, node])), [nodes]);
  const densityScale = nodes.length > 150 ? 0.72 : nodes.length > 80 ? 0.86 : 1;
  const dense = nodes.length > 80;
  const denseLabelKeys = useMemo(() => new Set([...nodes].sort((left, right) => right.weight - left.weight || right.updatedAt - left.updatedAt).slice(0, 40).map((node) => node.key)), [nodes]);
  return <>
    <color attach="background" args={[canvasColor]} />
    <fog attach="fog" args={[canvasColor, 18, 54]} />
    <ambientLight intensity={1.4} />
    <directionalLight position={[7, 12, 9]} intensity={2.1} color="#eee7d8" />
    <directionalLight position={[-10, -5, -7]} intensity={0.8} color="#71877a" />
    {edges.map((edge) => <BrainEdgeLine key={edge.id} edge={edge} nodes={nodeMap} onContext={onEdgeContext} />)}
    {nodes.map((node) => <BrainNeuron key={node.key} node={node} selected={selectedKey === node.key} linking={linkSource === node.key} shared={ownSharedKeys.has(node.key)} densityScale={densityScale} dense={dense} showAllLabels={showAllLabels && (!dense || denseLabelKeys.has(node.key))} onSelect={onSelect} onOpen={onOpen} onContext={onNodeContext} />)}
    {remoteNodes.map((node) => <SharedRemoteNeuron key={node.id} node={node} selected={selectedRemoteId === node.id} showAllLabels={showAllLabels} onSelect={onRemoteSelect} />)}
    <CameraControls onViewportFocus={onViewportFocus} focusRequest={focusRequest} />
  </>;
}

export function SecondBrainView() {
  const { language, t } = useI18n();
  const cards = useLiveQuery(() => db.cards.toArray(), [], []);
  const boards = useLiveQuery(() => db.boards.toArray(), [], []);
  const fragments = useLiveQuery(() => db.fragments.toArray(), [], []);
  const tasks = useLiveQuery(() => db.tasks.toArray(), [], []);
  const boardNodes = useLiveQuery(() => db.boardNodes.toArray(), [], []);
  const tags = useLiveQuery(() => db.tags.toArray(), [], []);
  const storedEdges = useLiveQuery(() => db.brainEdges.toArray(), [], []);
  const brainShares = useLiveQuery(() => db.brainShares.toArray(), [], []);
  const today = dayjs().format("YYYY-MM-DD");
  const report = useLiveQuery(() => db.brainReports.where("date").equals(today).first(), [today]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkSource, setLinkSource] = useState<string | null>(null);
  const [edgeMenu, setEdgeMenu] = useState<{ edge: BrainEdgeView; x: number; y: number } | null>(null);
  const [query, setQuery] = useState("");
  const [showAllLabels, setShowAllLabels] = useState(true);
  const [viewportFocus, setViewportFocus] = useState<[number, number, number]>([0, 0, 0]);
  const [busy, setBusy] = useState<"links" | "report" | null>(null);
  const [notice, setNotice] = useState("");
  const [reportExpanded, setReportExpanded] = useState(false);
  const [reportMinimized, setReportMinimized] = useState(false);
  const [reportOverflowing, setReportOverflowing] = useState(false);
  const [reportAtEnd, setReportAtEnd] = useState(false);
  const reportPanelRef = useRef<HTMLElement>(null);
  const reportReadingRef = useRef<HTMLDivElement>(null);
  const pendingIdentityAction = useRef<((identity: CommunityIdentity) => void) | null>(null);
  const discoveryDidRun = useRef(false);
  const brainSharesRef = useRef<BrainShareRecord[]>([]);
  const [communityIdentity, setCommunityIdentity] = useState<CommunityIdentity | null>(() => getCommunityIdentity());
  const [identityOpen, setIdentityOpen] = useState(false);
  const [exploreShared, setExploreShared] = useState(() => getCommunityDiscoveryEnabled());
  const [sharedSummaries, setSharedSummaries] = useState<SharedNeuronSummary[]>([]);
  const [sharedLoading, setSharedLoading] = useState(false);
  const [selectedRemoteId, setSelectedRemoteId] = useState<string | null>(null);
  const [remoteDetail, setRemoteDetail] = useState<SharedNeuronDetail | null>(null);
  const [remoteError, setRemoteError] = useState("");
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteBusyAction, setRemoteBusyAction] = useState("");
  const [shareCandidate, setShareCandidate] = useState<BrainNodeView | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<BrainNodeView | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ targetType: "neuron" | "comment"; targetId: string } | null>(null);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [adminToken, setAdminToken] = useState(() => getWishAdminSession());
  const theme = useAppStore((state) => state.theme);
  const engine = useAppStore((state) => state.aiEngine);
  const openRouterModel = useAppStore((state) => state.openRouterModel);
  const customModel = useAppStore((state) => state.customModel);
  const temperature = useAppStore((state) => state.temperature);
  const openCard = useAppStore((state) => state.openCard);
  const openBoard = useAppStore((state) => state.openBoard);
  const setView = useAppStore((state) => state.setView);

  const taskCopy = useMemo(() => getTaskIntegrationCopy(language), [language]);
  const graph = useMemo(() => buildBrainGraph({ cards, boards, fragments, tasks, boardNodes, tags, storedEdges, language }), [cards, boards, fragments, tasks, boardNodes, tags, storedEdges, language]);
  const semanticCopy = useMemo(() => getBrainSemanticCopy(language), [language]);
  const sharedCopy = useMemo(() => getSharedBrainCopy(language), [language]);
  const ownSharedKeys = useMemo(() => new Set(brainShares.filter((item) => item.status === "shared").map((item) => item.id)), [brainShares]);
  const remoteSceneNodes = useMemo(() => sharedNeuronSceneNodes(selectDiscoveryBatch(sharedSummaries, Boolean(communityIdentity))), [communityIdentity, sharedSummaries]);
  const ownedAINodes = useMemo(() => onlyOwnedNodesForAI([...graph.nodes, ...remoteSceneNodes]), [graph.nodes, remoteSceneNodes]);
  const reportHtml = useMemo(() => report ? renderSafeMarkdown(segmentReflection(report.content, language)) : "", [language, report]);
  const filteredNodes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(language);
    if (!normalized) return graph.nodes;
    return graph.nodes.filter((node) => `${node.title} ${node.text} ${node.keywords.join(" ")}`.toLocaleLowerCase(language).includes(normalized));
  }, [graph.nodes, language, query]);
  const filteredRemoteNodes = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(language);
    if (!normalized) return remoteSceneNodes;
    return remoteSceneNodes.filter((node) => `${node.title} ${node.authorName}`.toLocaleLowerCase(language).includes(normalized));
  }, [language, query, remoteSceneNodes]);
  const searchFocusRequest = query.trim() && filteredNodes[0] ? { key: filteredNodes[0].key, position: filteredNodes[0].position } : null;
  const sceneNodes = useMemo(
    () => selectBrainViewportNodes(filteredNodes, viewportFocus, PRIVATE_BRAIN_VIEWPORT_LIMIT, [selectedKey, linkSource].filter(Boolean) as string[]),
    [filteredNodes, linkSource, selectedKey, viewportFocus],
  );
  const visibleKeys = useMemo(() => new Set(sceneNodes.map((node) => node.key)), [sceneNodes]);
  const filteredEdges = useMemo(() => graph.edges.filter((edge) => visibleKeys.has(edge.source) && visibleKeys.has(edge.target)), [graph.edges, visibleKeys]);
  const selected = graph.nodes.find((node) => node.key === selectedKey) || null;
  const selectedShare = selected ? brainShares.find((item) => item.id === selected.key && item.status === "shared") || null : null;
  const selectedEdges = selected ? graph.edges.filter((edge) => edge.persisted && (edge.source === selected.key || edge.target === selected.key)) : [];
  const model = customModel.trim() || openRouterModel;
  const canvasColor = useMemo(() => {
    const css = getComputedStyle(document.documentElement).getPropertyValue("--brain-canvas").trim();
    return css || (theme === "light" ? "#e8e5dc" : "#0d1311");
  }, [theme]);

  useEffect(() => {
    brainSharesRef.current = brainShares;
    if (selectedRemoteId && remoteDetail?.isOwn) {
      const localShare = brainShares.find((item) => item.remoteId === selectedRemoteId && item.status === "shared");
      if (localShare) setSelectedKey(localShare.id);
    }
  }, [brainShares, remoteDetail?.isOwn, selectedRemoteId]);

  useEffect(() => {
    const close = () => setEdgeMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);

  useEffect(() => {
    const syncIdentity = (event: Event) => setCommunityIdentity((event as CustomEvent<CommunityIdentity>).detail);
    const openSharedNeuron = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id) void openRemoteNeuron(id);
    };
    window.addEventListener("chengjing-community-identity", syncIdentity);
    window.addEventListener("chengjing-open-shared-neuron", openSharedNeuron);
    const pending = localStorage.getItem(COMMUNITY_OPEN_NEURON_KEY);
    if (pending) {
      localStorage.removeItem(COMMUNITY_OPEN_NEURON_KEY);
      void openRemoteNeuron(pending);
    }
    return () => {
      window.removeEventListener("chengjing-community-identity", syncIdentity);
      window.removeEventListener("chengjing-open-shared-neuron", openSharedNeuron);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setCommunityDiscoveryEnabled(exploreShared);
    if (!exploreShared) {
      setSharedSummaries([]);
      setSharedLoading(false);
      if (discoveryDidRun.current) setNotice(sharedCopy.privateOnly);
      return;
    }
    discoveryDidRun.current = true;
    let active = true;
    setSharedLoading(true);
    setNotice(sharedCopy.exploring);
    void communityApi.discover(communityIdentity).then((result) => {
      if (!active) return;
      const selectedBatch = selectDiscoveryBatch(result.items, Boolean(communityIdentity));
      setSharedSummaries(selectedBatch);
      setNotice(sharedCopy.discovered(selectedBatch.length));
    }).catch(() => {
      if (!active) return;
      setSharedSummaries([]);
      setNotice(sharedCopy.discoverFailed);
    }).finally(() => { if (active) setSharedLoading(false); });
    return () => { active = false; };
  }, [communityIdentity?.id, exploreShared, sharedCopy]);

  useLayoutEffect(() => {
    const measure = () => {
      const reading = reportReadingRef.current;
      setReportOverflowing(Boolean(reading && !reportExpanded && !reportMinimized && reading.scrollHeight > reading.clientHeight + 2));
      setReportAtEnd(Boolean(reading && reading.scrollTop + reading.clientHeight >= reading.scrollHeight - 2));
    };
    const frame = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [reportExpanded, reportHtml, reportMinimized]);

  useEffect(() => {
    if (!reportExpanded) return;
    reportPanelRef.current?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setReportExpanded(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [reportExpanded]);

  function communityError(reason: unknown) {
    const error = reason instanceof CommunityApiError ? reason : new CommunityApiError("request-failed", 0);
    return sharedCopy.errors[error.code] || (error.message && error.message !== "request-failed" ? error.message : sharedCopy.error);
  }

  function ensureCommunityIdentity(action: (identity: CommunityIdentity) => void) {
    if (communityIdentity) { action(communityIdentity); return; }
    pendingIdentityAction.current = action;
    setIdentityOpen(true);
  }

  async function openRemoteNeuron(id: string) {
    const localShare = brainSharesRef.current.find((item) => item.remoteId === id && item.status === "shared");
    setSelectedKey(localShare?.id || null);
    setSelectedRemoteId(id);
    setRemoteDetail(null);
    setRemoteError("");
    setRemoteLoading(true);
    try {
      const result = await communityApi.neuron(id, getCommunityIdentity());
      setRemoteDetail(result.item);
    } catch (reason) { setRemoteError(communityError(reason)); }
    finally { setRemoteLoading(false); }
  }

  function startSharing(node: BrainNodeView) {
    if (!node.text.trim() && !node.title.trim()) { setNotice(t("brain.emptyContent")); return; }
    ensureCommunityIdentity(() => { setShareError(""); setShareCandidate(node); });
  }

  async function confirmSharing(intention: SharedIntention) {
    if (!shareCandidate || !communityIdentity || shareBusy) return;
    setShareBusy(true); setShareError("");
    try {
      const result = await communityApi.share(communityIdentity, {
        sourceType: shareCandidate.type,
        title: shareCandidate.title,
        body: shareCandidate.text.trim() || shareCandidate.title,
        intention,
      });
      const record: BrainShareRecord = { id: shareCandidate.key, localType: shareCandidate.type, localId: shareCandidate.id, remoteId: result.item.id, status: "shared", sharedAt: Date.now(), updatedAt: Date.now() };
      await db.brainShares.put(record);
      setShareCandidate(null);
      setNotice(sharedCopy.shareDone);
    } catch (reason) { setShareError(communityError(reason)); }
    finally { setShareBusy(false); }
  }

  async function forkRemoteNeuron(identity: CommunityIdentity) {
    if (!remoteDetail || remoteBusyAction) return;
    setRemoteBusyAction("fork");
    try {
      const result = await communityApi.fork(identity, remoteDetail.id);
      const escaped = remoteDetail.body.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
      const contentHtml = escaped.split(/\n{2,}/).map((paragraph) => `<p>${paragraph.replaceAll("\n", "<br>")}</p>`).join("");
      const card = await createCard({ title: remoteDetail.title, plainText: remoteDetail.body, contentHtml, kind: "note", state: "active", properties: { 共享來源: remoteDetail.authorName, 來源神經元: remoteDetail.id } });
      await db.brainShares.put({ id: `card:${card.id}`, localType: "card", localId: card.id, remoteId: result.item.id, status: "shared", originRemoteId: remoteDetail.id, sharedAt: Date.now(), updatedAt: Date.now() });
      setNotice(sharedCopy.forked);
    } catch (reason) { setNotice(communityError(reason)); }
    finally { setRemoteBusyAction(""); }
  }

  async function addRemoteComment(body: string, identity: CommunityIdentity | null) {
    if (!remoteDetail || remoteBusyAction) return;
    if (!adminToken && !identity) {
      ensureCommunityIdentity((next) => void addRemoteComment(body, next));
      return;
    }
    setRemoteBusyAction("comment");
    try {
      const result = await communityApi.comment(adminToken ? null : identity, remoteDetail.id, body, adminToken);
      setRemoteDetail((current) => current ? { ...current, comments: [...current.comments, result.item], commentCount: current.commentCount + 1 } : current);
    } catch (reason) { setNotice(communityError(reason)); }
    finally { setRemoteBusyAction(""); }
  }

  async function loadOlderRemoteComments() {
    if (!remoteDetail?.commentCursor || remoteBusyAction) return;
    setRemoteBusyAction("comments");
    try {
      const result = await communityApi.comments(remoteDetail.id, communityIdentity, remoteDetail.commentCursor);
      setRemoteDetail((current) => current ? { ...current, comments: [...result.items, ...current.comments.filter((comment) => !result.items.some((item) => item.id === comment.id))], commentCursor: result.nextCursor } : current);
    } catch (reason) { setNotice(communityError(reason)); }
    finally { setRemoteBusyAction(""); }
  }

  function startReport(targetType: "neuron" | "comment", targetId: string) {
    ensureCommunityIdentity(() => setReportTarget({ targetType, targetId }));
  }

  async function deleteRemoteComment(id: string) {
    if (!remoteDetail || remoteBusyAction) return;
    setRemoteBusyAction(`delete:${id}`);
    try {
      await communityApi.deleteComment(id, communityIdentity, adminToken);
      setRemoteDetail((current) => current ? { ...current, comments: current.comments.filter((comment) => comment.id !== id), commentCount: Math.max(0, current.commentCount - 1) } : current);
    } catch (reason) { setNotice(communityError(reason)); }
    finally { setRemoteBusyAction(""); }
  }

  async function deleteOwnedSharedNeuron() {
    if (!deleteCandidate || !communityIdentity || deleteBusy) return;
    const share = brainShares.find((item) => item.id === deleteCandidate.key && item.status === "shared");
    if (!share) return;
    setDeleteBusy(true);
    try {
      await communityApi.deleteNeuron(share.remoteId, communityIdentity);
      await db.brainShares.update(share.id, { status: "deleted", updatedAt: Date.now() });
      if (deleteCandidate.type === "card") await deleteCardPermanently(deleteCandidate.id);
      else if (deleteCandidate.type === "board") await deleteBoardPermanently(deleteCandidate.id);
      else if (deleteCandidate.type === "fragment") await deleteFragmentPermanently(deleteCandidate.id);
      else {
        const relatedEdges = await db.brainEdges.filter((edge) => (edge.sourceType === "task" && edge.sourceId === deleteCandidate.id) || (edge.targetType === "task" && edge.targetId === deleteCandidate.id)).toArray();
        await db.transaction("rw", [db.tasks, db.brainEdges], async () => { await db.brainEdges.bulkDelete(relatedEdges.map((edge) => edge.id)); await db.tasks.delete(deleteCandidate.id); });
      }
      setSelectedKey(null);
      setDeleteCandidate(null);
    } catch (reason) { setNotice(communityError(reason)); }
    finally { setDeleteBusy(false); }
  }

  function openNode(node: BrainNodeView) {
    if (node.type === "card") openCard(node.id);
    else if (node.type === "board") openBoard(node.id);
    else if (node.type === "task") setView("tasks");
    else setView("fragments");
  }

  async function selectNode(node: BrainNodeView) {
    setSelectedRemoteId(null);
    setRemoteDetail(null);
    setSelectedKey(node.key);
    if (!linkMode) return;
    if (!linkSource) {
      setLinkSource(node.key);
      setNotice(t("brain.firstSelected"));
      return;
    }
    if (linkSource === node.key) {
      setNotice(t("brain.chooseOther"));
      return;
    }
    const pair = [linkSource, node.key].sort().join("|");
    const exists = graph.edges.some((edge) => [edge.source, edge.target].sort().join("|") === pair);
    if (exists) {
      setNotice(t("brain.alreadyLinked"));
      setLinkSource(null);
      return;
    }
    const source = splitBrainKey(linkSource);
    const target = splitBrainKey(node.key);
    await db.brainEdges.add({ id: crypto.randomUUID(), sourceType: source.type, sourceId: source.id, targetType: target.type, targetId: target.id, origin: "manual", reason: t("brain.manualReason"), createdAt: Date.now() });
    setLinkSource(null);
    setNotice(t("brain.linkSaved"));
  }

  function nodeContext(event: ThreeEvent<MouseEvent>, node: BrainNodeView) {
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    const native = event.nativeEvent;
    showContextMenu({ kind: node.type, id: node.id } as Parameters<typeof showContextMenu>[0], native.clientX, native.clientY);
  }

  function edgeContext(event: ThreeEvent<MouseEvent>, edge: BrainEdgeView) {
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    setEdgeMenu({ edge, x: event.nativeEvent.clientX, y: event.nativeEvent.clientY });
  }

  async function writeSemanticReport(edges: BrainEdgeView[]) {
    const localMode = engine === "local-gemma";
    const latest = [...ownedAINodes]
      .sort((a, b) => b.observedAt - a.observedAt || b.updatedAt - a.updatedAt)
      .slice(0, localMode ? LOCAL_BRAIN_SEMANTIC_LIMITS.reportNodeLimit : 90);
    const nodeMap = new Map(ownedAINodes.map((node) => [node.key, node]));
    const semanticLinks = edges
      .filter((edge) => edge.origin !== "structure")
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0) || Number(b.persisted) - Number(a.persisted))
      .slice(0, localMode ? LOCAL_BRAIN_SEMANTIC_LIMITS.reportLinkLimit : 48);
    const context = [
      `${t("brain.repeatedConcepts")}: ${graph.concepts.slice(0, localMode ? 8 : 16).map((item) => `${item.term}(${item.count})`).join(", ") || t("brain.notObvious")}`,
      `${t("brain.recentNeurons")}:`,
      ...latest.map((node) => `- [${node.sourceKind}] ${node.title} | observed_at=${new Date(node.observedAt).toISOString()} | ${node.text.slice(0, localMode ? LOCAL_BRAIN_SEMANTIC_LIMITS.reportContentLimit : 300)}`),
      `${t("brain.establishedLinks")}:`,
      ...semanticLinks.map((edge) => {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        const relation = edge.relationType ? semanticCopy.relationLabels[edge.relationType] : edge.origin === "manual" ? t("brain.originManual") : t("brain.originAI");
        const support = edge.confidence == null ? "" : ` | confidence=${edge.confidence.toFixed(2)}`;
        const time = edge.temporalDistanceDays == null ? "" : ` | time_gap_days=${edge.temporalDistanceDays}`;
        const evidence = edge.evidence?.length ? ` | evidence=${edge.evidence.join(" / ")}` : "";
        return `- [${relation}] ${source?.title || edge.source} ↔ ${target?.title || edge.target}${support}${time} | hypothesis=${edge.reason}${evidence}`;
      }),
    ].join("\n");
    const response = await runAI({
      engine,
      model,
      temperature: localMode ? 0.35 : Math.min(0.65, temperature),
      maxTokens: localMode ? LOCAL_BRAIN_SEMANTIC_LIMITS.reportMaxTokens : undefined,
      context,
      prompt: semanticCopy.reportPrompt,
    });
    const timestamp = Date.now();
    await db.brainReports.put({ id: report?.id || crypto.randomUUID(), date: today, content: segmentReflection(response.text, language), model: response.model || model, createdAt: report?.createdAt || timestamp, updatedAt: timestamp });
  }

  async function organizeWithAI() {
    if (ownedAINodes.length < 2) {
      setNotice(t("brain.needTwo"));
      return;
    }
    const localMode = engine === "local-gemma";
    setBusy("links");
    try {
      const semanticContext = localMode
        ? buildBrainSemanticContext(
          ownedAINodes,
          graph.edges,
          Date.now(),
          LOCAL_BRAIN_SEMANTIC_LIMITS.nodeLimit,
          LOCAL_BRAIN_SEMANTIC_LIMITS.contentLimit,
          LOCAL_BRAIN_SEMANTIC_LIMITS.candidateLimit,
          LOCAL_BRAIN_SEMANTIC_LIMITS.existingEdgeLimit,
        )
        : buildBrainSemanticContext(ownedAINodes, graph.edges);
      setNotice(localMode ? semanticCopy.localReading(semanticContext.selectedNodes.length, ownedAINodes.length) : semanticCopy.reading);
      let response = await runAI({
        engine,
        model,
        temperature: localMode ? 0.05 : Math.min(0.28, temperature),
        maxTokens: localMode ? LOCAL_BRAIN_SEMANTIC_LIMITS.linkMaxTokens : 6_000,
        responseFormat: BRAIN_CONNECTION_RESPONSE_FORMAT as unknown as Record<string, unknown>,
        context: semanticContext.text,
        prompt: localMode ? `${semanticCopy.organizePrompt}\n\n${semanticCopy.localPromptSuffix}` : semanticCopy.organizePrompt,
      });
      let parsedConnections: ReturnType<typeof parseAIConnections>;
      try {
        if (response.finishReason === "length") throw new Error("truncated-ai-connection-json");
        parsedConnections = parseAIConnections(response.text, semanticContext.nodeKeys, language);
      } catch {
        if (localMode) throw new Error(semanticCopy.localJsonFailed);
        setNotice(semanticCopy.repairingJson);
        response = await runAI({
          engine,
          model,
          temperature: 0.05,
          maxTokens: 6_000,
          responseFormat: BRAIN_CONNECTION_RESPONSE_FORMAT as unknown as Record<string, unknown>,
          context: semanticContext.text,
          prompt: `${semanticCopy.organizePrompt}\n\n${semanticCopy.jsonRetryPrompt}`,
        });
        try { parsedConnections = parseAIConnections(response.text, semanticContext.nodeKeys, language); }
        catch { throw new Error(semanticCopy.invalidJson); }
      }
      const parsed = parsedConnections
        .filter((connection) => connection.confidence >= 0.62 && connection.reason.trim().length >= 8 && connection.evidence.length >= 2)
        .slice(0, localMode ? LOCAL_BRAIN_SEMANTIC_LIMITS.maxConnections : 30);
      const existingPairs = new Set(graph.edges.filter((edge) => edge.origin !== "ai").map((edge) => [edge.source, edge.target].sort().join("|")));
      const semanticNodeMap = new Map(semanticContext.selectedNodes.map((node) => [node.key, node]));
      const records: BrainEdgeRecord[] = parsed.filter((connection) => !existingPairs.has([connection.source, connection.target].sort().join("|"))).map((connection) => {
        const from = splitBrainKey(connection.source);
        const to = splitBrainKey(connection.target);
        const sourceNode = semanticNodeMap.get(connection.source)!;
        const targetNode = semanticNodeMap.get(connection.target)!;
        return { id: crypto.randomUUID(), sourceType: from.type, sourceId: from.id, targetType: to.type, targetId: to.id, origin: "ai", reason: connection.reason, confidence: connection.confidence, relationType: connection.relationType, evidence: connection.evidence, temporalDistanceDays: brainTemporalDistanceDays(sourceNode, targetNode), createdAt: Date.now() };
      });
      if (!records.length) {
        setNotice(t("brain.noNewLinks"));
        return;
      }
      await db.transaction("rw", db.brainEdges, async () => {
        await db.brainEdges.where("origin").equals("ai").filter((edge) => semanticContext.nodeKeys.has(`${edge.sourceType}:${edge.sourceId}`) && semanticContext.nodeKeys.has(`${edge.targetType}:${edge.targetId}`)).delete();
        await db.brainEdges.bulkAdd(records);
      });
      const refreshedEdges: BrainEdgeView[] = [
        ...graph.edges.filter((edge) => edge.origin !== "ai" || !semanticContext.nodeKeys.has(edge.source) || !semanticContext.nodeKeys.has(edge.target)),
        ...records.map((edge) => ({ id: edge.id, source: `${edge.sourceType}:${edge.sourceId}`, target: `${edge.targetType}:${edge.targetId}`, origin: "ai" as const, reason: edge.reason || t("brain.aiPossible"), confidence: edge.confidence, relationType: edge.relationType, evidence: edge.evidence, temporalDistanceDays: edge.temporalDistanceDays, persisted: true })),
      ];
      if (localMode) {
        setNotice(semanticCopy.localLinksOnly(records.length));
        return;
      }
      setNotice(semanticCopy.updatingReflection);
      try {
        await writeSemanticReport(refreshedEdges);
        setNotice(semanticCopy.linksAndReport(records.length));
      } catch {
        setNotice(semanticCopy.linksReportFailed(records.length));
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("brain.organizeFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function generateReport() {
    if (!ownedAINodes.length) {
      setNotice(t("brain.needContent"));
      return;
    }
    setBusy("report");
    setNotice(t("brain.reflecting"));
    try {
      await writeSemanticReport(graph.edges);
      setNotice(report ? t("brain.reportRegenerated") : t("brain.reportSaved"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("brain.reportFailed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="second-brain-page" data-brain-nodes={graph.nodes.length} data-brain-rendered-nodes={sceneNodes.length} data-brain-viewport-focus={viewportFocus.map((value) => value.toFixed(2)).join(",")} data-brain-persisted-links={graph.edges.filter((edge) => edge.persisted).length} data-brain-editable-edge-hit-targets={graph.edges.filter((edge) => edge.persisted).length}>
      <Canvas camera={{ position: [0, 1.5, 19], fov: 54, near: 0.1, far: 120 }} dpr={[1, 1.75]} gl={{ antialias: true, alpha: false }} onPointerMissed={() => { setSelectedKey(null); setSelectedRemoteId(null); setRemoteDetail(null); }}>
        <BrainScene nodes={sceneNodes} edges={filteredEdges} remoteNodes={filteredRemoteNodes} ownSharedKeys={ownSharedKeys} selectedKey={selectedKey} selectedRemoteId={selectedRemoteId} linkSource={linkSource} showAllLabels={showAllLabels} canvasColor={canvasColor} onSelect={selectNode} onOpen={openNode} onNodeContext={nodeContext} onEdgeContext={edgeContext} onRemoteSelect={(node) => void openRemoteNeuron(node.id)} onViewportFocus={setViewportFocus} focusRequest={searchFocusRequest} />
      </Canvas>

      <div className="brain-access-list" aria-label={t("brain.accessList")}>
        {sceneNodes.map((node) => <button type="button" key={node.key} data-brain-node-key={node.key} onClick={() => selectNode(node)} onDoubleClick={() => openNode(node)}>{node.title}</button>)}
        {filteredRemoteNodes.map((node) => <button type="button" key={node.id} data-shared-neuron-id={node.id} onClick={() => void openRemoteNeuron(node.id)}>{node.title} · {node.authorName}</button>)}
      </div>
      <div className="brain-edge-access-list" aria-label={t("brain.editableLinks")}>
        {graph.edges.filter((edge) => edge.persisted).map((edge) => <button type="button" key={edge.id} data-brain-edge-id={edge.id} data-brain-edge-origin={edge.origin} onContextMenu={(event) => { event.preventDefault(); setEdgeMenu({ edge, x: event.clientX, y: event.clientY }); }}>{edge.reason}</button>)}
      </div>

      <header className="brain-heading">
        <span><BrainCircuit size={17} />{t("brain.title")}</span>
        <h2>{t("brain.summary", { nodes: graph.nodes.length, edges: graph.edges.filter((edge) => edge.persisted).length })}</h2>
        <p>{taskCopy.brainDescription}</p>
        <small className="brain-viewport-status">{semanticCopy.viewportStatus(sceneNodes.length, graph.nodes.length)}</small>
      </header>

      <div className="brain-toolbar">
        <label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("brain.search")} />{query && <button type="button" aria-label={t("brain.clearSearch")} onClick={() => setQuery("")}><X size={13} /></button>}</label>
        <button type="button" className={showAllLabels ? "is-active" : ""} onClick={() => setShowAllLabels(!showAllLabels)} title={showAllLabels ? t("brain.labelsAllTitle") : t("brain.labelsShowTitle")}><Tags size={15} />{showAllLabels ? t("brain.labelsAll") : t("brain.labelsFocus")}</button>
        <button type="button" className={linkMode ? "is-active" : ""} onClick={() => { setLinkMode(!linkMode); setLinkSource(null); setNotice(!linkMode ? t("brain.linkEnter") : t("brain.linkExit")); }}><Link2 size={15} />{linkMode ? t("brain.linkActive") : t("brain.linkManual")}</button>
        <button type="button" disabled={busy !== null} onClick={organizeWithAI} title={engine === "local-gemma" ? semanticCopy.localButtonHint : undefined}>{busy === "links" ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{t("brain.organize")}</button>
        <button type="button" className={exploreShared ? "is-active is-shared-discovery" : ""} disabled={sharedLoading} onClick={() => setExploreShared((value) => { if (value) { setSelectedRemoteId(null); setRemoteDetail(null); } return !value; })}>{sharedLoading ? <LoaderCircle size={15} className="spin" /> : <Waves size={15} />}{sharedCopy.explore}</button>
        <button type="button" className={adminToken ? "is-admin" : ""} onClick={() => setModerationOpen(true)} title={sharedCopy.adminTools}><ShieldCheck size={15} /></button>
      </div>

      <aside className="brain-help">
        <span><MousePointer2 size={14} />{t("brain.rotate")}</span><span><Maximize2 size={14} />{t("brain.zoom")}</span><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>{t("brain.move")}</span>
      </aside>

      {notice && <div className="brain-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")}><X size={14} /></button></div>}

      {selected && !selectedRemoteId && <aside className="brain-inspector">
        <button type="button" className="bare-button" onClick={() => setSelectedKey(null)} aria-label={t("brain.closeInfo")}><X size={16} /></button>
        <span>{selected.type === "card" ? t("brain.typeCard") : selected.type === "board" ? t("brain.typeBoard") : selected.type === "task" ? taskCopy.brainType : t("brain.typeFragment")}{selectedShare && <em className="brain-own-shared-badge"><Waves size={11} />{sharedCopy.shared}</em>}</span>
        <h3>{selected.title}</h3>
        <p>{selected.text || t("brain.emptyContent")}</p>
        <div><b>{selected.weight.toFixed(1)}×</b><small>{t("brain.conceptWeight")}</small></div>
        <footer>{selected.keywords.slice(0, 6).map((keyword) => <i key={keyword}>{keyword}</i>)}</footer>
        {selectedEdges.length > 0 && <section className="brain-inspector-links"><h4>{t("brain.editableLinks")}</h4>{selectedEdges.map((edge) => { const otherKey = edge.source === selected.key ? edge.target : edge.source; const otherTitle = graph.nodes.find((node) => node.key === otherKey)?.title || otherKey; return <button type="button" key={edge.id} onClick={() => db.brainEdges.delete(edge.id)} title={t("brain.deleteThisLink")}><span className="brain-link-copy"><small>{edge.relationType ? semanticCopy.relationLabels[edge.relationType] : edge.origin === "manual" ? t("brain.originManual") : t("brain.originAI")}{edge.confidence != null ? ` · ${semanticCopy.supportStrength(Math.round(edge.confidence * 100))}` : ""}{edge.temporalDistanceDays != null ? ` · ${semanticCopy.daysApart(edge.temporalDistanceDays)}` : ""}</small><i>{otherTitle}</i><b>{edge.reason}</b>{edge.evidence?.length ? <em>{edge.evidence.join(" ／ ")}</em> : null}</span><Unlink size={13} /></button>; })}</section>}
        <div className="brain-sharing-actions">{selectedShare ? <button type="button" className="shared-delete-action" onClick={() => setDeleteCandidate(selected)}><Trash2 size={14} />{sharedCopy.deleteShared}</button> : <button type="button" className="shared-publish-action" onClick={() => startSharing(selected)}><Waves size={14} />{sharedCopy.shareNeuron}</button>}<button type="button" className="secondary-button" onClick={() => openNode(selected)}><ExternalLink size={14} />{t("brain.openOriginal")}</button></div>
      </aside>}

      {selectedRemoteId && <SharedNeuronInspector detail={remoteDetail} loading={remoteLoading} error={remoteError} identity={communityIdentity} adminToken={adminToken} busyAction={remoteBusyAction} onClose={() => { setSelectedRemoteId(null); setRemoteDetail(null); }} onFork={() => ensureCommunityIdentity((identity) => void forkRemoteNeuron(identity))} onReport={startReport} onComment={(body) => void addRemoteComment(body, communityIdentity)} onLoadMore={() => void loadOlderRemoteComments()} onDeleteComment={(id) => void deleteRemoteComment(id)} />}

      {reportExpanded && <button type="button" className="brain-report-backdrop" aria-label={semanticCopy.collapseReflection} onClick={() => setReportExpanded(false)} />}
      <section ref={reportPanelRef} className={`brain-report ${reportExpanded ? "is-expanded" : ""} ${reportMinimized ? "is-minimized" : ""} ${reportOverflowing ? "has-overflow" : ""} ${reportAtEnd ? "is-at-end" : ""}`} role={reportExpanded ? "dialog" : "region"} aria-modal={reportExpanded || undefined} aria-label={t("brain.todayReflection")} tabIndex={reportExpanded ? -1 : undefined}>
        <header><span><ShieldCheck size={14} />{t("brain.todayReflection")}</span><div className="brain-report-actions">{reportMinimized ? <button type="button" onClick={() => setReportMinimized(false)}><Maximize2 size={14} />{semanticCopy.restoreReflection}</button> : <><button type="button" disabled={busy !== null} onClick={generateReport} title={engine === "local-gemma" ? semanticCopy.localButtonHint : undefined}>{busy === "report" ? <LoaderCircle size={14} className="spin" /> : report ? <RefreshCw size={14} /> : <Sparkles size={14} />}{report ? t("brain.regenerate") : t("brain.generateToday")}</button><button type="button" onClick={() => { setReportExpanded(false); setReportMinimized(true); }}><Minus size={14} />{semanticCopy.minimizeReflection}</button>{report && <button type="button" onClick={() => { setReportMinimized(false); setReportExpanded(!reportExpanded); }}>{reportExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}{reportExpanded ? semanticCopy.collapseReflection : semanticCopy.expandReflection}</button>}</>}</div></header>
        {!reportMinimized && <div ref={reportReadingRef} className="brain-report-reading" onScroll={(event) => { const reading = event.currentTarget; setReportAtEnd(reading.scrollTop + reading.clientHeight >= reading.scrollHeight - 2); }}>{report ? <div className="brain-report-markdown" dangerouslySetInnerHTML={{ __html: reportHtml }} /> : <p className="brain-report-empty">{semanticCopy.reportEmpty}</p>}</div>}
      </section>

      {edgeMenu && <div className="brain-edge-menu" style={{ left: edgeMenu.x, top: edgeMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
        <header><span>{edgeMenu.edge.origin === "manual" ? t("brain.originManual") : edgeMenu.edge.origin === "ai" ? edgeMenu.edge.relationType ? semanticCopy.relationLabels[edgeMenu.edge.relationType] : t("brain.originAI") : t("brain.originStructure")}</span><p>{edgeMenu.edge.reason}</p></header>
        {edgeMenu.edge.persisted ? <button type="button" onClick={async () => { await db.brainEdges.delete(edgeMenu.edge.id); setEdgeMenu(null); }}><Trash2 size={14} />{t("brain.deleteThisLink")}</button> : <button type="button" disabled><Unlink size={14} />{t("brain.removeOnBoard")}</button>}
      </div>}

      {graph.nodes.length === 0 && <div className="brain-empty"><BrainCircuit size={34} /><h3>{t("brain.emptyTitle")}</h3><p>{taskCopy.brainEmpty}</p><button type="button" onClick={() => setView("fragments")}>{t("brain.leaveFragment")}</button></div>}
      <CommunityIdentityDialog open={identityOpen} identity={communityIdentity} onReady={(identity) => { saveCommunityIdentity(identity); setCommunityIdentity(identity); setIdentityOpen(false); const action = pendingIdentityAction.current; pendingIdentityAction.current = null; action?.(identity); }} onClose={() => { setIdentityOpen(false); pendingIdentityAction.current = null; }} />
      <ShareNeuronDialog node={shareCandidate} busy={shareBusy} error={shareError} onClose={() => { if (!shareBusy) setShareCandidate(null); }} onConfirm={(intention) => void confirmSharing(intention)} />
      <DeleteSharedNeuronDialog node={deleteCandidate} busy={deleteBusy} onClose={() => { if (!deleteBusy) setDeleteCandidate(null); }} onConfirm={() => void deleteOwnedSharedNeuron()} />
      <CommunityReportDialog target={reportTarget} identity={communityIdentity} onClose={() => setReportTarget(null)} onDone={setNotice} />
      <CommunityModerationDialog open={moderationOpen} onClose={() => setModerationOpen(false)} onToken={(token) => setAdminToken(token)} />
    </div>
  );
}
