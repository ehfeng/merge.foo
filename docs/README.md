# Product and implementation documentation

This documentation reflects the uploaded `merge-foo-product-plan(1).md` and the user's later choices. The [original product plan](product-plan.md) is preserved unchanged; these guides organize it rather than replacing it.

## Reading order

| Document | Purpose | Source in the original plan |
| --- | --- | --- |
| [Product and graph UX](product.md) | Vision, agreed direction, daily questions, UX and signal proposals | Sections 1–4, 6, 11 |
| [Progressive-review contract](progressive-review.md) | Release rules, state ownership, holds, stale prerequisites and retries | Sections 5, 7 |
| [Acceptance scenarios](acceptance.md) | Expected behavior, existing verification, and live-integration gaps | Sections 8–9 |
| [Roadmap and open decisions](roadmap.md) | Original milestones, current progress, unresolved choices | Sections 8, 10 |
| [Architecture](architecture.md) | Current code structure and proposed production architecture | Section 7 plus later stack choices |
| [Normal user onboarding](setup.md#normal-user-onboarding) | Sign in to the existing product App and select an accessible repository; current prototype limits | Later integration choices |
| [Operator setup and recovery](setup.md#operator-setup-and-recovery) | Register/configure the product App, reuse existing configuration, update local/hosted credentials | Later integration choices |
| [Hosting and shared storage](hosting.md) | Cloudflare/Node/Vercel builds, common PostgreSQL state, scheduler and operator prerequisites | Implementation and portability work |
| [Deployment evidence](deployment.md) | Dated build, browser and hosted API verification | Implementation evidence |
| [Live pilot evidence](pilot.md) | Approved real review sequence, background progression, rollback and delivery limitations | Controlled GitHub integration evidence |
| [Production domain](domain.md) | Cloudflare domain binding, canonical address, GitHub callbacks and cutover verification | User-purchased domain setup |
| [Public repository connection](onboarding.md) | Each user's GitHub repository choices, installation return, refresh and current verification | Public self-service onboarding |

## How to interpret status

**Agreed requirement** means the upload identifies it as agreed product direction, or the user subsequently chose it. **Proposal** means a recommended design or implementation detail awaiting validation or a decision. Implementing a proposal in the lab does not turn it into an agreed production policy.

**Verified in the lab** means exercised with explicit mock fixtures. **Implemented, integration verification pending** means code exists but real account/repository behavior has not been verified end to end. **Planned** means the capability is not implemented in the connected product. Tests with intercepted API responses are not evidence of authenticated GitHub access.

## Current checkpoint

Documentation reviewed on **2026-10-12** against the repository source and existing verification evidence.

The primary audience is a developer coordinating the review and release of a complex feature. merge.foo provides a view and coordination layer over GitHub with full repository context; permissions are implementation checks, and read-only users do not require a separate product/role system.

The user now wants the primary UI to feel like an interactive map with a few floating controls, closer to Google Maps than Gmail. The local prototype now implements a full-window pan/zoom map with compact PR markers, floating controls and temporary selected details. Before/after evidence uses the same mock scenario; repository-area layers remain future work.

- The interaction lab demonstrates three independent stacks (four, three and two PRs), inline coordination, a side panel, approval-driven release before merge, holds, replay deduplication, decisive-review chronology and confirmed-gate-loss rollback.
- The chosen implementation is **vinext App Router, React, TypeScript and Cloudflare Workers**. A dedicated GitHub App read integration and authentication code are implemented. The public shell and explicit mock lab were deployed and checked; see the dated deployment record.
- Imported stacks remain off. Durable holds/dependency intent, gated release/rollback, signed inbox and authenticated scheduler are implemented. The scoped three-PR pilot verified real plans, holds, requests, progression and rollback on the deployed SQLite store. PostgreSQL remains an optional locally verified portability adapter. Plans make no GitHub changes.
- **The user chose a public GitHub App for other users and organizations on 2026-10-12.** The registration helper uses a public preset. Runtime sign-in is public with fresh numeric identity and installation/repository checks; local/hosted OAuth and three real bot-authored PRs are verified as `ehfeng`. Another real user and representative complex repositories remain unverified.
- One operator-owned App serves the intended public product. Normal users authorize it and use accessible installed repositories; they never manage product credentials or run setup helpers. Operator setup and existing-configuration recovery are documented separately. The setup modal now gives normal-user authorization, repository and installation/admin guidance; operators retain their separate setup/recovery documentation.
- Each person chooses repository access through the public App's GitHub installation flow. Connection links are available even with existing repositories; returning from the link or using **Refresh repository list** updates the picker without sign-out or full reload. GitHub administrator/organization policies still apply, and connecting a repository does not activate review automation.
- The implemented service automates explicitly enabled simple chains, defaults to one active approval with configurable higher requirements and applicable GitHub rules, and uses repository permissions. Readers see all authors' PRs; My work is an optional filter. No separate teammate membership is required. Manual early review uses a warning and activity record, but that override remains untested live. Linked Linear priority follows the GitHub release.
- On confirmed upstream approval loss, affected automatic releases retract outstanding requests and restore draft state where merge.foo made the PR ready. The real pilot verified B/C cascade rollback, retained plans and B's completed approval. Manual overrides and broader failure cases remain locally verified only. See the progressive-review contract.
- Rebases, commits and comments do not pause downstream reviews while the upstream approval gate remains satisfied. Active approvals follow GitHub's actual review policy; merge.foo adds no separate diff-freshness veto. An unreadable gate defers new writes, not a blind rollback of existing reviews.
- **Planned assignments** hold requests until release. GitHub's suggested reviewers are the primary candidate source; real suggestions and persisted explicit choices were verified in the pilot. Explained continuity, areas and ownership ingestion remain planned; current plans use repository scope, with unpublished personal ownership still to define.
- The public `merge-foo` App has accepted PR-write access and signed webhooks. Its pilot installation originally selected only `ehfeng/merge.foo`; later public-onboarding verification observed additional connected repositories. Background scope remains pilot-only. Its real scheduler/review sequence passed, but intermittent webhook HTTP 500s remain unresolved; progression and operator writes are paused. See [pilot evidence](pilot.md) and [current onboarding](onboarding.md).

The intended MVP includes actual progressive-review actions. A controlled pilot has passed; that does not establish broad launch readiness or reliable webhook delivery.

## Source preservation

The original plan is 19,188 bytes and still matches the locally materialized upload byte for byte. Its SHA-256 is `0d4ed588d7899d423f36d2df9ace9309c5efc42d18808bfb1be89a2da4bae380`.

For conflicts, preserve the upload's agreed direction, apply explicit later user choices, and record remaining questions in the decision register. Historical statements such as “no implementation language selected” describe the plan when written; [architecture.md](architecture.md) records the subsequent stack choice.

## Current hosted operation

The deployed app at https://merge.foo serves the real three-PR pilot; the old public address redirects to it. B/C are draft, requests are empty, B's approval remains and feature automation is off. Operator writes are also disabled during delivery investigation. The SQLite object holds plans, intent and action history; external PostgreSQL is optional and unprovisioned. See [domain setup](domain.md), [current operator setup](setup.md#current-hosted-operation--2026-10-12) and [pilot evidence](pilot.md).

Public evidence uses the reviewed mock work-map images and public pilot PRs. Personal account screenshots and private repository query values are omitted or redacted.
