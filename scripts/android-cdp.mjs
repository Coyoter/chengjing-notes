export async function connectAndroid(port=9223) {
  const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page=pages.find(p=>p.url.includes("appassets.androidplatform.net"));if(!page)throw Error("Android WebView not found");
  const socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener("open",resolve,{once:true}));
  let sequence=0;const pending=new Map();
  socket.addEventListener("message",event=>{const data=JSON.parse(event.data);const request=pending.get(data.id);if(!request)return;pending.delete(data.id);clearTimeout(request.timer);data.error?request.reject(Error(JSON.stringify(data.error))):request.resolve(data.result)});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error("CDP timeout"))},30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))});
  await send("Runtime.enable");
  return {send,evaluate:async(expression)=>{
    // Keep promises rooted by an inspector object group while awaiting imports.
    // Preserve Runtime.evaluate semantics, including multi-statement snippets.
    const key=`chengjing-qa-${crypto.randomUUID()}`;
    try {
      let result=await send("Runtime.evaluate",{expression,objectGroup:key});
      if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
      if(result.result.subtype==="promise")result=await send("Runtime.awaitPromise",{promiseObjectId:result.result.objectId,returnByValue:true});
      else if(result.result.objectId)result=await send("Runtime.callFunctionOn",{objectId:result.result.objectId,functionDeclaration:"function(){return this}",returnByValue:true});
      if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;
    } finally {await send("Runtime.releaseObjectGroup",{objectGroup:key}).catch(()=>{});}
  },close:()=>socket.close()};
}
