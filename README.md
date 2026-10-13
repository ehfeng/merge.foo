# merge.foo

A personal productivity map over GitHub for a developer delivering complex features through PR stacks and progressive review. Built locally on this Mac with **vinext App Router, React, TypeScript, and Cloudflare Workers**.

Live app: **https://merge.foo**. The purchased domain connects to the existing Cloudflare Worker; the old public address redirects here. Public sign-in, the connected map, persisted plans and a controlled three-PR review/release/rollback pilot are verified. Automatic progression and operator writes remain paused while intermittent webhook HTTP 500s are investigated; see [domain setup](docs/domain.md) and [pilot evidence](docs/pilot.md).

## Normal user onboarding

Developers can connect through the operator-owned merge.foo GitHub App or the [local GitHub CLI companion](docs/companion.md). The App route uses GitHub sign-in and accessible installed repositories; if access has not been granted, an eligible administrator installs the App or handles an installation request. The companion uses your existing `gh` login for explicitly selected repositories without installing the merge.foo App. Developers do not register their own App or enter its client secrets. See [normal user onboarding](docs/setup.md#normal-user-onboarding).

Public sign-in and [self-service repository connection](docs/onboarding.md) are deployed. Each user chooses repositories through GitHub; connection links and list refresh remain available even with an existing selection. The foundation reads PRs across authors, uses GitHub reviewer suggestions and saves shared plans in SQLite Durable Objects. Local/hosted OAuth and the selected pilot are verified, including real suggestions, plans, holds and effects. Another real user and representative complex repositories remain unverified. Plans send no GitHub requests or notifications.

## Run locally

These instructions are for operators and contributors running the project checkout. Hosted-product users follow the onboarding flow above.

```sh
cd ~/src/merge.foo
pnpm install --frozen-lockfile
pnpm dev
```

Open **http://127.0.0.1:3000**. The current integration reads GitHub through the product's dedicated App. Operators should follow [operator setup and recovery](docs/setup.md#operator-setup-and-recovery) before running a credential helper. Use an existing App/configuration when present; both setup helpers are first-time tools and refuse to overwrite either local credential file. The public registration helper is at http://127.0.0.1:3002, while runtime sign-in is public and checks each user’s current repository access. Existing Codex/CLI credentials are never copied into the app or deployed.

Use **Explore the interaction lab**, or `http://127.0.0.1:3000/?lab=1`, to try the prototype with explicit mock data. Lab state persists locally and can be reset. Real PR data is never stored in localStorage.

To use the website with your existing GitHub CLI access, start the companion from this checkout and open its printed pairing URL:

```sh
pnpm companion --repo kernel/your-repository
```

Replace the example with the repository you want to allow. Keep the helper running; allow the browser's local network permission when prompted. Credentials stay with `gh`, and companion plans stay on this computer. See [companion setup, review actions and limitations](docs/companion.md).

A read-only companion smoke test loaded all 339 open PRs in private `kernel/kernel` in about 50 seconds and fetched reviewer suggestions separately for a selected PR. Large maps have a 120-second request deadline. No GitHub review actions were sent during this check; see [verified companion evidence](docs/companion.md#verified-evidence--2026-10-12).

## First milestone

- A full-window interactive map with three independent mock stacks, including a four-PR chain, compact PR markers and floating controls. Live data derives dependencies only from unique matching base/head branches; ambiguity and truncated coverage are disclosed. Branching graphs have separate lanes.
- Selected-PR details provide readiness, holds, reviewer planning with workload context, and per-stack automatic progression in the lab. Details show review gate, lifecycle, author readiness, checks, effort, risk, wait context, dependencies, and action history separately.
- Approval releases the next eligible existing PR before merge. Roots start explicitly. Missing reviewers and holds block releases; automatic progression can be paused. Distinct approval gates, exact-event replay, stale/uncertain prerequisites, and resumable partial failures are tested.
- Dedicated GitHub App OAuth with state and PKCE, encrypted HTTP-only sessions, bounded expiry, public sign-in bound to each verified numeric GitHub user ID, selected-repository reads, no-store API responses, and fresh GitHub identity checks. Authenticated read-only endpoints list accessible installed repositories and read PR data, policy decisions, requests, checks, reviews, and LOC.
- Imported stacks start with automatic progression off. The connected workflow requires explicit enrollment, a first review preview, current GitHub grants and operator write enablement. The approved pilot exercised real readiness/review requests and rollback; it performed no merges. Pilot automation is paused after testing.

The workflow retains approval across rebases and comments while the author's minimum and applicable GitHub review requirements remain satisfied. Confirmed gate loss rolls back automatic review releases: remove attributable outstanding requests and restore draft state if merge.foo made the PR ready, preserving plans, submitted history and explicit manual overrides. The live pilot verified comments, holds, progression before merge, reapproval and cascading rollback with completed reviews preserved. Rebases, complex GitHub policy and failure/revocation cases remain broader integration checks. See the [progressive-review contract](docs/progressive-review.md).

Planned assignments are shared in merge.foo and send GitHub requests only at release. GitHub's suggested reviewers are the primary candidate source and shared planned assignments persist in provider-neutral PostgreSQL or optional Cloudflare SQLite storage. Explicit choices remain intact. Explained stack continuity and linked repository diagrams remain planned; see [reviewer context](docs/product.md#planned-assignments-and-reviewer-continuity).

## Verification

```sh
pnpm typecheck
pnpm test             # workflow, auth, normalization, stable geometry
pnpm test:setup       # loopback registration, consent boundary, private file handling
pnpm test:browser     # uses locally installed Google Chrome
pnpm check:vinext
pnpm build
pnpm deploy:check    # dry run, no publication
```

`pnpm verify` runs type checks, unit tests, setup tests, actual SQLite/workerd restart tests, build, and browser tests. `pnpm start` runs the built Worker locally; `pnpm deploy` publishes the configured Worker to Cloudflare. No remote Git repository is created by this project.

## Product documentation

Start with the [documentation index and current status](docs/README.md). It organizes the uploaded plan and distinguishes agreed requirements, proposals, lab verification and planned connected features.

- [Product vision and graph UX](docs/product.md)
- [Progressive-review rules and state ownership](docs/progressive-review.md)
- [Acceptance scenarios and verification boundaries](docs/acceptance.md)
- [Milestones and unresolved decisions](docs/roadmap.md)
- [Current architecture and production proposals](docs/architecture.md)
- [Normal user onboarding](docs/setup.md#normal-user-onboarding), [operator setup and recovery](docs/setup.md#operator-setup-and-recovery), and [dated deployment evidence](docs/deployment.md)
- [Local GitHub CLI companion](docs/companion.md)

The [original uploaded plan](docs/product-plan.md) is preserved unchanged, 19,188 bytes. Later user choices select vinext, Cloudflare hosting and real GitHub integration. The intended MVP includes live progressive-review actions; the gated service has passed a scoped real pilot, with delivery reliability and broader launch hardening still open.

vinext is actively evolving. This project passed its compatibility check and actual Worker build; that does not establish parity for all Next.js features or production workloads.

## Hosting choice

The same vinext application has explicit Cloudflare, Node and Vercel builds. The deployed Cloudflare app uses SQLite Durable Objects; external PostgreSQL is available for a common store across hosts. Personal-first usage does not require a separate database service. Private Vercel Blob is a candidate for small personal state, with no adapter implemented yet. See [hosting, storage and background setup](docs/hosting.md) for the tradeoffs, target commands and operator prerequisites. Switching providers does not enable GitHub writes or enroll a stack.
