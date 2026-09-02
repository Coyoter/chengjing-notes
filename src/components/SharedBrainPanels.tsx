import { useEffect, useMemo, useState } from "react";
import {
  Check,
  CircleHelp,
  CopyPlus,
  Fingerprint,
  Flag,
  LoaderCircle,
  MessageCircleReply,
  Radio,
  Send,
  ShieldCheck,
  Trash2,
  Waves,
  X,
} from "lucide-react";
import { useAppStore } from "../store";
import type { BrainNodeView } from "../lib/brain";
import {
  CommunityApiError,
  communityApi,
  type CommunityIdentity,
  type CommunityReport,
  type CommunityReportReason,
  type SharedIntention,
  type SharedNeuronDetail,
} from "../lib/community";
import { getSharedBrainCopy } from "../lib/sharedBrainCopy";
import { getWishAdminSession, setWishAdminSession, wishPoolApi } from "../lib/wishPool";
import { IdentitySeal } from "./IdentitySeal";

export function ShareNeuronDialog({ node, busy, error, onClose, onConfirm }: {
  node: BrainNodeView | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (intention: SharedIntention) => void;
}) {
  const language = useAppStore((state) => state.language);
  const copy = useMemo(() => getSharedBrainCopy(language), [language]);
  const [intention, setIntention] = useState<SharedIntention>("share");
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => { if (node) { setIntention("share"); setConfirmed(false); } }, [node?.key]);
  if (!node) return null;
  const options = [
    { id: "share" as const, label: copy.intentionShare, note: copy.intentionShareNote, icon: <Radio size={16} /> },
    { id: "perspective" as const, label: copy.intentionPerspective, note: copy.intentionPerspectiveNote, icon: <Waves size={16} /> },
    { id: "help" as const, label: copy.intentionHelp, note: copy.intentionHelpNote, icon: <CircleHelp size={16} /> },
  ];
  return (
    <div className="community-dialog-backdrop" onMouseDown={onClose}>
      <section className="shared-neuron-dialog" role="dialog" aria-modal="true" aria-labelledby="shared-neuron-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><span className="community-dialog-symbol"><Waves size={21} /></span><div><small>{copy.shareNeuron}</small><h2 id="shared-neuron-dialog-title">{copy.shareTitle}</h2><p>{copy.shareDescription}</p></div><button type="button" className="bare-button" onClick={onClose} aria-label={copy.close}><X size={18} /></button></header>
        <section className="shared-neuron-preview"><small>{copy.preview}</small><h3>{node.title}</h3><p>{node.text}</p></section>
        <fieldset className="shared-intention-options"><legend>{copy.intentionTitle}</legend>{options.map((option) => <button type="button" key={option.id} className={intention === option.id ? "is-active" : ""} onClick={() => setIntention(option.id)}>{option.icon}<span><b>{option.label}</b><small>{option.note}</small></span>{intention === option.id && <Check size={15} />}</button>)}</fieldset>
        <label className="shared-irreversible"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span><i><Check size={13} /></i>{copy.irreversible}</span></label>
        {error && <p className="community-dialog-error" role="alert">{error}</p>}
        <footer><button type="button" onClick={onClose}>{copy.cancel}</button><button type="button" className="primary-button" disabled={!confirmed || busy} onClick={() => onConfirm(intention)}>{busy ? <LoaderCircle size={15} className="spin" /> : <Waves size={15} />}{busy ? copy.sharing : copy.confirmShare}</button></footer>
      </section>
    </div>
  );
}

export function DeleteSharedNeuronDialog({ node, busy, onClose, onConfirm }: { node: BrainNodeView | null; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const language = useAppStore((state) => state.language);
  const copy = useMemo(() => getSharedBrainCopy(language), [language]);
  if (!node) return null;
  return <div className="community-dialog-backdrop" onMouseDown={onClose}><section className="community-delete-dialog" role="alertdialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><header><span className="community-dialog-symbol is-danger"><Trash2 size={20} /></span><div><small>{copy.deleteShared}</small><h2>{copy.deleteTitle}</h2><p>{copy.deleteDescription}</p></div><button type="button" className="bare-button" onClick={onClose}><X size={18} /></button></header><blockquote>{node.title}</blockquote><footer><button type="button" onClick={onClose}>{copy.cancel}</button><button type="button" className="danger-button" disabled={busy} onClick={onConfirm}>{busy && <LoaderCircle size={14} className="spin" />}{copy.confirmDelete}</button></footer></section></div>;
}

export function SharedNeuronInspector({ detail, loading, error, identity, adminToken, busyAction, onClose, onFork, onReport, onComment, onLoadMore, onDeleteComment }: {
  detail: SharedNeuronDetail | null;
  loading: boolean;
  error: string;
  identity: CommunityIdentity | null;
  adminToken: string;
  busyAction: string;
  onClose: () => void;
  onFork: () => void;
  onReport: (targetType: "neuron" | "comment", targetId: string) => void;
  onComment: (body: string) => void;
  onLoadMore: () => void;
  onDeleteComment: (id: string) => void;
}) {
  const language = useAppStore((state) => state.language);
  const copy = useMemo(() => getSharedBrainCopy(language), [language]);
  const [body, setBody] = useState("");
  useEffect(() => setBody(""), [detail?.id]);
  return (
    <aside className="shared-neuron-inspector" aria-label={copy.remoteType}>
      <button type="button" className="bare-button shared-neuron-close" onClick={onClose} aria-label={copy.close}><X size={17} /></button>
      {loading && <div className="shared-neuron-loading"><LoaderCircle size={21} className="spin" /><span>{copy.loading}</span></div>}
      {!loading && error && <div className="shared-neuron-loading is-error"><Waves size={21} /><span>{error}</span></div>}
      {detail && <>
        <header><small>{copy.remoteType}</small><div className="shared-author"><IdentitySeal color={detail.seal} pattern={detail.authorPattern} size="medium" /><span><b>{detail.authorName}</b><em>{detail.isOwn ? copy.author : copy.sharedBy}</em></span></div><h2>{detail.title}</h2><div className={`shared-intention intention-${detail.intention}`}>{detail.intention === "help" ? <CircleHelp size={13} /> : detail.intention === "perspective" ? <Waves size={13} /> : <Radio size={13} />}{detail.intention === "help" ? copy.intentionHelp : detail.intention === "perspective" ? copy.intentionPerspective : copy.intentionShare}</div></header>
        <div className="shared-neuron-body"><p>{detail.body}</p>{detail.originNeuronId && <span><CopyPlus size={13} />{copy.forkOrigin}</span>}</div>
        {!detail.isOwn && <div className="shared-neuron-primary-actions"><button type="button" className="primary-button" disabled={Boolean(busyAction)} onClick={onFork}>{busyAction === "fork" ? <LoaderCircle size={15} className="spin" /> : <CopyPlus size={15} />}{busyAction === "fork" ? copy.forking : copy.fork}</button><button type="button" onClick={() => onReport("neuron", detail.id)}><Flag size={14} />{copy.report}</button></div>}
        <section className="shared-echoes"><header><span><MessageCircleReply size={14} />{copy.comments}</span><b>{detail.commentCount}</b></header>
          {detail.commentCursor && <button type="button" className="shared-load-comments" disabled={busyAction === "comments"} onClick={onLoadMore}>{busyAction === "comments" && <LoaderCircle size={13} className="spin" />}{copy.loadMoreComments}</button>}
          {detail.comments.length === 0 ? <p className="shared-no-comments">{copy.noComments}</p> : <div className="shared-comment-list">{detail.comments.map((comment) => <article key={comment.id}><header><IdentitySeal color={comment.seal} pattern={comment.authorPattern} size="tiny" /><b>{comment.authorName}</b>{comment.isAuthor && <em>{copy.author}</em>}{comment.isAdmin && <em className="is-admin"><ShieldCheck size={11} />{copy.administrator}</em>}<time>{new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(comment.createdAt)}</time></header><p>{comment.body}</p><footer>{!comment.isAdmin && !comment.isAuthor && <button type="button" onClick={() => onReport("comment", comment.id)}><Flag size={12} />{copy.report}</button>}{(adminToken || comment.isOwn) && <button type="button" className="is-danger" onClick={() => onDeleteComment(comment.id)}><Trash2 size={12} /></button>}</footer></article>)}</div>}
          <form className={`shared-comment-composer ${adminToken ? "is-admin" : ""}`} onSubmit={(event) => { event.preventDefault(); if (body.trim().length >= 2) { onComment(body.trim()); setBody(""); } }}><textarea value={body} maxLength={800} onChange={(event) => setBody(event.target.value)} placeholder={adminToken ? `${copy.administrator}：${copy.commentPlaceholder}` : copy.commentPlaceholder} /><footer><span>{Array.from(body).length}/800</span><button type="submit" disabled={body.trim().length < 2 || busyAction === "comment"}>{busyAction === "comment" ? <LoaderCircle size={14} className="spin" /> : <Send size={14} />}{copy.sendComment}</button></footer></form>
        </section>
      </>}
    </aside>
  );
}

export function CommunityReportDialog({ target, identity, onClose, onDone }: {
  target: { targetType: "neuron" | "comment"; targetId: string } | null;
  identity: CommunityIdentity | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const language = useAppStore((state) => state.language);
  const copy = useMemo(() => getSharedBrainCopy(language), [language]);
  const [reason, setReason] = useState<CommunityReportReason>("harmful");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (target) { setReason("harmful"); setDetail(""); setError(""); } }, [target?.targetId]);
  if (!target || !identity) return null;
  const readyIdentity = identity;
  const readyTarget = target;
  const reasons: Array<[CommunityReportReason, string]> = [["harmful", copy.reportHarmful], ["privacy", copy.reportPrivacy], ["spam", copy.reportSpam], ["other", copy.reportOther]];
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await communityApi.report(readyIdentity, { ...readyTarget, reason, detail }); onDone(copy.reported); onClose(); }
    catch (cause) { const apiError = cause instanceof CommunityApiError ? cause : new CommunityApiError("request-failed", 0); setError(copy.errors[apiError.code] || copy.error); }
    finally { setBusy(false); }
  }
  return <div className="community-dialog-backdrop" onMouseDown={onClose}><form className="community-report-dialog" role="dialog" aria-modal="true" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><header><span className="community-dialog-symbol"><Flag size={20} /></span><div><small>{copy.report}</small><h2>{copy.reportTitle}</h2><p>{copy.reportDescription}</p></div><button type="button" className="bare-button" onClick={onClose}><X size={18} /></button></header><div className="community-report-reasons">{reasons.map(([id, label]) => <label className={reason === id ? "is-active" : ""} key={id}><input type="radio" name="report-reason" checked={reason === id} onChange={() => setReason(id)} /><span>{label}</span><Check size={14} /></label>)}</div><textarea value={detail} maxLength={500} onChange={(event) => setDetail(event.target.value)} placeholder={copy.reportDetail} />{error && <p className="community-dialog-error">{error}</p>}<footer><button type="button" onClick={onClose}>{copy.cancel}</button><button type="submit" className="primary-button" disabled={busy}>{busy && <LoaderCircle size={14} className="spin" />}{copy.reportSubmit}</button></footer></form></div>;
}

export function CommunityModerationDialog({ open, onClose, onToken }: { open: boolean; onClose: () => void; onToken: (token: string) => void }) {
  const language = useAppStore((state) => state.language);
  const copy = useMemo(() => getSharedBrainCopy(language), [language]);
  const [token, setToken] = useState(() => getWishAdminSession());
  const [password, setPassword] = useState("");
  const [reports, setReports] = useState<CommunityReport[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open || !token) return;
    setBusy(true); setError("");
    void communityApi.reports(token).then((result) => setReports(result.items)).catch(() => { setToken(""); setWishAdminSession(""); }).finally(() => setBusy(false));
  }, [open, token]);
  if (!open) return null;
  async function login(event: React.FormEvent) {
    event.preventDefault(); if (!password) return; setBusy(true); setError("");
    try { const session = await wishPoolApi.login(password); setToken(session.token); setWishAdminSession(session.token); onToken(session.token); setPassword(""); }
    catch { setError(copy.error); } finally { setBusy(false); }
  }
  async function dismiss(id: string) { if (!token) return; await communityApi.dismissReport(token, id); setReports((items) => items.filter((item) => item.id !== id)); }
  async function remove(report: CommunityReport) {
    if (!token) return;
    if (report.targetType === "neuron") await communityApi.deleteNeuron(report.targetId, null, token);
    else await communityApi.deleteComment(report.targetId, null, token);
    setReports((items) => items.filter((item) => item.id !== report.id));
  }
  return <div className="community-dialog-backdrop" onMouseDown={onClose}><section className="community-moderation-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><header><span className="community-dialog-symbol"><ShieldCheck size={20} /></span><div><small>{copy.adminTools}</small><h2>{copy.adminReports}</h2></div><button type="button" className="bare-button" onClick={onClose}><X size={18} /></button></header>{!token ? <form className="community-admin-login" onSubmit={login}><input type="password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} placeholder="管理員密碼" /><button type="submit" className="primary-button" disabled={!password || busy}>{busy && <LoaderCircle size={14} className="spin" />}登入</button>{error && <p>{error}</p>}</form> : <div className="community-report-queue">{busy && <div className="shared-neuron-loading"><LoaderCircle size={18} className="spin" />{copy.loading}</div>}{!busy && reports.length === 0 && <p className="community-admin-empty">{copy.adminEmpty}</p>}{reports.map((report) => <article key={report.id}><header><Flag size={14} /><b>{report.targetTitle}</b><time>{new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(report.createdAt)}</time></header><small>{report.reporterName} · {report.reason}</small><p>{report.targetExcerpt}</p>{report.detail && <blockquote>{report.detail}</blockquote>}<footer><button type="button" onClick={() => void dismiss(report.id)}>{copy.dismiss}</button><button type="button" className="is-danger" onClick={() => void remove(report)}><Trash2 size={13} />{copy.removeTarget}</button></footer></article>)}</div>}</section></div>;
}
