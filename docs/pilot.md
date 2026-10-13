# Scoped live pilot — 2026-10-12 PDT

## Current receipt repair and pilot cleanup — 2026-10-12

PRs [#1](https://github.com/ehfeng/merge.foo/pull/1), [#2](https://github.com/ehfeng/merge.foo/pull/2) and [#3](https://github.com/ehfeng/merge.foo/pull/3) are now closed without merging; their reviews and history remain. The three closure deliveries all returned 202. Prior open/draft states below are historical pilot evidence.

All five failed delivery records lasted exactly ten seconds and contain no response headers/body. GitHub closes a delivery connection after ten seconds without a response, so the records support delivery timeout rather than a confirmed Worker-generated HTTP 500. [GitHub timeout guidance](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/troubleshooting-webhooks#timed-out)

An authenticated, read-only lookup found durable rows for all five original UUIDs. Their receivedAt values precede four GitHub failure timestamps and follow one; updatedAt is the latest processing change, not proof of initial durable commit time. Historical Cloudflare minute aggregates showed success outcomes and zero recorded runtime errors, but cannot identify the individual delayed stage. Durable Object output-gate latency is a possible mechanism, not an established historical cause.

Source 9b949e6 is deployed as 738c555f-8629-4bd5-b0b5-764b2814dc34. The receiver has one seven-second deadline across body/signature/storage work, returns 202 only after confirmed durability, and returns explicit 503 on expiry. Stalled bodies are cancelled without waiting for a stuck cancellation; late commits deduplicate on redelivery. Query-redacted persistent Worker logs and safe receipt diagnostics now expose the delayed stage. GitHub does not automatically retry failed deliveries; recovery uses explicit redelivery and authoritative polling. [GitHub recovery guidance](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries)

With hosted review writes verified false, all five original failed deliveries were replayed successfully. Cloudflare persisted outcome ok/HTTP 202 for each: native receipt 98–334ms, wall 102–336ms, CPU 1–3ms. A fresh natural PR-edit event also persisted and returned 202: native 188ms, wall 192ms, CPU 4ms; GitHub measured 0.39s. The source passes TypeScript, 289 units, 161 real workerd/SQLite synthetic requests (41 distinct/120 duplicates/restart/near 1MB), production build and deployment preflight. See [sanitized evidence](webhook-evidence.json).

This fixes unbounded waits and adds observed successful replay/new-insert evidence. It does not establish the exact old delay or guarantee that every future platform/network delivery succeeds. Review automation remains paused; no new review requests, review decisions or merges were used for the repair verification.


This report records the user-approved test on the hosted [merge.foo service](https://merge-foo.eric.workers.dev). The complete scoped review/progression/rollback sequence passed independently, with all PRs left open/unmerged and no pending requests. **Webhook reliability remains unresolved:** two additional deliveries returned 500 after the native mitigation deployed. Automatic progression and global GitHub workflow writes are now off while those failures are investigated. The original exception remains unknown.

## Verified setup

- Public GitHub App `merge-foo`, App ID **5281176**; installation **170800499** is restricted to the public repository **ehfeng/merge.foo**, repository ID **1416175510**.
- Accepted App permissions are Pull requests **write**, with Checks, Commit statuses and Metadata **read**. No App Contents permission was added.
- The only approved human reviewer is **ehfeng**, numeric ID **279398**. The test PR author is **merge-foo[bot]**, numeric ID **341255257**.
- Existing human CLI authorization created the seed and branch commits. A repository-limited App installation token created the three draft PRs, then was revoked. The only fixture file is `.merge-foo-pilot/review-fixture.txt`; no application source, Actions configuration or CODEOWNERS was published.
- Hosted background credentials and the exact one-repository scope were staged with workflow writes disabled. The App webhook was configured for HTTPS/JSON with SSL verification and its matching secret; the user-approved events are `pull_request`, `pull_request_review` and `pull_request_review_comment`.
- A separate enable preflight verified all three open, draft, bot-authored PRs formed the intended chain and had no review requests. Workflow writes were then deliberately enabled for the configured pilot. Enabling writes alone does not enroll stacks or start reviews.

| PR | Branch | Base | Creation state |
| --- | --- | --- | --- |
| [#1 — A](https://github.com/ehfeng/merge.foo/pull/1) | `codex/live-pilot-a` | `main` | Draft; no requested reviewers or teams |
| [#2 — B](https://github.com/ehfeng/merge.foo/pull/2) | `codex/live-pilot-b` | `codex/live-pilot-a` | Draft; no requested reviewers or teams |
| [#3 — C](https://github.com/ehfeng/merge.foo/pull/3) | `codex/live-pilot-c` | `codex/live-pilot-b` | Draft; no requested reviewers or teams |

All three persisted planned assignments were saved at version **1**, targeting the stable human reviewer ID. B and C used GitHub's suggestions; A used explicit selection because GitHub returned none. B's hold was saved. Plans and holds themselves sent no GitHub review requests.

An independent unauthenticated API snapshot at `2026-10-13T03:21:11.844Z` (October 12, 8:21pm PDT) verified the repository and bot identities, exact A → B → C head/base SHAs, and all three PRs still open/draft with no requested reviewers or teams. Each PR changed only the fixture file with one addition and one deletion. The public main-branch active-rules API returned **200 / empty list**; the classic branch-protection endpoint required authentication (**401**), so this public check does not establish the absence of classic protection.

## Observed checks

| Check | Result |
| --- | --- |
| Hosted normal OAuth, repository selection and shared-state reads | Passed during foundation verification; hosted evidence |
| Credential-free session/repository/workspace checks | Session **200**, repositories **401**, workspace **401** with no-store; access evidence |
| Authenticated background runner before enrollment | **200**, no enrolled features |
| Runner without authorization | **401** |
| Correctly signed webhook ping | **202** |
| Forged webhook signature | **401** |
| Actual GitHub installation-event delivery | **202** at `2026-10-13T03:18:32Z` (October 12 PDT) |
| Hosted planned assignments and B hold | Saved with stable reviewer identity and persisted state |
| Enrollment with automatic progression off | Version **2**; runner at `03:21:02Z` executed **0** effects |
| Automatic progression enabled before first explicit start | Version **3**; runner at `03:21:33Z` executed **0** effects; all three PRs remained draft with no requests |
| First explicit start after preview | Preview named only ehfeng; runner at `03:22:09Z` executed **1** step, followed by inbox processing at `03:22:25Z`; actual A became ready with ehfeng requested, B/C remained draft without requests and all remained unmerged |
| Approve A while B is held | Authenticated review **5498408063**, `APPROVED` by ehfeng at `03:25:00Z`; runner at `03:25:05Z` executed **0**, workflow version **11**; A ready with its review request completed, B/C draft without requests, all open/unmerged |
| Remove B's hold | Runner at `03:26:39Z` executed **1**, version **16**; B became ready. The `03:26:49Z` check processed **1** inbox item and observed B requesting only ehfeng; C remained draft and all remained unmerged |
| Comment on approved A | Review **5498418882**, `COMMENTED` at `03:27:03Z`; runner at `03:27:09Z` processed **1** inbox item; B remained ready with ehfeng requested, without duplicate effects |
| Confirm A's approval loss | Review **5498423662**, `CHANGES_REQUESTED` at `03:28:00Z`; runner at `03:28:09Z` executed **1**, version **24**, removing B's pending request; next check at `03:28:27Z` observed B back in draft, B/C request lists empty and all still unmerged |
| Map after first rollback | A showed changes requested, B/C were draft and all EH planned assignments remained saved; rollback evidence |
| Reapprove A | Review **5498561535**, `APPROVED` at `03:47:46Z`; last manual runner wake at `03:47:56Z` executed **1**, version **31**, making B ready. A later bot request at `03:48:44Z` targeted only ehfeng with no subsequent browser/manual wake |
| Approve B | Review **5498574553**, `APPROVED` at `03:49:28Z`; C was initially draft, then bot readiness **33099642953** at `03:49:44Z` and request **33099693308** at `03:50:51Z` released C to only ehfeng. All remained unmerged; no manual wake followed `03:47:56Z` |
| Deployed scheduler proof | Actual Cloudflare scheduled outcomes **ok** at `03:49:46Z` and `03:50:52Z`, both CPU 32ms and wall about9.3–9.4s; native webhook responses202 with no observed exceptions during these checks |
| Final confirmed upstream loss | Review **5498607239**, `CHANGES_REQUESTED` on A at `03:53:53Z`; runner at `03:54:03Z` executed **1**, version **47**, restoring B to draft without a pending request. C was still ready/requested at this intermediate check; by `03:56:43Z`, B/C were draft without requests, A ready without requests and all open/unmerged |

GitHub's delivery receipts subsequently exposed **three legitimate webhook responses with HTTP 500**, despite the successful polling-driven effects: B readiness (`3847994365236477952`, `03:26:49.714Z`), B request (`3847994377590808576`, `03:26:55.449Z`) and A comment (`3847994422153199616`, `03:27:16.18Z`). Other observed deliveries returned 202. The remaining review sequence was paused for investigation; successful runner results do not substitute for reliable webhook acceptance.

All three older failed response bodies were empty, consistent with a failure outside this application's controlled JSON503 path. A framework boundary is one possibility; the origin remains unconfirmed. Three harmless signed ping probes returned **202** without logged exceptions. Local compiled-Worker overlap checks also passed with 72 distinct receipts, 24 duplicates, 18 concurrent runner wakes and configuration races, using synthetic 800KB bodies, real local SQLite storage and zero outbound requests; they did not reproduce the hosted failure.

Workflow writes were temporarily disabled, and the hosted runner at `03:38:03Z` returned **executed 0 / GitHub workflow writes are disabled**. The older failed B-readiness event was safely replayed while GitHub writes remained disabled; the new delivery **3847995868894461952** returned **202** at `03:38:29Z`. This succeeded on the preceding source and therefore does not establish that the new mitigation resolved the original exception.

A narrow source mitigation routes the exact Cloudflare POST webhook endpoint directly to an isolated shared receipt implementation, bypassing framework route execution. Node/Vercel delegates to that same implementation. Explicit native configuration, PostgreSQL/SQLite selection, raw-body HMAC, the 1MB body bound, repository scope, durable inbox ACK and deduplication remain intact; no workflow dispatch occurs during receipt. TypeScript and **166 unit tests** pass, with **21 focused tests** independently rerun by the reviewer. Fresh Cloudflare, Node and Vercel builds pass. The new emitted Cloudflare Worker also passes the real workerd/SQLite overlap check: 72 distinct hooks, 24 duplicates, 18 concurrent runner wakes and 18 configuration CAS updates, 800122-byte bodies, all 72 durable inbox records and zero outbound requests. Hosted results are recorded below. This mitigation is not a confirmed root-cause diagnosis.

Independent emitted Node and Vercel checks also pass with synthetic configuration and outbound network blocked: SSR/static assets, protected 401/no-store responses, PKCE/cookies/logout, and no Cloudflare/Durable Object imports in executable bundles. Both hosts return the same receipt outcomes for signed ping 202, malformed JSON 400, out-of-scope 202 and unavailable persistence 503; the probes made zero outbound calls.

The new Cloudflare source **04fefa3e-de14-4d05-a5b1-e23cfaa02a31** was deployed around 8:45pm PDT with writes paused. After verifying the hosted disabled-writes guard, the three older failed events were safely replayed: new delivery IDs **3847996853714944000** (comment), **3847996855342374912** (readiness) and **3847996857238159360** (request) all returned **202** at `03:46:08–10Z`. Three ping probes also returned 202. These verify the deployed native receipt path for these inputs; they do not identify the original exception or prove every future delivery succeeds.

At the historical resume deployment **03:46:51.346Z**, the reviewed operator step reverified the exact open bot PRs 1–3, chain and sole reviewer, and reasserted the six trusted workflow fields without changing credential values. Writes were restored for the same pilot only to complete the remaining authorized reviews. Initial setup's all-draft/no-request preflight remained separate; current writes are disabled again as recorded below.

Two later delivery failures show that the native mitigation has **not eliminated the intermittent500**: review-submitted **3847997088184926208** at `03:47:57.684Z` and B-readiness **3847997107048808448** at `03:48:06.452Z`, following the secret-resume deployment at `03:46:51.346Z`. Subsequent observed events, including B approval, C release and final rollback, returned 202. No trace was running for those two failures; runtime, entry selection and deployment transitions are being investigated without attributing a cause prematurely.

Both newer failures were safely replayed with writes globally disabled: new delivery IDs **3847998519369531392** and **3847998519851892736** returned 202 at `03:59:04Z`; filtered traces reported CPU 4/2ms and no exceptions. Successful replays do not establish why the intermittent failures occurred. The compiled native entry was additionally proven using temporary test-only instrumentation that marked every hook response and threw on framework fallthrough; all 96 tested hooks (72 distinct and 24 duplicates) used native ingress. That proves the local emitted path, not every production request or its deployment identity.

The bounded hosted diagnostic was initially rejected by automatic approval review because the recognized pilot authorization did not cover authenticated synthetic signals and durable-state changes using existing credentials. That rejected attempt made **zero requests** and read no backup. The human then explicitly approved the exact write-disabled diagnostic; its single execution verified the disabled-write guard first and returned **36 × 202** for 24 distinct signals plus 12 duplicates, and **4 × 200** for one guard and three overlapping runner calls. No GitHub API calls, human reviews or additional probes were made; no failure was reproduced.

The filtered live trace captured only **10 webhook events** returning202 and **one successful cron event**, with maximum CPU 8ms and zero observed exceptions. It did not capture all 36 receipts or all four runner calls. These bounded successful results do not resolve the earlier five failures. Diagnosis remains the next concrete blocker; the probe is complete and further speculative testing was stopped.

Webhook acceptance proves delivery/authentication, not that a readiness or reviewer mutation succeeded. The foundation empty-repository test and local workflow fixtures likewise do not establish live progression behavior, a second user's access or broad production capacity.

An independent public snapshot at `2026-10-13T03:23:00.624Z` confirmed A ready/open/unmerged with exactly ehfeng requested, and B/C still draft/open/unmerged without requests. A's complete public timeline contained exactly one bot readiness event (`33098347888`, `03:22:08Z`) and one bot review-request event targeting ehfeng (`33098358605`, `03:22:23Z`). There were no team requests, reviews or rollback events at that snapshot.

The next unauthenticated independent check at `03:25:11.165Z` was blocked by GitHub's public API rate limit (**403**). No authenticated fallback or retries were used by that reviewer. Later live results therefore need the operator's authenticated evidence or a subsequent successful independent check; this limit does not establish an application failure.

After explicit authorization for exact-repository, read-only CLI metadata checks, an independent snapshot at `03:26:25.290Z` confirmed A's approval **5498408063** by ehfeng **279398** at `03:25:00Z`. A remained ready/open/unmerged with no outstanding request; B/C remained draft/open/unmerged with empty request lists and empty effect timelines. A still had exactly one bot readiness event and one bot request event. This checks the GitHub outcome alongside the separately saved application hold, without claiming GitHub exposes merge.foo's hold state.

## Completed live sequence

Automatic approval review initially rejected the attempted A-approval action because the existing permission covered fixture PR creation and reviewer selection, not submitting reviews under the human identity. No review was created and no workaround was used. The human subsequently explicitly authorized approval A → comment A → request changes on A → approve A again → approve B → request changes on A again, restricted to these fixtures and with no merges. All six were completed and independently verified below.

| Phase | Expected behavior | Status |
| --- | --- | --- |
| Enroll | Explicitly enroll this reliable A → B → C chain; imported stacks remain unmanaged | Passed: enrollment and enabling automatic progression alone sent no effect |
| Start A | Preview identifies only ehfeng; explicit start makes A ready and requests ehfeng | Passed: actual A ready and ehfeng requested; B/C still draft, all unmerged |
| Approve A while B is held | A remains unmerged; B stays draft without a review request | Passed: review 5498408063; held B/C remained draft without requests |
| Remove B's hold | Background progression makes B ready and requests ehfeng before A merges | Passed: B ready/requested before any merge |
| Comment on A | Existing valid approval remains effective; B continues review | Passed: comment 5498418882 left B ready/requested without duplicate effects |
| Confirm A's approval loss | Withdraw only merge.foo's outstanding B request and restore B to draft when its readiness is attributable; preserve review history and plans | Passed: B's bot request withdrawn, then B restored to draft; earlier history and all planned assignments retained |
| Approve A again | A new generation releases B without a duplicate outstanding request | Passed: new release episode made B ready and requested only ehfeng; numeric generation not yet independently inspected |
| Approve B before merging | Release C while A and B remain unmerged | Passed: actual scheduled execution made C ready/requested without browser/manual wake |
| Cascade confirmed upstream loss | Roll back eligible open automatic descendants B/C while retaining completed review history | Passed: B/C draft, all pending requests withdrawn, all open/unmerged; B's submitted approval remains retained |

The pilot is restricted to these fixtures and this reviewer. Merges, additional reviewers, wider installation access and additional repositories require a separate deliberate action; they are not implied by passing this sequence.

B's first release produced exactly one bot readiness event (**33098550987**, `03:26:38Z`) and one bot request event targeting ehfeng (**33098555224**, `03:26:44Z`). The subsequent comment on A did not add readiness/request events or pause B. Confirmed approval loss then produced the bot request-removal event (**33098619014**, `03:28:07Z`) and bot draft event (**33098631725**, `03:28:26Z`), retaining the earlier events. Reapproval produced a new B readiness event (**33099558606**, `03:47:55Z`) and sole-ehfeng request (**33099596904**, `03:48:44Z`), retaining the earlier rollback history. The request completed after the last manual wake, demonstrating deployed background continuation. Numeric generation state has not been independently inspected; visible release episodes and rollback outcomes are verified separately.

The independent authenticated read-only final check at `03:57:52.793Z`, with complete paginated review/timeline history at `03:58:31.277Z`, verified all six expected reviews by ehfeng and no others. All effects were authored by bot 341255257; every review-request/removal targeted only ehfeng 279398. B's completed `APPROVED` review was retained, so the final rollback drafted B without removing a completed request. Its final draft event was **33099839628** at `03:54:02Z`. C's pending request was removed (**33099869560**, `03:54:44Z`) before C returned to draft (**33099910643**, `03:55:45Z`).

| Final complete timeline counts | Ready | Requested | Removed | Draft |
| --- | --- | --- | --- | --- |
| A | 1 | 1 | 0 | 0 |
| B | 2 | 2 | 1 | 2 |
| C | 1 | 1 | 1 | 1 |

No PR was merged or closed, no submitted review was dismissed, and there were no outstanding user/team review requests. The pilot does not verify manual external overrides, rebases, a second account, private/organization permissions, very large or branching repositories, a production PostgreSQL service or an actual Vercel deployment. Those remain separate verification boundaries even though the respective source paths and local fixtures have broader coverage.

At pilot completion, the operator left automatic progression **off** and globally disabled workflow writes, with workflow version **54**. Deployment **40f966b2-70b6-47a5-ad69-ead4aa70e2d0** served the native-mitigation source at 100% from `03:58:31.342744Z`. Plans/history remained saved; final fixtures were A ready and B/C draft, all open/unmerged without pending requests. Final cascade evidence. No further human reviews are required for this six-review sequence; manual-override preservation was locally tested only. The later [production-domain cutover](domain.md) preserves this intent/state and records the newer deployment.

Personal account and operator screenshots referenced in this verification record are kept locally and omitted from the public repository.
