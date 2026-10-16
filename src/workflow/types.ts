export type Identity={id:string;login:string};
export type WorkflowReview={id:string;reviewerId:string;reviewerLogin?:string;state:'approved'|'changes_requested'|'commented'|'dismissed';submittedAt:string;eligible:boolean};
export type ObservedRequest={reviewerId:string;login:string;eventId?:string;requestedAt?:string;actorId?:string};
export type WorkflowPr={id:string;number:number;stackId:string;parentId?:string;author:Identity;lifecycle:'open'|'merged'|'closed';readiness:'draft'|'ready';topologyVerified?:boolean;githubGate:'approved'|'changes_requested'|'review_required'|'none'|'unknown';reviewsComplete:boolean;reviewEligibilityComplete?:boolean;reviews:WorkflowReview[];requests:ObservedRequest[];requestsComplete?:boolean;eventIds?:string[];plannedReviewers:Identity[];readinessEvent?:{id:string;at:string;actorId:string;readiness:'draft'|'ready'}};
export type WorkflowSnapshot={scope:string;repository:string;observedAt:string;complete:boolean;prs:WorkflowPr[]};
export type WorkflowActor=Identity&{canWrite:boolean};
export type PrConfiguration={held:boolean;minimumApprovals:number;parentId?:string|null;manualOverride:boolean};
export type StackConfiguration={enrolled:boolean;autoProgress:boolean;started:boolean;prIds:string[];actorId:string;actorLogin:string};
export type EffectReceipt={eventId?:string;at:string;actorId:string;attributable:boolean;reviewerId?:string};
export type Release={prId:string;stackId:string;generation:number;mode:'automatic'|'manual';priorReadiness:'draft'|'ready';targets:Identity[];readyReceipt?:EffectReceipt;requestReceipts:Record<string,EffectReceipt>;invalidated:boolean;rolledBack:boolean;rollbackBlocked?:string;createdAt:string;actorId:string;actorLogin?:string};
export type WorkflowAction={id:string;prId:string;stackId:string;generation:number;kind:'ready'|'request'|'remove_request'|'draft';reviewer?:Identity;mode:'automatic'|'manual';status:'pending'|'claimed'|'uncertain'|'done'|'cancelled'|'failed';attempts:number;dueAt:string;claim?:{id:string;owner:string;expiresAt:string};startedAt?:string;effectActorId?:string;baselineEventIds?:string[];uncertainOutcome?:boolean;dispatchStarted?:boolean;reason?:string;receipt?:EffectReceipt};
export type WorkflowActivity={id:string;at:string;actorId:string;actorLogin:string;prId?:string;stackId?:string;message:string;kind:'intent'|'release'|'rollback'|'sync'|'pause'};
export type WorkflowDocument={schemaVersion:1;version:number;config:{prs:Record<string,PrConfiguration>;stacks:Record<string,StackConfiguration>};releases:Record<string,Release>;actions:WorkflowAction[];activity:WorkflowActivity[];handledEventIds:string[]};
export interface WorkflowStore {readWorkflow(scope:string):Promise<WorkflowDocument|null>;compareAndSwapWorkflow(scope:string,expectedVersion:number,next:WorkflowDocument):Promise<boolean>}
export type WorkflowCommand=
 |{type:'configure_pr';prId:string;held?:boolean;minimumApprovals?:number;parentId?:string|null}
 |{type:'enroll';stackId:string;enabled:boolean;autoProgress?:boolean;prIds?:string[]}
 |{type:'auto';stackId:string;enabled:boolean}
 |{type:'start';prId:string;early?:boolean}
 |{type:'reconcile';eventId?:string};
export type EffectOutcome={state:'applied'|'already'|'unknown'|'not_applied';receipt?:EffectReceipt;reason?:string};
export interface WorkflowTransport {
 readonly enabled:boolean;
 observe():Promise<WorkflowSnapshot>;
 /** Freshly checks repository/installation access, actor grant and stable reviewer identity. */
 authorize(action:WorkflowAction,document:WorkflowDocument,snapshot:WorkflowSnapshot):Promise<boolean>;
 perform(action:WorkflowAction,snapshot:WorkflowSnapshot,beforeDispatch?:(fresh:WorkflowSnapshot,effectActor?:Identity)=>Promise<boolean>):Promise<EffectOutcome>;
 /** Never reports not_applied merely because a request disappeared; reviews may have completed it. */
 reconcile(action:WorkflowAction,snapshot:WorkflowSnapshot):Promise<EffectOutcome>;
}
export class WorkflowError extends Error {constructor(message:string,public status=400){super(message);}}
export class WorkflowTransportError extends Error {constructor(message:string,public outcome:'rejected'|'retryable'|'uncertain'){super(message);}}
