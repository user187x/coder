# Coder Rust migration

The Cargo workspace contains the shared `coder-core` library, the `coder-ui`
dashboard, a runnable `coder-server` control plane, and a `coder-provisioner`
Terraform worker. The server runs the Rust
UI and API together and stores state in PostgreSQL. The implemented flows no
longer require the Go server. This remains an initial migration, with the
limitations listed below.

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

The core implements:

- Transactional first-user setup and default organization membership.
- Argon2 password hashing, bounded authentication work, sign-in throttling,
  hashed expiring session tokens, and server-side logout.
- User/profile APIs, administrator-only user creation/listing, and organization checks.
- Organization-scoped template definitions and typed rich parameters.
- Owner-scoped workspaces, search, favorites, build history, logs, and lifecycle jobs.
- Encrypted secret storage and delivery only to an authorized workspace job worker.
- Durable provisioner claims, renewable leases, cancellation, completion fencing,
  expiry failure, and queued stop/start orchestration.

## Run infrastructure provisioning

Install Terraform 1.4 or later on a Unix worker host. Terraform 1.13.5 is tested.
The Rust worker invokes the Terraform CLI; provider plugins remain Terraform
plugins. Set `CODER_ENCRYPTION_KEY` on the server before creating infrastructure.

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

A Terraform spec accepts `driver`, `files`, and optional `variables`. Files must
be flat `.tf`/`.tf.json` files, plus an optional `.terraform.lock.hcl`, with at
most 32 files and 64 KiB total source. Use the local Terraform backend; external
backends and Terraform Cloud are unsupported. Rich parameters become typed
Terraform variables. Declare `variable "coder_start_count" { type = number }`
and use it for resource counts: start passes 1, stop passes 0, and delete uses a
destroy plan. Templates define stop behavior; the worker cannot infer how an
arbitrary provider should shut a resource down. Names beginning with `coder_`
are reserved. Optional `coder_workspace_id` and `coder_organization_id` variables
are available, and `coder_environment` receives the owner's enabled secrets as
a sensitive map. Cloud credentials belong to the worker environment.

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

Cloud and Docker resource providers have not been exercised. SSH, workspace
agents, and WireGuard networking are not implemented. Workspaces remain pending
until a suitable worker executes their jobs. The JSON worker protocol is not the existing Go DRPC protocol.
Full RBAC, audit, OAuth/SSO, scheduling, quotas, enterprise features, and in-place
Go data migration remain unported. This is not a production-compatible Coder
replacement.

## Database integration tests

```sh
cargo test --workspace --locked
cargo test -p coder-server --test control_plane --locked -- --ignored
CODER_TEST_TERRAFORM_BINARY=/absolute/path/to/terraform cargo test -p coder-server --test infrastructure --locked -- --ignored
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
creates no cloud infrastructure. Local verification
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
non-secret fields. Passwords, session tokens, and secret values are not reflected
into pages. No client JavaScript, CDN assets, or browser-local credential storage
is used. The UI uses its own cookie, so the original application may require its
own sign-in when opened from a dashboard link.

**UI migration status:** terminal emulation, live streams, direct SSO callbacks,
AI chat, advanced template editors and dynamic parameter interactions,
organization/deployment administration, branding/classification customizations,
and the remaining settings pages still use the original UI. When the separate UI targets a Go deployment, full-application links open
that deployment. Integrated Rust mode hides those unimplemented destinations. This dashboard is an
initial Rust UI implementation, not feature parity or a drop-in replacement.
Validation uses mock API contracts; deployment integration still needs testing
against your running Coder instance.

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

- Remaining API models/routes, OAuth, fine-grained RBAC, and audit.
- Provider compatibility, scheduling, import workflows, and event streams.
- Workspace agents, SSH, PTYs, tunnels, WireGuard, and workspace proxies.
- CLI commands, SDK transport, configuration, and credential storage.
- Remaining browser UI routes, live interactions, and deployment customizations.
- Enterprise features, custom airgap tools, and native monitoring utilities.
- Packaging, installation, containers, Helm, upgrades, and release automation.
- Compatibility and end-to-end tests across supported operating systems.

Keep the existing SQL migrations, protocol schemas, assets, and fixtures as
compatibility inputs. Move runtime ownership only after the corresponding Rust
implementation passes its compatibility tests. Do not deploy this library as
the application or remove the current implementation based on these unit tests.
