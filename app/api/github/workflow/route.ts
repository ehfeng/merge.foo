import {session,json,AuthenticationError} from '../../../../src/server/auth';
import {AccessError} from '../../../../src/server/github';
import {updateWorkflow} from '../../../../src/server/workflow';
import {WorkflowError} from '../../../../src/workflow/types';
export const dynamic='force-dynamic';
export async function POST(request:Request) {
  const data=await session(request);if(!data)return json({error:'Sign in to coordinate reviews.'},401);
  try{return json(await updateWorkflow(request,data));}
  catch(error){return json({error:error instanceof Error?error.message:'Review coordination is unavailable.'},error instanceof AccessError||error instanceof AuthenticationError||error instanceof WorkflowError?error.status:502);}
}
