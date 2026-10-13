import type { PullRequest, Workspace } from './types';

export function createFixture(now = new Date()): Workspace {
  const ago = (hours: number) => new Date(now.getTime() - hours*3600000).toISOString();
  const base = (number: number, title: string, stackId: string, extra: Partial<PullRequest> = {}): PullRequest => ({
    id: `pr-${number}`, number, title, stackId, repository: 'acme/platform', branch: title.toLowerCase().replaceAll(' ','-'),
    author: 'You', summary: 'An incremental change that keeps the stack small and focused.', areas: ['platform'],
    lifecycle: 'open', readiness: 'draft', held: false, checks: 'passing', mergeability: 'clean', contentVersion: 1,
    validity: 'fresh', requiredApprovals: 1, plannedReviewerIds: [], requests: [], reviews: [],
    lines: {added: 164, deleted: 42, discounted: 64, reason: '64 generated lines discounted; tests count in full.'},
    complexity: 'Medium', risk: 'Low', riskReason: 'Additive change behind a feature flag. Mock estimate.', priority: 'Normal', ...extra,
  });
  const request = (reviewerId: string, number: number, hours: number) => ({reviewerId, requestedAt: ago(hours), key: `seed:${number}:${reviewerId}`});
  return {
    schemaVersion: 1,
    reviewers: [
      {id:'elena',name:'Elena Park',initials:'EP',color:'#9275ce',specialty:'API & infrastructure'},
      {id:'noah',name:'Noah Chen',initials:'NC',color:'#5e94ac',specialty:'Data & reliability'},
      {id:'maya',name:'Maya Ellis',initials:'ME',color:'#d79964',specialty:'Product & frontend'},
    ],
    stacks: [
      {id:'api',title:'A faster API',description:'API platform · 4 pull requests',autoProgress:true,color:'#8171d4'},
      {id:'billing',title:'Reliable billing',description:'Payments · 3 pull requests',autoProgress:true,color:'#d79661'},
      {id:'search',title:'Search that feels instant',description:'Product experience · 2 pull requests',autoProgress:false,color:'#66a09b'},
    ],
    prs: [
      base(142,'Introduce request tracing','api',{summary:'Add request IDs and structured tracing at the gateway. Establishes the foundation for cache diagnostics.',areas:['gateway','observability'],readiness:'ready',plannedReviewerIds:['elena'],requests:[request('elena',142,18)],priority:'High'}),
      base(143,'Add the cache layer','api',{parentId:'pr-142',held:true,plannedReviewerIds:['noah'],summary:'Introduce a bounded response cache with explicit invalidation. Held while the eviction strategy is finalized.',risk:'Medium',riskReason:'Cache invalidation can return outdated responses. Mock estimate.',lines:{added:284,deleted:36,discounted:120,reason:'120 generated fixture lines discounted; tests count in full.'}}),
      base(144,'Wire cache into endpoints','api',{parentId:'pr-143',plannedReviewerIds:['elena'],risk:'Medium'}),
      base(145,'Ship cache observability','api',{parentId:'pr-144',lines:{added:98,deleted:14,discounted:0,reason:'No low-signal lines discounted.'},complexity:'Low'}),
      base(137,'Normalize invoice events','billing',{readiness:'ready',plannedReviewerIds:['noah'],requests:[request('noah',137,28)],reviews:[{reviewerId:'noah',decision:'approved',at:ago(8),contentVersion:1}],checks:'failing',mergeability:'conflicts',priority:'Urgent',risk:'High',riskReason:'Touches financial event processing. Mock estimate.'}),
      base(138,'Make webhook delivery durable','billing',{parentId:'pr-137',readiness:'ready',plannedReviewerIds:['maya'],requests:[{...request('maya',138,8),lastActivityAt:ago(2)}],reviews:[{reviewerId:'maya',decision:'changes_requested',at:ago(2),contentVersion:1}],summary:'Persist webhook attempts and add jittered retries. Maya requested an idempotency guard before approval.',risk:'High',riskReason:'Duplicate delivery may produce duplicate charges. Mock estimate.'}),
      base(139,'Add delivery health metrics','billing',{parentId:'pr-138',plannedReviewerIds:['noah'],complexity:'Low'}),
      base(128,'Build the search index','search',{plannedReviewerIds:['maya'],summary:'Create the index schema and an incremental update pipeline. Start the first review explicitly.',complexity:'High',lines:{added:460,deleted:12,discounted:180,reason:'180 generated schema lines discounted; tests count in full.'}}),
      base(129,'Launch instant results','search',{parentId:'pr-128',plannedReviewerIds:['elena','noah'],requiredApprovals:2,summary:'Connect the new index to search suggestions. Requires two distinct approvals.',risk:'Medium',riskReason:'Query changes affect ranking and relevance. Mock estimate.'}),
    ],
    activity:[{id:'seed-2',at:ago(2),prId:'pr-138',stackId:'billing',message:'#138: Maya requested changes to the idempotency guard',kind:'review'},
      {id:'seed-1',at:ago(8),prId:'pr-137',stackId:'billing',message:'#137 approved; #138 released before merge (mock)',kind:'release'}],
    handledEventIds:[],
  };
}
