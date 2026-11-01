# Coder Rust migration

The Cargo workspace contains a dependency-free shared library (`coder-core`) and
an executable Rust-rendered dashboard (`coder-ui`). The UI uses Coder's existing
HTTP API and database. It does not replace the backend, agent, or complete React
application yet.

## Open in an IDE

Open this `rust/` directory in VS Code with rust-analyzer, or open `Cargo.toml`
in RustRover or another Rust IDE. Install Rust 1.85 or later using rustup.
No Node.js, npm, WebAssembly toolchain, or container is needed to build the UI.
The shared library has no third-party dependencies; the UI uses Axum, Maud,
Reqwest, Serde, and Tokio. Open `ui/src/main.rs` to run or debug the application.

```sh
cargo build --workspace --locked
cargo test --workspace --locked
cargo fmt --all --check
cargo clippy --workspace --locked --all-targets -- -D warnings
```

## Run the UI

With an existing Coder deployment running at `http://127.0.0.1:3000`:

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
and the remaining settings pages still use the original UI. The full-application
links deliberately open the existing Coder deployment. This dashboard is an
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

- API models, HTTP routing, sessions, OAuth, RBAC, audit, and PostgreSQL access.
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
