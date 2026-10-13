# Roadmap and decision register

The [original build plan](product-plan.md#8-build-plan) defines the milestones. Later choices select vinext, provider-neutral hosting, real GitHub data and a public App. The user separately approved a single-repository live pilot and six test reviews. That pilot passed its review sequence; webhook delivery reliability and wider launch verification remain open. See [pilot evidence](pilot.md).

The user-purchased `merge.foo` domain now serves the existing app with valid HTTPS, a canonical redirect from the old address and verified normal GitHub sign-in. [Domain configuration](domain.md) records the cutover without changing paused workflow intent or credentials.

## Milestones

| Original milestone | Exit condition | Current status | Work still required |
| --- | --- | --- | --- |
| 1. Interaction model and prototype | Identify each stack's active review point, next reviewer and hold without opening every node | Demonstrated and tested in the explicit mock lab, with three independent stacks and a four-PR chain | User assessment of the scanability exit condition; validate with representative real work |
| 2. Connected graph and review context | Real stacks reflect requests/decisions; plans and active work are distinct | Deployed; real OAuth, three-PR graph, suggestions and durable plans verified as `ehfeng` | Another real user, representative repositories, fuller ancestry/diff/area context and personal plan ownership |
| 3. Readiness and automatic progression | A approval activates B before merge; C waits for B; hold affects only its path | Scoped live pilot passed holds, real requests, comments, reapproval, cron progression and cascade rollback | Resolve intermittent webhook 500s; verify complex policies, rebases, revocation, manual overrides and failure recovery live |
| 4. Intelligence and launch hardening | Answer all five daily questions and safely support the full progressive workflow | Fixture estimates and bounded read-context UI only | Explainable configurable effective LOC, summaries, risk/complexity, weighted workload, ping context, linked Linear priority, large-graph and permission/recovery testing |

The prototype is not the complete MVP. The intended MVP includes progressive-review actions; stopping at a connected read-only dashboard would leave milestone 3 unmet.

## Unresolved decisions

The register distinguishes user decisions from proposals and implementation or verification work. A resolved product choice does not mean its implementation is complete.

| ID | Decision | Current proposal or constraint | What resolves it |
| --- | --- | --- | --- |
| D1 | GitHub App public or private? | **Resolved: public; anyone can sign in independently.** Public manifest and numeric identity/repository checks are implemented. | Existing public App, local/hosted OAuth and selected three-PR pilot verified; another real user and representative repositories remain |
| D2 | What exactly counts as approved? | **Resolved:** one active approval by default; author may require more. Enforce applicable GitHub requirements and retain nondismissed approvals while the gate passes. | Implemented; pilot verified decisive reviews/comments with authenticated no-policy proof. Broader rules, code owners, dismissal/push policy and approval minima need live checks |
| D3 | How does readiness map to GitHub draft state? | Make the existing draft ready as needed, then send planned requests; preview possible automatic code-owner effects. | Real transitions/requests and attributable draft rollback verified in pilot; real CODEOWNERS behavior remains untested and Contents access remains absent |
| D4 | Which stack shapes can be automated initially? | **Resolved by the user on 2026-10-12:** simple linear chains first; branching automation later. Other shapes can remain visible on the graph. | Validate complete acyclic chain topology; keep branching, joins and ambiguous/incomplete relationships outside automatic progression |
| D5 | Can review start out of order? | **Resolved:** allow an authorized manual start with upstream warning and activity record. | Override source/UI locally verified; live override/provenance checks remain. It never approves upstream work or bypasses holds/permissions |
| D6 | How is stack order corrected? | Narrow Depends on PR declare/clear UI and actor/provenance are implemented. | Validate actual correction and recovery on representative live graphs; cycle/fork/ambiguity handling is locally tested; general graph editing remains deferred |
| D7 | How should upstream changes affect reviews? | **Resolved:** rebases/comments preserve a passing gate; actual gate loss retracts automatic requests and restores attributable draft state. Preserve plans/history/manual overrides. | Implemented; real comments, reapproval and B/C cascade passed with B approval retained. Live rebase/dismissal/manual/failure cases remain; unreadable gates defer writes without blind rollback |
| D8 | Waiting time and effective-LOC definitions? | **Recommended counting rules:** wait begins at an actual request, unknown when absent; raw LOC is additions plus deletions. Use raw LOC until explicit repository discounts exist; tests count fully. | Publish coverage and production counting rules; implement explained repository-specific generated/vendor/lockfile/formatting discounts without silently inventing estimates |
| D9 | How much Linear integration is required at launch? | **Resolved by the user on 2026-10-12: ship the GitHub workflow first**, then add linked Linear priority. Keep PR-only nodes. | Complete the GitHub release without blocking on Linear; retain linked priority/downstream context in the later intelligence milestone |
| D10 | Durable storage, delivery and retries? | Retain deployed SQLite Durable Object; no external database prerequisite. Blob remains a candidate and PostgreSQL an implemented portability option. | Real state, background credentials, cron and effects verified in pilot; resolve intermittent webhook 500s and test wider recovery/capacity. Define unpublished personal plan ownership |
| D11 | How is management scope activated? | **Clarified by the user on 2026-10-12:** repository access provides the shared PR network; a separate merge.foo teammate system is unnecessary. Anyone can sign in. View all authors' PRs in an accessible connected repository; actions follow applicable GitHub permissions. Explicitly chosen stacks; first review starts explicitly; imported stacks remain off. | Implement repository-wide graph coverage, per-action permission checks, repository-scoped plans/settings, conflict handling, notification preview and actor-attributed history; separately validate/approve actual write access |
| D12 | Workload/history scope? | **Recommended starting scope:** connected repositories; active and planned work separate; current actor's sent requests over seven days and distinct completed-review episodes. Management can be shared without claiming total team availability. | Persist requester and episode identity, count completions without replay duplicates, label repository/team coverage and unknown ping history |
| D13 | Planned assignment or immediate request? | **Resolved:** plans hold back requests until release; suggestions do not assign or notify. Current plans use repository scope. | Real persistence and no-request-on-save verified; release timing passed. Define unpublished personal plan ownership before expanding planning |
| D14 | How should reviewer context carry across a stack? | **User requirement on 2026-10-12:** use GitHub's suggested reviewers as much as possible, as the primary candidate source; add a continuity bias for repeated code-area changes, with explained upstream-review/path evidence. | Fetch/display GitHub suggestions first; preserve explicit choices and baseline order unless an explained refinement applies; handle missing candidates/required specialists visibly; do not build a separate general ranking engine or carry approval between PRs |
| D15 | How should repository structure explain reviewer selection? | **User requirement on 2026-10-12:** a linked area diagram and explanations for why people are selected, including frontend/backend and cron/Temporal work where relevant. Exact taxonomy/layout remains proposed. | Define configurable area mapping, evidence for relationships, touched-area highlighting and reviewer reasons; validate any required repository-content read access separately |
| D16 | Who is the primary audience? | **Clarified by the user on 2026-10-12:** personal productivity for a developer delivering a complex feature, using a map over GitHub. The product should be useful without colleagues adopting it. Full-repository context and open sign-in remain. | Center the individual's review/release workflow; define personal planning versus common records of real PR actions. Keep existing GitHub permission checks; no separate team, membership or viewer product |
| D17 | Operator setup versus user onboarding? | Operators configure one product App; developers authorize it and use accessible repositories. | Onboarding/recovery separated; existing App and normal local/hosted access verified. Pilot background key/webhook/runner setup complete; helpers remain first-time-only |
| D18 | What should the primary visualization feel like? | **User requirement on 2026-10-12:** an interactive map with a few controls, closer to Google Maps than Gmail. The graph is the main viewport; navigation and details are contextual. | Continuous pan/zoom canvas, compact PR markers, floating search/filter/zoom controls and temporary desktop/mobile details implemented locally; verify product intent with the prototype. Repository-area layers remain planned |

## Account setup checkpoint

The public App has accepted PR-write access, signed subscriptions and scoped background credentials. Its original installation selected only `ehfeng/merge.foo`; [later self-service verification](onboarding.md) observed broader connections chosen through GitHub, while background scope stayed pilot-only. Hosted/local OAuth, the pilot graph, suggestions, plans, holds, progression and rollback passed, including native cron. PRs remain unmerged; B/C are draft and B's approval survives. Automation/operator writes are paused due to unresolved webhook 500s. [Pilot.md](pilot.md) preserves the review evidence; [onboarding.md](onboarding.md) records the current deployment. Another real user and complex repositories remain unverified.

The public App audience was chosen on **2026-10-12**. The local helper was updated to prepare a public read-only registration, and all nine setup tests passed. Runtime sign-in now accepts any GitHub user and ignores the legacy owner field. File existence does not verify registration, installation, OAuth authorization or hosted configuration. Operators continue from the existing App/configuration rather than creating a duplicate or rerunning a first-time helper. The setup guide separates [normal onboarding](setup.md#normal-user-onboarding) from [operator setup and recovery](setup.md#operator-setup-and-recovery).

## Proposed next sequence

1. Diagnose intermittent webhook failures and verify recovery under deployment/runtime contention before resuming automatic effects.
2. Validate another real user and representative GitHub policy/topology/revocation/manual-override cases within deliberately approved repositories.
3. Define unpublished personal plan ownership, then enrich GitHub suggestions with changed-file/area/upstream-review evidence and a linked repository diagram.
4. Complete launch hardening and the [acceptance matrix](acceptance.md), adding linked Linear priority afterward.

The first usable release focuses on GitHub and progressive review. The user chose to add linked Linear priority afterward; this changes the release sequence while retaining the later intelligence target.

Reviewer continuity and repository diagrams are new requirements from 2026-10-12. Prioritize fetching GitHub's documented reviewer suggestions, then enrich that baseline with paginated changed-file metadata, explicit area mappings and observed stack reviews. Record planned assignments without requests. Full repository structure/CODEOWNERS inspection needs a content-read design beyond the current permissions; it has not been enabled. See [reviewer context and repository diagrams](product.md#planned-assignments-and-reviewer-continuity).

### Sign-in and collaboration

Anyone can sign in independently and use their connected work. With repository read access and App access, the repository map should show the full PR network across authors. My work is an optional filter, not the boundary of what a user can see. Load the required pages and ancestry; disclose incomplete coverage. Repository visibility and actions respect the access available to both the signed-in GitHub user and the App. An empty installation or insufficient repository access should lead to setup guidance rather than an account allowlist.

The user clarified that a separate teammate model is unnecessary. Use existing GitHub repository access for full-map visibility and action-specific permissions for real effects. The current implementation persists plans, holds and progression settings at repository/stack scope with actor-attributed history. Separate merge.foo teams, invitations and custom membership roles are outside the chosen initial scope.

The primary user is the individual developer delivering a complex feature; the current vision is personal productivity. Full-repository context supports that person's work. Frame permission work as ordinary enforcement for real GitHub actions. The current shared plans/settings are an implementation boundary, not a settled requirement for team coordination. Define unpublished plan ownership before expanding planning. Prefer the deployed Durable Object for now; private Vercel Blob is a researched candidate, and external PostgreSQL remains optional. See [personal-first storage](hosting.md#personal-first-storage-direction).

## Concrete implementation blockers

| Blocker | Next deliverable | Completion evidence |
| --- | --- | --- |
| Public audience and real account access | Multiple-user sign-in with current identity/repository checks and normal-user onboarding; isolate operator setup UI; verify the existing App and one selected repository | Users authorize the existing App and never handle credentials/helpers; private preferences/inaccessible repositories remain isolated; readers see all authors' PRs; uninstalled repositories are rejected; actual PRs appear locally and hosted |
| Persisted plans and repository coordination | Durable repository-scoped plans, holds and stack settings; per-action permission checks and versioned edits; actor-attributed activity | Repository collaborators with the required permissions can coordinate one stack across sessions; denied/revoked access and concurrent edits are handled |
| Reviewer context and repository diagrams | Changed-file/area mapping, upstream review evidence, GitHub suggestions, ownership provenance and a repository map linked to PRs | Repeated code-area changes favor the contextual reviewer; new areas surface specialists; every reason links to evidence; accepted plans send requests only at release |
| Trustworthy relationships and recovery | Repository-wide pagination across authors, fork-aware edge provenance, narrow dependency correction, merged ancestry, complete-chain eligibility and refresh cancellation | The map is not restricted to the signed-in user's authored PRs; ambiguous/incomplete graphs cannot progress; late refresh responses cannot replace the current repository; failed refreshes recover |
| Background authorization and live progressive review | Scoped installation-token authentication, secure App key/webhook secret, durable management grants and revocation checks; authoritative approval gate, notification preview, explicit stack activation, readiness/reviewer adapter and durable release/rollback recovery | Progression works after the browser closes; revoked scope stops actions; A approval starts B before merge; rebases/comments keep B active while the gate passes; confirmed loss rolls back automatic releases; manual overrides/history and recovery remain |
| GitHub release hardening | Honest request/history coverage, explainable review estimates, graph-size and permission/recovery checks | Relevant acceptance scenarios pass on representative real work; linked Linear priority follows this release |

These are development priorities, not permission to deploy, publish, send notifications or modify GitHub. See [architecture.md](architecture.md) for current boundaries and production proposals.

## Connected foundation implementation — 2026-10-12

Implemented locally: public encrypted GitHub sessions with fresh numeric identity checks; normal user repository/install onboarding; every author’s paginated open PR graph; fork-aware dependency inference and bounded recent merged ancestry; GitHub’s ordered suggested reviewers; and durable shared planned assignments with stable reviewer snapshots, actor history, current access checks and optimistic conflicts. Assignments send no GitHub writes. The author or a repository writer/maintainer/admin may edit; readers see shared plans.

Local unit/API, helper/browser, build and SQLite restart checks cover the foundation. Later live pilot evidence verifies actual authorization, selected data, persisted plans and gated effects. Open graphs have a 5,000-PR fail-closed bound; merged ancestry is matching branches among the latest 100 merged PRs. Rich reviewer continuity/area diagrams remain later work.

## Durable workflow and portability source — 2026-10-12

The next implementation extends the connected foundation with persisted holds and explicit dependency corrections, author approval minima, explicit management enrollment, chronological active approvals, release/rollback generations, claims, uncertain-outcome recovery, signed webhook inbox and independent authenticated wakeups. The lab is updated to retain approvals across comments/rebases and roll back only on actual gate loss. Source adapters support actual GitHub effects but remain operator/permission/scope gated; local fixtures do not establish real notifications or hosted launch.

Cloudflare, Node and Vercel builds share a typed state interface with external PostgreSQL as the common option and the preserved SQLite object as an optional Cloudflare adapter. Actual PostgreSQL and SQLite tests verify CAS/audit, competing claims, scope/inbox isolation and restart persistence; PostgreSQL also exercises the real workflow service with fake release/rollback effects. Provider-specific generated outputs are compiled and smoked locally. See [hosting.md](hosting.md).

GitHub's null review decision requires no-approval-policy proof; missing policy/provenance defers new writes and preserves active reviews. Cloudflare Free's external-request budget is a launch constraint: representative multi-PR observations/dispatch must fit the bounded call budget before enabling writes. No paid upgrade is silently assumed. Rich area/continuity diagrams, branching automation and Linear remain later work.

## Historical initial real-account verification — 2026-10-12

The user confirmed public visibility of the existing `merge-foo` App (ID `5281176`), approved installation `170800499` for all repositories and authorized normal merge.foo OAuth sign-in. The agent verified public App metadata: current Pull requests/Checks/Commit statuses/Metadata read permissions, no event subscriptions. The chosen public pilot `ehfeng/merge.foo` (repository ID `1416175510`) loaded successfully as an authenticated empty graph. See the connected pilot and public App confirmation.

This verifies local sign-in, accessible repository selection and the actual empty response, not a second real user, real stacked PR/review data, actual reviewer requests/rollback, live per-PR plan persistence, background keys/webhooks or the updated hosted deployment. No notifications or GitHub write actions were sent. Source fake fixtures remain separate from these account facts. Future background scopes/tokens must remain explicitly limited to the selected pilot even though the human chose broader App installation access.

## Historical hosted foundation checkpoint — 2026-10-12

The foundation was published to the existing workers.dev site, first as source version `6c58ecd7-f2c6-4854-9c8c-5cba088a8aa7`, then as active authentication-configured version `03570981-066d-44a7-a794-97165b0ac2d2` at `2026-10-13T01:49:09Z` (October 12, 6:49pm PDT). Existing GitHub client credentials were reused securely and the production session secret is separate. Hosted OAuth/repository selection and the actual zero-PR pilot map succeeded; the deployed Durable Object shared-state reads succeeded. Hosted pilot, hosted access checks.

The foundation checkpoint initially had a public/read-only App with no events and staged, unsaved Pull requests write permission. Deployment and hosted basic access are verified; the subsequent approved pilot setup is recorded below.

## Historical scoped-pilot setup checkpoint — 2026-10-12

The user approved Pull requests write, installation access restricted to `ehfeng/merge.foo`, and three small bot-authored test PRs with only `ehfeng` as reviewer. The installation restriction was saved first, then the App permission and installation update were accepted. Saved scope and permission. Checks/statuses/metadata remain read-only and Contents has no access; event subscriptions are still empty.

At this setup checkpoint, writes were false and key/webhook/runner work was pending; no PRs or requests had been sent yet. Those operator steps and the controlled live review sequence subsequently completed. See [current pilot evidence](pilot.md) for final state and delivery limitations.

Personal account and operator screenshots referenced in this verification record are kept locally and omitted from the public repository.
