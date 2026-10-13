# Local GitHub CLI companion

Connect merge.foo to repositories your GitHub account can already access. The standalone companion uses your existing GitHub CLI login, with credentials and personal plans on your computer. You do not need a repository checkout or a package manager.

## Install and connect

For macOS or Linux, install the companion once:

```sh
curl -fsSL https://merge.foo/install.sh | sh
```

Then start its guided setup:

```sh
~/.local/bin/mergefoo connect
```

The installer checks for **Node.js 22 or newer** and **GitHub CLI (`gh`)** and gives setup instructions if either is missing. It downloads one bundled executable from merge.foo, verifies its SHA-256 checksum, and installs it in your user account without administrator privileges. It does not edit your shell profile. If `~/.local/bin` is already on your PATH, you can use `mergefoo connect` directly; otherwise the installer prints the full command to run.

The CLI checks your GitHub sign-in, helps you choose an account or organization, and provides a searchable repository picker. Review the selected repositories, then open merge.foo in your browser. Choose **Connect this computer** and allow local-network access when asked. GitHub App installation and the hosted sign-in are unnecessary for this connection.

At the website's login screen, **Local companion** opens the same install/setup instructions. **GitHub App** remains available for hosted connections and shared plans. If the browser does not open from the CLI, use its printed private pairing link or paste it into the website's fallback field.

Keep the terminal running. Press **Ctrl+C** to stop the companion. Every restart creates a new pairing link; keep it private. The browser removes the link's key from the address bar and stores it only in that tab's session storage. **Disconnect local GitHub CLI** forgets the tab's pairing; explicitly enabled automation continues while the companion runs. Pause the feature or stop the companion to stop automatic actions.

Large repositories can take about a minute for the first map. Requests allow up to 120 seconds; reviewer suggestions load when a PR is selected.

## Check setup and select repositories directly

```sh
~/.local/bin/mergefoo doctor
~/.local/bin/mergefoo --help
~/.local/bin/mergefoo connect --repo OWNER/REPOSITORY
```

Repeat `--repo` to select multiple repositories without the picker. The browser cannot expand this allowlist. `--read-only` disables GitHub changes and automation while retaining local planning. `--no-open` keeps the browser closed and prints its pairing link. These flags also work in noninteractive terminals:

```sh
~/.local/bin/mergefoo connect --repo OWNER/REPOSITORY --read-only --no-open
```

The companion listens only on `127.0.0.1`, normally port 4318. Use `--port 4319` if that port is occupied. For a local development website, pass `--origin http://127.0.0.1:3000`; the normal origin is `https://merge.foo`.

## GitHub access and saved plans

The companion follows your current GitHub permissions. It uses GitHub CLI's stored login for `github.com`, excludes environment token overrides, and never requests or prints the GitHub token. GitHub CLI is a [privileged OAuth app](https://docs.github.com/en/apps/oauth-apps/using-oauth-apps/privileged-oauth-apps), which can operate under ordinary organization OAuth restrictions. SSO, repository access and enterprise policy still apply; a substituted personal token has its own restrictions.

Plans, workflow intent and history are saved in a dedicated user data directory: `~/Library/Application Support/merge.foo/companion` on macOS, the user's XDG data directory on Linux, or local application data on Windows. Use `--state-dir /absolute/private/path` for a different dedicated location or an existing developer companion store. Credentials and PR snapshots are not persisted there. Companion plans are separate from the hosted App's shared plans.

Planning sends no GitHub notifications. Stacks begin with automation off; enrollment and the first review start are explicit. Review readiness and reviewer requests use the signed-in GitHub user and their current permissions. Automation can continue after closing the browser, but stops when the helper exits, the computer sleeps, or access cannot be verified. The companion does not merge PRs.

## Troubleshooting

- **Missing Node or GitHub CLI:** follow the installer's guidance, then run it again. On macOS, `brew install node gh` installs both tools.
- **Not signed in:** the guided CLI offers GitHub sign-in. You can also run `gh auth login --hostname github.com --web` yourself.
- **Command not found:** use the full command printed by the installer, normally `~/.local/bin/mergefoo connect`. Optional PATH setup is printed after installation.
- **Wrong account:** stop the companion, run `gh auth switch --hostname github.com --user USER`, then reconnect. Saved state is scoped to the GitHub user and repository identity.
- **Repository missing:** check `gh repo view OWNER/REPOSITORY` and your SSO grants. Select its exact name with `--repo`; archived repositories cannot be selected.
- **Browser cannot connect:** keep the terminal running and use its latest pairing link. Allow local-network access for merge.foo in browser site settings. Chrome/Edge are the verified browser targets; see [Local Network Access](https://developer.chrome.com/blog/local-network-access).
- **Directory locked after a crash:** verify the prior process has exited before removing only `process.lock`; preserve `state.json`. Normal shutdown removes the lock automatically.

Run the installer again to update the executable. Windows users can download the versioned `.mjs` executable identified by `https://merge.foo/cli/latest.json` and run it with Node; the shell installer is for macOS/Linux.

## Contributor setup

The application keeps pnpm for development. Contributors can run the source companion or rebuild the download:

```sh
pnpm companion --repo OWNER/REPOSITORY --origin http://127.0.0.1:3000
pnpm build:companion
pnpm test:companion-distribution
```

The application build prepares the public installer, release manifest, executable and third-party notices before building the website. The published CLI bundles its JavaScript dependencies; users do not install this application's packages or run a build.

## Verified evidence — 2026-10-12

A real companion API smoke test using the stored GitHub CLI login `ehfeng` read private `kernel/kernel` with `--read-only`. It returned all **339 open PRs**, **282 inferred stacks** and no matching ancestors in the bounded recent-merged scan. The complete map took **49.945 seconds**. A separate selected-PR request returned **three GitHub reviewer suggestions**. GitHub writes were disabled; no review requests or notifications were sent.

The source passed **224 unit tests**, **40 browser tests**, TypeScript checking, the SQLite restart and setup tests, a production build and a Cloudflare deployment dry run. After explicit approval, the updated site was published as Worker version `36ac1656-3eb1-479b-b1d0-22494f51d7f0`. A live HTTP check returned 200 and confirmed the GitHub CLI connection option and new client bundle.

Kernel review actions and automatic progression have not been exercised live through the companion. The authenticated read establishes this account's access to this repository. Automated browser tests cover the connection and map with mock data; the user still grants local-network permission when pairing the live site in their browser.

## Standalone release 0.2.0 — 2026-10-13

The first standalone release replaces checkout-based user setup with an installer and guided CLI. The website exposes Local companion and GitHub App choices directly at login, copyable installation/start commands, and an explicit Connect this computer handoff.

The release passed 355 unit tests, all 52 browser cases, a production build, and installer smoke tests in a temporary directory without a repository or node_modules. The smoke tests cover checksum failures, quoted paths, private file permissions, upgrades, rollback and missing prerequisites. The bundled doctor command also verified the existing `ehfeng` GitHub CLI login without starting a connection or changing GitHub.

## Deployment restoration 0.2.1 — 2026-10-13

A later deployment from the hosted automation branch replaced the companion release with its older onboarding and omitted the CLI downloads. The restored release combines both implementations, preserves feature opt-in and hosted scheduling, and adds the bounded scan required by the companion store's updated interface.

Signed-in onboarding now places **Use local companion** above the repository chooser so it is visible without scrolling on desktop and mobile. The bundled CLI is version 0.2.1; the published 0.2.0 download is retained. Verification passed 422 unit tests, 54 browser cases, the production build, and isolated installer checks. The signed-in screenshots use mocked sessions and repositories.
