import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, X } from "lucide-react";
import { createTag, db } from "../db";
import { useI18n } from "../hooks/useI18n";

interface TagPickerProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void | Promise<unknown>;
  className?: string;
  maxVisible?: number;
}

export function TagPicker({ selectedIds, onChange, className = "", maxVisible = Number.POSITIVE_INFINITY }: TagPickerProps) {
  const tags = useLiveQuery(() => db.tags.orderBy("name").toArray(), [], []);
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const composing = useRef(false);
  const saving = useRef(false);
  const skipBlur = useRef(false);
  const root = useRef<HTMLDivElement>(null);

  const selected = tags.filter((tag) => selectedIds.includes(tag.id));
  const available = tags.filter((tag) => !selectedIds.includes(tag.id));

  async function commitNewTag(value = draft) {
    const name = value.trim();
    if (!name || saving.current) {
      setCreating(false);
      setDraft("");
      return;
    }
    saving.current = true;
    try {
      const tag = await createTag(name);
      await onChange([...new Set([...selectedIds, tag.id])]);
      setDraft("");
      setCreating(false);
      setOpen(false);
    } finally {
      saving.current = false;
    }
  }

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (root.current?.contains(event.target as Node)) return;
      if (creating && draft.trim()) void commitNewTag(draft);
      else { setOpen(false); setCreating(false); setDraft(""); }
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [creating, draft, open, selectedIds]);

  return (
    <div ref={root} className={`tag-strip shared-tag-picker ${className}`.trim()} data-tag-picker>
      {selected.slice(0, maxVisible).map((tag) => <button type="button" key={tag.id} className={`tone-${tag.color}`} title={`${t("common.remove")} ${tag.name}`} onClick={() => void onChange(selectedIds.filter((id) => id !== tag.id))}><i className={`tone-${tag.color}`} />{tag.name}<X size={11} /></button>)}
      {selected.length > maxVisible && <span className="tag-overflow-count">+{selected.length - maxVisible}</span>}
      <div className="tag-picker-wrap">
        <button type="button" className="add-tag" aria-expanded={open} onClick={() => { setOpen(!open); setCreating(false); setDraft(""); }}><Plus size={12} />{t("tags.add")}</button>
        {open && <div className="tag-picker" role="listbox">
          <div className="tag-picker-options">
            {available.map((tag) => <button type="button" key={tag.id} onClick={async () => { await onChange([...selectedIds, tag.id]); setOpen(false); }}><i className={`tone-${tag.color}`} />{tag.name}</button>)}
            {available.length === 0 && <p>{t("tags.empty")}</p>}
          </div>
          <i className="tag-picker-separator" />
          {creating ? <form className="tag-create-form" onSubmit={(event) => { event.preventDefault(); if (!composing.current) void commitNewTag(); }}>
            <input
              autoFocus
              value={draft}
              aria-label={t("tags.inputLabel")}
              placeholder={t("tags.placeholder")}
              onChange={(event) => setDraft(event.target.value)}
              onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={(event) => { composing.current = false; setDraft(event.currentTarget.value); }}
              onBlur={() => { if (skipBlur.current) { skipBlur.current = false; return; } if (!composing.current) void commitNewTag(); }}
              onKeyDown={(event) => {
                if (event.key === "Escape") { event.preventDefault(); skipBlur.current = true; setDraft(""); setCreating(false); }
                if (event.key === "Enter" && ((event.nativeEvent as KeyboardEvent).isComposing || composing.current)) event.preventDefault();
              }}
            />
          </form> : <button type="button" className="create-tag-button" onClick={() => setCreating(true)}><Plus size={13} />{t("tags.create")}</button>}
        </div>}
      </div>
    </div>
  );
}
