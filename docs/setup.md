# User onboarding and operator setup

The public product offers the operator-owned merge.foo GitHub App and a [local GitHub CLI companion](companion.md). The App route uses GitHub sign-in and installed repository grants. The companion uses your existing `gh` login on your computer for explicitly selected repositories, without a merge.foo App installation. Developers do not register an App, handle its client secret or configure Cloudflare.

For current background review setup, configure the App, shared state and runner once. Each authorized user can enable coordination for any connected repository with accepted review-write permissions; operators do not maintain a per-user repository list. `WORKFLOW_REPOSITORIES` is only a bounded legacy migration input. See [connected repository automation](automation.md).

## Normal user onboarding

For repositories where the merge.foo App cannot be installed, follow [local companion setup](companion.md). Install the standalone CLI with `curl -fsSL https://merge.foo/install.sh | sh`, then run `~/.local/bin/mergefoo connect` for guided sign-in and repository selection. Choose **Connect this computer** in the browser and allow local-network access. No project checkout or package manager is required. This connection has its own local plans and workflow history. Current GitHub user permissions and organization policies still apply.

The GitHub App flow is:

1. Open hosted merge.foo and choose **Continue with GitHub**.
2. Authorize the existing merge.foo App for your GitHub account. Use **Install or manage repository access**, or **Connect repository** beside the map's repository picker, to choose a personal account or organization and the repositories to connect in GitHub.
3. Return to merge.foo. The repository list refreshes after the installation link is used; **Refresh repository list** also fetches it without signing out or reloading. Select a connected repository to open its full PR network. Installation links remain available even when repositories are already listed.

Anyone can sign in and choose their own repository connections; there is no merge.foo account allowlist or teammate invitation step. GitHub controls the installation grant. Organization owners and eligible repository administrators can install the App; other members may need administrator approval and applicable SSO. Signing in alone does not install the App or bypass repository permissions.

**Installation** grants the App access to selected repositories. **Personal authorization** identifies the developer and lets the App act within that developer's permitted access. They are separate actions; signing in does not itself grant repository access. See [GitHub App installation](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party) and [authorization versus installation](https://docs.github.com/en/apps/using-github-apps/authorizing-github-apps#difference-between-authorization-and-installation).

Public sign-in and normal onboarding are deployed at https://merge.foo. Any GitHub user may authorize the product App; private requests revalidate numeric identity and installation/repository access. Local/hosted OAuth as `ehfeng`, real three-PR ingestion, reviewer suggestions, saved plans and scoped release/rollback are verified. A second real user and representative complex repositories remain pending ([D1](roadmap.md#unresolved-decisions)). The controlled pilot remains paused because intermittent webhook HTTP 500s are unresolved; see [pilot evidence](pilot.md) and [domain cutover](domain.md).

## Operator setup and recovery

The operator registers and maintains the App, stores server credentials, and configures/deploys the hosted service. Existing Mac CLI/Codex GitHub credentials do not configure merge.foo's App sign-in.

At the initial foundation checkpoint on 2026-10-12, the user completed public visibility, installation and normal OAuth authorization for App `merge-foo` (ID `5281176`). It then had four read permissions and no events, and installation `170800499` initially included all repositories. Verification exercised only the chosen public pilot `ehfeng/merge.foo` (repository ID `1416175510`). Local/hosted authenticated empty graphs and hosted SQLite reads succeeded, using existing GitHub client credentials and a separate production session secret. Subsequent scoped-pilot permission and credential work is recorded under [current hosted operation](#current-hosted-operation--2026-10-12).

The chosen App visibility is **public**, for other users and organizations. The helper prepares a public read-only App, covered by setup tests. The registration helper verifies the operator `ehfeng`, numeric GitHub ID `279398`, when saving operator credentials; this is not a restriction on product users. [GitHub's App visibility documentation](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private) explains public installation availability.

The first-time OAuth helper prepares a read-only foundation and discards generated background credentials; it does not configure progression. The current hosted pilot separately retains a protected App private key, webhook secret and runner secret, with reviewed Pull requests write permission and exact repository scope. User refresh grants are still discarded. Existing setup must be recovered field by field rather than rerunning registration.

### Check existing setup first

Before running either helper, determine whether the App already exists and whether `.env.local` or `.dev.vars` exists. **Both helpers intentionally refuse to run if either local file exists.** Never delete working configuration or register a duplicate App to bypass this protection.

| Existing state | Operator action |
| --- | --- |
| Configuration exists and credentials still work | Verify the existing App, callbacks, and selected-repository installation below. Restart the local server and sign in again; no new App or secret is needed. |
| Configuration exists but a credential or setting changed | Update only the affected fields locally using the steps below. Update the corresponding hosted secret separately if the deployment uses it. |
| Only one local file exists | Create the missing counterpart in a local editor with matching configuration from the surviving file. Preserve the survivor; neither helper repairs this case. |
| App exists, neither local file exists | Verify the existing App, then use `pnpm setup:auth` to prompt for its client ID and valid client secret. Reuse a valid securely retained secret; generate one in the existing App only if missing or revoked. |
| No App and neither local file exists | Use the first-time registration flow below. |
| Manifest exchange failed | Inspect GitHub App settings first: registration may already have succeeded. Follow the applicable existing-App/configuration row instead of registering again. |

### Verify the existing App

Verify public visibility and the deliberately chosen capability. A read-only foundation uses disabled webhooks and **Pull requests: read**, **Checks: read**, **Commit statuses: read**, **Metadata: read**. The approved hosted pilot instead uses **Pull requests: write**, active signed webhooks and the events listed under [current operation](#current-hosted-operation--2026-10-12); preserve that existing configuration during recovery. No Contents, account, email or organization permissions were added. Keep expiring user tokens enabled. See [GitHub registration maintenance](https://docs.github.com/en/apps/maintaining-github-apps/modifying-a-github-app-registration).

The existing App has these exact callbacks, with wildcard matching disabled:

- `http://127.0.0.1:3000/api/auth/callback`
- `https://merge.foo/api/auth/callback`
- `https://merge-foo.eric.workers.dev/api/auth/callback`

Hosted `APP_ORIGIN` is `https://merge.foo`; local configuration remains loopback. `APP_ORIGIN_ALIASES` is an optional JSON list of exact operator-approved previous origins. Browser/auth entry redirects occur before cookies; an old callback restarts canonical sign-in without forwarding OAuth parameters. The Worker retains its old hostname for callback recovery, webhook and protected runner compatibility. Do not relax origin/CSRF checks or transfer cookies between domains. Verify the intended repository remains selected before using any new host.

### Update existing local configuration

1. Open `.env.local` and `.dev.vars` in a local editor. Do not print their contents, paste credentials into chat, or put secrets in command arguments or logs.
2. Change only affected fields in both files. For an ordinary GitHub client-secret replacement, update `GITHUB_CLIENT_SECRET` and **preserve `AUTH_SECRET`**; it protects merge.foo sessions and is unrelated to the GitHub client secret. Change the client ID only if it actually changed. Preserve the intended exact origin. `AUTH_ALLOWED_GITHUB_ID` is a legacy field ignored by the public runtime; it can be removed. Add `GITHUB_APP_SLUG` using the existing App’s actual slug to enable its installation link; do not invent an App identifier.
3. If a local file is missing, create just that missing file with matching values from the survivor. Keep both files git-ignored and mode 600:

   ```sh
   chmod 600 .env.local .dev.vars
   ```

4. Restart `pnpm dev` and sign in. For hosted recovery, update only the affected Wrangler secret using its interactive prompt below, then verify hosted sign-in separately. Local edits do not update the deployment.

Reuse a valid existing `AUTH_SECRET`. Generate a new random value of at least 32 characters securely only if it is missing/invalid or deliberate session revocation requires rotation; changing it invalidates existing merge.foo sessions. The first-time helpers generate it without printing it. The `setup:auth` helper creates new files only; it is not a credential-update or verification command.

### First-time registration (no App or local configuration)

```sh
cd ~/src/merge.foo
pnpm setup:github
```

Open **http://127.0.0.1:3002** on this Mac and choose **Review registration on GitHub**. The helper pre-fills the public preset, local and `https://merge.foo` callbacks, disabled webhooks and the four read permissions. Sign in as `ehfeng`; you can edit the unique App name. Existing installations use recovery rather than registering again.

The operator reviews and clicks **Create GitHub App** in GitHub. That action creates credentials. GitHub returns to the loopback helper, which validates state, a browser cookie, the owner, and exact read permissions before saving the OAuth client ID/secret and a fresh session secret to mode-600, git-ignored `.env.local` and `.dev.vars`. No secrets are printed or uploaded. The helper discards the generated private key and webhook secret, refuses to overwrite configuration, and consumes each callback once. Complete the flow within one hour; if it expires, check existing App/configuration state before restarting. Stop the helper with Ctrl-C after completion.

On the completion page, choose **Choose repositories on GitHub**, select **Only select repositories**, and review permissions before installing. Keep expiring user access tokens enabled. Registration, installation, and personal authorization are separate account actions. Organization approval/SSO remains the organization's own flow.

This follows [GitHub's manifest registration flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest). The helper exchanges the temporary code only after the operator's final registration action; it never copies CLI/Codex credentials. Permissions belong to the App registration rather than broad OAuth `repo` scopes.

### Local sign-in verification

Restart `pnpm dev`, open http://127.0.0.1:3000, choose **Continue with GitHub**, review GitHub's authorization screen, and select an installed repository. Any GitHub user can sign in. Sign-in, repository selection and planned assignments send no GitHub writes. Real review actions separately require enrollment, preview, current grants and operator enablement. If repository selection is empty, verify installation selection and refresh.

The deployment can serve its public sign-in shell and explicit mock lab before authentication is configured. Private PR endpoints fail closed; a visible sign-in page does not prove authenticated access works.

### Hosted-secret configuration

Use interactive Wrangler prompts from the project directory. Do not paste secrets into chat or put them in command arguments. For initial hosted setup, configure all required values; for recovery, run only the command for each changed value.

```sh
pnpm exec wrangler secret put APP_ORIGIN --name merge-foo
pnpm exec wrangler secret put GITHUB_CLIENT_ID --name merge-foo
pnpm exec wrangler secret put GITHUB_CLIENT_SECRET --name merge-foo
pnpm exec wrangler secret put AUTH_SECRET --name merge-foo
pnpm exec wrangler secret put GITHUB_APP_SLUG --name merge-foo
```

`APP_ORIGIN` is the exact HTTPS deployment origin, currently `https://merge.foo`. Preserve the valid existing production `AUTH_SECRET` during ordinary recovery. `GITHUB_APP_SLUG` supplies the actual App's installation link. Legacy `AUTH_ALLOWED_GITHUB_ID` is ignored. Add the exact callback and verify the new domain's TLS before switching origin; retain known aliases for cookie-safe redirects. Registering or connecting a domain never enables workflow writes.

Existing Cloudflare account access was verified. If it expires, run `pnpm auth:cloudflare` and approve the login screen yourself. The deployed SQLite-backed `PLANNED_ASSIGNMENTS` object holds plans, workflow intent, inbox and action history. No external PostgreSQL service was provisioned. The hosted background credentials and exact pilot scope are configured; writes are currently disabled during delivery investigation. Preserve existing secrets and the object migration during recovery.

### Build and deployment

```sh
pnpm verify
pnpm deploy:check
pnpm deploy
```

This targets the existing `merge-foo` Worker with the apex Custom Domain `merge.foo` and `workers_dev: true` for legacy API compatibility. Preserve its SQLite binding/migration, cron and secrets. No unrelated Worker, DNS or account subscription needs to change. Verify selected repositories and unauthenticated API protection after sign-in.

## Sign-in and access troubleshooting

- Invalid OAuth state: start sign-in again; the flow expires after ten minutes.
- GitHub session expiry/revocation: sign in again. No refresh grant is retained.
- Missing repository: verify the user's access and App installation selection. Use the installation link, choose repositories in GitHub, then return or select **Refresh repository list**. Organization approval/SSO may be required; personal authorization alone does not install it.
- Archived repository: archived repositories are hidden from the picker. Unarchive it in GitHub if you intend to resume work, then refresh the repository list; its installation grant and saved data were not removed by this filter.
- Only one repository appears: that usually reflects installation selection, not a sign-in or domain limit. The original pilot selected only `ehfeng/merge.foo`; final public-onboarding verification later observed a broader accessible list. Each user chooses connections in GitHub. Links remain available with a populated picker, and list refresh needs no browser reload. Added repositories inherit the App's PR-write grant even while actions are paused; background scope remains separate.
- A refresh removes the selected repository: its cached graph and pending responses are cleared when current repository/installation IDs no longer match the grant. A confirmed expired/revoked identity also clears private UI state. A transient GitHub/network failure preserves the current view and offers **Retry repository list**; it does not claim access was refreshed.
- Missing installation link: the operator must configure the actual `GITHUB_APP_SLUG`; users can ask the repository administrator to install the existing App.
- Assignment storage unavailable: the operator must verify the `PLANNED_ASSIGNMENTS` binding and SQLite migration. Do not fall back to browser-only storage or imply the plan was saved.
- Assignment conflict: another developer changed the plan; refresh and review the latest assignment before saving again.
- Permission/rate-limit failure: the app displays the error and does not fall back to public/demo data.
- Unknown review-request age: event coverage was incomplete; creation time is not substituted.
- To revoke personal access, remove the GitHub App authorization in GitHub. An administrator can remove installation access. To end every merge.foo session immediately, the operator rotates `AUTH_SECRET` and redeploys.

## Provider-independent deployment and background workflow

The source now supports Cloudflare, Node and Nitro/Vercel builds with common PostgreSQL state and an optional Cloudflare SQLite adapter. Follow [hosting.md](hosting.md) for the migration, operator secrets, exact callbacks, selected numeric scopes and durable wakeup configuration. The manifest helper remains read-only by default; its `--local-origin` and `--hosted-origin` flags prepare deliberate alternative callbacks without changing an existing App. Do not rerun first-time registration to move hosts. Existing configuration recovery and preserving `AUTH_SECRET` still apply.

Live release/rollback source is gated by explicit enrollment, current grants and `GITHUB_WORKFLOW_WRITES_ENABLED`; background execution additionally requires a securely retained App private key, signature secret and authenticated runner. Account permission/key/webhook changes and hosted verification are separate operator actions. Planning and hold/dependency intent edits do not send review notifications.

## Current hosted operation — 2026-10-12

Normal users sign in at `https://merge.foo` and select an accessible installed repository. The new domain uses the same Worker, App, installation and SQLite state; existing planned assignments survive. Hosted origin and App homepage were updated without rotating credentials. [Domain evidence](domain.md) records current routing/auth checks; [pilot.md](pilot.md) preserves the earlier review sequence. Preserve the production `AUTH_SECRET`, separately from local session configuration and the GitHub client secret.

The approved public App `5281176` has accepted Pull requests write access on installation `170800499`. The pilot checkpoint restricted its installation to `ehfeng/merge.foo` (`1416175510`); later [public onboarding verification](onboarding.md) observed additional connected repositories. At that checkpoint, background `WORKFLOW_REPOSITORIES` contained only the pilot. Current repository discovery follows [connected repository automation](automation.md), with this field used only for legacy migration. Checks/statuses/metadata remain read-only and Contents has no access. Signed webhooks remain at `https://merge-foo.eric.workers.dev/api/github/webhook`, with SSL verification and the three PR/review subscriptions. Historical saved pilot scope.

The operator supplied the App key; background authentication, matching webhook HMAC secret, runner secret and exact single-repository scope are securely configured. A native minute cron exercised real progression. Three bot-authored fixture PRs remain open and unmerged: A ready, B/C draft, no outstanding requests, B's completed approval retained. Only `ehfeng` was requested. Plans and history remain saved. Feature automation is off and operator writes are false while intermittent webhook HTTP 500s are investigated; polling recovered the tested sequence. The native receipt path is hardened but did not eliminate the observed failure. Replays while writes were disabled succeeded. See the final map.

Personal account and operator screenshots referenced in this verification record are kept locally and omitted from the public repository.
