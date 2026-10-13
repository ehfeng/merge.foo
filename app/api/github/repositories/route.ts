import { session,json,AuthenticationError } from '../../../../src/server/auth';
import { repositories,verifyIdentity,AccessError } from '../../../../src/server/github';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  const data=await session(request); if(!data) return json({error:'Sign in to read repositories.'},401);
  try {await verifyIdentity(data); return json({repositories:await repositories(data)});} catch(error){return json({error:error instanceof Error?error.message:'GitHub unavailable.'},error instanceof AccessError||error instanceof AuthenticationError?error.status:502);}
}
