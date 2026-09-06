import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUp, Feather, Check, MoreHorizontal, ListTodo } from "lucide-react";
import { db } from "../db";
import { useI18n } from "../hooks/useI18n";
import { relativeTime } from "../lib/utils";
import { showContextMenuFromButton } from "../lib/contextMenu";

export function MobileCapture() {
  const { language } = useI18n(); const zh=language.startsWith("zh");
  const [text,setText]=useState(()=>localStorage.getItem("chengjing-mobile-draft-fragment")||""); const [kind,setKind]=useState<"fragment"|"task">("fragment");
  const [saving,setSaving]=useState(false);const [error,setError]=useState("");const input=useRef<HTMLTextAreaElement>(null);const reduced=useReducedMotion();
  const fragments=useLiveQuery(()=>db.fragments.orderBy("createdAt").reverse().limit(40).toArray(),[],[]);
  const tasks=useLiveQuery(()=>db.tasks.where("doneKey").equals("active").count(),[],0);
  async function capture() {
    if(!text.trim()||saving)return;setSaving(true);setError("");
    try{const now=Date.now();const id=crypto.randomUUID();if(kind==="fragment")await db.fragments.add({id,text:text.trim(),pinned:false,tagIds:[],createdAt:now,updatedAt:now});else await db.tasks.add({id,title:text.trim(),done:false,createdAt:now,updatedAt:now});localStorage.removeItem(`chengjing-mobile-draft-${kind}`);setText("");input.current?.focus()}
    catch(error){setError(error instanceof Error?error.message:String(error))}finally{setSaving(false)}
  }
  return <section className="mobile-capture-page">
    <header className="mobile-capture-intro"><span>{new Intl.DateTimeFormat(language,{month:"long",day:"numeric",weekday:"short"}).format(new Date())}</span><h1>{zh?"先記下，慢慢想。":"A thought worth keeping."}</h1><p>{zh?"零散的念頭，也有值得留下的地方。":"A quiet place for what is on your mind."}</p></header>
    <div className="mobile-capture-composer">
      <div className="capture-kind-switch" role="tablist" aria-label={zh?"記錄類型":"Capture type"}>{(["fragment","task"] as const).map(value=><button key={value} disabled={saving} role="tab" aria-selected={kind===value} onClick={()=>{setKind(value);setText(localStorage.getItem(`chengjing-mobile-draft-${value}`)||"");input.current?.focus()}}>{kind===value&&<motion.i layoutId="capture-kind" transition={{type:"spring",stiffness:440,damping:35}}/>}{value==="fragment"?<Feather size={16}/>:<ListTodo size={16}/>}<span>{value==="fragment"?(zh?"隻言片語":"Thought"):(zh?"待辦事項":"Task")}</span></button>)}</div>
      <textarea ref={input} value={text} onChange={event=>{setText(event.target.value);localStorage.setItem(`chengjing-mobile-draft-${kind}`,event.target.value)}} placeholder={kind==="fragment"?(zh?"此刻，腦中閃過什麼？":"What is on your mind?"):(zh?"接下來，想完成什麼？":"What would you like to do?")} aria-label={zh?"快速記錄":"Quick capture"} rows={3} onKeyDown={event=>{if((event.metaKey||event.ctrlKey)&&event.key==="Enter"&&!event.nativeEvent.isComposing){event.preventDefault();void capture()}}}/>
      <footer><span>{kind==="fragment"?(zh?"不必完整，先留下來。":"It does not need to be finished."):(zh?`${tasks} 件待完成`:`${tasks} tasks to do`)}</span><motion.button whileTap={reduced?{}:{scale:0.9}} disabled={!text.trim()||saving} onClick={()=>void capture()} aria-label={zh?"留下來":"Save"}><ArrowUp size={21}/></motion.button></footer>
      {error&&<p role="alert">{error}</p>}
    </div>
    <div className="mobile-stream-heading"><h2>{zh?"最近留下的":"Recently captured"}</h2><span>{fragments.length?`${fragments.length}`:""}</span></div>
    <div className="mobile-thought-stream"><AnimatePresence initial={false}>{fragments.map(fragment=><motion.article layout={!reduced} key={fragment.id} initial={reduced?false:{opacity:0,y:-12}} animate={{opacity:1,y:0}} exit={{opacity:0,x:24}} transition={{type:"spring",stiffness:420,damping:34}}><div><time>{relativeTime(fragment.createdAt,language)}</time>{fragment.pinned&&<Check size={13}/>}<button aria-label={zh?"更多操作":"More actions"} onClick={event=>showContextMenuFromButton(event,{kind:"fragment",id:fragment.id})}><MoreHorizontal size={20}/></button></div><p>{fragment.text}</p></motion.article>)}</AnimatePresence>{!fragments.length&&<div className="mobile-capture-empty"><Feather size={24}/><p>{zh?"從第一個小念頭開始。":"Start with one small thought."}</p></div>}</div>
  </section>;
}
