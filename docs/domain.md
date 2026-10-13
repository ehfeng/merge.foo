# Production domain — 2026-10-12 PDT

The user purchased `merge.foo` in their Cloudflare account and authorized connecting it to the existing application. The production address is **https://merge.foo**. It uses the existing `merge-foo` Worker, GitHub App, installation and SQLite Durable Object.

## Routing and configuration

- Apex Custom Domain: `merge.foo`, with `custom_domain: true` and no path wildcard.
- Cloudflare created its DNS/TLS. Authoritative nameservers are `alberto.ns.cloudflare.com` and `june.ns.cloudflare.com`; HTTPS returned **200**, with certificate verification **0** (valid).
- `workers_dev: true` retains the old hostname. Its browser GET/HEAD routes return **307** to the canonical address, preserving ordinary path/query state.
- Hosted `APP_ORIGIN` is `https://merge.foo`. Trusted `APP_ORIGIN_ALIASES` lists both `https://merge.foo` and `https://merge-foo.eric.workers.dev`; the current canonical origin is ignored as an alias. This supports either direction during a deliberate cutover.
- Old login/callback URLs restart sign-in on the canonical host before issuing cookies. Callback code/state and login query parameters are discarded rather than forwarded. Unknown authentication origins return **403**.
- Other APIs, webhook POSTs, protected runner requests and non-GET/HEAD requests are exempt from browser redirects. Canonical-only CSRF and host-only cookies remain enforced.

The App homepage is `https://merge.foo`. Its exact callbacks, all with wildcard matching disabled, are:

1. `http://127.0.0.1:3000/api/auth/callback`
2. `https://merge.foo/api/auth/callback`
3. `https://merge-foo.eric.workers.dev/api/auth/callback`

The existing signed webhook remains at `https://merge-foo.eric.workers.dev/api/github/webhook`. Both hostnames reach the same native receipt implementation; retaining this endpoint preserves integration continuity. The minute cron, durable binding/migration, repository scope, credential values and paused workflow settings were preserved. Local operator configuration remains loopback. The private hosted backup now records only the new origin; all other fields and mode 600 were preserved.

## Verification

The domain source deployment was **`0a4a1c81-8cf2-477f-bc60-8581fa9c13f3`** (`2026-10-13T04:18:42.923091Z`). Updating only the hosted origin activated **`079e7ba8-fc14-4f85-8fa2-e7ed3b9acc73`** at **100%** (`04:19:08.392441Z`). Setup-copy version **`dc04889e-896e-4802-ad2f-21a97af916c5`** later separated paused actions from App permissions; **`aa060e17-df05-4930-885f-38b20bc47872`** added public repository connection/refresh. The current archive-filter version is **`79ac8c5a-8531-4952-aa62-47979df51655`**, preserving the domain, grants and paused workflow. See [current onboarding](onboarding.md).

- Canonical HTTPS serves the app; old root redirects to `https://merge.foo/`.
- Canonical session API returns **200**; unauthenticated repository/workspace APIs return **401**, all with no-store protection.
- The old protected runner returns **401** without authorization and no redirect.
- Old login/callback probes return **307** to fresh canonical sign-in without issuing cookies or forwarding OAuth parameters. The lab query survives the UI redirect. Unsigned webhook POSTs return **401** on both hosts with no redirect or durable receipt.
- Actual normal GitHub OAuth returned to `https://merge.foo` as `ehfeng`. Selecting `ehfeng/merge.foo` loaded the three real PRs and retained planned assignments. Same-origin sign-out succeeded.
- TypeScript and **184 unit tests** pass. The operator helper's canonical default passes **14 setup tests**. Independent review reran **53 focused tests**.
- Fresh Cloudflare, Node and Vercel builds pass. Credential-free emitted Node/Vercel probes verify authentication redirect/cookie boundaries, protected APIs and absence of Cloudflare-only executable imports, with outbound requests blocked.

Connected map and preserved plan evidence, registered callback evidence. The original [pilot report](pilot.md) preserves its earlier workers.dev timestamps and account evidence.

The domain cutover does not resolve the five intermittent webhook HTTP 500s observed during the pilot. Feature automation and global workflow writes remain off. Domain setup sent no PR reviews, review requests or merges.

Repository selection lists repositories accessible through the signed-in user's App installations. At the domain/pilot checkpoint, installation `170800499` selected only `ehfeng/merge.foo`; a domain or sign-in change does not itself add repositories. Later [self-service verification](onboarding.md) observed a broader list. Added repositories inherit the App's PR-write grant independently of paused actions and the narrower background scope. Users choose that grant in GitHub; an agent acting on their behalf needs an explicit repository choice. Organization repositories need an applicable organization installation.

## Recovery

Preserve the existing `AUTH_SECRET`, GitHub credentials and durable state. For a deliberate host rollback, first verify the old host/callback, then change only `APP_ORIGIN` back to the previous exact origin while retaining trusted aliases. Starting a fresh OAuth flow is required because cookies do not transfer between domains. Do not recreate the App, overwrite local configuration or enable progression while recovering routing.

Primary references: [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [workers.dev configuration](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/) and [GitHub authorization callbacks](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url).

Personal account and operator screenshots referenced in this verification record are kept locally and omitted from the public repository.
