import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowUp,
  BookOpenText,
  Bot,
  Check,
  Cloud,
  Copy,
  FilePlus2,
  LoaderCircle,
  ListChecks,
  Map,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  WandSparkles,
  X,
} from "lucide-react";
import { createCard, db } from "../db";
import { useI18n } from "../hooks/useI18n";
import { useAppStore } from "../store";
import { buildSpaceContext, contextForBoard, contextForCard, runAI } from "../lib/ai";
import { applyAIActionPlan, buildAIActionContext, looksLikeAIAction, planAIActions, planHasDestructiveActions, type AIActionPlan } from "../lib/aiActions";
import { formatAiActionResult, getAiActionCopy } from "../lib/aiActionCopy";
import type { AIMessage } from "../lib/modelTypes";
import { AIMarkdown } from "./AIMarkdown";
import { renderSafeMarkdown } from "../lib/safeMarkdown";

export function AIPanel() {
  const { language, t } = useI18n();
  const actionCopy = getAiActionCopy(language);
  const close = useAppStore((state) => state.closeRightPanel);
  const selectedCardId = useAppStore((state) => state.selectedCardId);
  const selectedBoardId = useAppStore((state) => state.selectedBoardId);
  const view = useAppStore((state) => state.view);
  const engine = useAppStore((state) => state.aiEngine);
  const model = useAppStore((state) => state.customModel.trim() || state.openRouterModel);
  const temperature = useAppStore((state) => state.temperature);
  const spaceSearch = useAppStore((state) => state.spaceSearch);
  const setSpaceSearch = useAppStore((state) => state.setSpaceSearch);
  const aiDraft = useAppStore((state) => state.aiDraft);
  const setAIDraft = useAppStore((state) => state.setAIDraft);
  const aiActionRequest = useAppStore((state) => state.aiActionRequest);
  const consumeAIActionRequest = useAppStore((state) => state.consumeAIActionRequest);
  const card = useLiveQuery(() => selectedCardId ? db.cards.get(selectedCardId) : undefined, [selectedCardId]);
  const board = useLiveQuery(() => selectedBoardId ? db.boards.get(selectedBoardId) : undefined, [selectedBoardId]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threadReady, setThreadReady] = useState(false);
  const messagesQuery = useLiveQuery(() => threadId ? db.chatMessages.where("threadId").equals(threadId).sortBy("createdAt") : [], [threadId]);
  const messages = messagesQuery || [];
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [modelProgress, setModelProgress] = useState(0);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<AIActionPlan | null>(null);
  const [applyingPlan, setApplyingPlan] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);

  const contextType = selectedCardId ? "card" : view === "boards" && selectedBoardId ? "board" : "space";
  const contextId = selectedCardId || (contextType === "board" ? selectedBoardId : null) || undefined;
  const contextKey = `${contextType}:${contextId || "root"}`;
  const contextLabel = card?.title || (contextType === "board" ? board?.title : t("ai.wholeSpace")) || t("ai.wholeSpace");
  const conversationReady = threadReady && messagesQuery !== undefined;
  const suggestions = useMemo(() => [
    { icon: BookOpenText, label: t("ai.summarize"), prompt: t("ai.summarizePrompt"), action: false },
    { icon: Search, label: t("ai.findLinks"), prompt: t("ai.findLinksPrompt"), action: false },
    { icon: Map, label: t("ai.buildStructure"), prompt: t("ai.buildStructurePrompt"), action: true },
  ], [t]);

  useEffect(() => {
    let active = true;
    setThreadId(null);
    setThreadReady(false);
    setPendingPlan(null);
    setActionMode(false);
    setStreamingText("");
    setError("");
    void db.chatThreads.where("contextType").equals(contextType).filter((thread) => (thread.contextId || undefined) === contextId).sortBy("updatedAt").then((threads) => {
      if (!active) return;
      setThreadId(threads.at(-1)?.id || null);
      setThreadReady(true);
    });
    return () => { active = false; };
  }, [contextId, contextKey, contextType]);

  useEffect(() => {
    if (!aiDraft) return;
    setInput(aiDraft);
    setAIDraft("");
  }, [aiDraft, setAIDraft]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, streamingText, loading]);

  const history = useMemo<AIMessage[]>(() => messages.slice(-10).map((message) => ({ role: message.role, content: message.content })), [messages]);

  async function ensureThread() {
    if (threadId) return threadId;
    const id = crypto.randomUUID();
    const timestamp = Date.now();
    await db.chatThreads.add({ id, title: contextLabel, contextType, contextId, createdAt: timestamp, updatedAt: timestamp });
    setThreadId(id);
    return id;
  }

  async function startNewConversation() {
    if (!conversationReady || loading || applyingPlan) return;
    const id = crypto.randomUUID();
    const timestamp = Date.now();
    await db.chatThreads.add({ id, title: contextLabel, contextType, contextId, createdAt: timestamp, updatedAt: timestamp });
    setThreadId(id);
    setInput("");
    setAIDraft("");
    setError("");
    setStreamingText("");
    setPendingPlan(null);
    setActionMode(false);
  }

  async function send(prompt = input) {
    const clean = prompt.trim();
    if (!clean || loading || !conversationReady) return;
    setInput("");
    setAIDraft("");
    if (actionMode || looksLikeAIAction(clean)) {
      await planChanges(clean);
      return;
    }
    setError("");
    setStreamingText("");
    setModelProgress(0);
    setLoading(true);
    const id = await ensureThread();
    await db.chatMessages.add({ id: crypto.randomUUID(), threadId: id, role: "user", content: clean, createdAt: Date.now() });
    try {
      const explicitContext = contextType === "card" && selectedCardId
        ? await contextForCard(selectedCardId)
        : contextType === "board" && selectedBoardId
          ? await contextForBoard(selectedBoardId)
          : "";
      const searched = spaceSearch ? await buildSpaceContext(clean) : "";
      const context = [explicitContext, searched].filter(Boolean).join("\n\n---\n\n");
      const result = await runAI({
        engine,
        model,
        prompt: clean,
        context,
        history,
        temperature,
        onToken: setStreamingText,
        onProgress: (progress) => setModelProgress(progress),
      });
      await db.chatMessages.add({ id: crypto.randomUUID(), threadId: id, role: "assistant", content: result.text, model: result.model, createdAt: Date.now() });
      await db.chatThreads.update(id, { updatedAt: Date.now() });
      setStreamingText("");
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : t("ai.unavailable"));
    } finally {
      setLoading(false);
    }
  }

  async function planChanges(prompt: string) {
    const clean = prompt.trim();
    if (!clean || loading) return;
    setInput(""); setError(""); setPendingPlan(null); setLoading(true);
    const id = await ensureThread();
    await db.chatMessages.add({ id: crypto.randomUUID(), threadId: id, role: "user", content: clean, createdAt: Date.now() });
    try {
      const context = await buildAIActionContext(contextType, selectedCardId, selectedBoardId, spaceSearch);
      const plan = await planAIActions({ engine, model, prompt: clean, context, temperature: 0.1 });
      if (plan.actions.length === 0) {
        const summary = plan.summary.trim();
        if (!summary || summary === "AI change plan") throw new Error(actionCopy.empty);
        await db.chatMessages.add({ id: crypto.randomUUID(), threadId: id, role: "assistant", content: summary, model: engine === "openrouter" ? model : "Gemma 4 E2B", createdAt: Date.now() });
        await db.chatThreads.update(id, { updatedAt: Date.now() });
        setActionMode(false);
        return;
      }
      setPendingPlan(plan);
      await db.chatMessages.add({ id: crypto.randomUUID(), threadId: id, role: "assistant", content: plan.summary, model: engine === "openrouter" ? model : "Gemma 4 E2B", createdAt: Date.now() });
      await db.chatThreads.update(id, { updatedAt: Date.now() });
    } catch (exception) { setError(exception instanceof Error ? exception.message : actionCopy.failed); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (!aiActionRequest || !conversationReady || loading || applyingPlan) return;
    const request = aiActionRequest;
    consumeAIActionRequest(request.id);
    setActionMode(true);
    void planChanges(request.prompt);
  }, [aiActionRequest, applyingPlan, consumeAIActionRequest, conversationReady, loading]);

  async function applyPlan() {
    if (!pendingPlan || applyingPlan) return;
    setApplyingPlan(true); setError("");
    try {
      const result = await applyAIActionPlan(pendingPlan, { boardId: contextType === "board" ? selectedBoardId : undefined, cardId: contextType === "card" ? selectedCardId : undefined });
      const message = formatAiActionResult(language, result.applied, result.skipped);
      if (threadId) await db.chatMessages.add({ id: crypto.randomUUID(), threadId, role: "assistant", content: message, createdAt: Date.now() });
      setPendingPlan(null); setActionMode(false);
      const createdBoardId = result.createdBoardIds.at(-1);
      if (createdBoardId) {
        useAppStore.getState().openBoard(createdBoardId);
        window.setTimeout(() => window.dispatchEvent(new Event("chengjing:board-fit-after-ai")), 180);
      } else if (contextType === "board") window.dispatchEvent(new Event("chengjing:board-fit-after-ai"));
    } catch (exception) { setError(exception instanceof Error ? exception.message : actionCopy.failed); }
    finally { setApplyingPlan(false); }
  }

  async function saveMessage(content: string) {
    const cardRecord = await createCard({
      title: t("ai.cardTitle", { context: contextLabel }),
      kind: "ai",
      state: "active",
      contentHtml: renderSafeMarkdown(content),
      plainText: content,
      color: "violet",
      properties: { [t("ai.propertyModel")]: engine === "openrouter" ? model : "Gemma 4 E2B", [t("ai.propertyContext")]: contextLabel },
    });
    useAppStore.getState().openCard(cardRecord.id);
  }

  async function copyMessage(id: string, content: string) {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1300);
  }

  return (
    <div className="ai-panel">
      <header className="panel-header ai-panel-header">
        <div><span>{t("ai.brand")}</span><h2>{t("ai.headline")}</h2></div>
        <div className="ai-panel-actions">
          <button type="button" className="icon-button" disabled={!conversationReady || loading || applyingPlan} onClick={() => void startNewConversation()} aria-label={t("ai.newConversation")} title={t("ai.newConversation")}><Plus size={17} /></button>
          <button type="button" className="icon-button" onClick={close} aria-label={t("ai.close")}><X size={18} /></button>
        </div>
      </header>
      <div className="ai-context-bar">
        <div className={contextType === "card" ? "is-card-reference" : undefined}>{contextType === "card" ? <BookOpenText size={14} /> : contextType === "board" ? <Map size={14} /> : <Search size={14} />}{contextType === "card" && <b>{t("ai.referenceLabel")}</b>}<span>{contextType === "card" ? t("ai.referenceTitle", { title: contextLabel }) : contextLabel}</span></div>
        <button type="button" className={`ai-space-search-toggle ${spaceSearch ? "is-active" : ""}`} aria-pressed={spaceSearch} aria-label={spaceSearch ? t("ai.syncLocalDisable") : t("ai.syncLocalEnable")} title={spaceSearch ? t("ai.syncLocalHintOn") : t("ai.syncLocalHintOff")} onClick={() => setSpaceSearch(!spaceSearch)}><Search size={12} /><span>{t("ai.searchOtherCards")}</span></button>
      </div>

      <div className="ai-messages" ref={scrollRef}>
        {conversationReady && messages.length === 0 && !loading && (
          <div className="ai-empty">
            <div className="ai-orb"><Sparkles size={22} /><i /><i /></div>
            <h3>{t("ai.ready", { context: contextLabel })}</h3>
            <p>{t("ai.scope")}</p>
            <div className="ai-suggestions">{suggestions.map((item) => { const Icon = item.icon; return <button type="button" key={item.label} onClick={() => { if (item.action) void planChanges(item.prompt); else void send(item.prompt); }}><Icon size={16} /><span>{item.label}</span></button>; })}</div>
            <div className="skill-row"><span>{t("ai.skills")}</span><button type="button" onClick={() => setInput(t("ai.decomposePrompt"))}>{t("ai.decompose")}</button><button type="button" onClick={() => { setActionMode(true); setInput(t("ai.organizeBoardPrompt")); }}>{t("ai.organizeBoard")}</button></div>
          </div>
        )}
        {messages.map((message) => (
          <article key={message.id} className={`ai-message is-${message.role}`} aria-label={message.role === "user" ? t("ai.you") : undefined}>
            {message.role === "assistant" && <header><Bot size={14} /><span>{message.model || t("ai.brand")}</span></header>}
            {message.role === "assistant" ? <AIMarkdown content={message.content} /> : <div className="ai-message-plain">{message.content.trim()}</div>}
            {message.role === "assistant" && <footer><button type="button" onClick={() => copyMessage(message.id, message.content)}>{copiedId === message.id ? <Check size={13} /> : <Copy size={13} />}{copiedId === message.id ? t("ai.copied") : t("ai.copy")}</button><button type="button" onClick={() => saveMessage(message.content)}><FilePlus2 size={13} />{t("ai.saveCard")}</button></footer>}
          </article>
        ))}
        {loading && (
          <article className="ai-message is-assistant is-loading">
            <header>{engine === "local-gemma" ? <ShieldCheck size={14} /> : <Cloud size={14} />}<span>{engine === "local-gemma" ? "Gemma 4 E2B" : model}</span></header>
            {streamingText ? <div className="ai-message-plain is-streaming">{streamingText}</div> : <div className="thinking-dots"><i /><i /><i /></div>}
            {engine === "local-gemma" && modelProgress > 0 && modelProgress < 100 && <div className="model-loading-line"><i style={{ width: `${modelProgress}%` }} /><span>{t("ai.downloading", { progress: modelProgress.toFixed(1) })}</span></div>}
          </article>
        )}
        {pendingPlan && <section className="ai-action-plan">
          <header><span><ListChecks size={15} />{actionCopy.planTitle}</span>{planHasDestructiveActions(pendingPlan) && <b><TriangleAlert size={13} />{actionCopy.destructive}</b>}</header>
          <p>{pendingPlan.summary}</p>
          <div>{pendingPlan.actions.map((action, index) => <article key={`${action.type}-${index}`} className={action.type.startsWith("delete") ? "is-destructive" : ""} data-action-type={action.type}><i>{action.type.startsWith("create") || action.type === "append_journal" ? actionCopy.actionCreate : action.type.startsWith("delete") ? actionCopy.actionDelete : actionCopy.actionUpdate}</i><span>{action.description}</span></article>)}</div>
          <footer><small>{actionCopy.preview}</small><button type="button" onClick={() => setPendingPlan(null)}>{actionCopy.cancel}</button><button type="button" className="is-apply" disabled={applyingPlan} onClick={() => void applyPlan()}>{applyingPlan ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}{actionCopy.apply(pendingPlan.actions.length)}</button></footer>
        </section>}
        {error && <div className="ai-error" role="alert">{error}<button type="button" onClick={() => setError("")}>{t("common.close")}</button></div>}
      </div>

      <footer className="ai-composer-wrap">
        {contextType === "card" && <div className="ai-prompt-chips" aria-label={t("ai.recommendedPrompts")}><span>{t("ai.recommendedPrompts")}</span><button type="button" onClick={() => setInput(t("card.aiPrompt"))}><Sparkles size={12} />{t("ai.summarizeCard")}</button></div>}
        <div className="ai-composer">
          <textarea value={input} onChange={(event) => setInput(event.target.value)} onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={(event) => { composingRef.current = false; setInput(event.currentTarget.value); }} placeholder={t("ai.placeholder")} onKeyDown={(event) => { if (event.key !== "Enter" || event.shiftKey) return; if (composingRef.current || (event.nativeEvent as KeyboardEvent).isComposing || event.keyCode === 229) return; event.preventDefault(); void send(event.currentTarget.value); }} />
          <div><button type="button" className={actionMode ? "ai-action-mode is-active" : "ai-action-mode"} aria-label={actionCopy.mode} title={actionCopy.modeHint} onClick={() => setActionMode(!actionMode)}><WandSparkles size={15} /><span>{actionCopy.mode}</span></button><span>{engine === "openrouter" ? <><Cloud size={12} />{t("ai.cloudPrivacy", { model })}</> : <><ShieldCheck size={12} />{t("ai.localPrivacy")}</>}</span><button type="button" className="send-button" disabled={!input.trim() || loading || !conversationReady} onClick={() => void send(input)} aria-label={t("ai.send")}><ArrowUp size={16} /></button></div>
        </div>
        <p>{t("ai.disclaimer")}</p>
      </footer>
    </div>
  );
}
