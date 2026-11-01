# Coder Rust migration

The Cargo workspace builds a unified `coder` executable for the Rust dashboard,
PostgreSQL control plane, infrastructure worker, outbound workspace agent, and
WireGuard TCP/SSH forwarding client, OIDC sign-in, resource-scoped roles, and browser PTYs. The worker can embed either Terraform or OpenTofu;
no engine download is needed at runtime. The shared validation library remains
dependency-free. This is a working migration of the implemented flows, with
the compatibility limits listed below.

The compatibility target is this fork's [`1.5.1` tag](https://github.com/user187x/coder/tree/1.5.1),
commit `3536d5b6f268beab85b8e9892aa38185cfdd718c`, recorded in
[`compatibility.json`](compatibility.json). All capabilities and UI behavior in
that tag are required, including platform extensions and features formerly
classified as enterprise. Later additions are outside this target. The Rust
port is incomplete; this target does not mean the implemented flows have full
release compatibility.

## Open in an IDE

Open this `rust/` directory in VS Code with rust-analyzer, or open `Cargo.toml`
in RustRover or another Rust IDE. Install Rust 1.85 or later using rustup.
No Node.js, npm, WebAssembly toolchain, or container is needed to build the UI.
The shared library has no third-party dependencies. Open `server/src/main.rs`
to run/debug the complete implemented application, or `ui/src/main.rs` to run
the dashboard against an existing Coder deployment.

```sh
cargo build --workspace --locked
cargo test --workspace --locked
cargo fmt --all --check
cargo clippy --workspace --locked --all-targets -- -D warnings
```

## Build a bundled executable

For a small development build, run `cargo build --locked -p coder`. No engine
is embedded by default. To distribute one executable with an engine, first
obtain a platform-matching Terraform or OpenTofu executable and its license
from an official release. Verify the release archive against the published
checksum, then pass the executable's SHA-256 to:

```sh
bash scripts/build-bundle.sh opentofu /absolute/path/to/tofu VERIFIED_EXECUTABLE_SHA256 /absolute/path/to/LICENSE
```

Use `terraform` as the first argument to embed Terraform instead. The build
rejects a mismatched checksum and includes the engine license. It produces
`dist/coder-opentofu.tar.gz` or `dist/coder-terraform.tar.gz`. The archive contains
`coder`, notices, this guide, and the example template. The GitHub Actions
`rust-bundle` workflow performs the same build for Linux AMD64 using pinned,
checksum-verified releases. The engine is extracted into a private temporary
directory while in use and removed on normal shutdown. A crash can leave that
engine file behind; it contains no workspace credentials.

Run the packaged roles with the same executable:

```sh
./coder server
./coder worker
./coder agent
./coder engine version
./coder engine-license
```

Each role runs as a separate process. The server still requires PostgreSQL;
remote HTTPS requires a TLS reverse proxy that supports WebSocket upgrades.
Providers, workspace services, and remote modules are not embedded. This is a
bundled application runtime, not a rewrite of the Terraform/OpenTofu engines
in Rust or a replacement for every feature of the original application.

## Run the Rust application

Set `DATABASE_URL` to a PostgreSQL connection string, then run from this directory:

```sh
cargo run --locked -p coder-server
```

Open **http://127.0.0.1:3000/setup** to create the first administrator and default
organization. Setup closes after the first account is created. Passwords must
be 12-1024 bytes. The server includes the Rust dashboard, so a separate UI
process is unnecessary.

| Variable               | Default             | Purpose                                                          |
|------------------------|---------------------|------------------------------------------------------------------|
| `DATABASE_URL`         | Required            | PostgreSQL connection string                                     |
| `CODER_SERVER_LISTEN`  | `127.0.0.1:3000`    | HTTP listening address                                           |
| `CODER_SERVER_ORIGIN`  | HTTP listen address | Exact public browser origin for form validation                  |
| `CODER_ENCRYPTION_KEY` | Unset               | 64 random hexadecimal characters for secrets and Terraform state |

Use an existing PostgreSQL server or a local development instance. Tables and the
SQLx migration history live in an isolated `coder_rust` schema. Existing Go
Coder users, sessions, templates, and workspaces are **not imported or modified**.
Keep the encryption key stable and backed up; without it secret writes and Terraform job claims are
unavailable, and stored secrets and state cannot be decrypted after a key change. Secret
values use AES-256-GCM with authenticated user/name context. Stored-byte and
count budgets are enforced transactionally. Only environment delivery is supported.

For non-local use, terminate HTTPS at a reverse proxy, set the public HTTPS
origin, and use a PostgreSQL connection configured with certificate verification.
The Rust process serves HTTP and does not terminate TLS itself.

## Configure an external PostgreSQL database

The `server`, `migrate`, and `db-check` commands share explicit database flags.
Run `coder server --help` for the complete list. The standalone `coder-server`
accepts the same server flags. CLI flags override environment values; explicit
host/port/user/database flags override their fields in `DATABASE_URL`.
Passwords can be supplied through `PGPASSWORD` or a password file, including
passwords containing URL-special characters. Password files preserve spaces and
remove one trailing line ending. Unknown, duplicate, and invalid options fail
without echoing their values.

For example, after provisioning an external database and role:

```sh
./coder db-check \
  --db-host db.example.com --db-port 5432 \
  --db-user coder --db-name coder \
  --db-password-file /run/secrets/postgres-password \
  --db-ssl-root-cert /etc/coder/postgres-ca.pem
```

`db-check` verifies connectivity without applying migrations. TLS defaults to
`verify-full`, which verifies the certificate chain and database hostname.
A URL's explicit `sslmode` is honored; `--db-ssl-mode` overrides it. For mutual
TLS, also pass `--db-ssl-cert` and `--db-ssl-key`. Use `--db-ssl-mode disable`
only when deliberately choosing an unencrypted connection, such as a local
development database. The bundled runtime does not create PostgreSQL databases
or roles.

The corresponding environment settings are:

| Parameter               | Environment variable                     | Default                              |
|-------------------------|------------------------------------------|--------------------------------------|
| `--database-url`        | `DATABASE_URL`                           | Unset                                |
| `--db-host`             | `PGHOST`                                 | Required without a URL               |
| `--db-port`             | `PGPORT`                                 | `5432`                               |
| `--db-user`             | `PGUSER`                                 | `postgres`                           |
| `--db-name`             | `PGDATABASE`                             | `postgres`                           |
| Password                | `PGPASSWORD` or `CODER_DB_PASSWORD_FILE` | Unset                                |
| `--db-ssl-mode`         | `PGSSLMODE`                              | `verify-full`                        |
| `--db-ssl-root-cert`    | `PGSSLROOTCERT`                          | Unset                                |
| `--db-ssl-cert`         | `PGSSLCERT`                              | Unset                                |
| `--db-ssl-key`          | `PGSSLKEY`                               | Unset                                |
| `--db-max-connections`  | `CODER_DB_MAX_CONNECTIONS`               | `10`                                 |
| `--db-connect-timeout`  | `CODER_DB_CONNECT_TIMEOUT`               | `10` seconds                         |
| `--listen`              | `CODER_SERVER_LISTEN`                    | `127.0.0.1:3000`                     |
| `--origin`              | `CODER_SERVER_ORIGIN`                    | Listening address                    |
| `--encryption-key-file` | `CODER_ENCRYPTION_KEY_FILE`              | Falls back to `CODER_ENCRYPTION_KEY` |
| `--no-migrate`          | `CODER_DATABASE_MIGRATE=false`           | Migrate at startup                   |

With a URL, host/port/user/database environment values are not overrides; put
those values in the URL or explicit flags. TLS environment settings and
`PGPASSWORD` can supply fields omitted from the URL. A password file overrides
the URL/environment password. Keep passwords out of command arguments and
configure the environment through your service manager or secret mounts.

For deployments that separate migration and runtime privileges, run
`coder migrate` with a role allowed to create the `coder_rust` schema, tables,
indexes, and sequences. Run `coder server --no-migrate` with a role granted schema
usage, table read/write privileges, sequence usage, and read access to
`coder_rust._sqlx_migrations`. The server checks all migration versions and
checksums without writing migration history. It refuses startup if the schema is
missing, incomplete, newer, or incompatible with this binary. Existing Go data
is not imported by these commands.

Use the same connection flags or environment settings for both commands:

```sh
./coder migrate --db-host db.example.com --db-user coder_migrator --db-name coder \
  --db-password-file /run/secrets/migration-password --db-ssl-root-cert /etc/coder/postgres-ca.pem
./coder server --no-migrate --db-host db.example.com --db-user coder_runtime --db-name coder \
  --db-password-file /run/secrets/runtime-password --db-ssl-root-cert /etc/coder/postgres-ca.pem \
  --encryption-key-file /run/secrets/coder-encryption-key --listen 0.0.0.0:3000 \
  --origin https://coder.example.com
```

`/healthz` is process liveness. `/readyz` checks PostgreSQL connectivity and
returns HTTP 503 when the pool/database is unavailable. Connection failures and
configuration errors do not print the database URL, password, or key contents.

The core implements:

- Transactional first-user setup and default organization membership.
- Argon2 password hashing, bounded authentication work, sign-in throttling,
  hashed expiring session tokens, and server-side logout.
- User/profile APIs, administrator-only user creation/listing/suspension, organization checks, and CLI sessions.
- OIDC authorization code sign-in with PKCE, verified ID tokens, and explicit identity linking.
- Organization roles with per-resource allow/deny permissions, shared workspaces, and access audit events.
- Native agent PTYs with browser terminal rendering and live authorization checks.
- Organization-scoped template definitions and typed rich parameters.
- Owner-scoped workspaces, search, favorites, build history, logs, and lifecycle jobs.
- Encrypted secret storage and delivery only to an authorized workspace job worker.
- Durable provisioner claims, renewable leases, cancellation, completion fencing,
  expiry failure, and queued stop/start orchestration.

## Run infrastructure provisioning

Use an embedded engine, or install Terraform 1.4+ / OpenTofu on a Unix worker
host. Terraform 1.13.5 and OpenTofu 1.10.6 are tested. The Rust worker invokes
the selected engine CLI; provider plugins remain engine-managed executables. Set `CODER_ENCRYPTION_KEY` on the server before creating infrastructure.

Create an organization-scoped key using an administrator session:
`POST /api/v2/organizations/{organization_id}/provisionerkeys`. The response's
`key` is returned once. Start the worker from this directory:

```sh
export CODER_PROVISIONER_TOKEN='<returned key>'
cargo run --locked -p coder-provisioner
```

| Variable                         | Default                      | Purpose                                 |
|----------------------------------|------------------------------|-----------------------------------------|
| `CODER_PROVISIONER_TOKEN`        | Required                     | Organization worker key                 |
| `CODER_PROVISIONER_URL`          | `http://127.0.0.1:3000`      | HTTPS server root URL, or loopback HTTP |
| `CODER_TERRAFORM_BINARY`         | `terraform` from PATH        | Terraform executable                    |
| `CODER_PROVISIONER_RECOVERY_DIR` | `coder-provisioner-recovery` | Private Unix directory, mode 0700       |

Submit [the minimal Terraform template](provisioner/examples/terraform-template.json)
to `POST /api/v2/organizations/{organization_id}/templates` using a
`Coder-Session-Token` header. Its response includes `active_version_id`; select
that template in the Rust UI to create a workspace and supply its `message`
parameter. The example uses Terraform's built-in `terraform_data` resource,
so it needs no cloud account or external provider. Start creates one resource,
stop removes it, and delete destroys the remaining state.

To swap an installed engine, set `CODER_IAC_BINARY=/absolute/path/to/tofu`
or select `CODER_IAC_ENGINE=opentofu`. An explicit executable takes precedence
over the embedded engine. Selecting a different engine kind uses its PATH
command; it does not silently run the other embedded engine. `provisioner_spec`
continues to use `driver: "terraform"` for both engines. The queue, lifecycle,
and encrypted state protocol are shared. Back up state and verify provider,
lockfile, state-format, and template compatibility before changing engines for
existing cloud infrastructure; the tested built-in-resource example does not
establish universal compatibility.

Set `CODER_PROVIDER_MIRROR` to a prepared engine-compatible provider mirror to
install providers locally without registry fallback. A private job-local CLI
configuration isolates worker settings from the user's global configuration.
The mirror does not vendor remote modules or remove a provider's need to reach
its cloud API. Ship required modules/providers separately for air-gapped use.

A Terraform spec accepts `driver`, `files`, optional `variables`, and an
optional `agent: { "ports": [22, 3000], "terminal": true }` configuration.
Terminal access defaults to false and also requires local agent opt-in. Files must
be flat `.tf`/`.tf.json` files, plus an optional `.terraform.lock.hcl`, with at
most 32 files and 64 KiB total source. Use the local Terraform backend; external
backends and Terraform Cloud are unsupported. Rich parameters become typed
Terraform variables. Declare `variable "coder_start_count" { type = number }`
and use it for resource counts: start passes 1, stop passes 0, and delete uses a
destroy plan. Templates define stop behavior; the worker cannot infer how an
arbitrary provider should shut a resource down. Names beginning with `coder_`
are reserved. Optional `coder_workspace_id` and `coder_organization_id` variables
are available, and `coder_environment` receives the owner's enabled secrets as
a sensitive map. When `agent` is configured, declare sensitive string variable
`coder_agent_token`; the worker supplies a stable, encrypted workspace credential
on every transition. Use it to configure `CODER_AGENT_TOKEN` in the deployed
agent. The template must install and launch the platform-matching agent binary;
adding the `agent` block alone does not create a machine or start an agent. Cloud credentials belong to the worker environment.

The worker renews leases, applies saved plans, and checkpoints AES-256-GCM state
in PostgreSQL with workspace/organization authenticated context. Each run uses a
new private directory and restores remote state, so another worker can continue.
Only resource names/types and fixed progress messages reach the dashboard.
Raw Terraform output is discarded because it can contain secrets. One worker
executes one job at a time; run more workers to serve the organization queue.
Jobs have a 30-minute Terraform deadline. SIGINT, SIGTERM, timeout, or a rejected
heartbeat interrupts the entire Terraform process group, then kills it after a
10-second grace period. Cancellation is detected by the heartbeat, at most one
30-second heartbeat interval plus the request timeout later.

Templates and providers execute code with the worker's privileges and inherited
cloud credentials. Use trusted administrator templates and dedicated isolated
worker hosts. This worker is not a sandbox. Recovery directories may contain
plaintext state, variables, and saved plans; keep them on persistent private
storage and remove them only after recovery.

### Recover an interrupted apply

Before apply, the server marks the workspace's state dirty. If the worker cannot
commit its final checkpoint, further infrastructure builds are blocked. No
infrastructure operation is automatically replayed. The Rust UI displays a
recovery message after the build ends. An acknowledged clean checkpoint removes
the worker directory; uncertain execution retains it and prints its location.

Stop the old worker and verify its Terraform/provider processes have exited.
Reconcile actual infrastructure with the retained `terraform.tfstate` (or a
verified backup); an old pre-apply checkpoint may omit resources created during
the interrupted apply. An administrator can inspect metadata using
`GET /api/v2/workspaces/{id}/provisioner-state`, then submit:

```json
{
  "revision": 3,
  "confirm_workspace_id": "exact-workspace-uuid",
  "state": { "version": 4 }
}
```

Send this body to `POST /api/v2/workspaces/{id}/provisioner-state/recover` with
an administrator session. Replace `revision` with the current metadata revision
and `state` with the **complete reconciled state**, not the abbreviated example.
The endpoint requires exact workspace confirmation, rejects active leases and
stale revisions, and stores the recovered state encrypted. Cancellation or
expiry fences server writes but cannot prove that a disconnected external
provider has stopped; operator reconciliation remains necessary. State is
limited to 4 MiB per workspace. Back up PostgreSQL and its encryption key.

## Provisioning worker contract

Templates are created by an administrator using
`POST /api/v2/organizations/{organization_id}/templates`, with JSON such as:

```json
{
  "name": "development",
  "display_name": "Development",
  "parameters": [],
  "provisioner_spec": { "driver": "your-worker-adapter" }
}
```

Obtain a session token from `POST /api/v2/users/login` and send it in the
`Coder-Session-Token` header. Obtain organization IDs from
`GET /api/v2/users/me/organizations`. The template creation response contains
its active version ID for workspace creation. Unsupported mutation fields are
rejected rather than silently pretending to apply unimplemented options.

Create an organization-scoped worker key with
`POST /api/v2/organizations/{organization_id}/provisionerkeys`. The `key` value is
returned once; only its hash is stored. Worker calls use a separate
`Coder-Provisioner-Token` header:

1. POST `{}` to `/api/v2/provisioner/jobs/claim`. A `null` response means no job.
2. Execute the claimed transition using the supplied spec and parameters. A start
   job also includes its owner's enabled secret environment. Terraform jobs receive
   it on every transition. Do not log secrets.
3. Renew the five-minute lease at `/jobs/{id}/heartbeat` under the same
   `/api/v2/provisioner` prefix, with `{ "lease_token": "..." }`.
4. Append logs at `/jobs/{id}/logs`, with the lease token and `entries` containing
   `log_level` and `output` fields.
5. Report actual results at `/jobs/{id}/complete`, with the lease token,
   `success`, `resources`, and an optional `error`. Resource objects require
   `name`, `type`, and `hide`; agents use the existing Coder JSON field names.

A successful start becomes `running`, stop becomes `stopped`, and delete hides
the workspace only after worker completion. A rejected heartbeat means the
worker must stop. Canceled, completed, expired, and mismatched leases cannot
commit results. Claim polling marks expired jobs failed; it never automatically
repeats infrastructure changes. A successful queued stop inserts its follow-up
start atomically. Worker keys can be revoked through the organization key API.

The bundled worker claims only `driver=terraform` jobs. Other worker adapters
can filter claims with `?driver=...`. Terraform adapters read state at
`/jobs/{id}/state/read` with a lease token and checkpoint it at `/jobs/{id}/state`
with `lease_token`, `revision`, `state`, and `dirty`. Each write increments the
revision; completion requires matching `state_revision` and a clean checkpoint
for success. These routes use the same `/api/v2/provisioner` prefix.

Cloud and Docker resource providers have not been exercised. The outbound Rust
agent provides relayed TCP, including SSH transport to an existing SSH service.
WireGuard encrypts CLI connections through the relay. Workspaces remain pending
until a suitable worker executes their jobs. The JSON worker protocol differs
from Go DRPC. Direct peer discovery, the Go agent protocol, scheduling, quotas,
remaining organization controls, and in-place Go data migration remain unported. This is
not a drop-in replacement for an existing Coder deployment.

## Connect a workspace

Install `coder` inside the workspace and on the client. The workspace's SSH
service or application must already listen on IPv4 loopback or all IPv4
interfaces. The agent never accepts inbound connections and never connects to
arbitrary destination hosts. Both server and agent enforce explicit port lists.

For a manually installed agent, obtain an owner session token from
`POST /api/v2/users/login`, then register allowed ports on the client:

```sh
export CODER_URL=https://coder.example.com
export CODER_SESSION_TOKEN='<owner session token>'
./coder register WORKSPACE_UUID 22,3000
```

Registration prints a one-time `token`; keep that response private. Install the
token and the same permitted ports in the workspace's service environment:

```sh
export CODER_URL=https://coder.example.com
export CODER_AGENT_TOKEN='<registered token>'
export CODER_AGENT_PORTS=22,3000
./coder agent
```

A template with an `agent` configuration can install this environment using
`var.coder_agent_token` instead of manual registration. The token is stored as a
hash for authentication and encrypted for worker bootstrap. Rotating manual
registration invalidates the prior credential. Revoke it with
`DELETE /api/v2/workspaces/{id}/agent`; inspect connection status and allowed
ports with `GET` on the same path. Owner metadata APIs never return the token.

On the client, forward a workspace application to a local loopback listener:

```sh
./coder forward WORKSPACE_UUID 3000 127.0.0.1:13000
```

For SSH, use the stdio transport as a ProxyCommand, keeping the usual SSH
host-key verification and user authentication:

```sh
ssh -o 'ProxyCommand=/absolute/path/to/coder connect WORKSPACE_UUID 22' user@workspace
```

The SSH command inherits `CODER_URL` and `CODER_SESSION_TOKEN`. This transports
SSH to an existing workspace SSH server; it does not install sshd, manage SSH
keys. CLI connections now require a WireGuard handshake before accepting local
input; they never silently fall back to plaintext. BoringTun 0.7.1 implements
WireGuard cryptography, with fresh X25519 keys per connection, replay protection,
key rotation timers, authenticated EOF, and ordered stream records. Encrypted IP
packets travel inside the existing WebSocket relay. The control plane distributes
public keys and remains trusted for peer identity; the relay does not hold the
CLI connection private keys or decrypt its payloads.
The relay supports independent TCP half-close, bounded frames/backpressure, and
32 simultaneous sessions per workspace (1024 per server). It rechecks sessions,
organization access, port permissions, agent credentials, and workspace state
every two seconds; a blocked socket write can add its ten-second timeout to
revocation latency. Stops, deletes, recovery requirements, logout, and key
revocation close access. Clients reconnect explicitly after a network failure.

Run one Rust server instance for this relay. Connection tickets and sockets are
process-local; multi-server routing and distributed relay state are not
implemented. Remote deployments require WSS through the TLS reverse proxy.
This transport needs no TUN device, root privileges, or kernel WireGuard module.
It is not a UDP VPN: STUN/DERP, transparent IP routing, NAT traversal, and direct
peer-to-peer connections are not implemented. Existing raw TCP relay API clients
remain supported; the Rust CLI always negotiates WireGuard.

## Enable browser terminals

On a client with `workspace.agent` permission:

```sh
./coder register WORKSPACE_UUID 22,3000 --terminal
```

Inside the workspace, configure the agent service:

```sh
export CODER_AGENT_TERMINAL=true
export CODER_AGENT_SHELL=/bin/bash
export CODER_AGENT_DIRECTORY=/home/coder
./coder agent
```

Set `CODER_URL`, `CODER_AGENT_TOKEN`, and `CODER_AGENT_PORTS` as above. Both the
server registration and the local service must enable terminals. Terraform
bootstrap can set `provisioner_spec.agent.terminal`; its startup script must also
set the local service variables. The worker supplies `coder_agent_terminal`
alongside `coder_agent_token` as Terraform input variables.

Open a running workspace and select **Terminal**. The Rust agent creates a native
Unix PTY as its own operating-system user. Keyboard input, control characters,
ANSI rendering, and resize events work without a shell command supplied by the
browser. The bundled xterm.js 6.0.0 renderer is served locally, with its MIT
license; no npm build, CDN, or Node runtime is required. Only terminal pages
permit scripts. Terminal sockets require an exact browser Origin and an
HTTP-only session cookie, with `workspace.terminal` authorization rechecked
throughout the session. Browser terminal traffic uses TLS through the trusted
control plane; it does not use the CLI's end-to-end WireGuard channel.

Disconnecting kills the shell and its foreground process group and reaps the
shell. Sessions do not resume. Deliberately detached processes are not a sandbox:
run each agent under the intended workspace OS account. Shells inherit only
HOME, USER, LOGNAME, PATH, locale settings, and TERM; service credentials are
excluded. Native browser PTYs currently require a Unix agent.

## Configure SSO

Complete initial setup first. Register an OIDC client with your provider using
`https://coder.example.com/auth/oidc/callback` as the exact redirect URI, then run:

```sh
./coder server --db-host db.example.com --db-user coder --db-name coder \
  --db-password-file /run/secrets/pg-password \
  --db-ssl-root-cert /etc/coder/pg-ca.pem \
  --encryption-key-file /run/secrets/coder-key \
  --origin https://coder.example.com \
  --oidc-issuer https://identity.example.com/realms/developers \
  --oidc-client-id coder \
  --oidc-secret-file /run/secrets/oidc-secret \
  --oidc-organization ORGANIZATION_UUID
```

Equivalent environment variables are `CODER_OIDC_ISSUER`, `CODER_OIDC_CLIENT_ID`,
`CODER_OIDC_SECRET_FILE`, and `CODER_OIDC_ORGANIZATION`. Public clients can omit
the secret file. Discovery, JWKS, and token requests have bounded response sizes,
timeouts, and no redirects. HTTPS is required except for loopback development.
ID tokens are verified for signature, issuer, audience, expiry, nonce, and access
token hash when present. Login state is single-use, bound to an HTTP-only browser
cookie, expires after five minutes, and is lost on server restart.

New account creation is disabled by default. In **Access**, a deployment owner
can link an existing member to an exact provider subject. Linking disables that
member's password login and revokes sessions. Relinking replaces their previous
provider subject. Existing email addresses never
cause automatic account linking. Deployment owner accounts cannot be converted.
With `--oidc-allow-signups true` (`CODER_OIDC_ALLOW_SIGNUPS=true`), a verified
email claim permits new non-admin users in the configured organization. Limit
who can authenticate to this client at the identity provider before enabling it.

`--password-auth false` (`CODER_PASSWORD_AUTH=false`) disables password sign-in
for the deployment, including owners. Restoring it requires changing server
configuration. OIDC uses local one-day application sessions; IdP logout does not
revoke them automatically. A deployment owner can suspend a member using
`PATCH /api/v2/users/USER_UUID/status` with `{"status":"suspended"}`; suspension
revokes sessions and prevents further sign-in. SAML, SCIM, provider group sync,
and OIDC back-channel logout are not implemented.

After browser sign-in, **CLI access** issues a one-day token shown once for
`CODER_SESSION_TOKEN`. It also revokes all browser and CLI sessions. These APIs
are `POST /api/v2/users/me/tokens` and `DELETE /api/v2/users/me/sessions`.

## Manage permissions

Open **Access** to create organization roles, assign members, link SSO identities,
and review access events. A role contains explicit action names, an optional
workspace/template UUID, and `allow: true` or `false`. Deny wins over grants and
member defaults. Deployment owners bypass role denies within organizations they
belong to. Active organization membership is always required. Granting
`rbac.manage` delegates full access administration for that organization.

Members can read/use templates and create/manage their own workspaces by default.
Use denies to restrict these defaults. For another user's workspace, grant
`workspace.read` plus only the operations needed. Reading never grants shell,
network, agent-key, build, or delete access. List queries use the same permission
function as object endpoints, and the UI hides disallowed workspace actions.

| Actions                                                                                       | Scope                                                                         |
|-----------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------|
| `workspace.read`, `workspace.start`, `workspace.stop`, `workspace.cancel`, `workspace.delete` | One workspace or all in the organization                                      |
| `workspace.connect`, `workspace.terminal`, `workspace.agent`                                  | Separate network, shell, and agent credential permissions                     |
| `workspace.state.read`, `workspace.state.recover`                                             | State metadata and privileged recovery; owners do not get recovery by default |
| `template.read`, `template.use`                                                               | One template or all in the organization                                       |
| `workspace.create`, `template.write`, `provisioner.manage`, `rbac.manage`, `audit.read`       | Organization                                                                  |

Routes under `/api/v2/organizations/ORG_UUID`:

- `GET/POST /roles`: list or create roles and discover available actions.
- `PUT/DELETE /roles/ROLE_UUID`: replace or delete a role.
- `PUT/DELETE /roles/ROLE_UUID/users/USER_UUID`: assign or remove a role.
- `GET /members`: list assignable members, up to 1000.
- `GET /audit`: paginated access events, including role changes, identity linking,
  SSO sign-ins, member suspension, and connection/terminal openings.
- `PUT /oidc/users/USER_UUID`: link `{"subject":"provider-subject"}` as an owner.

Role update example:

```json
{
  "name": "workspace-support",
  "permissions": [
    {"action": "workspace.read", "resource_id": "WORKSPACE_UUID", "allow": true},
    {"action": "workspace.terminal", "resource_id": "WORKSPACE_UUID", "allow": true}
  ]
}
```

Replace `WORKSPACE_UUID` with the actual UUID. Roles and assignments are durable
PostgreSQL data in `coder_rust`. The audit API covers access operations; it is not
an equivalent of the original deployment's full audit subsystem. Group-based
bindings, enterprise policy languages, and Go role/data migration remain separate
compatibility work.

## Database integration tests

```sh
cargo test --workspace --locked
cargo test -p coder-server --test control_plane --locked -- --ignored
CODER_TEST_TERRAFORM_BINARY=/absolute/path/to/terraform CODER_TEST_ALTERNATE_IAC_BINARY=/absolute/path/to/tofu cargo test -p coder-server --test infrastructure --locked -- --ignored
cargo test -p coder-server --test networking --locked -- --ignored
CODER_AGENT_TOKEN=must-not-inherit cargo test -p coder-server --test access --locked -- --ignored
cargo test -p coder-server --test postgres --locked -- --ignored external_postgres_configuration
python3 scripts/test-postgres-tls.py
```

The integration commands require `CODER_TEST_DATABASE_URL` pointing to an **empty,
dedicated test database**. It creates test data and does not reset existing data.
CI supplies PostgreSQL 16 and runs the test on Rust 1.85 and stable. The test
exercises setup, authentication, organization isolation, secret encryption and
worker delivery, job fencing, restart/cancellation, lease expiry, deletion,
HTTP-service restart persistence, and real Rust UI sign-in. The infrastructure
test executes the example template with real Terraform, checks start/stop/delete
across fresh worker directories, encrypted state, stale lease rejection, dirty
state blocking, and administrator recovery. It uses built-in resources and
creates no cloud infrastructure. The networking test runs real WebSocket and TCP
connections through the outbound agent, including concurrent transfers,
half-close, cross-user rejection, credential revocation, logout, and single-use
connection tickets. CI also exercises the embedded OpenTofu engine through
infrastructure jobs. The TLS test helper uses Python/OpenSSL only for test certificates and a
mutual-TLS proxy in front of the configured dedicated PostgreSQL test database.
It verifies a successful authenticated TLS connection and rejection of a hostname
that does not match the certificate. These are test-only dependencies. Local verification
also supports an embedded PostgreSQL test adapter with
`CODER_TEST_SINGLE_CONNECTION=1`; this adapter does not establish native
PostgreSQL concurrency or production load behavior.

## Run the UI

To run the UI separately against either backend, with a Coder API running at `http://127.0.0.1:3000`:

```sh
cargo run --locked -p coder-ui
```

Open **http://127.0.0.1:8080**. Sign in with your Coder username/password, or an
existing Coder session token. Password sign-in respects the deployment's auth
settings and terms of service. The browser receives an HTTP-only session cookie;
credentials are sent only to the configured backend. No user database or token
store is created by the UI.

For a remote backend or a reverse proxy, configure the process environment:

| Variable           | Default                                  | Purpose                                                |
|--------------------|------------------------------------------|--------------------------------------------------------|
| `CODER_UI_BACKEND` | `http://127.0.0.1:3000`                  | Existing Coder API root URL                            |
| `CODER_UI_LISTEN`  | `127.0.0.1:8080`                         | Interface and port for the UI HTTP server              |
| `CODER_UI_ORIGIN`  | `http://` followed by the listen address | Exact browser origin used to validate form submissions |

Use HTTP(S) root URLs without credentials or path prefixes. For remote use,
terminate HTTPS at a reverse proxy and set `CODER_UI_ORIGIN` to the public HTTPS
origin. The cookie is marked Secure for HTTPS. Use HTTPS for a remote backend.
Changing the browser hostname, scheme, or port requires changing the configured
origin. The default binds only to loopback. The UI server does not terminate TLS.

The UI supports:

- Password/token sign-in and sign-out against the Coder API.
- Workspace search and pagination, details, resources, and build logs.
- Start, stop, cancel, favorite, and typed-name deletion confirmation.
- Restart on the active template version through the backend's queued build API.
- Template browsing and workspace creation with rich parameter inputs.
- Profile name/username editing, secret listing/creation, and user listings.
- Responsive layouts, native keyboard-accessible forms, and escaped HTML.

Pages use full HTTP navigations and manual refresh. Failed submissions retain
non-secret fields. Passwords and existing session tokens are not reflected into
pages. The CLI access page displays a newly requested token once. Browser
JavaScript is limited to the bundled terminal renderer and its transport bridge;
no CDN assets or browser-local credential storage is used. The UI uses its own cookie, so the original application may require its
own sign-in when opened from a dashboard link.

The workspace list accepts `owner`, `user`, `name`, `template`, `organization`,
`status`, `outdated`, and comma-separated UUIDs in `id` filters. Unkeyed
`owner/name` searches and quoted values are supported. `owner:me` shows owned
workspaces; the default `user:me` also includes workspaces explicitly shared
through resource-level read grants. Group ACL sharing is not implemented.
Unknown filters return an error. Favorites sort first for their owner, followed
by owned workspaces, running workspaces, owner, and name.

Workspace links use `/@username/workspace`. Build history links use
`/@username/workspace/builds/number`; the UUID workspace routes continue to work.
The API also serves owner/name lookup, numbered builds, build-by-ID, parameters,
and resources under the corresponding `1.5.1` endpoint paths. These routes use
the same authorization checks as workspace reads. The Rust layout uses the
tag's navbar height, page width, table corners, dark color tokens, and bundled
`brix.gif` logo. It has not passed browser screenshot comparison, and the
remaining custom interactions and screens are not reproduced yet.

**UI migration status:** Rust now handles OIDC callbacks, browser PTYs, role
management, identity linking, access events, and CLI token issuance. AI chat,
advanced template editors, dynamic parameter interactions, general deployment
administration, branding, and other original UI routes remain unported. The
standalone UI can still target a Go deployment; integrated Rust mode hides
unimplemented destinations. This is not yet UI/API feature parity with the pinned `1.5.1` tag.

The library exposes these implemented modules:

| Rust module      | Go source                          | Behavior                                              |
|------------------|------------------------------------|-------------------------------------------------------|
| `apiversion`     | `apiversion/apiversion.go`         | Protocol parsing and backward compatibility           |
| `limited_writer` | `coderd/util/xio/limitwriter.go`   | Reject oversized writes before sending data           |
| `secrets`        | `codersdk/usersecretvalidation.go` | Field validation and create-request invariants        |
| `wsrelated`      | `codersdk/wsrelated/`              | Related-data selection, wildcards, canonical encoding |

Tests cover Go validation messages and boundary behavior. Malformed related-data
paths use Rust's native string escaping in diagnostic messages. Version components are
signed 64-bit integers, matching the existing 64-bit server. Secret lengths use
UTF-8 bytes. Database aggregate secret limits still require the PostgreSQL
trigger. `wsrelated::Config` uses validated path selections instead of Go's
nested pointer structs. Rust I/O follows `std::io::Write`: a call returns either
a successful byte count or an error, rather than Go's simultaneous count/error.

## Remaining migration

The full application still uses its existing implementation. Completion requires
porting and verifying all of these areas before switching the runtime:

- Remaining Go API/SDK contracts, OAuth-provider functionality, SAML/SCIM/group sync, and full deployment auditing.
- Provider compatibility, scheduling, import workflows, and event streams.
- Go-compatible agent/SSH protocols, persistent/reconnecting terminals, direct peer connections,
  workspace proxies, and distributed relay coordination.
- CLI commands, SDK transport, configuration, and credential storage.
- Remaining browser UI routes, live interactions, and deployment customizations.
- Tag-specific platform features, including images, AI chat, Cloud Drive, quotas,
  lockdown controls, custom airgap tools, and native monitoring utilities.
- Cross-platform packaging, installation, containers, Helm, upgrades, and release automation.
- Compatibility and end-to-end tests across supported operating systems.

Keep the existing SQL migrations, protocol schemas, assets, and fixtures as
compatibility inputs. Move runtime ownership only after the corresponding Rust
implementation passes its compatibility tests. Do not remove the existing runtime or claim full compatibility based on the
implemented flows alone.
