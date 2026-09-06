import { useEffect, useRef, useState } from "react";
import { BrainCircuit, CalendarDays, Columns3, Database, Feather, FileStack, Highlighter, ListTodo, LayoutGrid, Menu, Search, Settings, Sparkles, SquareKanban, Waves, ChevronRight, X } from "lucide-react";
import { motion, AnimatePresence, MotionConfig, useReducedMotion, useDragControls } from "framer-motion";
import { useAppStore } from "../store";
import { useI18n } from "../hooks/useI18n";
import type { AppView } from "../types";
import { androidCall } from "../platform/android";
import { consumeMobileBack } from "../lib/mobileBack";

export function MobileChrome() {
  const { t, language } = useI18n(); const zh=language.startsWith("zh"); const reduced=useReducedMotion();
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const [sheet, setSheet] = useState<"all" | null>(null);
  const allFeatures = ({"zh-TW":"全部功能","zh-CN":"全部功能",en:"All features",ja:"すべての機能",ko:"모든 기능"})[language];
  const dragControls=useDragControls();
  const activeImport = useRef(false);
  const choose = (next: AppView) => { window.dispatchEvent(new Event("chengjing:flush-editors")); setView(next); setSheet(null); };
  useEffect(() => {
    const back = () => {
      window.dispatchEvent(new Event("chengjing:flush-editors"));
      const state = useAppStore.getState();
      if (consumeMobileBack()) return;
      if (sheet) setSheet(null);
      else if (state.commandOpen) state.setCommandOpen(false);
      else if (state.createCardOpen) state.setCreateCardOpen(false);
      else if (state.importOpen) state.setImportOpen(false);
      else if (state.selectedCardId) state.closeCard();
      else if (state.rightPanel !== "none") state.closeRightPanel();
      else if (state.view !== "today") state.setView("today");
      else void androidCall("app.close");
    };
    window.addEventListener("chengjing:android-back", back);
    return () => window.removeEventListener("chengjing:android-back", back);
  }, [sheet]);
  useEffect(() => {
    const receive = async () => {
      if (activeImport.current) return; activeImport.current = true;
      try {
        const queue = await androidCall<Array<{ id: string; text: string; files: Array<{ path: string; name: string }> }>>("share.pending");
        const { db } = await import("../db");
        const { importFile } = await import("../lib/importers");
        for (const item of queue) {
          if (item.text && !await db.fragments.get(item.id)) { const now = Date.now(); await db.fragments.add({ id: item.id, text: item.text, pinned: false, tagIds: [], createdAt: now, updatedAt: now }); }
          for (const file of item.files) await importFile(file.name, new Blob(), file.path);
          await androidCall("share.ack", { id: item.id });
        }
        if (queue.length) useAppStore.getState().setView("fragments");
      } finally { activeImport.current = false; }
    };
    const pause = () => { window.dispatchEvent(new Event("chengjing:flush-editors")); };
    const resume = () => void receive().catch(console.error);
    resume(); window.addEventListener("chengjing:android-resume", resume); window.addEventListener("chengjing:android-pause", pause);
    return () => { window.removeEventListener("chengjing:android-resume", resume); window.removeEventListener("chengjing:android-pause", pause); };
  }, []);
  const icons={fragments:Feather,journal:CalendarDays,tasks:ListTodo,highlights:Highlighter,boards:Columns3,kanban:SquareKanban,database:Database,brain:BrainCircuit,settings:Settings,library:FileStack,today:LayoutGrid};
  const hints:Partial<Record<AppView,[string,string]>>={fragments:["接住一閃而過的念頭","Catch a passing thought"],journal:["留給今天的一頁","A page for today"],tasks:["讓下一步更清楚","A clear next step"],highlights:["值得回看的句子","Words worth revisiting"],boards:["攤開想法，自由連結","Room to connect ideas"],kanban:["看見事情如何推進","See work move forward"],library:["所有卡片與收藏","Your cards and collections"],database:["把細節整理得有序","Bring details into focus"]};
  const entry=(name:AppView)=>{const Icon=icons[name];return <motion.button key={name} type="button" className={`mobile-directory-item ${view===name?"is-current":""}`} whileTap={reduced?{}:{scale:0.97}} onClick={()=>choose(name)}><Icon size={22}/><span><b>{t(`nav.${name}` as Parameters<typeof t>[0])}</b>{hints[name]&&<small>{hints[name]![zh?0:1]}</small>}</span></motion.button>};
  return <MotionConfig reducedMotion="user">
    <header className="mobile-header"><span>澄境<small>CHENGJING</small></span><div><button aria-label={t("top.searchPlaceholder")} onClick={() => useAppStore.getState().setCommandOpen(true)}><Search size={21} /></button><button aria-label={allFeatures} aria-expanded={Boolean(sheet)} onClick={()=>setSheet("all")}><Menu size={23}/></button></div></header>
    <nav className="mobile-nav" aria-label={t("nav.primary")}>
      <button className={["today","fragments"].includes(view) ? "active" : ""} onClick={() => choose("fragments")}><Feather /><span>{zh?"片語":"Capture"}</span></button>
      <button className={view === "tasks" ? "active" : ""} onClick={() => choose("tasks")}><ListTodo /><span>{t("nav.tasks")}</span></button>
      <button className={view === "brain" ? "active mobile-brain-tab" : "mobile-brain-tab"} onClick={() => choose("brain")}><BrainCircuit /><span>{zh?"第二大腦":"Brain"}</span></button>
      <button className={view === "library" ? "active" : ""} onClick={() => choose("library")}><FileStack /><span>{zh?"知識庫":"Library"}</span></button>
      <button aria-label={allFeatures} aria-expanded={Boolean(sheet)} className={sheet ? "active" : ""} onClick={() => setSheet("all")}><LayoutGrid /><span>{({"zh-TW":"全部","zh-CN":"全部",en:"All",ja:"すべて",ko:"전체"})[language]}</span></button>
    </nav>
    <AnimatePresence>{sheet && <motion.div className="mobile-sheet-backdrop" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={() => setSheet(null)}><motion.section className="mobile-sheet mobile-directory" drag="y" dragControls={dragControls} dragListener={false} dragConstraints={{top:0,bottom:0}} dragElastic={{top:0,bottom:0.4}} onDragEnd={(_,info)=>{if(info.offset.y>80||info.velocity.y>500)setSheet(null)}} initial={reduced?false:{y:"100%"}} animate={{y:0}} exit={{y:"100%"}} transition={{type:"spring",stiffness:380,damping:36}} role="dialog" aria-modal="true" aria-label={t("nav.primary")} onClick={(event) => event.stopPropagation()}>
      <header onPointerDown={event=>dragControls.start(event)}><i className="mobile-sheet-handle"/><div><small>CHENGJING</small><strong>{allFeatures}</strong></div><button aria-label={t("ai.close")} onClick={() => setSheet(null)}><X size={21}/></button></header>
      <div className="mobile-directory-scroll">
        {sheet==="all"&&<section><h3>{zh?"隨手記錄":"CAPTURE"}</h3><div className="mobile-directory-grid">{(["fragments","tasks","journal","highlights"] as AppView[]).map(entry)}</div></section>}
        <section className="mobile-directory-explore"><h3>{zh?"思考與整理":"THINK & ORGANIZE"}</h3><button className="mobile-directory-brain" onClick={()=>choose("brain")}><span className="directory-brain-symbol"><BrainCircuit size={32}/></span><span><b>{t("nav.brain")}</b><small>{zh?"循著關聯，看見新的線索":"Follow connections. Find a new thread."}</small></span><ChevronRight size={18}/></button><div className="mobile-directory-grid">{(["boards","kanban","library","database"] as AppView[]).map(entry)}</div></section>
        <footer><button onClick={()=>{useAppStore.getState().openAI();setSheet(null)}}><Sparkles size={19}/>{t("nav.ai")}</button><button onClick={()=>{useAppStore.getState().openWishPool();setSheet(null)}}><Waves size={19}/>{zh?"許願池":"Wish Pool"}</button><button onClick={()=>choose("settings")}><Settings size={19}/>{t("nav.settings")}</button></footer>
      </div>
    </motion.section></motion.div>}</AnimatePresence>
  </MotionConfig>;
}
