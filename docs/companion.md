# Local GitHub CLI companion

The companion connects the merge.foo map directly to `gh` on your computer. Use it for repositories your GitHub CLI account can already access, including organization repositories where the merge.foo GitHub App is not installed. GitHub credentials remain in GitHub CLI's credential storage; repository data travels over loopback to your browser, without a hosted relay.

This route uses your existing GitHub authorization and repository permissions. It does not grant new access or override SSO, enterprise restrictions or your organization's rules. GitHub documents GitHub CLI as a [privileged OAuth app](https://docs.github.com/en/apps/oauth-apps/using-oauth-apps/privileged-oauth-apps), which can operate under ordinary organization OAuth app access restrictions. That distinction applies to GitHub CLI's OAuth login, not a personal token substituted for it.

## Start and pair

Requirements: Node.js 22 or newer, pnpm, [GitHub CLI](https://cli.github.com/), and a current Chrome or Edge browser. Run these commands in the project checkout:

```sh
pnpm install --frozen-lockfile
gh auth status --hostname github.com
pnpm companion --repo kernel/your-repository
```

Replace `kernel/your-repository` with the exact repository you want to use. If GitHub CLI is not signed in, run `gh auth login --hostname github.com --web` first. The companion uses the stored login for `github.com` and excludes environment token overrides. It never requests or prints the GitHub token. GitHub CLI normally uses the operating system credential store, but can fall back to its own configuration file when a credential store is unavailable; see [GitHub CLI login](https://cli.github.com/manual/gh_auth_login).

Open the pairing URL printed by the helper. It opens `https://merge.foo` with a one-session pairing capability in the URL fragment. Choose **Connect local GitHub CLI** and allow the browser's local network access prompt when asked. You can also choose **Use GitHub CLI** and paste the full pairing URL. Select an allowed repository to load its PR map. You do not need to install the merge.foo GitHub App or sign in to its hosted GitHub connection for this route.

Large repositories can take about a minute for the initial map. The companion allows up to 120 seconds for a complete map or workflow request. GitHub reviewer suggestions load separately when you select a PR, so they do not delay the full repository map.

Keep the terminal process running. Press **Ctrl+C** to stop it and revoke its pairing capability. Every restart generates a new pairing capability; open the newly printed URL to pair again. Do not share that URL: it authorizes the browser tab to use the helper. The browser removes the capability from the address bar and retains it only in that tab's session storage. **Disconnect local GitHub CLI** only forgets this tab's pairing; the helper and any enabled automation keep running. Pause or disable the feature's automation in the map, or stop the helper with **Ctrl+C**, to stop automatic actions.

The launcher rebuilds the companion at startup so it uses the current checkout. To build it separately:

```sh
pnpm build:companion
```

## Repositories and local development

Repository access must be selected when starting the helper. Repeat `--repo` for additional repositories; the browser cannot expand this allowlist:

```sh
pnpm companion --repo kernel/your-repository --repo kernel/another-repository
```

The default loopback address is `http://127.0.0.1:4318`, and only the exact website origin `https://merge.foo` may connect. If that port is occupied, use `--port 4319` and open the new pairing URL. Run `pnpm companion --help` for the supported options.

Use `--read-only` to disable GitHub changes and automatic progression while still reading the map and saving local plans:

```sh
pnpm companion --repo kernel/your-repository --read-only
```

For a local website, start `pnpm dev` in a separate terminal, then pair the helper to its exact origin:

```sh
pnpm companion --repo kernel/your-repository --origin http://127.0.0.1:3000
```

An origin change requires restarting and pairing again. Do not expose the helper through a tunnel or bind it to a network interface. It is designed for a browser and helper running on the same computer.

## Plans and review actions

The companion supports the map, reviewer planning, holds and progressive-review controls using the same workflow rules as the hosted connection. Plans do not send GitHub notifications. Imported stacks begin with automation off; enrolling a stack and starting review are explicit actions. Live review actions run as the active GitHub CLI user and require their current GitHub permissions. The hosted operator's App write setting does not control companion actions.

Plans, workflow intent and action history persist in `.mergefoo-companion/` in the directory where the helper starts. That directory is ignored by this repository and is restricted to the local user. It does not store GitHub credentials or PR snapshots. Use `--state-dir /absolute/private/path` to choose a dedicated directory, and keep that location outside source control. The companion's plans are separate from the hosted App's shared plans; they are not synchronized between computers.

The helper polls enrolled workflows while it is running; the browser refreshes the visible map every minute while no PR details or edits are open. Review automation can continue after closing the browser when explicitly enrolled, but stops when the helper exits, the laptop sleeps or GitHub access becomes unavailable. Pausing an enrolled workflow in the map stops new automatic releases. Stopping the helper does not undo changes already made in GitHub. The companion performs review readiness and review-request actions; it does not merge PRs.

## Connection troubleshooting

- **Cannot connect:** confirm the helper is running, then open its latest pairing URL. Restarting invalidates the old capability.
- **Browser permission denied:** allow local or loopback network access for merge.foo in browser site settings and retry. Chrome requires permission for websites to access local companion services; see [Local Network Access](https://developer.chrome.com/blog/local-network-access). Browser or device management may restrict this permission. Firefox and Safari have not been verified for this flow.
- **Repository missing:** add its exact `owner/repository` through `--repo` and restart. Check `gh api repos/OWNER/REPOSITORY --hostname github.com --jq .full_name` independently. Archived repositories are excluded.
- **Wrong GitHub user:** stop the helper, use `gh auth switch --hostname github.com --user USER`, then restart. Saved state is scoped to GitHub user and repository identity.
- **State directory is locked after a crash:** verify that the prior process ID shown in the error has exited before removing only `process.lock` from the state directory. Preserve `state.json`; normal **Ctrl+C** shutdown removes the lock automatically.
- **Read or write denied:** resolve the account's current GitHub access or SSO requirements. The helper refuses unverified access and never substitutes demo data.
- **Plans differ from the hosted connection:** each connection has its own storage. Choose the intended connection before editing.

## Verification boundary

Automated tests cover the loopback authentication/origin boundary, allowlist, CLI transport, local state and browser connection routing. An authenticated private-repository read confirms account access for that repository; it does not prove broader organization access or permission for every workflow action. Real review changes should first be exercised on a deliberately selected repository and PR.

## Verified evidence — 2026-10-12

A real companion API smoke test using the stored GitHub CLI login `ehfeng` read private `kernel/kernel` with `--read-only`. It returned all **339 open PRs**, **282 inferred stacks** and no matching ancestors in the bounded recent-merged scan. The complete map took **49.945 seconds**. A separate selected-PR request returned **three GitHub reviewer suggestions**. GitHub writes were disabled; no review requests or notifications were sent.

The source passed **224 unit tests**, **40 browser tests**, TypeScript checking, the SQLite restart and setup tests, a production build and a Cloudflare deployment dry run. After explicit approval, the updated site was published as Worker version `36ac1656-3eb1-479b-b1d0-22494f51d7f0`. A live HTTP check returned 200 and confirmed the GitHub CLI connection option and new client bundle.

Kernel review actions and automatic progression have not been exercised live through the companion. The authenticated read establishes this account's access to this repository. Automated browser tests cover the connection and map with mock data; the user still grants local-network permission when pairing the live site in their browser.
