import {AccessError} from './github';
import {readBoundedBody,RequestBodyError} from './request-body-core';
export async function boundedBody(request:Request,limit:number):Promise<Uint8Array> {
  try{return await readBoundedBody(request,limit);}catch(error){if(error instanceof RequestBodyError)throw new AccessError(error.message,error.status);throw error;}
}
