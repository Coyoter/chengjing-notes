import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useI18n } from "../hooks/useI18n";
import { getKnowledgeCopy } from "../lib/knowledgeCopy";

export function KnowledgeGroupPicker({ value, onChange, className = "" }: { value?: string; onChange: (value?: string) => void; className?: string }) {
  const groups = useLiveQuery(() => db.knowledgeGroups.orderBy("order").toArray(), [], []);
  const { language } = useI18n();
  const copy = getKnowledgeCopy(language);
  const areas = groups.filter((group) => group.kind === "area");
  const topics = groups.filter((group) => group.kind === "topic");
  return <label className={`knowledge-group-picker ${className}`.trim()}><span>{copy.chooseTopic}</span><select value={value || ""} onChange={(event) => onChange(event.target.value || undefined)}><option value="">{copy.noTopic}</option>{areas.map((area) => <optgroup key={area.id} label={area.name}>{topics.filter((topic) => topic.parentId === area.id).map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</optgroup>)}{topics.filter((topic) => !topic.parentId).map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></label>;
}
