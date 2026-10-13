# Connected repository review automation

Any non-archived repository available through a user's merge.foo GitHub authorization can use review automation. The App installation must have accepted Pull requests write permission, and the user must have the GitHub permissions required for each action. There is no product-owned repository allowlist or separate teammate membership.

Connecting and viewing a repository does not start reviews. A repository writer explicitly enables coordination for a feature; its first review starts through the recipient preview, and automatic progression is a separate per-feature choice. Existing approval requirements, holds, simple-chain checks, identity checks and attributable rollback still apply.

## Durable discovery and consent

Authorized workflow commands register repository discovery metadata in shared state after command validation and before the workflow compare-and-swap. If registration fails, enabled intent is not saved and the user can retry. A concurrent workflow conflict can leave a discovery record, but that record grants no authority: the runner reads current enrolled intent before minting a token or dispatching.

The registry uses stable installation/repository IDs and contains canonical repository metadata only. Workflow settings, plans and effect history remain in their existing installation/repository scopes. GitHub removal, suspension, archive status, accepted permissions and the granting actor's current writer permission are rechecked before effects. A concurrent change to the management grant is fenced at dispatch.

Signed webhooks may wake already registered repositories. They cannot create registry membership or enable a feature. The same seven-second receipt deadline and durable-before-ack rule apply. An unknown registered name requires refreshed authorized metadata; old queued names cannot select a different target. Changed installations use a different state scope.

## Scheduling and hosting

The minute Cloudflare cron, Vercel Cron, and Node sidecar call the protected GET runner, which selects one registered repository per wakeup using a durable keyset cursor. Registry and inbox scans are bounded, wrap fairly and survive restarts. No fixed list is required, including when `WORKFLOW_REPOSITORIES=[]`.

Polling frequency depends on the number of registered repositories and wakeup frequency; this implementation does not promise immediate progression at arbitrary scale. One workflow step runs per bounded invocation, preserving durable claims and safe retries. Public multi-account capacity and large repository workloads remain to validate.

`WORKFLOW_REPOSITORIES` is an optional legacy migration input only. A bounded checkpoint recovers discovery for existing explicitly enrolled features; it does not enroll features, enable progression, start reviews, or gate new repositories. Existing plans and workflow records are preserved. No SQL schema migration is needed.

Cloudflare Free distinguishes 50 external subrequests from 1,000 calls to internal Cloudflare services. The deployed SQLite/Durable Object path keeps the existing GitHub transport budget. PostgreSQL HTTP requests add external calls on Cloudflare, so that combination needs representative total-budget testing; Node/Vercel do not inherit Cloudflare's fixed request limit. No paid upgrade is assumed. [Cloudflare limits](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/)

## Operator configuration

Configure the existing App credentials, webhook verification secret, runner secret and shared state once. `GITHUB_WORKFLOW_WRITES_ENABLED` remains the service-level emergency pause. GitHub repository access is granted in GitHub's existing installation flow; accepting installation permission updates may require a repository or organization administrator.

The normal user selects a repository, plans reviewers, enables feature coordination, starts its first review and chooses automatic progression. Operators do not append repository IDs for each new user.
