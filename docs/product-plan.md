# merge.foo — Product summary and implementation plan

## 1. Product summary

**merge.foo is a graph-first workspace for getting code reviewed, unblocked, and merged.** It connects to GitHub and replaces a flat pull-request inbox with a visual map of PR stacks, review dependencies, and the people whose attention is needed next.

The product is outcome-oriented: pull requests are an intermediate state; **merging is the goal**. It coordinates reviews rather than initially replacing the code-reading and commenting experience.

The homepage is one diagram containing multiple independent stacks. Its visual direction is Mermaid-like clarity—compact nodes and explicit connections—with the polish, restraint, and opinionated workflow associated with Linear. Mermaid itself is neither the implementation requirement nor the product goal.

**The defining workflow is progressive review.** Authors can publish an entire stack and plan reviewers without requesting every review immediately. By default, approval of one PR releases the next PR for review, without waiting for a merge. Authors can hold individual PRs or disable automatic progression for a stack.

**Chosen name/domain:** merge.foo. This records the naming decision, not domain registration status.

**Candidate tagline:** “The shortest path to merged.”

## 2. Agreed product direction

| Decision | Product consequence |
| --- | --- |
| Focus on the outcome of merging | Prioritize actions that unblock important code, not PR administration for its own sake. |
| Graph-first homepage | Dependencies and independent stacks are visible together; a table is not the primary interface. |
| PR nodes first | Start with PRs as the visible entities. Linked issue context can enrich them without adding issue nodes. |
| Linear-like product feel | Use restrained visual design, consistent interactions, and clear workflow defaults. This is not an affiliation claim. |
| Edit readiness and reviewers in the graph | Routine coordination should not require navigating away from the work map. |
| Plan reviews before requesting them | A planned reviewer is not yet being asked to spend attention on that PR. |
| Advance on approval by default | Release the next eligible PR when the predecessor satisfies the approval requirement; merging is not the trigger. |
| Allow exceptions | Support explicit holds and per-stack automatic-progression controls. |

The remaining implementation details below are proposals unless identified as agreed behavior.

## 3. The daily questions the product must answer

| User question | Information and action needed |
| --- | --- |
| What do I need reviewed today, and by whom? | The active review point in each stack, required reviewer decisions, and an assignment action. |
| How urgent is this issue or its downstream work? | Direct priority, downstream dependencies, and an explanation of inherited urgency. |
| How complex is this review? | Raw LOC, effective LOC, change summary, complexity, and risk—not one undifferentiated score. |
| How long have I been waiting, and should I ping? | Review-request age, meaningful subsequent activity, and last-ping history. |
| What is this person’s review load? | Active requests, upcoming planned reviews, and work I have requested from them over the past seven days. |

**Proposed default scope:** my authored PRs and the reviewers I am waiting on. Team, repository, and “needs my review” scopes can reuse the graph later.

## 4. Homepage and graph design

### One canvas, not separate stack cards

Show multiple independent stacks as disconnected groups in one coherent diagram. Use a consistent base-to-tip orientation; left-to-right is the initial layout proposal.

An arrow from A to B means **B depends on A**. Position communicates dependency, not status: an upstream PR may already be approved while its downstream PR is waiting for review.

Prioritize stable layout. A new review, status change, or selection should not unnecessarily move nodes and destroy the user’s spatial context. Retain only enough merged ancestry to keep the active stack understandable.

The main visual question is: **Where is each stack waiting, and what opens next?**

### Compact, consistent PR nodes

| Always visible | Available on hover or selection |
| --- | --- |
| PR number and short title | Change summary and affected areas |
| Review state | Raw LOC and effective-LOC explanation |
| Planned or active reviewer | Complexity and risk rationale |
| Active waiting time, when applicable | Linked issue priority and downstream impact |
| Compact effort/risk indicators | Reviewer workload and recent request history |
| Hold or automatic-progression exception | Blockers, review history, and next action |

Use consistent node dimensions rather than making large changes physically larger. Distinguish status with text and shape as well as restrained color. Avoid showing every metric at equal prominence.

### In-context actions

Users should be able to set a PR ready for review, hold it, choose planned reviewers, and inspect reviewer load from its node. Clicking the node opens a side panel for explanation and less frequent actions.

For an active review, distinguish changing a future plan from adding or removing a real review request. Show notification effects before an action that requests someone’s attention.

A selected PR should highlight its upstream blockers and downstream dependents. A suggested next action should highlight the relevant graph location rather than replace the diagram with a competing queue.

## 5. Progressive-review behavior

### Default sequence

An author publishes a stack and assigns planned reviewers. The author starts the first review. When that PR meets its approval requirement, merge.foo makes the next existing PR ready for review as needed and sends its planned review requests. The process repeats independently within each stack.

**“Open for review” means activate the existing PR’s review workflow. It does not mean create another PR, open a browser window, or merge code.**

Opening review must not depend on merge-only conditions. Conversely, passing the review gate does not establish that a PR is mergeable.

### User-facing states

| State | Meaning |
| --- | --- |
| Queued | Planned for review; automatically activates after its predecessor is approved. Planned requests have not been sent. |
| In review | Ready for review; review requests are active. |
| Changes requested | Author action is needed before the approval requirement can be met. |
| Approved | The approval requirement is satisfied; this can release the next queued PR. |
| Held | Explicit instruction not to release this PR automatically. |
| Merged / closed | Lifecycle outcomes, shown separately from review progression. |

**Implementation proposal:** do not store these as one overloaded status enum. Keep author intent/readiness, review decisions, GitHub lifecycle, and technical checks as separate properties, then derive the node’s presentation.

### Release eligibility

The proposed automation should release a PR only when it is queued, its predecessor satisfies the applicable approval requirement, automatic progression is enabled, no hold applies, and planned reviewers are available. For a first PR with no predecessor, the author explicitly starts review.

| Situation | Proposed behavior |
| --- | --- |
| Parent approved but not merged | Release the next eligible PR immediately. |
| Next PR held | Stop at that PR; do not affect other stacks. |
| Automatic progression disabled | Indicate eligibility, but require manual release. |
| No planned reviewer | Show “Choose a reviewer”; do not silently pick someone. |
| Multiple approval requirements | Wait for the applicable requirement, not merely the first approval event. |
| Prerequisite approval later becomes invalid | Pause further releases and flag affected active reviews for attention. |
| Duplicate approval event | Do not send duplicate review requests. |
| Partial synchronization failure | Show what succeeded, what remains pending, and allow a safe retry. |

Queued reviews should appear as upcoming work in a reviewer’s load, not as already-requested work.

### Changes and stale reviews

Upstream feedback can change downstream diffs. The product should track which diff a review applies to and distinguish changed content from identity-only changes where possible.

Do not infer content staleness solely from changed commit identifiers. When validity cannot be determined, show uncertainty rather than claiming a review is fresh.

**Proposed conservative behavior:** preserve review history, flag potentially stale downstream reviews, and pause further automatic releases while prerequisites are unresolved. Do not silently withdraw active requests or discard review decisions. Exact GitHub approval and draft-state interactions require validation during implementation.

## 6. Review intelligence

### Effort, complexity, and risk are different

| Signal | Proposed definition |
| --- | --- |
| Raw LOC | Added and deleted lines, displayed consistently. |
| Effective LOC | A transparent estimate of meaningful review volume after discounting configured low-signal changes. |
| Complexity | Structural difficulty: affected components, interfaces, control flow, and interactions. |
| Risk | Potential impact of a mistake, informed by affected areas and the nature of the change. |
| Change summary | What changed and what a reviewer should pay attention to. |

Generated files, vendored content, lockfiles, and formatting-only changes are candidates for separately disclosed discounts. Do not treat them as universally irrelevant or silently exclude tests. Show the calculation’s rules and allow repository-specific configuration.

Initial complexity and risk labels should be explainable estimates, not claims of validated prediction. A small sensitive change can deserve more attention than a large mechanical change.

### Priority and downstream urgency

Use both a PR’s own linked issue priority and the importance of work it blocks. Count and explain downstream impact without equating a large stack with an urgent stack.

Prefer an explanation such as “Blocks three PRs, including an urgent billing fix” over an opaque priority score. Initially use manual priority where linked issue information is unavailable; add Linear-derived context without introducing issue nodes.

### Waiting and ping context

Measure active review waiting from an actual review request, not from PR creation or private reviewer assignment. Show the last request, meaningful reviewer activity, and last recorded ping separately.

Requests waiting on author changes should be distinguishable from requests waiting on a reviewer. Do not reset waiting time merely because the graph synchronized or a mechanical update occurred.

Start with ping context and explicit user-triggered actions. Unattended reminder campaigns are outside the initial scope. Show the limits of ping-history coverage rather than claiming to detect every message across communication channels.

### Reviewer load

Keep four views distinct: active outstanding requests; upcoming planned requests; requests sent by the current user over the past seven days; and recent completed reviews.

Show raw counts alongside estimated effort. Label whether coverage is limited to connected repositories or includes a broader team scope. Request load is not proof of someone’s total workload, availability, or performance.

## 7. Proposed technical structure

No implementation language or graph library has been selected.

| Component | Responsibility |
| --- | --- |
| GitHub integration | Read authorized PR, branch, diff, review, and check information; execute supported readiness and reviewer actions. |
| Normalized work graph | Represent PRs, dependency edges, reviewers, plans, and current observed state. |
| Review workflow engine | Evaluate release eligibility and carry out idempotent state transitions. |
| Signal computation | Produce effort estimates, urgency explanations, wait metrics, and reviewer-load summaries. |
| Graph interface | Render stable layouts, inline controls, filtering, and the selected-PR panel. |
| Activity log | Explain releases, holds, assignments, failures, retries, and manual overrides. |

### State ownership

GitHub is authoritative for observed PR lifecycle and actual review events. merge.foo owns private reviewer plans, explicit holds, progression settings, and its own action history. Linear can supply linked issue priority and dependency context when connected.

Dependency edges should include provenance: observed branch relationship, explicit declaration, or another supported source. Surface ambiguous relationships instead of silently inventing stack order.

### Synchronization and write safety

Use event-driven updates plus reconciliation so the graph can recover from missed events. Re-evaluate current eligibility before sending review requests. Persist action state so retries cannot repeat already-completed steps.

Automation should operate only within clearly disclosed, user-authorized management scope. Within that scope, progressive review defaults to on; connecting GitHub should not silently activate every existing draft stack.

Before implementing write behavior, validate permission requirements, draft/ready transitions, automatic reviewer notifications, code-owner interactions, approval validity, and applicable repository rules against current GitHub behavior.

## 8. Build plan

These milestones are a development sequence. The intended MVP includes both the graph and progressive-review actions, not just a read-only dashboard.

### Milestone 1 — Interaction model and prototype

Build a representative canvas with at least three independent stacks, including one of four or more PRs. Exercise queued, active, approved, held, and changes-requested states.

Prototype inline readiness, planned reviewer selection with load context, and a side panel. Demonstrate approval-driven progression while the approved parent remains unmerged.

**Exit condition:** the user can identify each stack’s active review point, its next reviewer, and any explicit hold without opening every node.

### Milestone 2 — Connected graph and review context

Connect authorized GitHub repositories; ingest PRs, actual review requests, decisions, and diffs. Derive dependency relationships where reliable and provide a correction path where ambiguous.

Add stable graph layout, baseline LOC, review waiting time, private reviewer plans, and workload counts. Implement a recoverable synchronization model.

**Exit condition:** the graph reflects real stacks and clearly distinguishes planned from active review work.

### Milestone 3 — Readiness and automatic progression

Implement readiness actions, explicit holds, per-stack progression settings, actual reviewer requests, and approval-triggered release. Handle missing reviewers, external changes, duplicate events, and partial failures.

Add an activity log that answers “Why did this PR open for review?” and “Why did this stack stop?”

**Exit condition:** approval of A activates B without merging A; C stays queued until B is approved; a hold affects only the intended path.

### Milestone 4 — Intelligence and launch hardening

Add explainable effective LOC, change summaries, complexity/risk indicators, weighted reviewer load, and reliable ping context. Incorporate linked Linear priority and downstream issue information while retaining PR-only nodes.

Test realistic graph sizes, stable navigation, synchronization recovery, permissions, and action transparency. Ensure estimates and incomplete coverage are labeled.

**Exit condition:** the product answers all five daily questions and safely supports the complete progressive-review workflow.

## 9. MVP acceptance scenarios

| Scenario | Expected result |
| --- | --- |
| Several independent stacks are active | All appear on one canvas and advance independently. |
| A four-PR stack has all reviewers planned | Only released PRs send review requests; later work remains visibly queued. |
| A is approved and remains unmerged | B opens for review automatically. |
| B is explicitly held | Approval of A does not release B. |
| Automatic progression is off | Eligibility is visible; release requires an explicit action. |
| B has no planned reviewer | The graph requests an assignment rather than choosing or notifying someone silently. |
| An approval event is replayed | No duplicate review requests are sent. |
| A prerequisite review becomes invalid | Further releases pause and affected reviews are flagged. |
| A reviewer has planned and active work | Both are shown separately, alongside the user’s seven-day request history. |
| Data or notification coverage is incomplete | The UI states the limitation instead of presenting a complete-looking total. |

## 10. Decisions still to resolve

| Question | Recommended starting point |
| --- | --- |
| What exactly counts as approved? | A visible, per-PR review gate that respects applicable policy; do not treat any single approval as universally sufficient. |
| How does readiness map to GitHub draft status? | Map the release action explicitly and disclose notification side effects after validating platform behavior. |
| What stack shapes belong in the first automation release? | Support multiple independent chains first; define branching and multiple-parent release rules before enabling those shapes. |
| Can an author review out of order? | Allow an explicit manual override with a clear upstream warning; never interpret it as automatic approval. |
| How should stack order be established? | Use reliable observable relationships and an explicit correction path; defer general graph editing. |
| What is the default response to upstream changes? | Flag affected reviews and pause further releases; preserve history and active requests. |
| How should waiting time and effective LOC be calculated? | Publish simple initial definitions and expose the assumptions rather than hiding them in scores. |
| How much Linear integration is required at launch? | Linked priority and downstream context are the target; issue nodes remain outside the PR-first MVP. |

## 11. Boundaries and success measures

The initial product is not a full code-review editor, an autonomous code-merging agent, a generic graph explorer, an employee-performance dashboard, or a mixed issue/PR planning system. Automatic review release must never be presented as automatic merging.

Success means faster movement from requested review to useful decisions and from those decisions to merge, without increasing stale downstream review work or concentrating too much load on one person. Track time to first review, review-cycle waiting, avoidable re-review, assignment-to-release delay, and time to merge with repository context—not as simplistic individual rankings.

**Product principle:** Show the topology of the work, make the current review blockers obvious, and automatically move attention forward when the preceding review is complete.
