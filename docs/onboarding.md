# Public repository connection — 2026-10-12 PDT

The user reaffirmed that anyone should be able to sign in and choose their own repository connections. Public App installation and per-user sign-in were already enabled; the product now exposes the connection flow even when a repository is already listed.

## Normal flow

1. Sign in at **https://merge.foo** with GitHub.
2. Choose **Install or manage repository access** on the repository chooser, or the **Connect repository** plus icon beside the map's picker.
3. In GitHub, choose a personal account or organization and the repositories to connect. GitHub handles permission consent and any administrator/SSO requirements.
4. Return to merge.foo. The list refreshes after using an installation link; **Refresh repository list** is also available without signing out or reloading. Choose a repository to open its PR network.

Only non-archived repositories are offered. The server finishes GitHub's raw repository pagination before excluding archived entries, preserving active public/private repositories on later pages and across installations. An archived repository is also rejected by fresh workspace/plan access validation; this changes app eligibility rather than its GitHub installation grant.

There is no merge.foo account allowlist or teammate invitation system. The existing public App serves each user's GitHub authorization and installation scope. A user cannot bypass GitHub's private repository or organization controls. The App's existing PR-write grant remains distinct from whether review actions are enabled.

## Refresh behavior

- A successful refresh preserves the selected graph, plans, details and camera when numeric repository and installation IDs still match.
- Verified removal/replacement of a repository clears its cached view and invalidates outstanding workspace replies.
- Confirmed revoked/expired identity returns **401**, clears private UI state and offers sign-in again.
- Temporary GitHub/network/rate-limit failures retain the current view with retry guidance. Session and repository endpoints distinguish these **502** responses from confirmed authentication loss.
- Simultaneous focus/visibility return events share a refresh. If installation finishes during an older list request, a fresh request follows it.
- List failures and plan/workspace conflicts retain their own retry action. Lab state remains separate from live repository selection.

The user chooses grants in GitHub. This implementation made no installation-grant changes and did not change `WORKFLOW_REPOSITORIES` or enable automation. At the start, installation `170800499` selected only the pilot. During final hosted verification, the picker returned additional public/private repositories; that current grant is broader than the earlier checkpoint. No other repository's PR contents were opened by the agent. Background execution remains limited to the configured pilot and disabled.

## Verification and publication

The self-service flow was published as **`aa060e17-df05-4930-885f-38b20bc47872`**. The archive filter is now published as **`79ac8c5a-8531-4952-aa62-47979df51655`**. Domain routing, credentials, SQLite state/migration and minute cron were preserved.

For the archive update, TypeScript and **198 unit tests** pass, with **24 focused GitHub/repository-route checks** independently verified and a fresh Cloudflare build. Its regressions cover an archived-only first page followed by active public/private repositories and rejection of a stale archived selection before graph loading. Earlier browser/provider evidence follows below; the small filter update did not rerun every provider or browser scenario.

The live list refresh changed the current picker from **66 to 31** entries, preserving the selected pilot graph. Repository names were not recorded in this measurement. Filtered picker evidence.

TypeScript and **196 unit tests** pass. **31 unique browser behavior checks** cover 22 existing interactions and nine new connection/refresh/race scenarios; the nine new cases passed again after the final retry correction. Independent review reran **58 focused tests**. Fresh Cloudflare, Node and Vercel builds and emitted-runtime probes pass with synthetic configuration and outbound requests blocked.

Hosted checks confirm root/session **200**, unauthenticated repository API **401** with no-store protection, and the old browser address **307** to the canonical domain. GitHub Advanced settings still offer **Make private**, confirming that the App is already public; no App settings were changed by the agent. Real verification observed the broader accessible list, the normal installation link beside the existing pilot map, and a completed manual list refresh preserving that graph/plans. Live control evidence. A second real account and other repositories' PR data remain unverified. Earlier webhook HTTP 500s remain unresolved and review automation stays paused.

Primary guidance: [GitHub App installation and repository choice](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party), [public App visibility](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private). See [normal onboarding](setup.md#normal-user-onboarding), [domain configuration](domain.md) and [pilot evidence](pilot.md).

Personal account and operator screenshots referenced in this verification record are kept locally and omitted from the public repository.
