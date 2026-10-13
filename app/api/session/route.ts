import {configuration,session,json,revalidateIdentity,installationUrl,AuthenticationError} from '../../../src/server/auth';
export const dynamic='force-dynamic';
export async function GET(request: Request) {
  const data=await session(request);
  if(data) {
    try { const user=await revalidateIdentity(data);
      return json({configured:true,authenticated:true,login:user.login,installationUrl:installationUrl()});
    } catch(error) {
      if(error instanceof AuthenticationError)return json({configured:true,authenticated:false,error:'GitHub session expired. Sign in again.'},401);
      return json({configured:true,error:'GitHub access could not be checked. Retry when GitHub is available.',installationUrl:installationUrl()},502);
    }
  }
  return json({configured:!!configuration(),authenticated:false,installationUrl:installationUrl()});
}
