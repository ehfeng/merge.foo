import {session,json,AuthenticationError} from '../../../../src/server/auth';
import {AccessError} from '../../../../src/server/github';
import {updatePlan} from '../../../../src/server/plans';
export const dynamic='force-dynamic';
export async function PUT(request:Request) {
  const data=await session(request);if(!data)return json({error:'Sign in to plan reviewers.'},401);
  try {const response=await updatePlan(request,data);return json(await response.json(),response.status);}
  catch(error){return json({error:error instanceof Error?error.message:'Planned assignment could not be saved.'},error instanceof AccessError||error instanceof AuthenticationError?error.status:502);}
}
