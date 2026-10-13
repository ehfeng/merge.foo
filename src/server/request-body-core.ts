/** Lightweight request reader shared by API routes and native webhook ingress. */
export class RequestBodyError extends Error {
  readonly status=413;
  constructor(){super('Request is too large.');}
}
export async function readBoundedBody(request:Request,limit:number,signal?:AbortSignal):Promise<Uint8Array> {
  signal?.throwIfAborted();
  if(Number(request.headers.get('Content-Length'))>limit)throw new RequestBodyError();
  const reader=request.body?.getReader();if(!reader)return new Uint8Array();
  const chunks:Uint8Array[]=[];let length=0;
  let abort:()=>void=()=>{};
  const cancelled=new Promise<never>((_,reject)=>{abort=()=>{
    // Cancelling a hostile/stalled source can itself hang; never await its promise.
    void reader.cancel(signal?.reason).catch(()=>{});
    reject(signal?.reason??new DOMException('Request aborted.','AbortError'));
  };});
  signal?.addEventListener('abort',abort,{once:true});
  try{while(true){
    signal?.throwIfAborted();
    const next=await (signal?Promise.race([reader.read(),cancelled]):reader.read());
    signal?.throwIfAborted();
    if(next.done)break;length+=next.value.byteLength;
    if(length>limit){void reader.cancel().catch(()=>{});throw new RequestBodyError();}
    chunks.push(next.value);
  }} finally{signal?.removeEventListener('abort',abort);reader.releaseLock();}
  const body=new Uint8Array(length);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}return body;
}
