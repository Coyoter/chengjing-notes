import { useEffect, useRef, useState } from "react";
import Dexie from "dexie";
import { db } from "../db";
import type { AppLanguage } from "../types";
import type { BrainWorkspace } from "../lib/brainWorkspace";

const empty: BrainWorkspace = { graph: { nodes: [], edges: [], concepts: [] }, tasks: [], hasMore: false, scanned: 0, elapsedMs: 0 };
export function useBrainWorkspace(language: AppLanguage, query: string, page: number) {
  const [data, setData] = useState(empty); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    let worker: Worker | undefined; let timer: ReturnType<typeof setTimeout>;
    const run = () => {
      worker?.terminate(); setLoading(true); setError("");
      worker = new Worker(new URL("../lib/brainWorkspace.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event) => {
        if (event.data.error) setError(event.data.error); else setData(event.data.result);
        setLoading(false);
      };
      worker.onerror = () => { setError("Second Brain could not load. Please reopen this view."); setLoading(false); };
      worker.postMessage({ database: db.name, language, query, page });
    };
    const schedule = () => { setLoading(true); clearTimeout(timer); worker?.terminate(); timer = setTimeout(run, 400); };
    refresh.current = schedule;
    const changes = (parts: Record<string, unknown>) => {
      if (Object.keys(parts).some((key) => /\/(cards|tasks|boards|boardNodes|tags|brainEdges)\//.test(key))) schedule();
    };
    Dexie.on("storagemutated", changes);
    timer = setTimeout(run, query ? 200 : 0);
    return () => { clearTimeout(timer); worker?.terminate(); Dexie.on("storagemutated").unsubscribe(changes); };
  }, [language, query, page]);
  return { ...data, loading, error, refresh: () => refresh.current() };
}
