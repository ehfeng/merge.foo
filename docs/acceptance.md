# Acceptance scenarios and verification boundaries

The later [domain cutover](domain.md) verified HTTPS, normal GitHub sign-in, retained plans and same-origin logout at `https://merge.foo`. TypeScript, 184 units, 14 setup tests and fresh provider builds pass; earlier pilot counts below remain dated evidence. The cutover does not resolve its intermittent webhook failures or expand real-account coverage.

Source: [original MVP acceptance scenarios](product-plan.md#9-mvp-acceptance-scenarios) and [milestone exits](product-plan.md#8-build-plan). **Local verified** refers to synthetic/unit/browser/runtime evidence. **Pilot verified** refers only to the authorized public `ehfeng/merge.foo` A → B → C fixtures and sole reviewer `ehfeng`; see the [live pilot record](pilot.md). Passing that pilot does not establish every MVP scenario or broader production readiness.

## Product acceptance matrix

| ID | Scenario and expected result | Evidence in the current repo | Remaining live work |
| --- | --- | --- | --- |
| A1 | Independent stacks share one canvas and advance independently | Lab verified: three chains of 4/3/2 PRs. [Workflow tests](../src/domain/engine.test.ts) and [browser tests](../tests/workspace.spec.ts) | Live pilot covers one chain; multiple real stacks, large graphs and incomplete ancestry remain |
| A2 | Shared planned assignments do not send review requests until release | Local persistence/permission/restart checks pass. Pilot: all three plans saved through the hosted UI; future PRs stayed draft without requests until release; plans survived rollback | Four-PR and multiple-user planning; edits during real in-flight releases |
| A3 | A is approved but unmerged; B enters review; C remains queued | Pilot verified: unholding B released it before A merged; approving B later released C, with all PRs still unmerged | Protected-branch, code-owner and higher-author-minimum policy cases; checks/conflicts are covered locally |
| A4 | B is held; approval of A leaves B held and other stacks unaffected | Pilot verified: saved hold kept B draft without requests after A approval; removing it enabled release | Other independent live stacks and concurrent hold/dispatch races |
| A5 | Automatic progression is off; release requires an explicit action | Imported stacks are off by default. Pilot enrollment/auto configuration alone sent no effects; explicit start released only A | Broader live off/on transitions, revoked grants and manual early starts |
| A6 | B has no planned reviewer; prompt for assignment without silently choosing | Local workflow/browser checks; #145 demonstrates an unassigned node | Actual unassigned-release/candidate failure cases; pilot A's empty suggestions required explicit planning |
| A7 | Replayed approval and repeated reconciliation send no duplicate requests | Local generations/leases/provenance/restart checks. Pilot comment/reconciliation produced no duplicate B effects; reapproval created a distinct release episode. Guarded webhook replays returned 202 with writes disabled | Live timeout/uncertain mutation recovery and concurrent active dispatch; disabled-write replay is not proof of effect deduplication |
| A8 | Confirmed prerequisite approval-gate loss rolls back affected automatic descendants; rebases/comments preserve a satisfied gate | Pilot: comment preserved A approval/B review; change request rolled B back; reapproval released B again; final A change request returned B/C to draft and withdrew C's outstanding request. Local tests cover chronology, rebases and manual-override preservation | Real rebase/dismissal/ruleset changes, manual/external overrides, uncertain outcomes and partial rollback recovery |
| A9 | Reviewer active and planned work stay distinct, with my seven-day sent history | Lab verifies separate counters and picker context. Live active and upcoming counts use observed requests and persisted plans within the loaded repository; seven-day sent history is unavailable | Actor-aware sent history, broader coverage and GitHub team-request handling |
| A10 | Incomplete data or notification coverage is stated explicitly | [Normalization tests](../src/server/github.test.ts) verify unknown age, ambiguous branches, partial data and unassessed signals; UI has coverage text | Representative live partial/fork/history cases; broader request/ping history |
| A11 | GitHub suggestions form the default candidate list; overlapping stacked changes favor contextual reviewers with visible reasons | Returned order/flags are implemented. Pilot: B/C suggested ehfeng from past commits; A explicitly had none. Live areas remain empty | Changed-file/upstream-review continuity, explained refinements and ownership constraints; GitHub flags alone do not prove code overlap |
| A12 | Repository structure and reviewer explanations are linked to the PR graph | Planned; no live repository map or reviewer-reason model exists | Configurable/inferred areas, multiple-area changes, clickable source/PR evidence, inference labels and separately validated source-read access |

## Interaction checks

The [browser suite](../tests/workspace.spec.ts) preserves mock release/holds/replays and connected planned-assignment, conflict, onboarding and stale-fetch checks through selected details and contextual views. Escape dismisses reviewer pickers without closing details, closing details restores marker focus, and lab controls live in the map menu. The [map interaction checks](../tests/map-canvas.spec.ts) cover background drag, camera/topology stability under filtering/reviews, keyboard pan/zoom/fit, offscreen keyboard focus and usable mobile details without document overflow.

Visual comparison uses actual application screenshots of one [shared mock scenario](map-review-scenario.json), at 1440×1080 desktop and 390×844 mobile. These are still screenshots, not synchronized interaction recordings or authenticated GitHub evidence. See the dated [verification record](deployment.md#map-prototype-local-verification--2026-10-12).

[Map geometry tests](../src/domain/map-layout.test.ts) check aligned rows/shared columns, stable topology/API ordering, defensive coverage, fitting and zoom anchors; [older layout tests](../src/domain/layout.test.ts) still cover branch lanes. The latest [aligned visualization](screenshots/work-map-aligned.jpg) records the explicit mock work map, not a real account workspace.

## Connected-account and safety checklist

| Check | Current evidence and status |
| --- | --- |
| State/PKCE, encrypted bounded session, public numeric user binding and no refresh-token retention | [Auth tests](../src/server/auth.test.ts) pass; normal local and hosted OAuth verified for ehfeng. Second-user and private-organization sign-in remain unverified |
| Public registration preset, callback state/cookie validation, private file handling and no overwrite | Public App 5281176 verified; 14 [setup tests](../scripts/test_setup_github.py) pass. Registration helpers remain separate from normal onboarding |
| Operator setup and existing-configuration recovery | Documentation separates existing working configuration, targeted updates, a missing counterpart, existing App without local files, and first registration. Helpers remain first-time-only; this documentation update does not verify credentials or account recovery |
| Normal user onboarding uses the existing product App | Implemented; normal local/hosted sign-in and selected repository verified for ehfeng. Users authorize the existing App and select accessible repositories; missing installation gives admin/install guidance. A second user and private organization are still needed |
| Unauthenticated private APIs return 401 with no-store | Local browser/API checks and dated [hosted evidence](hosted-api-evidence.json) |
| Authenticated shared plans remain separate from GitHub effects | Hosted plan saves verified; planning sends no request. Readiness/request/rollback writes require operator enablement, exact scope, enrolled intent and fresh action authorization; pilot effects were separately approved |
| Selected repositories are enforced | Reader rechecks accessible installation/repository in [github.ts](../src/server/github.ts). Pilot installation170800499 and tokens were restricted to repository1416175510; wider/revoked/private access remains fixture-tested only |
| Connecting never activates existing stacks | Normalization imports stacks off. Pilot explicit enrollment and auto configuration did not start review; A needed explicit release |
| Real account sign-in and real PR ingestion | Hosted OAuth, three bot-authored PRs, human reviews, persisted plans and actual release/rollback verified in the public pilot; representative large/fork/private and second-user cases remain |
| Live release before merge, review requests and safe failure recovery | Pilot readiness and requests to sole reviewer ehfeng verified before merge. Local partial/uncertain recovery tests pass; the pilot does not verify inbox/email delivery or every failure mode |
| Repository-wide visibility and per-user access | All-author graph, reader visibility and author/writer edit rules implemented without merge.foo teams. Private-data isolation/revocation/concurrent edits are tested locally; only one live human account participated. Personal unpublished-plan ownership remains to define |
| Configurable approval gate and simple-chain automation | Implemented: default one active eligible approval plus applicable GitHub requirements; author can raise its minimum. Pilot verified one unprotected simple chain. Protected policy, higher minima and branches/joins remain outside live evidence |
| Approval survives rebases and comments while requirements still pass | No custom diff-freshness veto. Comment preservation verified live; rebase/new commits/dismissal chronology covered locally and still require live checks |
| Manual review start before upstream approval | Implemented with preview, warning and actor record; manual override preservation tested locally. Pilot covered explicit root start, not early downstream overrides |
| Background progression without browser wakeups | Scoped installation JWT/token, grants and Cloudflare cron verified live. C became ready/requested with no manual wake after `03:47:56Z`; actual eight-hour expiry/revocation and hosted Node/Vercel runners remain unverified |
| Signed webhook receipt and delivery reliability | Successful signed receipts and durable inbox processing verified in the pilot; all five failed deliveries later returned 202 on guarded replay. Intermittent HTTP 500 failures remain unresolved, including two after the native ingress mitigation; reliable delivery is not established |
| Automatic-release rollback after confirmed upstream approval loss | Live B rollback and later B/C cascade verified with all PRs open/unmerged and plans retained. Source retracts only attributable outstanding requests and restores attributable draft transitions; manual/external and ambiguous-outcome cases remain local tests |

## Approval-gate and rollback verification boundaries

These scenarios describe the [approved rollback contract](progressive-review.md#rollback-on-upstream-approval-loss). Local engine/service/API/storage tests cover chronology, claims, partial/uncertain outcomes and provenance. The [pilot](pilot.md) verifies comment preservation, change-request rollback, reapproval, background progression and cascade; the other cases below still need representative live evidence:

- In A → B → C, a newer blocking change request, GitHub dismissal or actual review-requirement failure on A triggers rollback when its approval gate fails. Retract outstanding requests created by affected automatic releases of open B and C, and restore draft only where those releases made them ready. Completed reviews, comments, plans and history remain; merged/closed PRs are not returned to draft.
- Duplicate invalidation events and repeated reconciliation cause no repeated rollback effects. Delayed older approvals cannot revive the invalidated generation or override newer feedback.
- If request removal succeeds but restoring draft fails or returns an uncertain result, persist each step, reconcile GitHub state and resume safely. Retry only unresolved, still-authorized steps.
- When A again satisfies the gate, re-evaluate B and C using current policy and intent, then use new release generations. Do not duplicate requests left outstanding after partial recovery.
- Preserve an explicit manual early-review override. A PR already ready before automatic release stays ready; external/manual changes are not blindly undone.
- A rebase, new commit or uncertainty about content freshness on A preserves B's requests/readiness and does not block an eligible release while A's nondismissed approvals and applicable requirements still satisfy the gate. If GitHub rules dismiss approvals on a push and the gate fails, apply rollback.
- A comment after approval does not replace the approval or pause B. A comment after a blocking change request does not erase that decisive feedback or satisfy a failed gate.
- If GitHub cannot be read or the current gate cannot be verified, defer new writes and preserve existing B requests/readiness. Successful synchronization re-evaluates the actual gate; no blind rollback occurs because of the read failure.

## Planned assignment and reviewer-context verification

Shared plans and GitHub suggestion display are implemented and pilot-verified. The continuity/area/ownership refinements below remain proposed; the pilot does not establish them:

- In the current implementation, a repository reader can see B's planned assignment while B is draft or ready, without a GitHub request being sent. The request is sent only on release; suggestions remain distinct from accepted assignments and active requests. An explicit assignment is retained across recommendation refreshes. Personal unpublished-plan ownership remains a product decision.
- In A → B, Sam reviewed A and B changes the same module: favor Sam and link the reason to A's review and the overlapping paths. A planned-but-unreviewed assignment must not be presented as review experience. Compare each PR against its own base, avoiding false overlap from inherited stack edits.
- When B introduces a second area, show that area and any additional reviewer recommendation. Enforce candidate eligibility and applicable review/ownership requirements; continuity must not substitute for required approvals or silently overwrite a chosen reviewer.
- GitHub suggested-reviewer reasons are labeled as GitHub evidence. `isAuthor` means the suggestion is based on previous commits, not authorship of the current PR; `isCommenter` means past review comments. Neither flag establishes exact overlapping paths, CODEOWNERS, a required reviewer, or a complete explanation of GitHub's ranking. Missing history and bounded workload remain visible.
- GitHub suggestions and their returned order are the default, with no invented confidence score. Continuity or ownership adjustments explain their evidence and preserve existing assignments. Empty/unavailable suggestions enable explicit selection; separately sourced specialists are not mislabeled as GitHub suggestions. Displaying or refining candidates creates no assignment or review request.
- Selecting a PR highlights all its affected areas in the repository map; selecting an area highlights linked PRs. Reviewer reasons link to paths, source/ref, upstream reviews, ownership rules or a recorded user choice. Inferred architecture relationships remain visibly distinct from confirmed ones; cron and Temporal are examples only when supported by repository evidence.
- Changed-file metadata requires Pull requests: read; the pilot App now grants Pull requests: write, with no Contents access. Paginate file metadata and disclose truncation when this capability is implemented. Show source/ownership data as unavailable or use explicit repository configuration; do not imply CODEOWNERS or a full source-derived structure map was read. Validate source access and base-branch ownership evidence separately.

## Reproducing the existing checks

Run from the repository root:

```sh
pnpm typecheck
pnpm test
pnpm test:setup
pnpm test:browser
pnpm check:vinext
pnpm build
pnpm deploy:check
```

`pnpm verify` runs typecheck, unit, setup, actual SQLite storage, build and browser checks. `deploy:check` is a deployment dry run; `deploy` publishes and is a separate operational action. Builds/browser/runtime verification use isolated credential-free copies; follow [deployment.md](deployment.md) and [hosting.md](hosting.md) rather than loading real local credentials into test runs. This documentation update does not rerun those suites.

Before declaring the connected MVP complete, validate the remaining second-user/private-organization, larger/fork graph, protected policy, manual/external override and failure-recovery scenarios against explicitly selected repositories, and satisfy the [milestone exits](roadmap.md#milestones). Merge, automatic cleanup and broader reviewer notification are not pilot results. Never publish private PR contents, credentials, cookies or repository inventories as evidence.

## Connected foundation local verification

The implementation includes public per-user authentication, installed-repository access checks, all-author pagination, fork/ambiguity/cycle handling, ordered suggestion evidence, app-only plan authorization/CSRF checks and versioned SQLite persistence. `pnpm test:storage` runs the actual Cloudflare workerd SQLite object, verifies restart persistence, shared reads, repository isolation, actor history and version conflicts/clearing. This complements unit/API fixture and browser checks; it makes no GitHub requests. Operator helper tests use isolated fake credentials and preserve existing configurations. No hosted account setup, migration or publication is performed by these tests.

## Workflow/provider verification checkpoint

On 2026-10-12 PDT: TypeScript and 166 unit tests pass; the earlier full checkpoint passed 14 setup and 23 browser tests. After the native webhook change, 21 focused tests, fresh Cloudflare/Node/Vercel builds and emitted-runtime probes pass. Actual local PostgreSQL and workerd/SQLite fixtures verify state/restart/claims; PostgreSQL release/rollback uses fake GitHub effects. The new compiled Cloudflare Worker accepts 72 distinct signed deliveries plus 24 duplicates while 18 runner wakes and 18 configuration CAS updates overlap, using 800122-byte synthetic bodies: all 72 inbox records persist, with zero outbound requests. This is local runtime evidence, not deployed capacity proof.

The [scoped live pilot](pilot.md) separately verifies hosted SQLite plans, normal OAuth, all six authorized human reviews, real App installation-token effects and Cloudflare cron progression/rollback. B's submitted approval and all plans survived the final cascade. All three PRs remain open/unmerged; A is ready, B/C are draft, and no user/team requests remain. The operator verified the final quiet state: global workflow writes are `false` and the feature's automatic progression is off at workflow version 54.

Webhook reliability remains unresolved. Three deliveries returned HTTP 500 before the native ingress mitigation and two afterward; all five responses had empty bodies and no Content-Type. The mitigation was deployed as `04fefa3e-de14-4d05-a5b1-e23cfaa02a31`. All five guarded replays returned 202, but this does not identify the cause or establish reliable future acceptance. No CPU or framework exception has been diagnosed. Broader account behavior, production PostgreSQL and actual Vercel hosting remain unverified. See [deployment evidence](deployment.md) and [hosting setup](hosting.md).
