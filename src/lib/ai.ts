import { db } from "../db";
import { useAppStore } from "../store";
import { intlLocale, translate } from "../i18n";
import type { AIEngine, AppLanguage } from "../types";
import { friendlyErrorMessage, localizedKindLabel, truncate } from "./utils";
import { generateLocalChat } from "./localGemma";
import type { AIMessage, AIResponse } from "./modelTypes";
import { searchQueryTerms } from "./searchIndex";
import { isMaterializedCard } from "./journalVisibility";

function currentLanguage(): AppLanguage {
  return useAppStore.getState().language || "zh-TW";
}

export function isUnsupportedResponseFormat(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /unsupported|not supported|does not support|不支援|不支持/i.test(message)
    && /response[_ .-]?format|text\.format|json_schema|json_object|structured(?:\s+output)?/i.test(message);
}

export async function searchSpace(query: string, limit = 8, language = currentLanguage()) {
  const locale = intlLocale[language];
  const terms = searchQueryTerms(query, language);
  if (!terms.length) return [];
  const cards = await db.cards.where("searchTerms").anyOf(terms).distinct().limit(500).toArray();
  return cards
    .map((card) => {
      const haystack = `${card.title} ${card.plainText}`.toLocaleLowerCase(locale);
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? (card.title.toLocaleLowerCase(locale).includes(term) ? 4 : 1) : 0), 0);
      return { card, score };
    })
    .filter((entry) => entry.score > 0 && entry.card.state !== "trash" && isMaterializedCard(entry.card))
    .sort((a, b) => b.score - a.score || b.card.updatedAt - a.card.updatedAt)
    .slice(0, limit)
    .map((entry) => entry.card);
}

export async function contextForCard(cardId: string) {
  const language = currentLanguage();
  const card = await db.cards.get(cardId);
  if (!card) return "";
  const boardNodes = await db.boardNodes.where("cardId").equals(cardId).toArray();
  const boards = (await Promise.all(boardNodes.map((node) => db.boards.get(node.boardId)))).filter(Boolean);
  return `${translate(language, "ai.cardContext")}: ${card.title}\n${translate(language, "ai.typeContext")}: ${localizedKindLabel(card.kind, language)}\n${translate(language, "ai.boardsContext")}: ${boards.map((board) => board!.title).join(", ") || translate(language, "ai.noneContext")}\n${translate(language, "ai.contentContext")}:\n${truncate(card.plainText, 12_000)}`;
}

export async function contextForBoard(boardId: string) {
  const language = currentLanguage();
  const board = await db.boards.get(boardId);
  if (!board) return "";
  const nodes = await db.boardNodes.where("boardId").equals(boardId).toArray();
  const cards = (await Promise.all(nodes.filter((node) => node.cardId).map((node) => db.cards.get(node.cardId!)))).filter((card) => card && card.state !== "trash");
  const edges = await db.boardEdges.where("boardId").equals(boardId).toArray();
  return [
    `${translate(language, "ai.boardContext")}: ${board.title}`,
    board.description ? `${translate(language, "ai.descriptionContext")}: ${board.description}` : "",
    `${translate(language, "ai.cardsContext")}:`,
    ...cards.map((card) => `- ${card!.title}：${truncate(card!.plainText, 1600)}`),
    `${translate(language, "ai.edgesContext")}:`,
    ...edges.map((edge) => `- ${edge.source} → ${edge.target}${edge.label ? `（${edge.label}）` : ""}`),
  ].filter(Boolean).join("\n");
}

export async function buildSpaceContext(query: string) {
  const language = currentLanguage();
  const cards = await searchSpace(query, 8, language);
  return cards.length
    ? `${translate(language, "ai.localResults")}:\n${cards.map((card, index) => `[${index + 1}] ${card.title}\n${truncate(card.plainText, 1800)}`).join("\n\n")}`
    : translate(language, "ai.noLocalResults");
}

export async function runAI(options: {
  engine: AIEngine;
  model: string;
  prompt: string;
  context?: string;
  history?: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: Record<string, unknown>;
  reasoning?: { effort?: "low" | "medium" | "high"; max_tokens?: number; exclude?: boolean };
  onToken?: (text: string) => void;
  onProgress?: (progress: number, file: string) => void;
}): Promise<AIResponse> {
  const language = currentLanguage();
  const messages: AIMessage[] = [
    { role: "system", content: translate(language, "ai.system") },
    ...(options.history || []),
    {
      role: "user",
      content: `${options.context ? `<reference_material label="${translate(language, "ai.referenceOpen")}">\n${options.context}\n</reference_material>\n\n` : ""}${options.prompt}`,
    },
  ];
  if (options.engine === "local-gemma") {
    return generateLocalChat(messages, {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      onToken: options.onToken,
      onProgress: options.onProgress,
    });
  }
  if (!window.chengjing) throw new Error(translate(language, "ai.desktopOnly"));
  const request = {
      model: options.model,
      messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens || 3072,
      responseFormat: options.responseFormat,
      reasoning: options.reasoning,
      routingMode: useAppStore.getState().openRouterRoutingMode,
  };
  const profileId = useAppStore.getState().customProviderId;
  const send = options.engine === "custom-provider"
    ? (payload: typeof request) => window.chengjing!.ai.providerChat({ ...payload, profileId })
    : (payload: typeof request) => window.chengjing!.ai.openRouterChat(payload);
  try {
    return await send(request);
  } catch (error) {
    if (options.responseFormat && isUnsupportedResponseFormat(error)) {
      try {
        return await send({ ...request, responseFormat: undefined });
      } catch (fallbackError) {
        throw new Error(friendlyErrorMessage(fallbackError, translate(language, "ai.openRouterFailed")));
      }
    }
    throw new Error(friendlyErrorMessage(error, translate(language, "ai.openRouterFailed")));
  }
}
