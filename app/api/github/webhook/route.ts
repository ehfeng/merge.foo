import {json} from '../../../../src/server/auth';
import {AccessError} from '../../../../src/server/github';
import {receiveWebhook} from '../../../../src/server/workflow-background';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{return await receiveWebhook(request);}catch(error){return json({error:error instanceof Error?error.message:'Webhook processing unavailable.'},error instanceof AccessError?error.status:503);}}
