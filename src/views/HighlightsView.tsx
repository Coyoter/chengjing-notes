import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Highlighter, MessageSquareText, Quote } from "lucide-react";
import { db } from "../db";
import { useAppStore } from "../store";
import { showContextMenuFromPointer } from "../lib/contextMenu";
import { useI18n } from "../hooks/useI18n";

export function HighlightsView() {
  const [visibleLimit, setVisibleLimit] = useState(160);
  const highlights = useLiveQuery(() => db.highlights.orderBy("createdAt").reverse().limit(visibleLimit).toArray(), [visibleLimit], []);
  const totalCount = useLiveQuery(() => db.highlights.count(), [], 0);
  const openCard = useAppStore((state) => state.openCard);
  const cardIds = useMemo(() => [...new Set(highlights.map((item) => item.cardId))], [highlights]);
  const cardMap = useLiveQuery(async () => new Map((await db.cards.bulkGet(cardIds)).filter(Boolean).map((card) => [card!.id, card!])), [cardIds.join("|")], new Map());
  const { language, t } = useI18n();
  const loadMoreLabel = ({ "zh-TW": "顯示更多劃記", "zh-CN": "显示更多划记", en: "Show more highlights", ja: "さらに表示", ko: "더 보기" } as const)[language];

  return (
    <div className="page-scroll standard-page narrow-page">
      <header className="page-intro"><div><span>{t("highlights.eyebrow")}</span><h2>{t("highlights.title")}</h2><p>{t("highlights.description")}</p></div></header>
      <section className="highlight-list">
        {highlights.map((item) => {
          const card = cardMap.get(item.cardId);
          return (
            <button type="button" key={item.id} className="highlight-card" onClick={() => openCard(item.cardId)} onContextMenu={(event) => showContextMenuFromPointer(event, { kind: "highlight", id: item.id })}>
              <Quote size={18} />
              <blockquote>{item.text}</blockquote>
              {item.note && <p><MessageSquareText size={13} />{item.note}</p>}
              <footer><Highlighter size={13} /><span>{card?.title || t("highlights.sourceRemoved")}</span>{item.page && <b>{t("highlights.page", { page: item.page })}</b>}</footer>
            </button>
          );
        })}
        {highlights.length === 0 && <div className="empty-state"><Highlighter size={28} /><h3>{t("highlights.empty")}</h3><p>{t("highlights.emptyDescription")}</p></div>}
        {highlights.length < totalCount && <button type="button" className="content-load-more" onClick={() => setVisibleLimit((value) => value + 160)}>{loadMoreLabel}</button>}
      </section>
    </div>
  );
}
