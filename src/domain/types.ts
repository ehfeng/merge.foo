export type Lifecycle = 'open' | 'merged' | 'closed';
export type Decision = 'approved' | 'changes_requested' | 'commented';
export type Validity = 'fresh' | 'stale' | 'uncertain';
export type Review = { reviewerId: string; decision: Decision; contentVersion: number; at: string; eventId?: string; submittedAt?: string; dismissed?: boolean; eligible?: boolean };
export type ReviewRequest = { reviewerId: string; requestedAt: string; key: string; lastActivityAt?: string; lastPingAt?: string };
export type PullRequest = {
  id: string; number: number; title: string; stackId: string; parentId?: string; dependencySource?: 'declared'|'observed'|'unknown'; repository: string;
  branch: string; author: string; summary: string; areas: string[];
  lifecycle: Lifecycle; readiness: 'draft' | 'ready'; held: boolean;
  checks: 'passing' | 'pending' | 'failing'; mergeability: 'clean' | 'conflicts' | 'unknown';
  contentVersion: number; validity: Validity; requiredApprovals: number;
  approvalVerified?: boolean; manualOverride?: boolean; workflow?: {enrolled:boolean;manualOverride:boolean;pending:boolean;uncertain:boolean;reason?:string;targets?:{id:string;login:string}[];generation?:number};
  observedGate?: 'approved' | 'changes_requested' | 'review_required' | 'none' | 'unknown';
  url?: string;
  plannedReviewerIds: string[]; planVersion?: number; plannedReviewerIdentities?: {id: string; login: string}[]; canEditPlan?: boolean; suggestedReviewers?: {reviewerId: string; isAuthor: boolean; isCommenter: boolean}[]; requests: ReviewRequest[]; reviews: Review[];
  lines: { added: number; deleted: number; discounted: number; reason: string };
  complexity: 'Low' | 'Medium' | 'High' | 'Unknown'; risk: 'Low' | 'Medium' | 'High' | 'Unknown'; riskReason: string;
  priority: 'Urgent' | 'High' | 'Normal';
  release?: { key: string; requestTargets: string[]; readyCompleted: boolean; completedReviewerIds: string[]; generation?: number; provenance?: 'automatic' | 'manual'; priorReadiness?: 'draft'|'ready'; createdReviewerIds?: string[]; invalidated?: boolean };
  syncFailure?: 'ready' | 'request';
};
export type Stack = { id: string; title: string; description: string; autoProgress: boolean; color: string; enrolled?: boolean };
export type Reviewer = { id: string; name: string; initials: string; color: string; specialty: string };
export type Activity = { id: string; at: string; prId?: string; stackId: string; message: string; kind: 'release' | 'review' | 'intent' | 'pause' | 'sync' };
export type Workspace = { schemaVersion: 1; workflowVersion?: number; prs: PullRequest[]; stacks: Stack[]; reviewers: Reviewer[]; activity: Activity[]; handledEventIds: string[] };
export type Command =
  | { type: 'start'; prId: string; early?: boolean }
  | { type: 'dependency'; prId: string; parentId?: string }
  | { type: 'approval-minimum'; prId: string; minimum: number }
  | { type: 'review'; prId: string; reviewerId: string; decision: Decision; eventId: string; contentVersion?: number; submittedAt?: string; dismissed?: boolean; eligible?: boolean }
  | { type: 'hold'; prId: string; held: boolean }
  | { type: 'ready'; prId: string; readiness: 'draft' | 'ready' }
  | { type: 'plan'; prId: string; reviewerIds: string[] }
  | { type: 'auto'; stackId: string; enabled: boolean }
  | { type: 'invalidate'; prId: string; validity: 'stale' | 'uncertain' }
  | { type: 'fail'; prId: string; step: 'ready' | 'request' }
  | { type: 'reconcile' };
