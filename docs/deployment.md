# Deployment and verification

## Current release — 2026-10-13

Production Worker `dd9f9c21-61af-46fd-a0d2-81c5179c11db` serves application source `635139b` at **https://merge.foo**. The consolidation into main preserves that application code and adds the earlier automation deployment evidence. Companion CLI `0.2.3` includes smaller adaptive GraphQL reads and explicit stale-lock repair. Repository maps default to My work, hide other authors, fit the remaining PRs, use trackpad scrolling to pan and pinching to zoom, and place adjacent PRs one 24-pixel canvas tick apart.

The release was checked with TypeScript, 496 unit tests across the companion/map updates, 64 browser checks for compact spacing, and final focused geometry/map/gesture checks after fitting was adjusted to keep headings clear of controls. The live client bundle and unchanged companion download were verified against the published build. Consolidation itself changes only documentation; it does not redeploy or alter GitHub actions, saved state, credentials, or runtime configuration.

## Connected repository automation checkpoint — 2026-10-13

At this checkpoint, source `9921eb1` was deployed as Worker `5751cd0d-c7c4-4a57-97e6-e3edb19ace89`, retaining enabled review actions and using the durable registry with `WORKFLOW_REPOSITORIES=[]`. Existing opted-in pilot records and historical receipts survived migration. The protected dynamic GET scheduler returned zero eligible actions at workflow version 54. A connected non-pilot repository (`ehfeng/ted`) loaded normally with no app errors; no new live feature enrollment or notifications were used for verification.

TypeScript, 347 unit tests, 19 browser checks, 323 real workerd/SQLite requests across two installations, actual PostgreSQL registry restart tests and fresh Cloudflare/Node/Vercel build/runtime checks passed. Independent review found no blockers. See [the current contract](automation.md) and [sanitized deployment evidence](connected-automation-evidence.json). Broader live multi-account notification and capacity coverage remain to validate.


## Webhook deadline and diagnostics checkpoint — 2026-10-12

Worker 738c555f-8629-4bd5-b0b5-764b2814dc34 runs the bounded native receipt path from source 9b949e6. One seven-second deadline covers body, HMAC and persistence; only confirmed durable receipts receive 202. Diagnostics use the existing operator secret, exact repository scope and at most 20 UUID reads; they never execute workflows or change stored state. Persistent invocation logs redact query strings. Existing bindings, migration, secrets, domain and paused review actions are retained.

TypeScript, 289 unit tests, 161 real workerd/SQLite synthetic requests, a fresh Cloudflare build and deployment preflight passed. The five old failed deliveries replayed as 202, and one fresh GitHub PR-edit notification persisted with total Worker wall 192ms. Original delivery records all expired at ten seconds with empty responses; the exact old stalled stage remains unobserved. See [receipt repair and evidence](pilot.md#current-receipt-repair-and-pilot-cleanup--2026-10-12).


## Repository archive filter checkpoint — 2026-10-12

`79ac8c5a-8531-4952-aa62-47979df51655` excludes archived repositories from the server-provided picker and fresh repository access validation. Pagination completes before filtering; active public/private repositories remain eligible. TypeScript, 198 unit tests, independent focused checks and a fresh Cloudflare build pass. The app returns HTTPS 200. Installation grants, saved data and paused automation are preserved; [onboarding.md](onboarding.md) records the behavior and verification boundaries.

## Public repository connection checkpoint — 2026-10-12

Self-service repository connection and list refresh are deployed as `aa060e17-df05-4930-885f-38b20bc47872`. Connection links remain available with existing repositories; GitHub handles each user's grant. Return/manual refresh preserves authorized work and safely handles revocation, expired identity and transient errors. TypeScript, 196 units, 31 browser behavior checks and fresh Cloudflare/Node/Vercel builds/runtime probes pass. [Onboarding evidence](onboarding.md) records scope and limitations. No installation grants, background scope or paused automation settings were changed.

## Production domain checkpoint — 2026-10-12

The user-purchased domain **https://merge.foo** routes to the existing Worker with valid TLS. The old address redirects to it. Exact GitHub callbacks/homepage and canonical OAuth are configured; real sign-in, repository data and same-origin logout are verified. At that cutover, TypeScript, 184 units, 14 setup tests and provider builds passed. The later setup-copy version `dc04889e-896e-4802-ad2f-21a97af916c5` corrected permission wording; the current self-service version is recorded above. See [domain evidence](domain.md). Workflow automation remains paused; these changes do not resolve earlier webhook failures or expand installation access.

## Live pilot checkpoint — 2026-10-12

The deployed service passed the approved three-PR pilot: real saved plans, holds, readiness/reviewer requests before merge, approval preserved through a comment, reapproval and cascade rollback with B's completed review retained. C advanced through native minute cron with no manual wakeup or browser action. Only `ehfeng` was requested; all PRs remain open and unmerged. See [the exact reviews/events and remaining limits](pilot.md) and final map.

The native webhook receipt path was isolated from framework request initialization and shares bounded-body HMAC/durable-inbox semantics across hosts. Fresh source passes **166 unit tests**, TypeScript and all three production builds. Emitted Node/Vercel runtimes pass protected API/OAuth/provider-isolation checks with fake configuration. A fresh compiled Cloudflare overlap fixture persists 72 distinct deliveries plus 24 duplicate requests alongside runner/configuration contention, with zero outbound requests. Prior 14 setup/23 browser tests and real PostgreSQL/SQLite fixtures remain separately dated evidence below.

Webhook reliability is **unresolved**: three original and two post-mitigation pilot deliveries returned empty HTTP 500s. Writes were disabled for safe replay, which returned 202. The scheduler recovered the sequence, but replay/local success does not identify or eliminate the failure. Automation and operator writes remain disabled. [Pilot.md](pilot.md) records that checkpoint's version; [domain.md](domain.md) records the subsequent production cutover. No external database or paid hosting upgrade was provisioned.

## Historical hosted foundation checkpoint — 2026-10-12

At this historical checkpoint, source version `6c58ecd7-f2c6-4854-9c8c-5cba088a8aa7` was published, then the six-value authentication update activated **`03570981-066d-44a7-a794-97165b0ac2d2`** at **6:49pm PDT on October 12** (`2026-10-13T01:49:09Z`). Existing GitHub client credentials were securely reused; a separate production session secret was generated with a private ignored backup. Writes were disabled and background credentials/scopes were then unconfigured. Later account state is described above.

Normal hosted OAuth succeeded for the existing authorized App. Repository selection loaded, and the chosen public pilot `ehfeng/merge.foo` rendered its actual **No open PRs / zero-PR map** without errors. Hosted Durable Object shared-state reads succeeded. Hosted pilot evidence.

The credential-free check returned `/api/session` **200, configured**, `/api/github/repositories` **401**, and `/api/github/workspace` **401** with no-store protection. Hosted access-protection evidence.

At the foundation checkpoint the App was public/read-only with no events and write permission staged but unsaved. That evidence verifies sign-in, empty-repository access and shared reads only. The subsequent scoped pilot has accepted write permission, restricted installation, configured credentials/events and real effects; see [current operator setup](setup.md#current-hosted-operation--2026-10-12).

## Original deployment — 2026-10-11

The following is a **historical verification record from 2026-10-11**, not the current deployed version or account state. The latest documentation checkpoint is in [the documentation index](README.md#current-checkpoint).

- Local project: `/Users/eric/src/merge.foo`
- Framework: vinext 1.1.0 App Router, Cloudflare Workers
- Worker: `merge-foo`
- URL: https://merge-foo.eric.workers.dev
- GitHub callback: https://merge-foo.eric.workers.dev/api/auth/callback
- Original recorded Cloudflare version: `95951fcc-8187-411f-bb59-68b122dac8cb`
- Existing account Free plan verified before deployment. No DNS, subscription, or optional paid bindings changed.
- At the recorded deployment: ASSETS was the only binding; no GitHub client secrets or account credentials had been uploaded.

Completed checks: `pnpm typecheck`, `pnpm test` (40 tests), `pnpm test:setup` (9 tests), `pnpm build`, `pnpm test:browser` (12 tests, including visual evidence), `pnpm check:vinext` (0 compatibility issues), and the official deployment dry run. The actual production build and Cloudflare upload succeeded. The implemented GraphQL query was validated against GitHub's current public schema/API. All original 19,188 plan bytes compare equal to the attachment.

The hosted shell hydrated and the interaction lab rendered all three stacks in Chrome. The setup modal's **Check connection & access protection** issues credential-free GETs. Both repeated checks returned `/api/session` **200**, `/api/github/repositories` **401**, and `/api/github/workspace` **401**, with JSON and `Cache-Control: private, no-store`. Cloudflare real-time tail independently confirmed those statuses on the recorded version, outcome `ok`, and zero exceptions. Sanitized status evidence is in [hosted-api-evidence.json](hosted-api-evidence.json), with a browser screenshot. Setup dismissal was verified afterward.

The direct Python probes received HTTP 403 with body `error code: 1010`, including for the homepage. Those requests produced no Worker event while Chrome requests did. This identifies rejection before the app runs and specific to that client route/signature, rather than an API authentication defect. [Cloudflare's error 1010 documentation](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/) describes a client/browser signature block. No security settings were changed or bypassed. Read-only configuration checks confirmed workers.dev enabled and ASSETS as the only binding.

At the original handoff, `pnpm setup:github` had prepared a private read-only manifest with both callbacks, and Chrome was paused at GitHub's **Confirm access** step. This records that handoff only; the user's later passkey login and changing runtime state make it unsuitable as a current setup-status claim.

As of the 2026-10-12 documentation review, local credential files exist; only existence was checked, and no contents or secrets were inspected. App details, selected-repository installation, merge.foo OAuth sign-in, hosted secret configuration and real-data ingestion remain unverified or incomplete. During the subsequent roadmap discussion on 2026-10-12, the user chose a public App for other users and organizations. The local helper was updated to a public preset and nine setup tests passed; runtime sign-in was still owner-only at that earlier checkpoint. That local change was not deployed and does not verify the existing App's visibility. The [setup guide](setup.md) describes recovery and configuration, and the [roadmap](roadmap.md#account-setup-checkpoint) records outstanding verification. Existing CLI/Codex credentials were not copied into merge.foo by the agent.

## Connected foundation local verification — 2026-10-12

Public sign-in, normal user onboarding, all-author paginated graphs, ordered GitHub suggestions and durable shared planned assignments are implemented locally. The updated source has **80 unit tests**, **13 operator-helper tests**, **16 browser fixture tests**, a passing TypeScript check and production build. The actual workerd/SQLite fixture verifies restart durability, shared reads, repository isolation, actor history, version conflicts and clearing. A built local Worker initialized the `PLANNED_ASSIGNMENTS` binding and returned no-store 401 from all logged-out private endpoints, including plan writes.

Independent review found and resolved helper/runtime origin mismatches, sign-out retry handling, per-reviewer upcoming counts, stable reviewer snapshots and duplicate/reused-handle protection. Browser failures exposed pre-hydration Setup clicks and fixture display regressions; the repaired suite passes. Build/browser/runtime verification used a credential-free temporary checkout; an earlier build command ran in the source directory and automatically loaded local `.dev.vars` without printing credentials or making GitHub calls. No real credential file was inspected or modified, and no App, repository, notification or deployment action was performed.

The updated hosted service still requires operator configuration (`APP_ORIGIN`, client ID/secret, `AUTH_SECRET`, optional actual `GITHUB_APP_SLUG`), the SQLite binding/migration deployment, existing-App callback/public-visibility/read-permission verification, installation on an explicitly selected repository, personal authorization and real-account testing. A purchased domain is optional; workers.dev can serve this milestone. SQLite Durable Objects are available on Workers Free within its limits; a paid plan is not inherently required. [Cloudflare storage pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

Historical merged ancestry is bounded to matching branches among the latest 100 merged PRs; open pagination fails closed above 5,000 PRs. Areas, architecture diagrams, holds, background auth, readiness/reviewer requests and release/rollback remain later milestones.

## Map prototype local verification — 2026-10-12

The primary prototype now uses a full-window pan/zoom dependency canvas, compact PR markers, floating search/filter/zoom controls and temporary selected-PR details. Activity and reviewer load are contextual views; mock reset/reconciliation tools are tucked into the map menu. On mobile, the initial view centers a readable review point, with explicit Fit all for the overview and a temporary bottom drawer for details. Repository-area overlays remain future work.

Verification passed: TypeScript, **86 unit tests**, **21 browser tests** and the production build in a credential-free temporary checkout. The browser checks cover map dragging, search by PR/feature, stable camera/topology after filtering and review updates, keyboard pan/zoom/fit and offscreen focus, mobile drawer/overflow, plus the existing mock workflow and connected assignment/onboarding/conflict/stale-fetch protections. Review fixed modified-key interception, menu accessibility, focus-triggered camera movement during mouse selection and loading-state sign-out. No GitHub mutations, real credential reads or deployment were performed.

The comparison below consists of screenshots captured from the real application using one [shared mock scenario](map-review-scenario.json). It is static evidence, not synchronized video or real-account integration verification. Desktop pairs use 1440×1080; mobile pairs use 390×844.

| Scenario | Before | After |
| --- | --- | --- |
| Desktop overview | [Earlier app shell](screenshots/work-map-before.png) | [Interactive map](screenshots/work-map-after.png) |
| Desktop, PR #143 selected | [Earlier selected panel](screenshots/work-map-before-selected.png) | [Temporary detail card](screenshots/work-map-after-selected.png) |
| Mobile overview | [Earlier mobile shell](screenshots/work-map-before-mobile.png) | [Readable map view](screenshots/work-map-after-mobile.png) |
| Mobile, PR #142 selected | No paired earlier selected screenshot was captured | [Temporary bottom drawer](screenshots/work-map-after-mobile-selected.png) |

The current local preview is an isolated fixture-only development instance; the hosted workers.dev build has not been updated by this redesign. Source changes preserve the connected foundation's public authentication, graph reads and server-persisted plans. Real GitHub account and hosting verification remain separate tasks.

The user's subsequent alignment correction removes decorative stack offsets and curved-row drift: linear chains are horizontal, roots align and equivalent depths share columns. All seven map-geometry checks and TypeScript pass. The refreshed in-app preview was visually checked and its node positions confirm the aligned rows/columns; see the [aligned screenshot](screenshots/work-map-aligned.jpg). Earlier comparison screenshots above remain records of the preceding prototype revision.

## Real local account checkpoint — 2026-10-12

The existing public `merge-foo` App and user-approved installation were verified; normal GitHub OAuth completed as `ehfeng`. The selected public pilot `ehfeng/merge.foo` loaded the connected empty map with no API error. Connected pilot evidence, public App confirmation. App metadata still shows the read-only permission set and no events. No real review requests, readiness writes, secret generation or hosted publication occurred during this check. Empty-repository verification does not substitute for representative PR/review/background tests.

## Historical workflow/provider verification before the live pilot — 2026-10-12

The pre-pilot source passed **156 unit tests**, **14 operator/setup tests**, **23 browser fixture tests**, TypeScript and all three production builds (Cloudflare, standalone Node and native Nitro/Vercel). Emitted runtimes exercised SSR/static files, protected APIs and fake-config OAuth/cookie/logout behavior. Wrangler dry-run passed. This historical source checkpoint predates the deployment and native-ingress mitigation described above.

Actual PostgreSQL fixture tests cover atomic version/audit changes, competing claims, scope isolation, inbox replay, server restart, and the real workflow service releasing B before A merges then performing attributable rollback with fake effects. Actual workerd/SQLite tests cover retained plans, generic workflow claims, inbox replay and restart. Browser fixtures cover persisted holds/dependencies, notification previews, explicit early overrides, disabled writes and stale responses. These are local checks, not actual review notifications.

The native scheduled handler was verified through Wrangler's official `/cdn-cgi/local/scheduled` test route with explicit JSON outcome `ok`. Temporary instrumentation confirmed entry/exit, then a fake configured scope reached authenticated `/api/internal/reconcile` with HTTP200 and local SQLite state, while writes were disabled and no feature was enrolled. The new Explorer scheduled API reported an inconsistent exception before handler entry; it is recorded as a tooling discrepancy rather than substituted for the affirmative native-route proof. Temporary code/config instrumentation was restored byte-for-byte. Real installed-App background effects remain unverified.

The representative batched nine-PR chain fixture uses 48 modeled HTTP calls for readiness and 49 for requesting review, including SQL/token/scheduler/grant overhead. Limits, additional reviewer/history cases, slow verification and contention can defer work; these numbers are not a general production-capacity guarantee. No paid upgrade is assumed. Original product-plan SHA-256 remains `0d4ed588d7899d423f36d2df9ace9309c5efc42d18808bfb1be89a2da4bae380`.

Personal account and operator screenshots referenced in this verification record are kept locally and omitted from the public repository.
