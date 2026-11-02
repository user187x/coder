# Verification suite

Checks that Coder's own capabilities still work in the fork, that everything the fork adds works, and that the
deliverable installs and runs in an air gap. `run.sh` runs the suites and writes `out/<date>/report.md`.

| Suite | What | Needs |
|---|---|---|
| `static` (`chart_checks.py`) | the chart renders for Minikube, EKS, a private registry, Keycloak-only and admins' kubectl; every image pinned by digest and archived; no floating tags; Keycloak's Secrets optional; nothing at workspace start needs the internet; the platform service's unit tests | helm |
| `unit` | `go test` of every package the fork changed (`--go full`: upstream's whole Go suite), the dashboard's vitest suite (upstream's tests and the fork's), `platform_unit_test.py` | the fork's clone, Go, Node 22–24, Docker (Postgres for the database tests) |
| `live` (`live.py`) | on a deployment, with a throwaway user and workspace (deleted afterwards). **Upstream:** sign-in, users, suspension, tokens, organizations, templates and a new version (offline `terraform init`), the workspace lifecycle, agent, apps through Coder's proxy, the web terminal (a command over the reconnecting PTY), listening ports, build logs, audit, insights, health, provisioners, notifications. **Fork:** notes, volume backups and their download, icons, and every platform service view with its access rules | `--url`, `--ca` |
| `ui` (`ui.mjs`) | in Chromium: every dashboard page loads; no request leaves the domain; no page throws; the sign-in page, the template Overview, the workspace page (metrics, chips, apps squircle, border); `--soak-minutes N`: the workspace page and the HUD left open, with the JS heap and the DOM required to level off | `--url`, `--domain`, `--workspace`, Playwright |
| `rollback` (`rollback.sh`) | the deployment's database copied; the rollback image (pure upstream Coder) and the fork run on the copy and see the same; the schema unchanged | kubectl, docker, the bundle's images |
| `lockdown` (`lockdown_live.py`) | Lock Down on a throwaway workspace, running and stopped: Network, Sudo Command and Complete set live in 1–2 s; the agent stays connected and an admin's web terminal opens; the network is cut (a service inside the cluster too) while Coder stays reachable; sudo refused; a process started before keeps running; neither the workspace's user nor root in it can undo it; at start, before anyone signs in; lifted, everything is back; Network and Sudo back after a restart; Freeze: every process paused (the agent too), network and sudo cut, the snapshot ready and holding the disk as it was, frozen again after a restart, lifted: everything resumes and the agent reconnects, the snapshot kept, then deleted | `--url`, kubectl |
| `load` (`load.py`) | many developers' and admins' dashboards polling at once (`--load "--developers 200 --admins 10 --speed 10 --minutes 10"`), with latency percentiles and error rate | `--url` |

The air-gapped end-to-end test is separate, in `../airgap-e2e/`: `setup.sh` once, then `e2e.sh <bundle>`,
`step8.sh` (DEPLOY.md step 8) and `step9.sh` (the image builder offline).

```bash
./run.sh static unit                                            # before every commit to the fork or the chart
./run.sh live ui rollback load --url https://coder.example.com --domain example.com \
    --context my-cluster --workspace /@admin/my-ws --soak-minutes 10 --load "--developers 100 --admins 5 --speed 10"
```
