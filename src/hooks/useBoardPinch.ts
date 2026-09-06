import { useEffect, useRef, type RefObject } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import { pinchViewport, type PinchPoint, type PinchViewport } from "../lib/boardPinch";

// React Flow's normal node drag/nopan handlers consume touch events over cards.
// Only a two-finger gesture is claimed here; all single-touch and mouse handlers remain intact.
export function useBoardPinch(root: RefObject<HTMLDivElement | null>, flow: ReactFlowInstance | null, onStart: () => void) {
  const pinching=useRef(false);const startCallback=useRef(onStart);startCallback.current=onStart;
  useEffect(()=>{
    const element=root.current?.querySelector<HTMLElement>('.react-flow');
    if(!element||!flow)return;
    let gesture: {ids:number[];first:[PinchPoint,PinchPoint];viewport:PinchViewport} | null=null;
    let frame=0,releaseFrame=0;let pending:PinchViewport|null=null;let ignoreClickUntil=0;
    const point=(touch:Touch):PinchPoint=>{const rect=element.getBoundingClientRect();return{x:touch.clientX-rect.left,y:touch.clientY-rect.top}};
    const start=(event:TouchEvent)=>{
      if(gesture||event.touches.length!==2)return;
      const touches=Array.from(event.touches);
      if(!touches.every(touch=>element.contains(touch.target as Node)) || (event.target as Element).closest('.react-flow__controls,.react-flow__minimap'))return;
      pinching.current=true;cancelAnimationFrame(releaseFrame);
      gesture={ids:touches.map(touch=>touch.identifier),first:[point(touches[0]),point(touches[1])],viewport:flow.getViewport()};
      startCallback.current();event.preventDefault();event.stopPropagation();
    };
    const move=(event:TouchEvent)=>{
      if(!pinching.current)return;
      event.preventDefault();event.stopPropagation();
      if(!gesture)return;
      const pair=gesture.ids.map(id=>Array.from(event.touches).find(touch=>touch.identifier===id));
      if(!pair[0]||!pair[1])return;
      pending=pinchViewport(gesture.viewport,gesture.first,[point(pair[0]),point(pair[1])]);
      if(!frame)frame=requestAnimationFrame(()=>{frame=0;if(pending)void flow.setViewport(pending,{duration:0});pending=null;});
    };
    const end=(event:TouchEvent)=>{
      if(!pinching.current)return;
      // Let the original drag handler receive its end/cancel event and clean up.
      // Do not resume one-finger dragging until both fingers have lifted.
      gesture=null;ignoreClickUntil=performance.now()+250;
      if(event.touches.length===0){cancelAnimationFrame(releaseFrame);releaseFrame=requestAnimationFrame(()=>{pinching.current=false;});}
    };
    const click=(event:MouseEvent)=>{if(pinching.current||performance.now()<ignoreClickUntil){event.preventDefault();event.stopPropagation();}};
    element.addEventListener('touchstart',start,{capture:true,passive:false});
    element.addEventListener('touchmove',move,{capture:true,passive:false});
    element.addEventListener('touchend',end,true);element.addEventListener('touchcancel',end,true);
    element.addEventListener('click',click,true);element.addEventListener('dblclick',click,true);
    return()=>{cancelAnimationFrame(frame);cancelAnimationFrame(releaseFrame);pinching.current=false;element.removeEventListener('touchstart',start,true);element.removeEventListener('touchmove',move,true);element.removeEventListener('touchend',end,true);element.removeEventListener('touchcancel',end,true);element.removeEventListener('click',click,true);element.removeEventListener('dblclick',click,true);};
  },[root,flow]);
  return pinching;
}
