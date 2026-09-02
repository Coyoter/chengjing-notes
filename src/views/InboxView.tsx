import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, Inbox, Plus } from "lucide-react";
import { createCard, db } from "../db";
import { useAppStore } from "../store";
import { CardListItem } from "../components/CardListItem";
import { useI18n } from "../hooks/useI18n";

export function InboxView() {
  const [tab, setTab] = useState<"pending" | "done">("pending");
  const cards = useLiveQuery(
    () => db.cards.where("state").equals(tab === "pending" ? "inbox" : "active").reverse().sortBy("updatedAt"),
    [tab],
    [],
  );
  const openCard = useAppStore((state) => state.openCard);
  const { t } = useI18n();

  async function quickAdd() {
    const card = await createCard({ title: t("inbox.newIdea"), state: "inbox" });
    openCard(card.id);
  }

  return (
    <div className="page-scroll standard-page">
      <header className="page-intro">
        <div><span>{t("inbox.eyebrow")}</span><h2>{t("inbox.title")}</h2><p>{t("inbox.description")}</p></div>
        <button className="primary-button" type="button" onClick={quickAdd}><Plus size={16} />{t("inbox.quickAdd")}</button>
      </header>
      <div className="segmented-control inbox-segments">
        <button type="button" className={tab === "pending" ? "is-active" : ""} onClick={() => setTab("pending")}><Inbox size={15} />{t("inbox.pending")}</button>
        <button type="button" className={tab === "done" ? "is-active" : ""} onClick={() => setTab("done")}><Check size={15} />{t("inbox.organized")}</button>
      </div>
      <section className="surface-panel library-panel inbox-card-panel">
        {cards.length > 0 ? (
          <div className="card-list spacious">
            {cards.map((card) => <CardListItem key={card.id} card={card} />)}
          </div>
        ) : (
          <div className="empty-state"><Inbox size={28} /><h3>{t("inbox.clean")}</h3><p>{tab === "pending" ? t("inbox.pendingEmpty") : t("inbox.doneEmpty")}</p></div>
        )}
      </section>
    </div>
  );
}
