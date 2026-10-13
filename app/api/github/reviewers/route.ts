import {session,json,AuthenticationError} from '../../../../src/server/auth';
import {AccessError,verifyIdentity,validateRepositoryAccess,graphQuery,fetchReviewerSuggestions} from '../../../../src/server/github';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  const data=await session(request);if(!data)return json({error:'Sign in to read reviewer suggestions.'},401);
  try {
    await verifyIdentity(data);const parameters=new URL(request.url).searchParams;
    const repo=await validateRepositoryAccess(data,parameters.get('repository')??'');
    return json(await fetchReviewerSuggestions(repo,parameters.get('prId')??'',{
      request:async()=>{throw new Error('Reviewer suggestions use GraphQL.');},
      graph:<T>(query:string,variables:Record<string,unknown>)=>graphQuery<T>(data.token,query,variables),
    }));
  }catch(error){return json({error:error instanceof Error?error.message:'GitHub reviewer suggestions are unavailable.'},error instanceof AccessError||error instanceof AuthenticationError?error.status:502);}
}
