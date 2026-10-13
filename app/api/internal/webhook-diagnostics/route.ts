import {json} from '../../../../src/server/auth';
import {AccessError} from '../../../../src/server/github';
import {inspectWebhookReceipts} from '../../../../src/server/webhook-diagnostics';
export const dynamic='force-dynamic';
export async function POST(request:Request){
  try{return await inspectWebhookReceipts(request);}
  catch(error){return json({error:error instanceof AccessError?error.message:'Webhook receipt diagnostics unavailable.'},error instanceof AccessError?error.status:503);}
}
