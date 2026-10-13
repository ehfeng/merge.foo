# Progressive-review contract

Source: [original behavior plan](product-plan.md#5-progressive-review-behavior) and [state ownership and synchronization proposal](product-plan.md#7-proposed-technical-structure). This separates agreed product behavior, adopted lab proposals and unresolved production policy.

## Agreed sequence

1. Publish a stack of existing PRs and record planned reviewer assignments.
2. The author explicitly starts the first review.
3. When the current PR meets the applicable approval requirement, release the next eligible PR: mark it ready if needed and activate its planned reviewer requests.
4. Repeat independently for each managed stack, subject to holds and its automatic-progression setting.

During the 2026-10-12 roadmap discussion, the user chose these first-release rules:

- Automate simple linear chains first. Branches and joins can be shown but are outside initial automatic progression.
- Default to one active approval, let the author require more per PR, and enforce applicable GitHub review requirements. An approval continues to count until dismissed or superseded by a newer decisive review, subject to the applicable review gate. Rebases and comments do not independently revoke it.
- Anyone can sign in independently. The user clarified that GitHub repository access supplies shared PR visibility and a separate teammate system is unnecessary. Coordinate reviewers, holds and progression through repository-scoped stack settings, with current action-specific permissions and actor-attributed history. Higher approval requirements remain author-controlled unless authority to change them is separately defined.
- Allow an authorized person to manually start a later review before upstream approval, with an upstream warning and activity record. This does not approve prerequisites, clear holds or bypass authorization. Later automatic releases still require prerequisite gates.
- If an upstream approval no longer satisfies the release gate, roll back affected automatic releases: remove outstanding requests created by that release and return a PR to draft if the automatic release made it ready. Keep planned reviewers, completed reviews, comments and history; respect explicit manual early-review overrides.
- A rebase, new commit or comment on A does not pause B while A still satisfies the approval gate. merge.foo does not impose an additional diff-freshness approval gate. If GitHub's applicable rules make the approval gate fail after a change, the actual gate failure triggers rollback.
- Use **planned assignment** for a reviewer chosen before release. Repository readers can see that assignment in merge.foo; creating or editing it sends no GitHub review request. Requests are held back until release. A suggestion remains a suggestion until a person accepts it into the plan.
- Use GitHub's suggested reviewers as the primary candidate source. Bias toward the same human across adjacent stacked PRs when the same code area is changed, adding explained continuity context to GitHub's suggestions. Preserve explicit choices and respect eligibility/applicable review requirements. This bias does not copy approvals from one PR to another or automatically create assignments/requests.

These are user decisions and engineering starting rules. The connected foundation implements public sign-in, repository-visible planned assignments and GitHub suggested candidates locally; durable holds/dependency corrections, author-configurable approval gates, release/rollback generations and provider-neutral storage are now implemented in source and tested locally. Real notification/hosted behavior and area-based continuity remain to verify or implement.

**Approval, not merge, advances review.** A can remain unmerged while B enters review. C remains queued until B's applicable gate is met. Checks, conflicts and other merge-only conditions do not replace the review gate.

“Open for review” activates an existing PR's review workflow. It does not create another PR, open a browser window or merge code. The interaction lab simulates these actions. The connected service queues durable work and has explicit GitHub write adapters; actual execution requires deliberate operator enablement, installation write permission, a current management grant and an authenticated background wakeup. Importing a graph does not enable writes.

## Keep state separate

| State dimension | Authority or owner | Current representation |
| --- | --- | --- |
| Observed lifecycle | GitHub | `lifecycle`: open, merged, closed |
| Observed readiness | GitHub draft/ready state | `readiness`; connected changes require explicit review intent, current grants and operator write enablement |
| Review decisions and active requests | GitHub | `reviews`, `requests`, and live `observedGate` |
| Planned assignments, hold and progression preference | merge.foo-owned repository/stack coordination settings | `plannedReviewerIds` persist in the connected SQLite store; `held`, explicit dependencies, minimum approvals and enrolled stack intent also persist in versioned workflow state |
| Checks and mergeability | GitHub | `checks`, `mergeability`; neither establishes review approval |
| Content validity and release progress | Workflow/synchronization layer | Lab `contentVersion`, `validity`, `release`, event/request keys |

Node labels such as Queued, In review, Changes requested, Approved and Held are derived presentations, not one authoritative status field. Merged/closed lifecycle remains separate. The lab adds Release pending, Stale review and Review uncertain to expose recovery. Live mode shows observed Draft/Ready separately from persisted planned assignments; planning does not change GitHub readiness.

## Adopted lab eligibility and recovery proposals

These rules implement conservative proposals from the plan; they still need platform and policy validation before live writes.

| Situation | Lab behavior | Production requirement or open question |
| --- | --- | --- |
| First PR has no prerequisite | Explicit Start review; readiness alone does not send a request | Preserve explicit start when enabling a managed stack |
| Approved predecessor is unmerged | Next eligible PR becomes ready and receives mock requests | Validate actual draft/ready and reviewer-notification semantics |
| Hold applies | Block release on that path; other stacks continue | Persist the stack hold and show the stop reason |
| Automatic progression is off | Show eligibility; require explicit Release | Never silently activate existing stacks on account connection |
| No planned reviewer | Show Choose a reviewer; send nothing | No silent assignment or notification |
| Several approvals are required | Count distinct eligible reviewers’ latest decisive submission by timestamp; comments do not replace decisions | Count active, non-dismissed approvals using authoritative decisive-review chronology and applicable repository policy. Comments do not supersede approvals |
| An earlier prerequisite becomes stale or uncertain | Rebases/content annotations preserve satisfied approval; unavailable approval verification defers new releases; confirmed decisive gate loss rolls back automatic descendants | This mock freshness rule is superseded: preserve released reviews while the authoritative approval gate remains satisfied; confirmed gate failure triggers rollback |
| Same approval event arrives repeatedly | Ignore its exact event ID; repeated reconciliation does not duplicate requests | Persist deduplication across workers and restarts |
| Readiness succeeds but requesting a reviewer fails | Record completed steps; retry only pending steps after rechecking eligibility | Persist an action/outbox record and reconcile ambiguous upstream outcomes |
| Future plan changes after review starts | Keep active requests and the release-time target snapshot unchanged | Plan edits do not alter active requests; rollback is a separately disclosed automatic action. Other request changes require an explicit action |

Current code represents a single parent per PR. Rendering can show branches; the user chose to defer branching/multiple-parent automation and allow explicit out-of-order review starts. Manual early starts, attributable rollback and explicit dependency correction are implemented in source with local tests. A merged ancestor satisfies its release gate; handling real merged ancestry remains unverified.

## Approval and content validity

The fixture and durable workflow gates use the latest decisive submission chronology per reviewer, excluding comments and dismissed/ineligible/author approvals. A duplicate approval from one person does not satisfy a two-person minimum. Content-version annotations do not independently revoke approval. The connected observer reads actual current reviews and applicable GitHub policy separately from the author minimum; incomplete decisions or policy evidence defer new writes.

Live reads use GitHub's observed `reviewDecision`; historical individual approvals do not substitute for a failing applicable policy gate. The live `validity: 'fresh'` field is a normalization placeholder, not evidence of diff-validity analysis or authorization for future writes. Production must also enforce the author's minimum, including when GitHub imposes no approval requirement.

The user clarified on **2026-10-12** that approval remains approval: a rebase, new commit, diff-freshness uncertainty or comment must not independently pause B while A still meets the approval gate. GitHub may dismiss approvals or require approval of the latest push under repository rules; those actual gate changes must be respected. merge.foo does not add its own content-freshness veto. If the current approval gate cannot be read or its requirements cannot be established, defer new automatic writes and show synchronization uncertainty; preserve B's existing state until gate loss is confirmed.

The lab was updated to these agreed semantics: comments and rebases preserve active approvals, delayed older decisions cannot replace newer feedback, and actual upstream gate loss rolls back automatic descendants. Browser and unit fixtures verify this without sending GitHub writes.

The chosen production gate combines the author's configured minimum (one active approval by default) with applicable GitHub review policy; satisfying one does not waive the other. Reviewers need eligible, non-dismissed approvals; newer decisive changes-requested reviews and dismissals must be handled according to policy and authoritative chronology. A comment-only review leaves the decisive state unchanged. The workflow service combines this policy evidence with the persisted author-configurable gate. A null GitHub decision is treated as no review policy only after ruleset and classic protection checks establish that; otherwise it remains unknown. [GitHub's review requirements](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

### Rollback on upstream approval loss

The user approved this rule on **2026-10-12**, replacing the original proposal to preserve active requests after confirmed upstream approval loss. If a newer decisive change request, dismissal or change in applicable GitHub/author review requirements makes an upstream approval gate fail, pause new releases on the affected path and undo downstream automatic releases that depended on it. A code change triggers rollback only when the applicable review rules actually invalidate the gate; a rebase or comment by itself does not. Other independent stacks continue.

For each affected open PR, remove only outstanding review requests attributable to its automatic release. Return it to draft only if that release changed it from draft to ready and the state has not been superseded by a manual or external action. Preserve the planned reviewer assignment and all submitted reviews, comments and history. An explicit manual early-review override remains in effect; it does not approve the upstream PR or authorize further automatic progression.

For example, A's approval automatically makes B ready and requests Sam's review. A then receives a blocking change request. Retract that pending request, restore B's prior draft state and record the reason. When A qualifies again, recheck holds, management scope, approval gates and reviewer plans before starting a new release generation. If B had already automatically released C, apply the same rollback rule to C. Merged/closed PRs are lifecycle outcomes, not candidates for returning to draft.

Rollback is a recorded, recoverable action with completed and pending steps. Repeated invalidation must not repeat completed changes, and old release retries must not reactivate a rolled-back generation. Reconcile ambiguous GitHub outcomes and later manual changes before retrying. Removing a pending request does not erase submitted reviews; converting to draft does not unsubscribe existing notification subscribers. [GitHub review-request removal](https://docs.github.com/en/rest/pulls/review-requests#remove-requested-reviewers-from-a-pull-request), [draft conversion](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/changing-the-stage-of-a-pull-request)

This behavior is implemented in the lab and durable service. The scoped live pilot verified attributable request removal/draft restoration, reapproval and B/C cascade rollback with plans/history and B's approval retained. Live rebase/dismissal/policy/manual-override/failure cases remain unverified. Webhook reliability is unresolved and the pilot is paused; see [pilot evidence](pilot.md). The original uploaded plan remains unchanged.

## Management scope and notification boundary

The product target defaults progression on **within explicitly enabled management scope**, after an explicit first review. Connection alone does not grant management scope. Repository collaborators coordinate shared scope and stack settings using the permissions required for each action, with a record of the actor for each change. No separate merge.foo teammate membership is required. Imported stacks have progression off. Authorized controls can save app-owned intent without GitHub notifications; actual release requires explicit enrollment/start and operator/background gates.

Before live writes, show who will receive attention requests, what readiness changes occur, why the PR is eligible and why each reviewer was chosen. Keep suggestions, planned assignments and already-sent requests distinct. A planned assignment is visible repository coordination data, not a user-only secret and not a GitHub request. Retry logic must explain completed and pending steps and re-read current intent, prerequisites and repository policy.

Making a draft ready can automatically request code-owner reviews; explicit reviewer requests also notify recipients. The preview and recovery design must include these platform effects, then re-read actual requests after readiness to avoid blindly re-requesting a reviewer. Current documentation establishes these effects; selected-repository integration still needs verification. [GitHub readiness behavior](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/changing-the-stage-of-a-pull-request), [review-request API](https://docs.github.com/en/rest/pulls/review-requests)

The lab's browser storage and exact-event keys demonstrate the interaction contract. They do not guarantee cross-session GitHub delivery, concurrency safety or durable notification idempotence. See the [future architecture](architecture.md#proposed-production-extension) and [acceptance checklist](acceptance.md).
