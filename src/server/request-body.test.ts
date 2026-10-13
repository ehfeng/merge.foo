import {it,expect} from 'vitest';
import {boundedBody} from './request-body';
it('bounds chunked payloads even when Content-Length is missing and cancels excess data',async()=>{
  let cancelled=false;let index=0;const stream=new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new Uint8Array(8));index++;if(index===10)controller.close();},cancel(){cancelled=true;}});
  const request=new Request('https://merge.example/api/github/webhook',{method:'POST',body:stream,duplex:'half'} as RequestInit);
  await expect(boundedBody(request,12)).rejects.toMatchObject({status:413});expect(cancelled).toBe(true);expect(index).toBeLessThan(10);
});
