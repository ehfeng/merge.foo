import {session,json,AuthenticationError} from '../../../../src/server/auth';
import {fetchRepository,verifyIdentity,AccessError} from '../../../../src/server/github';
import {loadPlans} from '../../../../src/server/plans';
import {loadCoordination} from '../../../../src/server/workflow';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  const data=await session(request); if(!data) return json({error:'Sign in to read pull requests.'},401);
  try {const identity=await verifyIdentity(data); const current={...data,login:identity.login};const result=await fetchRepository(current,new URL(request.url).searchParams.get('repository')??''); await loadPlans(result.repo,result.workspace); const coordinated=await loadCoordination(current,result.repo,result.workspace);return json({...coordinated,warnings:result.warnings});}
  catch(error){return json({error:error instanceof Error?error.message:'GitHub unavailable.'},error instanceof AccessError||error instanceof AuthenticationError?error.status:502);}
}
