import { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircleReply, Waves, X } from "lucide-react";
import { useAppStore } from "../store";
import {
  COMMUNITY_OPEN_NEURON_KEY,
  communityApi,
  getCommunityIdentity,
  type CommunityNotification,
} from "../lib/community";
import { getSharedBrainCopy } from "../lib/sharedBrainCopy";
import { IdentitySeal } from "./IdentitySeal";

const LAST_SEEN_KEY = "chengjing-community-last-seen-v1";
const PENDING_KEY = "chengjing-community-pending-notifications-v1";

function pendingNotifications(): CommunityNotification[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item): item is CommunityNotification => Boolean(item && typeof item === "object" && "id" in item && "neuronId" in item)) : [];
  } catch { return []; }
}

function savePending(items: CommunityNotification[]) {
  try {
    if (items.length) localStorage.setItem(PENDING_KEY, JSON.stringify(items));
    else localStorage.removeItem(PENDING_KEY);
  } catch {}
}

export function CommunityNotificationManager() {
  const language = useAppStore((state) => state.language);
  const setView = useAppStore((state) => state.setView);
  const view = useAppStore((state) => state.view);
  const copy = useMemo(() => getSharedBrainCopy(language), [language]);
  const [items, setItems] = useState<CommunityNotification[]>(() => pendingNotifications());
  const latestAt = useRef(items.reduce((latest, item) => Math.max(latest, item.createdAt), 0));

  useEffect(() => {
    const identity = getCommunityIdentity();
    if (!identity) return;
    const since = Number(localStorage.getItem(LAST_SEEN_KEY) || 0);
    let active = true;
    void communityApi.notifications(identity, since).then((result) => {
      if (!active || result.items.length === 0) return;
      setItems((current) => {
        const map = new Map([...current, ...result.items].map((item) => [item.id, item]));
        const next = [...map.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 30);
        latestAt.current = next.reduce((latest, item) => Math.max(latest, item.createdAt), latestAt.current);
        savePending(next);
        return next;
      });
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  if (!items.length) return null;
  const visible = items.slice(0, 3);

  function settle(next: CommunityNotification[]) {
    setItems(next);
    savePending(next);
    if (!next.length && latestAt.current) localStorage.setItem(LAST_SEEN_KEY, String(latestAt.current));
  }

  function open(item: CommunityNotification) {
    const next = items.filter((candidate) => candidate.id !== item.id);
    settle(next);
    localStorage.setItem(COMMUNITY_OPEN_NEURON_KEY, item.neuronId);
    if (view === "brain") {
      localStorage.removeItem(COMMUNITY_OPEN_NEURON_KEY);
      window.dispatchEvent(new CustomEvent("chengjing-open-shared-neuron", { detail: item.neuronId }));
    } else setView("brain");
  }

  return (
    <aside className="community-notifications" aria-live="polite">
      <header><span><Waves size={15} />{copy.notificationTitle}</span><button type="button" onClick={() => settle([])} aria-label={copy.notificationDismiss}><X size={15} /></button></header>
      <div>{visible.map((item) => <button type="button" key={item.id} onClick={() => open(item)}><IdentitySeal color={item.seal} pattern={item.authorPattern} size="tiny" /><span><small>{item.authorName} · {item.neuronTitle}</small><b>{item.body}</b><em><MessageCircleReply size={12} />{copy.notificationOpen}</em></span></button>)}</div>
      {items.length > visible.length && <footer><span>{copy.notificationMore(items.length - visible.length)}</span><button type="button" onClick={() => settle([])}>{copy.notificationDismiss}</button></footer>}
    </aside>
  );
}
