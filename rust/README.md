# Coder Rust migration

The Cargo workspace contains the shared `coder-core` library, the `coder-ui`
dashboard, and a runnable `coder-server` control plane. The server runs the Rust
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

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Required | PostgreSQL connection string |
| `CODER_SERVER_LISTEN` | `127.0.0.1:3000` | HTTP listening address |
| `CODER_SERVER_ORIGIN` | HTTP listen address | Exact public browser origin for form validation |
| `CODER_ENCRYPTION_KEY` | Unset | 64 random hexadecimal characters for secret encryption |

Use an existing PostgreSQL server or a local development instance. Tables and the
SQLx migration history live in an isolated `coder_rust` schema. Existing Go
Coder users, sessions, templates, and workspaces are **not imported or modified**.
Keep the encryption key stable and backed up; without it secret writes are
unavailable, and stored secrets cannot be decrypted after a key change. Secret
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
   job also includes its owner's enabled secret environment. Do not log secrets.
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

**There is no Terraform, Docker, cloud, SSH, or WireGuard worker bundled yet.**
The queue is functional, but workspaces remain pending until a worker actually
executes them. The JSON worker protocol is not the existing Go DRPC protocol.
Full RBAC, audit, OAuth/SSO, scheduling, quotas, enterprise features, and in-place
Go data migration remain unported. This is not a production-compatible Coder
replacement.

## Database integration tests

```sh
cargo test --workspace --locked
cargo test -p coder-server --test control_plane --locked -- --ignored
```

The second command requires `CODER_TEST_DATABASE_URL` pointing to an **empty,
dedicated test database**. It creates test data and does not reset existing data.
CI supplies PostgreSQL 16 and runs the test on Rust 1.85 and stable. The test
exercises setup, authentication, organization isolation, secret encryption and
worker delivery, job fencing, restart/cancellation, lease expiry, deletion,
HTTP-service restart persistence, and real Rust UI sign-in. Local verification
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

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODER_UI_BACKEND` | `http://127.0.0.1:3000` | Existing Coder API root URL |
| `CODER_UI_LISTEN` | `127.0.0.1:8080` | Interface and port for the UI HTTP server |
| `CODER_UI_ORIGIN` | `http://` followed by the listen address | Exact browser origin used to validate form submissions |

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

| Rust module | Go source | Behavior |
| --- | --- | --- |
| `apiversion` | `apiversion/apiversion.go` | Protocol parsing and backward compatibility |
| `limited_writer` | `coderd/util/xio/limitwriter.go` | Reject oversized writes before sending data |
| `secrets` | `codersdk/usersecretvalidation.go` | Field validation and create-request invariants |
| `wsrelated` | `codersdk/wsrelated/` | Related-data selection, wildcards, canonical encoding |

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
- Provisioning, scheduling, Terraform integration, jobs, and event streams.
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
