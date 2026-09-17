import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { db } from "../db";
import { migrateLegacyFragments } from "../lib/captureCards";
import { useI18n } from "../hooks/useI18n";
import { captureCopy } from "../lib/captureCopy";

/** Normalize late legacy sync/import packets, including relations arriving later. */
export function CaptureMigrationManager() {
  const [error, setError] = useState("");
  const { t, language } = useI18n();
  useEffect(() => {
    let active = true;
    let pending = Promise.resolve();
    const subscription = liveQuery(() => Promise.all([
      db.fragments.count(),
      db.brainEdges.filter((edge) => edge.sourceType === "fragment" || edge.targetType === "fragment").count(),
      db.brainShares.filter((share) => share.localType === "fragment").count(),
      db.tasks.filter((task) => Boolean(task.conversionKey?.startsWith("content:fragment:"))).count(),
    ])).subscribe({ next: (counts) => {
      if (!counts.some(Boolean)) return;
      pending = pending.then(async () => { await migrateLegacyFragments(); if (active) setError(""); }).catch((error) => { if (active) setError(String(error)); });
    }, error: (error) => { if (active) setError(String(error)); } });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  return error ? <div role="alert" className="capture-migration-error">{t("context.failed")} <button onClick={() => void migrateLegacyFragments().then(() => setError("")).catch((error) => setError(String(error)))}>{captureCopy(language).retry}</button></div> : null;
}
