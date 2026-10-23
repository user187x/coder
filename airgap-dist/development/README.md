# Development

Everything needed to keep developing the coder-airgapped deliverable, other than the deliverable itself
(`../helm-chart/`) and the Coder fork (a separate repository, see `coder-fork/FORK.md`).

**`../helm-chart/` is the source of truth.** Edit the chart and its files there; nothing is copied in from elsewhere.

## Where to change what

| To change | Edit |
|---|---|
| Coder server settings, defaults, wiring | `../helm-chart/coder-airgapped/values.yaml` (`global:` first), `templates/` |
| Platform service (the dashboard's add-ons are built into the fork) | `../helm-chart/coder-airgapped/files/ui-updates/` |
| Default logo (animated GIF) and default user avatar | `../helm-chart/defaults/` (installed as ConfigMaps by `install.sh`) |
| First user / template-push bootstrap | `../helm-chart/coder-airgapped/files/bootstrap/bootstrap.py`, `templates/bootstrap-job.yaml` |
| Workspace image (desktop, fonts, tmux, preinstalled tools) | `workspace-image/` (then `tools/build-workspace-image.sh`) |
| Workspace template `default` (shown as DEFAULT) | `../helm-chart/coder-airgapped/charts/coder-workspace/files/*.tf`, its scripts in `files/scripts/` (format: `shfmt -i 1 -w files/scripts/*.sh`) |
| Announcement banner | the fork: `coderd/platformbanner` (server), `site/src/modules/platform/announcement/` (dashboard) |
| The Coder server itself (UI, API) | the fork, `~/workspace/coder` – see `coder-fork/FORK.md` |
| Images that are shipped | `../helm-chart/images.txt` (+ `mirror-images.sh save`, or `tools/build-airgap-image.sh` / `tools/build-minio-image.sh` for the custom ones) |

After a change: bump `version` in `../helm-chart/coder-airgapped/Chart.yaml`, add a `../CHANGELOG.md` entry, build with
`tools/build-bundle.sh`, test with `tools/airgap-e2e/`, commit, and tag `v<version>`.

## Development cluster

minikube profile `coder` is the development cluster. Deploy (or redeploy) the working tree onto it with
`cd ../helm-chart && ./make --deploy` (Minikube, your domain, new or existing certificates). After a reboot:
`../helm-chart/minikube-support expose coder <domain>`.

## What is here

| Path | What |
|---|---|
| `coder-fork/FORK.md` | Which fork commit the Coder image is built from, and how to build a new one |
| `workspace-image/` | Dockerfile of the workspace image `ghcr.io/user187x/coder-workspace` (enterprise-base + desktop without light-locker, JetBrains Mono Nerd Font, tmux from `packages/tmux-installation.deb`, k9s/kubectl, Python venv); build with `tools/build-workspace-image.sh` |
| `airgap-image/` | Dockerfile + `terraformrc` of the `-airgap` Coder image (the fork's image + a Terraform provider mirror); `template/` is filled by the build |
| `tools/build-bundle.sh` | Lint + render the chart, package our charts into `charts/`, fetch missing public image archives, write `../dist/coder-airgapped-<version>[-slim].tar.gz`, the release in parts (`-charts`, `-images-<part>`, `-ASSETS.txt`) and `-layer` |
| `tools/build-workspace-image.sh` | Build the workspace image (FileBrowser Quantum from the `filebrowser-quantum` release binary at the repository's root, pinned by SHA-256), check it, and save it into the bundle (`mirror-images.sh store`: `../helm-chart/images/workspaces/`) |
| `tools/build-airgap-image.sh` | Build the `-airgap` image and save it into the bundle (`mirror-images.sh store`: `../helm-chart/images/ui/`, the rollback image `images/rollback/`) |
| `tools/build-minio-image.sh` | The Cloud Drive's MinIO image `ghcr.io/user187x/coder-minio:<MinIO release>` (Chainguard's build, pinned by digest, retagged) into `../helm-chart/images/custom/` |
| `tools/airgap-e2e/` | Fresh end-to-end test of DEPLOY.md on a kind cluster with egress blocked (`README.md` there) |
| `tools/apply-platform-patch.py` | Applies the "platform patch" (templated values, `global.imagePullSecrets`, quoted checksums) to a vendored subchart |
| `tools/render-diff.py` | Compare two `helm template` outputs object by object |
| `tools/export_live.py`, `tools/compare.py` | Export a cluster's objects; diff a render against them |
| `tools/extract_release_chart.py` | Recover a chart from a Helm release Secret |
| `upstream-charts/` | Untouched upstream charts: `coder-2.37.3` (vendored as `charts/coder`), `coder-banner-0.4.1` (what minikube ran; since 1.43.0 the banner is Coder's own) |
| `reference/` | Frozen capture (2026-10-09) of the original deployment on minikube profile `minikube`: every object, cleaned (`manifests/`), and the Helm/Argo CD values (`helm-values/`). Read-only, except that the banner service's objects and Traefik's rewrite-body plugin were taken out on 2026-10-20 (no Traefik response-body rewriting anywhere, in any mode) |

Not in this repository: secrets, the database dump, the fork's git bundle and the original image are in
`~/coder-airgapped-private/` (backup only; the deployment starts from a clean database). Built tarballs go to
`../dist/` and image archives to `../helm-chart/images/`; both are git-ignored.

## Upgrading a vendored subchart

Unpack the new upstream chart over `../helm-chart/coder-airgapped/charts/<name>/`, then
`tools/apply-platform-patch.py <dir> coder coder.image.pullSecrets --extra-env --coder-ha`, and update the dependency version in the umbrella `Chart.yaml`. Compare
with `tools/render-diff.py` against a render from before the upgrade.

## Facts worth knowing

* `CODER_DISABLE_PASSWORD_AUTH=true` blocks **every** password login, owners included (`coderd/userauth.go`).
  OIDC sign-ins link to an existing user with login type `oidc` by email.
* Coder checks password strength only when a password is set through the API, not at login.
* `CODER_BOOTSTRAP_INITIAL_USER_PASSWORD` is not read by Coder.
* Helm release records are limited to 1 MiB: the default logo and avatar stay outside the chart.
* Argo CD renders without cluster access (`lookup` returns nothing), and needs server-side apply (the add-on
  ConfigMap is ~800 KB) and server-side diff (HTTPRoute defaults).
