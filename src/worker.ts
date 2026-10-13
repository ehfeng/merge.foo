import handler from 'vinext/server/fetch-handler';
import {scheduledReconciliation} from './server/scheduler';
import {nativeWebhookIngress} from './server/webhook-native';
import {canonicalOriginDecision} from './server/canonical-origin';
export default {...handler,async fetch(request:Request,env:Record<string,unknown>,ctx:Parameters<typeof handler.fetch>[2]) {
  const canonical=canonicalOriginDecision(request,{origin:typeof env.APP_ORIGIN==='string'?env.APP_ORIGIN:undefined,aliases:env.APP_ORIGIN_ALIASES});
  if(canonical)return canonical;
  const receipt=await nativeWebhookIngress(request,env);
  return receipt??handler.fetch(request,env,ctx);
},async scheduled(_event:unknown,env:Record<string,unknown>,ctx:Parameters<typeof handler.fetch>[2]) {
  await scheduledReconciliation(request=>handler.fetch(request,env,ctx),env);
}};
export * from 'vinext/server/fetch-handler';
export {PlannedAssignments} from './server/plan-object';
