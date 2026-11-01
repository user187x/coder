# Coder Rust migration

This is a working Rust library for the first shared components of the Coder
migration. It is **not a replacement for the Coder application yet**. There is no
Rust server, CLI, agent, or browser UI in this package.

## Open in an IDE

Open this `rust/` directory in VS Code with rust-analyzer, or open `Cargo.toml`
in RustRover or another Rust IDE. Install Rust 1.85 or later using rustup.
No Node.js, Go, database, container, or third-party Rust dependency is needed
to build this package.

```sh
cargo build --locked
cargo test --locked
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
```

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
- Browser UI and its complete interaction and accessibility behavior.
- Enterprise features, custom airgap tools, and native monitoring utilities.
- Packaging, installation, containers, Helm, upgrades, and release automation.
- Compatibility and end-to-end tests across supported operating systems.

Keep the existing SQL migrations, protocol schemas, assets, and fixtures as
compatibility inputs. Move runtime ownership only after the corresponding Rust
implementation passes its compatibility tests. Do not deploy this library as
the application or remove the current implementation based on these unit tests.
