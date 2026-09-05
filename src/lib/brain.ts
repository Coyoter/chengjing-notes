import type {
  BoardNodeRecord,
  BoardRecord,
  BrainContentType,
  BrainEdgeOrigin,
  BrainEdgeRecord,
  BrainRelationType,
  CardRecord,
  CardKind,
  FragmentRecord,
  TagRecord,
  TaskRecord,
  AppLanguage,
} from "../types";
import { intlLocale, translate } from "../i18n";
import { getTaskIntegrationCopy, taskCopyFormat } from "./taskIntegrationCopy";
import { isMaterializedCard } from "./journalVisibility";
import { getTaskHierarchyCopy } from "./taskHierarchyCopy";

export interface BrainNodeView {
  key: string;
  type: BrainContentType;
  id: string;
  title: string;
  text: string;
  sourceKind: CardKind | "board" | "fragment" | "task";
  keywords: string[];
  weight: number;
  radius: number;
  position: [number, number, number];
  createdAt: number;
  observedAt: number;
  updatedAt: number;
}

export interface BrainEdgeView {
  id: string;
  source: string;
  target: string;
  origin: BrainEdgeOrigin | "structure";
  reason: string;
  confidence?: number;
  relationType?: BrainRelationType;
  evidence?: string[];
  temporalDistanceDays?: number;
  persisted: boolean;
}

export interface BrainConcept {
  term: string;
  count: number;
}

export interface BrainSemanticCandidate {
  source: string;
  target: string;
  temporalDistanceDays: number;
  keywordOverlap: string[];
  score: number;
}

export interface ParsedAIConnection {
  source: string;
  target: string;
  reason: string;
  confidence: number;
  relationType: BrainRelationType;
  evidence: string[];
}

const DAY_MS = 86_400_000;
const AI_RELATION_TYPES = new Set<BrainRelationType>(["semantic", "shared_context", "possible_influence", "goal_obstacle", "sequence", "contrast", "reinforcement"]);
export const BRAIN_CONNECTION_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "chengjing_brain_connections",
    strict: false,
    schema: {
      type: "object",
      properties: {
        connections: {
          type: "array",
          maxItems: 30,
          items: {
            type: "object",
            properties: {
              source: { type: "string" }, target: { type: "string" },
              relationType: { type: "string", enum: [...AI_RELATION_TYPES] },
              reason: { type: "string" }, evidence: { type: "array", minItems: 2, maxItems: 3, items: { type: "string" } },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["source", "target", "relationType", "reason", "evidence", "confidence"],
            additionalProperties: false,
          },
        },
      },
      required: ["connections"],
      additionalProperties: false,
    },
  },
} as const;

export const LOCAL_BRAIN_SEMANTIC_LIMITS = {
  nodeLimit: 18,
  contentLimit: 180,
  candidateLimit: 24,
  existingEdgeLimit: 12,
  maxConnections: 8,
  linkMaxTokens: 768,
  reportNodeLimit: 18,
  reportLinkLimit: 12,
  reportContentLimit: 180,
  reportMaxTokens: 384,
} as const;

export const PRIVATE_BRAIN_VIEWPORT_LIMIT = 200;

export function selectBrainViewportNodes(
  nodes: BrainNodeView[],
  focus: [number, number, number],
  limit = PRIVATE_BRAIN_VIEWPORT_LIMIT,
  pinnedKeys: string[] = [],
) {
  if (nodes.length <= limit) return nodes;
  const pinned = new Set(pinnedKeys);
  const priority = (node: BrainNodeView) => {
    if (pinned.has(node.key)) return Number.NEGATIVE_INFINITY;
    const dx = node.position[0] - focus[0];
    const dy = node.position[1] - focus[1];
    const dz = node.position[2] - focus[2];
    return dx * dx + dy * dy + dz * dz - node.weight * 0.8;
  };
  return [...nodes]
    .sort((left, right) => priority(left) - priority(right) || right.updatedAt - left.updatedAt)
    .slice(0, Math.max(1, limit));
}

const STOP_WORDS = new Set([
  "我們", "你們", "他們", "自己", "這個", "那個", "一個", "一些", "什麼", "怎麼", "可以", "可能", "應該", "還是", "但是", "因為", "所以", "如果", "沒有", "不是", "就是", "已經", "現在", "今天", "明天", "昨天", "最近", "事情", "東西", "感覺", "想法", "內容", "卡片", "白板", "筆記", "日誌", "進行", "需要", "希望", "覺得", "真的", "about", "with", "from", "that", "this", "have", "your", "the", "and", "for",
  "です", "ます", "する", "した", "して", "いる", "ある", "これ", "それ", "ため", "よう", "から", "今日", "自分", "생각", "내용", "오늘", "지금", "그리고", "하지만", "있는", "없는", "하는", "위해", "것이", "제가", "나는",
]);
const WORD_SEGMENTERS = new Map<string, Intl.Segmenter>();
const BRAIN_DATE_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function wordSegmenter(locale: string) {
  const existing = WORD_SEGMENTERS.get(locale);
  if (existing) return existing;
  const created = new Intl.Segmenter(locale, { granularity: "word" });
  WORD_SEGMENTERS.set(locale, created);
  return created;
}

function brainDateFormatter(locale: string) {
  const existing = BRAIN_DATE_FORMATTERS.get(locale);
  if (existing) return existing;
  const created = new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" });
  BRAIN_DATE_FORMATTERS.set(locale, created);
  return created;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomFrom(value: string, salt: string) {
  return (hashString(`${salt}:${value}`) % 10_000) / 10_000;
}

export function journalBrainTitle(card: Pick<CardRecord, "plainText" | "journalDate">, language: AppLanguage = "zh-TW") {
  const candidates = card.plainText
    .replace(/\u00a0/g, " ")
    .split(/\n+|(?<=[。！？!?])\s*/)
    .map((line) => line.replace(/^[\s#>*•·\-–—\d.、]+/, "").trim())
    .filter((line) => line.length >= 2)
    .filter((line) => !/^(今天|今日|日誌|每日記錄|空白日誌)$/u.test(line))
    .filter((line) => !/^\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日$/u.test(line));
  const meaningful = candidates[0];
  if (!meaningful) return translate(language, "brain.journalEmpty");
  return meaningful.length > 30 ? `${meaningful.slice(0, 30)}…` : meaningful;
}

export function extractKeywords(value: string, limit = 16, language: AppLanguage = "zh-TW") {
  const locale = intlLocale[language];
  const normalized = value.toLocaleLowerCase(locale).replace(/https?:\/\/\S+/g, " ");
  const counts = new Map<string, number>();
  const add = (word: string) => counts.set(word, (counts.get(word) || 0) + 1);
  if (typeof Intl.Segmenter === "function") {
    for (const part of wordSegmenter(locale).segment(normalized)) {
      const token = part.segment.trim().replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
      if (!part.isWordLike || token.length < 2 || STOP_WORDS.has(token)) continue;
      add(token);
    }
  } else {
    normalized.split(/[^\p{L}\p{N}]+/gu).filter((token) => token.length >= 2 && !STOP_WORDS.has(token)).forEach(add);
  }
  for (const run of normalized.match(/[\p{Script=Han}]{2,}/gu) || []) {
    for (let index = 0; index < run.length - 1; index += 1) {
      const bigram = run.slice(index, index + 2);
      if (!STOP_WORDS.has(bigram)) add(bigram);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit)
    .map(([word]) => word);
}

function journalObservedAt(journalDate: string | undefined, fallback: number) {
  const matched = journalDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return fallback;
  const timestamp = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]), 12).getTime();
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function escapeReference(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function roundedDays(value: number) {
  return Math.round(value * 10) / 10;
}

export function brainTemporalDistanceDays(source: Pick<BrainNodeView, "observedAt">, target: Pick<BrainNodeView, "observedAt">) {
  return roundedDays(Math.abs(source.observedAt - target.observedAt) / DAY_MS);
}

function selectSemanticNodes(nodes: BrainNodeView[], limit: number) {
  const selected = new Map<string, BrainNodeView>();
  const recent = [...nodes].sort((a, b) => b.observedAt - a.observedAt || b.updatedAt - a.updatedAt);
  const prominent = [...nodes].sort((a, b) => b.weight - a.weight || b.updatedAt - a.updatedAt);
  recent.slice(0, Math.ceil(limit * 0.68)).forEach((node) => selected.set(node.key, node));
  prominent.forEach((node) => { if (selected.size < limit) selected.set(node.key, node); });
  recent.forEach((node) => { if (selected.size < limit) selected.set(node.key, node); });
  return [...selected.values()];
}

function semanticCandidates(nodes: BrainNodeView[], limit: number) {
  const lexical: BrainSemanticCandidate[] = [];
  const exploratory: BrainSemanticCandidate[] = [];
  for (let sourceIndex = 0; sourceIndex < nodes.length; sourceIndex += 1) {
    for (let targetIndex = sourceIndex + 1; targetIndex < nodes.length; targetIndex += 1) {
      const source = nodes[sourceIndex];
      const target = nodes[targetIndex];
      const targetKeywords = new Set(target.keywords);
      const keywordOverlap = source.keywords.filter((keyword) => targetKeywords.has(keyword));
      const temporalDistanceDays = brainTemporalDistanceDays(source, target);
      const temporalAffinity = Math.exp(-temporalDistanceDays / 21);
      const lexicalAffinity = Math.min(1, keywordOverlap.length / 3);
      const prominence = Math.min(1, (source.weight + target.weight) / 5);
      const candidate = {
        source: source.key,
        target: target.key,
        temporalDistanceDays,
        keywordOverlap,
        score: lexicalAffinity * 0.6 + temporalAffinity * 0.28 + prominence * 0.12,
      };
      (keywordOverlap.length ? lexical : exploratory).push(candidate);
    }
  }
  const sort = (left: BrainSemanticCandidate, right: BrainSemanticCandidate) => right.score - left.score || left.temporalDistanceDays - right.temporalDistanceDays;
  lexical.sort(sort);
  exploratory.sort(sort);
  const lexicalLimit = Math.ceil(limit / 2);
  return [...lexical.slice(0, lexicalLimit), ...exploratory.slice(0, limit - lexicalLimit)].sort(sort);
}

export function buildBrainSemanticContext(
  nodes: BrainNodeView[],
  existingEdges: BrainEdgeView[] = [],
  now = Date.now(),
  nodeLimit = 84,
  contentLimit = 480,
  candidateLimit = 120,
  existingEdgeLimit = 80,
) {
  const selectedNodes = selectSemanticNodes(nodes, nodeLimit);
  const nodeKeys = new Set(selectedNodes.map((node) => node.key));
  const candidates = semanticCandidates(selectedNodes, candidateLimit);
  const referenceNodes = selectedNodes.map((node) => {
    const ageDays = roundedDays(Math.max(0, now - node.observedAt) / DAY_MS);
    return [
      `<node key="${escapeReference(node.key)}" kind="${escapeReference(node.sourceKind)}" observed_at="${new Date(node.observedAt).toISOString()}" updated_at="${new Date(node.updatedAt).toISOString()}" age_days="${ageDays}">`,
      `<title>${escapeReference(node.title.slice(0, 140))}</title>`,
      `<content>${escapeReference(node.text.slice(0, contentLimit))}</content>`,
      `<surface_terms>${escapeReference(node.keywords.slice(0, 12).join(", "))}</surface_terms>`,
      "</node>",
    ].join("\n");
  });
  const pairHints = candidates.map((candidate) => `<pair source="${escapeReference(candidate.source)}" target="${escapeReference(candidate.target)}" time_gap_days="${candidate.temporalDistanceDays}" surface_overlap="${escapeReference(candidate.keywordOverlap.join(", ") || "none")}" />`);
  const established = existingEdges
    .filter((edge) => edge.origin !== "ai" && nodeKeys.has(edge.source) && nodeKeys.has(edge.target))
    .slice(0, existingEdgeLimit)
    .map((edge) => `<existing_link source="${escapeReference(edge.source)}" target="${escapeReference(edge.target)}" origin="${escapeReference(edge.origin)}">${escapeReference(edge.reason)}</existing_link>`);
  const text = [
    `<semantic_brain generated_at="${new Date(now).toISOString()}">`,
    "<reading_note>surface_terms are lexical hints only. candidate_pairs are broad review hints, not proven links and not an exclusive list.</reading_note>",
    "<nodes>",
    ...referenceNodes,
    "</nodes>",
    "<candidate_pairs>",
    ...pairHints,
    "</candidate_pairs>",
    "<existing_user_links>",
    ...established,
    "</existing_user_links>",
    "</semantic_brain>",
  ].join("\n");
  return { text, selectedNodes, nodeKeys, candidates };
}

function positionFor(key: string, cluster: string, index: number, total: number): [number, number, number] {
  const clusterAngle = randomFrom(cluster || key, "cluster") * Math.PI * 2;
  const clusterY = (randomFrom(cluster || key, "height") - 0.5) * 8;
  const clusterRadius = 4.2 + randomFrom(cluster || key, "ring") * 4.5;
  const centerX = Math.cos(clusterAngle) * clusterRadius;
  const centerZ = Math.sin(clusterAngle) * clusterRadius;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const localAngle = index * golden + randomFrom(key, "orbit") * Math.PI;
  const spread = 1.4 + Math.sqrt(Math.max(1, total)) * 0.34;
  return [
    centerX + Math.cos(localAngle) * spread * (0.45 + randomFrom(key, "x")),
    clusterY + (randomFrom(key, "y") - 0.5) * spread * 2.1,
    centerZ + Math.sin(localAngle) * spread * (0.45 + randomFrom(key, "z")),
  ];
}

export function buildBrainGraph(input: {
  cards: CardRecord[];
  boards: BoardRecord[];
  fragments: FragmentRecord[];
  tasks: TaskRecord[];
  boardNodes: BoardNodeRecord[];
  tags: TagRecord[];
  storedEdges: BrainEdgeRecord[];
  language?: AppLanguage;
}) {
  const language = input.language || "zh-TW";
  const taskCopy = getTaskIntegrationCopy(language);
  const hierarchyCopy = getTaskHierarchyCopy(language);
  const tagMap = new Map(input.tags.map((tag) => [tag.id, tag.name]));
  const cardMap = new Map(input.cards.map((card) => [card.id, card]));
  const dueDateFormatter = brainDateFormatter(intlLocale[language]);
  const boardText = new Map<string, string[]>();
  for (const node of input.boardNodes) {
    const text = !node.cardId && (node.title || node.text);
    if (text) { const lines = boardText.get(node.boardId) || []; lines.push(text); boardText.set(node.boardId, lines); }
  }
  const drafts: Array<Omit<BrainNodeView, "weight" | "radius" | "position">> = [];

  input.cards.filter((card) => card.state !== "trash" && isMaterializedCard(card)).forEach((card) => {
    const semanticTitle = card.kind === "journal" ? journalBrainTitle(card, language) : card.title;
    const tagText = card.tagIds.map((id) => tagMap.get(id)).filter(Boolean).join(" ");
    const text = `${semanticTitle}\n${card.plainText}\n${tagText}`.trim();
    drafts.push({ key: `card:${card.id}`, type: "card", id: card.id, title: semanticTitle, text: card.plainText, sourceKind: card.kind, keywords: extractKeywords(text, 16, language), createdAt: card.createdAt, observedAt: card.kind === "journal" ? journalObservedAt(card.journalDate, card.createdAt) : card.createdAt, updatedAt: card.updatedAt });
  });
  input.boards.forEach((board) => {
    const tagText = board.tagIds.map((id) => tagMap.get(id)).filter(Boolean).join(" ");
    const looseBoardText = (boardText.get(board.id) || []).join("\n");
    const text = `${board.title}\n${board.description}\n${looseBoardText}\n${tagText}`.trim();
    drafts.push({ key: `board:${board.id}`, type: "board", id: board.id, title: board.title, text: [board.description, looseBoardText].filter(Boolean).join("\n"), sourceKind: "board", keywords: extractKeywords(text, 16, language), createdAt: board.createdAt, observedAt: board.createdAt, updatedAt: board.updatedAt });
  });
  input.fragments.forEach((fragment) => {
    const tagText = fragment.tagIds.map((id) => tagMap.get(id)).filter(Boolean).join(" ");
    drafts.push({ key: `fragment:${fragment.id}`, type: "fragment", id: fragment.id, title: fragment.text.slice(0, 36), text: fragment.text, sourceKind: "fragment", keywords: extractKeywords(`${fragment.text}\n${tagText}`, 16, language), createdAt: fragment.createdAt, observedAt: fragment.createdAt, updatedAt: fragment.updatedAt });
  });
  input.tasks.forEach((task) => {
    const sourceCard = task.cardId ? cardMap.get(task.cardId) : undefined;
    if (task.cardId && (!sourceCard || sourceCard.state === "trash")) return;
    const tagText = sourceCard?.tagIds.map((id) => tagMap.get(id)).filter(Boolean).join(" ") || "";
    const due = task.dueAt ? dueDateFormatter.format(task.dueAt) : "";
    const details = [task.done ? taskCopy.taskDone : taskCopy.taskOpen, sourceCard ? `${taskCopy.source}: ${sourceCard.title}` : "", due ? taskCopyFormat(taskCopy.due, { date: due }) : taskCopy.noDue].filter(Boolean);
    const text = details.join("\n");
    drafts.push({ key: `task:${task.id}`, type: "task", id: task.id, title: task.title, text, sourceKind: "task", keywords: extractKeywords(`${task.title}\n${sourceCard?.title || ""}\n${tagText}`, 16, language), createdAt: task.createdAt, observedAt: task.createdAt, updatedAt: task.updatedAt });
  });

  const frequencies = new Map<string, number>();
  drafts.forEach((draft) => new Set(draft.keywords).forEach((keyword) => frequencies.set(keyword, (frequencies.get(keyword) || 0) + 1)));
  const concepts: BrainConcept[] = [...frequencies.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], intlLocale[language]))
    .slice(0, 24)
    .map(([term, count]) => ({ term, count }));

  const clusterCounts = new Map<string, number>();
  drafts.forEach((draft) => {
    const cluster = draft.keywords.find((keyword) => (frequencies.get(keyword) || 0) >= 2) || draft.type;
    clusterCounts.set(cluster, (clusterCounts.get(cluster) || 0) + 1);
  });
  const clusterIndexes = new Map<string, number>();
  const nodes: BrainNodeView[] = drafts.map((draft) => {
    const repeatedScore = draft.keywords.reduce((sum, keyword) => sum + Math.max(0, (frequencies.get(keyword) || 1) - 1), 0);
    const weight = Math.min(5, 1 + repeatedScore * 0.18 + (draft.type === "fragment" ? 0 : 0.18));
    const cluster = draft.keywords.find((keyword) => (frequencies.get(keyword) || 0) >= 2) || draft.type;
    const clusterIndex = clusterIndexes.get(cluster) || 0;
    clusterIndexes.set(cluster, clusterIndex + 1);
    return {
      ...draft,
      weight,
      radius: Math.min(1.12, 0.34 + Math.sqrt(weight) * 0.2),
      position: positionFor(draft.key, cluster, clusterIndex, clusterCounts.get(cluster) || 1),
    };
  });

  const nodeKeys = new Set(nodes.map((node) => node.key));
  const edges: BrainEdgeView[] = input.storedEdges
    .map((edge) => ({
      id: edge.id,
      source: `${edge.sourceType}:${edge.sourceId}`,
      target: `${edge.targetType}:${edge.targetId}`,
      origin: edge.origin,
      reason: edge.reason || (edge.origin === "manual" ? translate(language, "brain.manualReason") : translate(language, "brain.aiPossible")),
      confidence: edge.confidence,
      relationType: edge.relationType,
      evidence: edge.evidence,
      temporalDistanceDays: edge.temporalDistanceDays,
      persisted: true,
    }))
    .filter((edge) => nodeKeys.has(edge.source) && nodeKeys.has(edge.target));

  const structureKeys = new Set(edges.map((edge) => [edge.source, edge.target].sort().join("|")));
  input.boardNodes.filter((node) => node.cardId).forEach((boardNode) => {
    const source = `board:${boardNode.boardId}`;
    const target = `card:${boardNode.cardId}`;
    const pair = [source, target].sort().join("|");
    if (!nodeKeys.has(source) || !nodeKeys.has(target) || structureKeys.has(pair)) return;
    structureKeys.add(pair);
    edges.push({ id: `structure:${boardNode.id}`, source, target, origin: "structure", reason: translate(language, "brain.cardOnBoard"), persisted: false });
  });
  input.tasks.filter((task) => task.parentTaskId).forEach((task) => {
    const source = `task:${task.parentTaskId}`;
    const target = `task:${task.id}`;
    const pair = [source, target].sort().join("|");
    if (!nodeKeys.has(source) || !nodeKeys.has(target) || structureKeys.has(pair)) return;
    structureKeys.add(pair);
    edges.push({ id: `structure:task:${task.id}`, source, target, origin: "structure", reason: hierarchyCopy.subtask, persisted: false });
  });

  return { nodes, edges, concepts };
}

function closeOpenJson(value: string) {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const character of value) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{" || character === "[") stack.push(character);
    else if ((character === "}" && stack.at(-1) === "{") || (character === "]" && stack.at(-1) === "[")) stack.pop();
  }
  return `${value}${inString ? '"' : ""}${stack.reverse().map((character) => character === "{" ? "}" : "]").join("")}`;
}

function malformedConnectionObjects(value: string) {
  const keyIndex = value.search(/["']connections["']\s*:/i);
  const arrayStart = keyIndex >= 0 ? value.indexOf("[", keyIndex) : value.indexOf("[");
  if (arrayStart < 0) return [];
  const objects: Record<string, unknown>[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = arrayStart + 1; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === "{") { if (depth === 0) start = index; depth += 1; }
    else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try { objects.push(JSON.parse(value.slice(start, index + 1))); } catch { /* Ignore only the malformed item and keep complete neighbours. */ }
        start = -1;
      }
    }
  }
  return objects;
}

function parseConnectionPayload(raw: string) {
  const codeFence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = (codeFence || raw).trim();
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  const candidate = start >= 0 ? source.slice(start, end >= start ? end + 1 : undefined) : source;
  const repaired = candidate.replace(/}\s*{/g, "},{").replace(/,\s*([}\]])/g, "$1");
  for (const attempt of [candidate, repaired, closeOpenJson(repaired)]) {
    try {
      const parsed = JSON.parse(attempt);
      if (Array.isArray(parsed)) return { connections: parsed };
      for (const key of ["connections", "links", "relations", "edges"]) if (Array.isArray(parsed?.[key])) return { connections: parsed[key] };
      for (const container of [parsed?.data, parsed?.result, parsed?.output]) {
        for (const key of ["connections", "links", "relations", "edges"]) if (Array.isArray(container?.[key])) return { connections: container[key] };
      }
    } catch { /* Try the next conservative repair. */ }
  }
  const recovered = malformedConnectionObjects(source);
  if (recovered.length) return { connections: recovered };
  throw new Error("invalid-ai-connection-json");
}

export function parseAIConnections(raw: string, validKeys: Set<string>, language: AppLanguage = "zh-TW"): ParsedAIConnection[] {
  const parsed = parseConnectionPayload(raw);
  const values = Array.isArray(parsed?.connections) ? parsed.connections : [];
  const seen = new Set<string>();
  return values.slice(0, 36).flatMap((item: Record<string, unknown>) => {
    const resolveKey = (value: unknown) => {
      const raw = value && typeof value === "object"
        ? (value as Record<string, unknown>).key || (value as Record<string, unknown>).id || (value as Record<string, unknown>).nodeId || (value as Record<string, unknown>).node_id
        : value;
      const key = String(raw || "").trim();
      if (validKeys.has(key)) return key;
      const matches = [...validKeys].filter((candidate) => candidate.endsWith(`:${key}`));
      return matches.length === 1 ? matches[0] : key;
    };
    const source = resolveKey(item.source || item.from || item.sourceId || item.source_id || item.sourceKey || item.source_key || item.fromId || item.from_id);
    const target = resolveKey(item.target || item.to || item.targetId || item.target_id || item.targetKey || item.target_key || item.toId || item.to_id);
    const pair = [source, target].sort().join("|");
    if (!validKeys.has(source) || !validKeys.has(target) || source === target || seen.has(pair)) return [];
    seen.add(pair);
    const confidenceValue = item.confidence ?? item.score ?? item.probability;
    const rawConfidence = typeof confidenceValue === "string" ? Number.parseFloat(confidenceValue.replace("%", "")) : Number(confidenceValue);
    const confidence = rawConfidence > 1 && rawConfidence <= 100 ? rawConfidence / 100 : rawConfidence;
    const relation = String(item.relationType || item.relation_type || item.type || "").toLowerCase();
    const relationAliases: Record<string, BrainRelationType> = {
      related: "semantic", related_to: "semantic", semantic_relation: "semantic", similarity: "semantic", similar: "semantic",
      same_context: "shared_context", common_context: "shared_context", shared_theme: "shared_context",
      influences: "possible_influence", influence: "possible_influence", causal: "possible_influence", causes: "possible_influence",
      leads_to: "sequence", continuation: "sequence", precedes: "sequence", follows: "sequence",
      obstacle: "goal_obstacle", obstacle_to: "goal_obstacle", supports: "reinforcement", reinforces: "reinforcement",
      contradicts: "contrast", contradiction: "contrast", conflict: "contrast", tension: "contrast",
    };
    const relationType = AI_RELATION_TYPES.has(relation as BrainRelationType) ? relation as BrainRelationType : relationAliases[relation] || "semantic";
    const evidenceValue = item.evidence;
    const evidenceCandidates = Array.isArray(evidenceValue) ? evidenceValue
      : evidenceValue && typeof evidenceValue === "object" ? Object.values(evidenceValue)
        : [item.sourceEvidence, item.source_evidence, item.evidenceSource, item.evidence_source, item.sourceQuote, item.source_quote,
          item.targetEvidence, item.target_evidence, item.evidenceTarget, item.evidence_target, item.targetQuote, item.target_quote];
    const evidence = evidenceCandidates
      .filter((value) => value !== undefined && value !== null)
      .map((value) => String(value).trim().slice(0, 160))
      .filter(Boolean)
      .slice(0, 3);
    return [{
      source,
      target,
      reason: String(item.reason || item.explanation || item.rationale || item.description || translate(language, "brain.possibleShared")).slice(0, 180),
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.65,
      relationType,
      evidence,
    }];
  });
}

export function splitBrainKey(key: string): { type: BrainContentType; id: string } {
  const separator = key.indexOf(":");
  return { type: key.slice(0, separator) as BrainContentType, id: key.slice(separator + 1) };
}
