import { beginLogin } from '../../../../src/server/auth';
export const dynamic='force-dynamic';
export async function GET(request:Request){return beginLogin(request);}
