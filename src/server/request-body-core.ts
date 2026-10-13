/** Lightweight request reader shared by API routes and native webhook ingress. */
export class RequestBodyError extends Error {
  readonly status=413;
  constructor(){super('Request is too large.');}
}
export async function readBoundedBody(request:Request,limit:number):Promise<Uint8Array> {
  if(Number(request.headers.get('Content-Length'))>limit)throw new RequestBodyError();
  const reader=request.body?.getReader();if(!reader)return new Uint8Array();
  const chunks:Uint8Array[]=[];let length=0;
  try{while(true){const next=await reader.read();if(next.done)break;length+=next.value.byteLength;if(length>limit){await reader.cancel();throw new RequestBodyError();}chunks.push(next.value);}}
  finally{reader.releaseLock();}
  const body=new Uint8Array(length);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}return body;
}
