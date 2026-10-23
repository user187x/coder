# Images in this bundle

Every container image the solution runs, saved with `docker save` (linux/amd64, gzip), one folder per part of the
solution – the sections of `../images.txt`. `../mirror-images.sh push` loads them from here and pushes them to your
registry – no internet needed. Ours (`ghcr.io/user187x/...`) are on no public registry: **always keep them**; the
public ones can be left out where your registry has them already.

| Folder | What | Size | Pushed by default |
|---|---|---:|---|
| `ui/` | The user interface: Coder (the fork - the dashboard and its server) and the platform service (coder-ui-updates), what they run on, and their databases (2 of ours, 2 public) | 810 MB | yes |
| `workspaces/` | The workspace templates' images (ours) | 4.8 GB | yes |
| `cloud-drive/` | The Cloud Drive: its storage (MinIO) and its CSI driver (1 of ours, 2 public) | 182 MB | yes |
| `image-builder/` | Templates > Images: the build Jobs (BuildKit) and the registry built images are kept in (public) | 143 MB | yes |
| `cluster/` | What the chart adds to the cluster: metrics-server, where it has none (public) | 22 MB | yes |
| `prereqs/` | Only if you install these from prereqs/: the CloudNativePG operator, Traefik (public) | 92 MB | yes |
| `rollback/` | Plain upstream Coder: the decorator install's base without the layer, and rollback (ours) | 309 MB | yes |
| `reference/` | Argo CD + Keycloak as the reference cluster runs them - not pushed unless asked (public) | 1.0 GB | no – reference only: `push REGISTRY reference` |

The user interface is `ui/`: Coder itself (the fork – the dashboard and its server), the platform service
(coder-ui-updates: Controls › Settings, the Cloud Drive's API, chat, Health, ...), the image they run on, and the
database Coder and the platform service's logs keep their data in.

The release is also published in parts: `coder-airgapped-<version>-charts.tar.gz` (everything but the images) and one
`coder-airgapped-<version>-images-<folder>.tar.gz` per folder here. Unpacked into one directory they are the bundle.

## Make the bundle smaller

```bash
./mirror-images.sh list                       # section, archive bundled or absent, image
# every public archive left out (ours kept):
for img in $(./mirror-images.sh list | awk '$3 !~ /^ghcr[.]io[/]user187x[/]/ {print $3}'); do
  rm -f "$(./mirror-images.sh path "$img")"
done
rm -rf images/reference                       # or only a folder of public images
```

Then on the air-gapped side, either your registry already has the public images – at the paths
`./mirror-images.sh list $REGISTRY` shows – and you push only ours:

```bash
./mirror-images.sh push $REGISTRY ours
```

or put them back on an internet machine first: `./mirror-images.sh save` (pulls each by the exact digest in
`../images.txt` and rewrites the archives). `./mirror-images.sh verify` checks the archives against their
`SHA256SUMS`. Groups for `push` and `save`: a folder's section (`ui`, `workspaces`, ...), `ours`, `public` or `all`.

## What each file is

### `ui/`

| Archive | Image | Size | Used by |
|---|---|---:|---|
| `ghcr.io_user187x_coder-platform_2.0.0-platform.57-airgap.tar.gz` | `ghcr.io/user187x/coder-platform:2.0.0-platform.57-airgap` | 320 MB | coder (server); = the fork's platform.57 (fa2a23742) + Terraform provider mirror |
| `ghcr.io_user187x_coder-image-tools_1.0.0.tar.gz` | `ghcr.io/user187x/coder-image-tools:1.0.0` | 208 MB | coder-ui-updates and the Images builder's scans: the bundled Python + shellcheck, shfmt, trivy (+ vulnerability DB), regctl (development/image-tools) |
| `docker.io_library_python_3.13-alpine.tar.gz` | `docker.io/library/python:3.13-alpine` | 20 MB | coder-ui-updates, bootstrap Job, push-Job login (reference cluster: same tag via its Harbor) |
| `ghcr.io_cloudnative-pg_postgresql_18.4-system-trixie.tar.gz` | `ghcr.io/cloudnative-pg/postgresql:18.4-system-trixie` | 262 MB | database, uiUpdates.logsDb, uiUpdates.pgImage |

### `workspaces/`

| Archive | Image | Size | Used by |
|---|---|---:|---|
| `ghcr.io_user187x_coder-workspace_1.9.3.tar.gz` | `ghcr.io/user187x/coder-workspace:1.9.3` | 1.6 GB | workspace pods (default: DEFAULT): enterprise-base + desktop (no light-locker) with its Classic and Serenade themes, noVNC's clipboard shared with the computer, Chromium (default), Terminator, Firefox, JetBrains Mono Nerd Font in every terminal (code-server's too) and Noto Color Emoji, tmux, CLI tools, k9s/kubectl/kubelogin, Python venv, default ~/.bashrc and desktop background (development/workspace-image) |
| `ghcr.io_user187x_coder-workspace-dataflow_1.1.3.tar.gz` | `ghcr.io/user187x/coder-workspace-dataflow:1.1.3` | 3.2 GB | workspace pods (ubuntu-dataflow): the workspace image + Java 21, Apache NiFi 2.12.0 (NARs unpacked), Apache Airflow 3.3.2 (development/workspace-image-dataflow) |

### `cloud-drive/`

| Archive | Image | Size | Used by |
|---|---|---:|---|
| `ghcr.io_user187x_coder-minio_RELEASE.2026-09-22T19-25-18Z.tar.gz` | `ghcr.io/user187x/coder-minio:RELEASE.2026-09-22T19-25-18Z` | 64 MB | the Cloud Drive's storage (userStorage.minio): cgr.dev/chainguard/minio retagged with its MinIO release (development/tools/build-minio-image.sh) |
| `cr.yandex_crp9ftr22d26age3hulg_yandex-cloud_csi-s3_csi-s3-driver_0.43.7.tar.gz` | `cr.yandex/crp9ftr22d26age3hulg/yandex-cloud/csi-s3/csi-s3-driver:0.43.7` | 104 MB | the Cloud Drive's CSI driver (userStorage.csi; k8s-csi-s3 + GeeseFS, Apache-2.0) |
| `cr.yandex_crp9ftr22d26age3hulg_yandex-cloud_csi-s3_csi-node-driver-registrar_v2.16.0.tar.gz` | `cr.yandex/crp9ftr22d26age3hulg/yandex-cloud/csi-s3/csi-node-driver-registrar:v2.16.0` | 14 MB | the Cloud Drive's CSI driver: kubelet registration |

### `image-builder/`

| Archive | Image | Size | Used by |
|---|---|---:|---|
| `docker.io_moby_buildkit_v0.33.0-rootless.tar.gz` | `docker.io/moby/buildkit:v0.33.0-rootless` | 123 MB | Images view: the build Jobs (BuildKit rootless) |
| `ghcr.io_user187x_coder-registry_3.1.2-1.tar.gz` | `ghcr.io/user187x/coder-registry:3.1.2-1` | 22 MB | Images view: coder-image-registry, where built images are kept - Docker's registry 3.1.2 built from source with Go 1.26.9 and fixed modules, as a regular user (`development/registry-image`) |

### `cluster/`

| Archive | Image | Size | Used by |
|---|---|---:|---|
| `registry.k8s.io_metrics-server_metrics-server_v0.8.1.tar.gz` | `registry.k8s.io/metrics-server/metrics-server:v0.8.1` | 22 MB | metrics-server (live CPU / memory for the HUD, Health, quotas; metricsServer.enabled: auto) |

### `prereqs/`

| Archive | Image | Size | Used by |
|---|---|---:|---|
| `ghcr.io_cloudnative-pg_cloudnative-pg_1.30.0.tar.gz` | `ghcr.io/cloudnative-pg/cloudnative-pg:1.30.0` | 37 MB | CloudNativePG operator (prereqs/cloudnative-pg-0.29.0.tgz, install.sh --cnpg) |
| `docker.io_traefik_v3.7.12.tar.gz` | `docker.io/traefik:v3.7.12` | 55 MB | Traefik (prereqs/traefik-41.4.0.tgz) |

### `rollback/`

| Archive | Image | Size | Used by |
|---|---|---:|---|
| `ghcr.io_user187x_coder-upstream_2.38.0-main.70bc2e554-airgap.tar.gz` | `ghcr.io/user187x/coder-upstream:2.38.0-main.70bc2e554-airgap` | 309 MB | plain base (Argo CD decorator install without the layer) and rollback: pure upstream Coder at the fork's base (70bc2e554) + the same Terraform provider mirror (development/coder-fork/ROLLBACK.md) |

### `reference/`

| Archive | Image | Size | Used by |
|---|---|---:|---|
| `quay.io_argoproj_argocd_v3.5.2.tar.gz` | `quay.io/argoproj/argocd:v3.5.2` | 209 MB | Argo CD (server, repo-server, controller, applicationset) |
| `ghcr.io_dexidp_dex_v2.45.1.tar.gz` | `ghcr.io/dexidp/dex:v2.45.1` | 48 MB | Argo CD dex |
| `ecr-public.aws.com_docker_library_redis_8.6.4-alpine.tar.gz` | `ecr-public.aws.com/docker/library/redis:8.6.4-alpine` | 34 MB | Argo CD redis |
| `quay.io_keycloak_keycloak-operator_26.7.3.tar.gz` | `quay.io/keycloak/keycloak-operator:26.7.3` | 235 MB | Keycloak operator |
| `quay.io_keycloak_keycloak_26.7.3.tar.gz` | `quay.io/keycloak/keycloak:26.7.3` | 266 MB | Keycloak |
| `ghcr.io_cloudnative-pg_postgresql_17.tar.gz` | `ghcr.io/cloudnative-pg/postgresql:17` | 242 MB | Keycloak's database (CNPG Cluster keycloak-db) |

## Digests

`../images.txt` has the full digest of every image. That is the digest that was pulled (the upstream multi-arch
index) and the one `save` pulls again. The archive holds only its linux/amd64 image, so after `docker load` – and in
your registry after `push` – the image shows a different digest (that platform's manifest). Same image, same layers.

Each folder's `SHA256SUMS` covers its archives; `mirror-images.sh push` checks an archive before loading it.
