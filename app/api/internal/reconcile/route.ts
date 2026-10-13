import {json} from '../../../../src/server/auth';
import {AccessError} from '../../../../src/server/github';
import {reconcileBackground,reconcileScheduled} from '../../../../src/server/workflow-background';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{return await reconcileBackground(request);}catch(error){return json({error:error instanceof Error?error.message:'Background reconciliation unavailable.'},error instanceof AccessError?error.status:503);}}
export async function GET(request:Request){try{return await reconcileScheduled(request);}catch(error){return json({error:error instanceof Error?error.message:'Background reconciliation unavailable.'},error instanceof AccessError?error.status:503);}}
