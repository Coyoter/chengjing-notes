import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Droplets,
  Fingerprint,
  LoaderCircle,
  LogOut,
  MessageCircleReply,
  PawPrint,
  Pencil,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useAppStore } from "../store";
import { intlLocale } from "../i18n";
import { getWishPoolCopy } from "../lib/wishPoolCopy";
import {
  getWishAdminSession,
  setWishAdminSession,
  wishPoolApi,
  WishPoolApiError,
  type WishItem,
  type WishReply,
} from "../lib/wishPool";
import { getCommunityIdentity, type CommunityIdentity } from "../lib/community";
import { CommunityIdentityDialog } from "./CommunityIdentityDialog";
import { getSharedBrainCopy } from "../lib/sharedBrainCopy";
import { IdentitySeal } from "./IdentitySeal";

type DeleteTarget = { kind: "wish" | "reply"; id: string; wishId?: string } | null;

function mergeUniqueReplies(first: WishReply[], second: WishReply[]) {
  const map = new Map<string, WishReply>();
  for (const item of [...first, ...second]) map.set(item.id, item);
  return [...map.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export function WishPoolPanel() {
  const language = useAppStore((state) => state.language);
  const close = useAppStore((state) => state.closeRightPanel);
  const copy = useMemo(() => getWishPoolCopy(language), [language]);
  const sharedCopy = useMemo(() => getSharedBrainCopy(language), [language]);
  const [identity, setIdentity] = useState<CommunityIdentity | null>(() => getCommunityIdentity());
  const [identityOpen, setIdentityOpen] = useState(false);
  const [items, setItems] = useState<WishItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replying, setReplying] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [adminToken, setAdminToken] = useState(() => getWishAdminSession());
  const [isAdmin, setIsAdmin] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [deleting, setDeleting] = useState(false);
  const errors: Readonly<Record<string, string>> = copy.errors;

  const showError = useCallback((reason: unknown) => {
    const apiError = reason instanceof WishPoolApiError ? reason : new WishPoolApiError("request-failed", 0);
    if (apiError.code === "admin-session-expired") {
      setAdminToken(""); setIsAdmin(false); setWishAdminSession(""); setLoginOpen(true);
    }
    setError(errors[apiError.code] || errors.generic || copy.errors.generic);
  }, [copy.errors.generic, errors]);

  const loadWishes = useCallback(async (reset: boolean) => {
    if (reset) setLoading(true); else setLoadingMore(true);
    setError("");
    try {
      const result = await wishPoolApi.list(reset ? "" : nextCursor || "");
      setItems((current) => {
        if (reset) return result.items;
        const existing = new Set(current.map((item) => item.id));
        return [...current, ...result.items.filter((item) => !existing.has(item.id))];
      });
      setNextCursor(result.nextCursor);
      if (reset && items.length > 0) setNotice(copy.refreshed);
    } catch (reason) {
      showError(reason);
    } finally {
      setLoading(false); setLoadingMore(false);
    }
  }, [copy.refreshed, items.length, nextCursor, showError]);

  useEffect(() => { void loadWishes(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const syncIdentity = (event: Event) => setIdentity((event as CustomEvent<CommunityIdentity>).detail);
    window.addEventListener("chengjing-community-identity", syncIdentity);
    return () => window.removeEventListener("chengjing-community-identity", syncIdentity);
  }, []);

  useEffect(() => {
    if (!adminToken) return;
    let active = true;
    void wishPoolApi.status(adminToken).then((result) => {
      if (!active) return;
      setIsAdmin(result.admin);
      if (!result.admin) { setAdminToken(""); setWishAdminSession(""); }
    }).catch(() => {
      if (!active) return;
      setAdminToken(""); setIsAdmin(false); setWishAdminSession("");
    });
    return () => { active = false; };
  }, [adminToken]);

  async function submitWish(event: React.FormEvent) {
    event.preventDefault();
    const value = body.trim();
    if (value.length < 2 || submitting) return;
    if (!identity) { setIdentityOpen(true); return; }
    setSubmitting(true); setError(""); setNotice("");
    try {
      const result = await wishPoolApi.create(identity, value);
      setItems((current) => [result.item, ...current.filter((item) => item.id !== result.item.id)]);
      setBody(""); setNotice(copy.posted);
    } catch (reason) { showError(reason); }
    finally { setSubmitting(false); }
  }

  async function submitReply(event: React.FormEvent, wishId: string) {
    event.preventDefault();
    const value = replyBody.trim();
    if (value.length < 2 || replying) return;
    if (!identity && !isAdmin) { setIdentityOpen(true); return; }
    setReplying(true); setError(""); setNotice("");
    try {
      const result = await wishPoolApi.reply(wishId, isAdmin ? null : identity, value, isAdmin ? adminToken : "");
      setItems((current) => current.map((item) => item.id === wishId
        ? { ...item, replies: mergeUniqueReplies(item.replies, [result.item]), replyCount: item.replyCount + 1 }
        : item));
      setReplyBody(""); setReplyingTo(null); setNotice(copy.replied);
    } catch (reason) { showError(reason); }
    finally { setReplying(false); }
  }

  async function loadOlderReplies(wish: WishItem) {
    if (!wish.replyCursor) return;
    setError("");
    try {
      const result = await wishPoolApi.listReplies(wish.id, wish.replyCursor);
      setItems((current) => current.map((item) => item.id === wish.id
        ? { ...item, replies: mergeUniqueReplies(result.items, item.replies), replyCursor: result.nextCursor }
        : item));
    } catch (reason) { showError(reason); }
  }

  async function login(event: React.FormEvent) {
    event.preventDefault();
    if (!password || loggingIn) return;
    setLoggingIn(true); setError("");
    try {
      const session = await wishPoolApi.login(password);
      setWishAdminSession(session.token); setAdminToken(session.token); setIsAdmin(true); setLoginOpen(false); setPassword(""); setNotice(copy.adminActive);
    } catch (reason) { showError(reason); }
    finally { setLoggingIn(false); }
  }

  function logout() {
    setWishAdminSession(""); setAdminToken(""); setIsAdmin(false); setLoginOpen(false); setDeleteTarget(null);
  }

  async function confirmDelete() {
    if (!deleteTarget || !adminToken || deleting) return;
    setDeleting(true); setError("");
    try {
      if (deleteTarget.kind === "wish") {
        await wishPoolApi.deleteWish(deleteTarget.id, adminToken);
        setItems((current) => current.filter((item) => item.id !== deleteTarget.id));
      } else {
        await wishPoolApi.deleteReply(deleteTarget.id, adminToken);
        setItems((current) => current.map((item) => item.id === deleteTarget.wishId
          ? { ...item, replies: item.replies.filter((reply) => reply.id !== deleteTarget.id), replyCount: Math.max(0, item.replyCount - 1) }
          : item));
      }
      setDeleteTarget(null); setNotice(copy.deleted);
    } catch (reason) { showError(reason); }
    finally { setDeleting(false); }
  }

  function timeLabel(value: number) {
    return new Intl.DateTimeFormat(intlLocale[language], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(value);
  }

  const wishLength = Array.from(body).length;
  const replyLength = Array.from(replyBody).length;

  return (
    <section className="wish-pool-panel" aria-label={copy.title}>
      <header className="panel-header wish-pool-header">
        <div><span>{copy.eyebrow}</span><h2>{copy.title}</h2></div>
        <div className="wish-pool-actions">
          <button type="button" className={isAdmin ? "is-admin" : ""} onClick={() => isAdmin ? logout() : setLoginOpen((value) => !value)} title={isAdmin ? copy.adminLogout : copy.adminLogin} aria-label={isAdmin ? copy.adminLogout : copy.adminLogin}>{isAdmin ? <ShieldCheck size={16} /> : <PawPrint size={16} />}</button>
          <button type="button" onClick={() => void loadWishes(true)} disabled={loading} title={copy.refresh} aria-label={copy.refresh}><RefreshCw size={16} className={loading ? "spin" : ""} /></button>
          <button type="button" onClick={close} title={copy.close} aria-label={copy.close}><X size={18} /></button>
        </div>
      </header>

      {loginOpen && !isAdmin && (
        <form className="wish-admin-login" onSubmit={login}>
          <div><ShieldCheck size={17} /><span><b>{copy.loginTitle}</b><small>{copy.loginDescription}</small></span></div>
          <label><input type="password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} placeholder={copy.password} aria-label={copy.password} /><button type="submit" disabled={!password || loggingIn}>{loggingIn ? copy.loggingIn : copy.login}</button></label>
        </form>
      )}

      <div className="wish-pool-scroll">
        <section className="wish-pool-intro">
          <div className="wish-pool-symbol"><Droplets size={22} /></div>
          <div><p>{copy.description}</p><small>{copy.privacy}</small></div>
        </section>

        <section className="wish-identity-bar">
          {isAdmin ? <PawPrint size={16} /> : <Fingerprint size={16} />}
          <span>{copy.identity}<b>{isAdmin ? copy.admin : identity?.displayName || sharedCopy.identityTitle}</b></span>
          {!isAdmin && <button type="button" onClick={() => setIdentityOpen(true)} title={identity ? sharedCopy.identityRename : sharedCopy.identityTitle} aria-label={identity ? sharedCopy.identityRename : sharedCopy.identityTitle}>{identity ? <Pencil size={15} /> : <Fingerprint size={15} />}</button>}
        </section>

        <form className="wish-composer" onSubmit={submitWish}>
          <textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={800} placeholder={copy.placeholder} aria-label={copy.placeholder} />
          <footer><span>{copy.count.replace("{count}", String(wishLength))}</span><button type="submit" disabled={wishLength < 2 || submitting}>{submitting ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />}{submitting ? copy.submitting : copy.submit}</button></footer>
        </form>

        {(error || notice) && <div className={`wish-pool-notice ${error ? "is-error" : ""}`} role="status" aria-live="polite">{error || notice}</div>}

        <div className="wish-list" aria-busy={loading}>
          {loading && items.length === 0 && <div className="wish-empty"><LoaderCircle size={22} className="spin" /><p>{copy.loading}</p></div>}
          {!loading && items.length === 0 && <div className="wish-empty"><Droplets size={25} /><h3>{copy.empty}</h3><p>{copy.emptyDescription}</p></div>}
          {items.map((wish) => (
            <article className={`wish-item ${wish.isAdmin ? "is-admin" : ""}`} data-wish-id={wish.id} key={wish.id}>
              <header><IdentitySeal color={wish.authorSeal || "#7f8981"} pattern={wish.authorPattern} size="medium" /><div><b>{wish.authorName}</b>{wish.isAdmin && <em>{copy.admin}</em>}<time>{timeLabel(wish.createdAt)}</time></div></header>
              <p>{wish.body}</p>
              <footer>
                <button type="button" onClick={() => { setReplyingTo(wish.id); setReplyBody(""); }}><MessageCircleReply size={14} />{copy.reply}{wish.replyCount > 0 && <span>{wish.replyCount}</span>}</button>
                {isAdmin && <button type="button" className="wish-delete-button" onClick={() => setDeleteTarget({ kind: "wish", id: wish.id })}><Trash2 size={14} />{copy.delete}</button>}
              </footer>

              {wish.replyCursor && <button type="button" className="wish-more-replies" onClick={() => void loadOlderReplies(wish)}>{copy.moreReplies.replace("{count}", String(Math.max(0, wish.replyCount - wish.replies.length)))}</button>}
              {wish.replies.length > 0 && <div className="wish-replies">{wish.replies.map((reply) => (
                <section className={reply.isAdmin ? "is-admin" : ""} key={reply.id}>
                  <header><IdentitySeal color={reply.authorSeal || "#7f8981"} pattern={reply.authorPattern} size="tiny" /><b>{reply.authorName}</b>{reply.isAdmin && <em><ShieldCheck size={12} />{copy.admin}</em>}<time>{timeLabel(reply.createdAt)}</time>{isAdmin && <button type="button" onClick={() => setDeleteTarget({ kind: "reply", id: reply.id, wishId: wish.id })} aria-label={`${copy.delete}：${reply.authorName}`}><Trash2 size={13} /></button>}</header>
                  <p>{reply.body}</p>
                </section>
              ))}</div>}

              {replyingTo === wish.id && <form className={`wish-reply-form ${isAdmin ? "is-admin" : ""}`} onSubmit={(event) => void submitReply(event, wish.id)}><textarea autoFocus value={replyBody} onChange={(event) => setReplyBody(event.target.value)} maxLength={500} placeholder={replyPlaceholder(copy.replyPlaceholder, isAdmin, copy.admin)} aria-label={copy.replyPlaceholder} /><footer><span>{replyLength}/500</span><button type="button" onClick={() => { setReplyingTo(null); setReplyBody(""); }}>{copy.cancelReply}</button><button type="submit" disabled={replyLength < 2 || replying}>{copy.submitReply}</button></footer></form>}

              {deleteTarget?.kind === "wish" && deleteTarget.id === wish.id && <div className="wish-delete-confirm"><span>{copy.deleteWishConfirm}</span><button type="button" onClick={() => setDeleteTarget(null)}>{copy.cancelReply}</button><button type="button" onClick={() => void confirmDelete()} disabled={deleting}>{copy.confirmDelete}</button></div>}
              {deleteTarget?.kind === "reply" && deleteTarget.wishId === wish.id && <div className="wish-delete-confirm"><span>{copy.deleteReplyConfirm}</span><button type="button" onClick={() => setDeleteTarget(null)}>{copy.cancelReply}</button><button type="button" onClick={() => void confirmDelete()} disabled={deleting}>{copy.confirmDelete}</button></div>}
            </article>
          ))}
        </div>

        {nextCursor && <button type="button" className="wish-load-more" onClick={() => void loadWishes(false)} disabled={loadingMore}>{loadingMore && <LoaderCircle size={15} className="spin" />}{loadingMore ? copy.loadingMore : copy.loadMore}</button>}
      </div>
      <CommunityIdentityDialog open={identityOpen} identity={identity} onReady={(next) => { setIdentity(next); setIdentityOpen(false); setNotice(identity ? sharedCopy.identityChanged : sharedCopy.identityReady); }} onClose={() => setIdentityOpen(false)} />
    </section>
  );
}

function replyPlaceholder(placeholder: string, isAdmin: boolean, adminLabel: string) {
  return isAdmin ? `${adminLabel}：${placeholder}` : placeholder;
}
