# Keeping the fork current with upstream Coder

How the fork (`user187x/coder`) takes each new upstream Coder (Community Edition), and how a new base is shown to
break nothing the fork adds.

## Where things stand (2026-10-13)

| | |
|---|---|
| Base | upstream `main` at `70bc2e554` (2026-10-03, between v2.38.0 and v2.39.0), migration 000611 |
| Fork | 72 commits on top: 240 files added, 270 upstream source files modified (most in the dashboard), 65 deleted (telemetry, the update check, GitHub/GitLab login, the trial) |
| Database | no migration of its own: the schema is always upstream's |
| Upstream since | 189 commits to 2026-10-12, migrations 000612–000618 |
| Trial merge of upstream `main` (2026-10-12) | 14 files conflict: `cli/server_test.go`, `scripts/typegen/main.go`, `tailnet/controllers_test.go`, and 11 dashboard files (Avatar, EmojiPicker, the Paywall and Premium pages the fork removes links from, AI settings sidebar, Health layout, Appearance settings, connection log filter, a chat alert) |

`git merge-tree --write-tree --name-only upstream/main HEAD` shows these conflicts without touching any branch: run
it before every update to size the work.

## The process, for every upstream release

1. **Follow upstream releases, not `main`.** Take each release tag (`v2.39.0`, `v2.40.0`, …). A release is what
   upstream supports, and its published image is a rollback target the moment the fork moves onto it.
2. **Branch and merge:**

   ```bash
   cd ~/workspace/coder
   git remote add upstream https://github.com/coder/coder.git 2>/dev/null; git fetch upstream --tags
   git merge-tree --write-tree --name-only v2.39.0 main     # the conflicts, before you start
   git switch -c upstream/v2.39.0 main
   git merge v2.39.0                                        # resolve; keep upstream's change and re-apply the fork's
   make gen                                                 # generated code (API types, mocks, docs) from both
   ```

   Merge rather than rebase: the fork's history stays as it is (its commits are referenced by released bundles),
   and each update is one reviewable merge commit.
3. **Resolve conflicts with these rules:**
   * **Removals stay removed:** telemetry, the update check, GitHub/GitLab default login, trial and premium funnel,
     STUN defaults. When upstream changes a removed file, keep it deleted and remove new call sites. Then check the
     egress test (`ui.mjs`: no request leaves the domain) and `chart_checks.py` (telemetry off).
   * **The fork's hooks are small and marked:** every change to an upstream file carries a `Platform:` comment
     (`grep -rn "Platform:" --include=*.go --include=*.tsx`). Re-apply the hook to upstream's new code rather than
     keeping the old file.
   * **The fork's own code lives in its own files:** `site/src/modules/platform/`, `coderd/platform*.go`,
     `cli/platform_*.go`, `coderd/gitsshkey/`. These rarely conflict; their tests say whether upstream's API still
     fits.
4. **Verify (all must pass, with no check failing that passed on the previous release):**

   ```bash
   cd ~/Desktop/coder-airgapped-eks/development/tools/verify
   ./run.sh static unit --go full          # upstream's whole Go suite + vitest + the fork's tests
   ```

   Then build (`scripts/build_platform_image.sh`, `build-airgap-image.sh`), make a bundle, and run the air-gapped
   end-to-end test on it (`../airgap-e2e/`: `e2e.sh`, `step8.sh`, `step9.sh`). Finish with the live suites on that
   cluster:

   ```bash
   ./run.sh live ui rollback load --url https://coder.airgap.test --ca ../airgap-e2e/pki/ca.crt ...
   ```

   Compare `out/<date>/report.md` with the previous release's: any check that passed before and fails now is a
   regression to fix before release.
5. **Release:**
   - Version the fork `<upstream version>-platform.<n>` (e.g. `2.39.0-platform.1`), so agent versions compare
     sensibly with upstream's.
   - Update `FORK.md`, the chart's image tags, `images.txt` and the CHANGELOG.
   - The rollback target becomes the upstream release itself (`ghcr.io/coder/coder:v2.39.0`, mirrored into the
     bundle with the provider mirror: `build-airgap-image.sh --upstream`).

## What can break the fork, and what catches it

| Upstream change | Effect on the fork | Caught by |
|---|---|---|
| New migrations | none (the fork has none) | `rollback.sh` (upstream and fork on one database) |
| Coder API used by the platform service changes (`/api/v2/users/me`, `users`, `workspaces`, `workspaces/{id}/builds`, `workspacebuilds/{id}/parameters`, `templates/{id}`, `templateversions/{id}/rich-parameters`, `users/me/keys/tokens`, `buildinfo`, `authcheck`, `authmethods`, `users/first`, `users/login`) | platform features fail (HUD, quota, scheduler, notes, volumes, bootstrap) | `live.py` (fork suite), e2e step 8 |
| Dashboard components the fork changed are refactored upstream (AgentRow, AgentMetadata, TemplateLayout, Navbar, Health) | merge conflicts; views break | vitest, `ui.mjs` |
| Agent metadata or app health semantics change | metrics, readiness gating | `live.py` (apps healthy, lifecycle), `ui.mjs` |
| OIDC startup code changes (`cli/server.go`) | Coder without Keycloak at startup | `go test ./cli -run 'OIDC'`, `chart_checks.py` |
| Upstream adds a new outbound call (telemetry, docs, images from a CDN) | breaks the air gap | `ui.mjs` egress, e2e (egress blocked) |
| Terraform providers in the template need new versions | `terraform init` offline | e2e step 8 (template push and workspace build) |

## Making updates cheaper over time

* **Split the early catch-all commits.** "Initial commit for updates", "Updated Coder", "Save-off point…" hold
  hundreds of unrelated changes. Re-cut them into topic commits on a branch: telemetry removal, auth removals,
  platform hooks, dashboard modules. A conflict then points at one concern.
* **Fewer edits to upstream files.** Where the fork rewrote an upstream view (e.g. the workspace page's agent row),
  prefer a wrapper or slot in the fork's own module, so upstream's file merges cleanly.
* **Don't delete upstream's tests**, except for removed features: they are the check that upstream's features still
  work in the fork.
