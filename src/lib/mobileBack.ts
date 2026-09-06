import { useEffect, useRef } from "react";
const handlers: Array<() => void> = [];
export function consumeMobileBack() { const handler=handlers.at(-1);if(!handler)return false;handler();return true; }
export function useMobileBack(active: boolean, handler: () => void) {
  const latest=useRef(handler);latest.current=handler;
  useEffect(()=>{if(!active||window.chengjing?.platform!=="android")return;const close=()=>latest.current();handlers.push(close);return()=>{const index=handlers.indexOf(close);if(index>=0)handlers.splice(index,1);};},[active]);
}
