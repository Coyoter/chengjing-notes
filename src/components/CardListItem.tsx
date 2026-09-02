import { Calendar, ExternalLink, FileText, MoreHorizontal, Pin } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useAppStore } from "../store";
import type { CardRecord } from "../types";
import { localizedKindLabel, relativeTime, truncate } from "../lib/utils";
import { showContextMenuFromButton, showContextMenuFromPointer } from "../lib/contextMenu";
import { useI18n } from "../hooks/useI18n";

export function CardListItem({ card, compact = false }: { card: CardRecord; compact?: boolean }) {
  const tags = useLiveQuery(async () => {
    const values = await Promise.all(card.tagIds.map((id) => db.tags.get(id)));
    return values.filter(Boolean);
  }, [card.tagIds.join("|")], []);
  const openCard = useAppStore((state) => state.openCard);
  const { language, t } = useI18n();

  return (
    <article className={`card-list-item ${compact ? "is-compact" : ""}`} onClick={() => openCard(card.id)} onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "card", id: card.id })}>
      <div className="card-kind-mark">
        {card.kind === "web" ? <ExternalLink size={15} /> : card.kind === "journal" ? <Calendar size={15} /> : <FileText size={15} />}
      </div>
      <div className="card-list-content">
        <div className="card-list-heading">
          <h3>{card.title}</h3>
          {card.favorite && <Pin size={13} fill="currentColor" />}
        </div>
        {!compact && <p>{truncate(card.plainText, 160) || t("common.noContent")}</p>}
        <footer>
          <span>{localizedKindLabel(card.kind, language)}</span>
          <span>{relativeTime(card.updatedAt, language)}</span>
          {tags.slice(0, 3).map((tag) => <i key={tag!.id} className={`tone-${tag!.color}`}>{tag!.name}</i>)}
        </footer>
      </div>
      <button type="button" className="bare-button item-more" aria-label={t("library.more", { title: card.title })} onClick={(event) => showContextMenuFromButton(event, { kind: "card", id: card.id })}>
        <MoreHorizontal size={16} />
      </button>
    </article>
  );
}
