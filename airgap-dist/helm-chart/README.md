# coder-airgapped 1.46.0: portable Helm chart of the live Coder fork

This bundle contains one Helm chart, `coder-airgapped/`. It reproduces the forked Coder platform as it ran on the
reference minikube cluster (namespace `coder`) on **2026-10-09**. All of its dependencies are vendored, so it
installs with no network access.

**Just want to deploy it? Follow [`DEPLOY.md`](DEPLOY.md).** This file has the details.
 One `global:` block (domain, hostnames, registry, OIDC, Secret names, first user,
Gateway) configures everything, from a values file or from an Argo CD Application.

| Part | Live source it was captured from | In the chart |
|---|---|---|
| Coder server, `ghcr.io/user187x/coder-platform:2.0.0-platform.4` (Coder 2.37.3 + fork, built from `d01b8f6`) | Argo CD app `argocd/coder` (chart `coder` 2.37.3) | `charts/coder/` (upstream 2.37.3 + platform patch) + `values.yaml › coder` |
| PostgreSQL `coder-db` (CloudNativePG, 2 instances) | extraTemplate of `argocd/coder` | `templates/database.yaml` |
| Announcement banner | Argo CD app `argocd/coder-banner` (chart 0.4.1) | Coder itself since 1.43.0 (the fork's `coderd/platformbanner`, at `/__banner/`; starts blank) – no service, no Traefik body rewrite |
| Platform service `coder-ui-updates` + `coder-ui-logs-db` + RBAC | `coder-ui-updates apply` (plain manifests) | `templates/ui-updates*.yaml`, `files/ui-updates/` (48 files, identical to the live ConfigMap) |
| Workspace template `default` (DEFAULT) + `/__icons/` server | Helm release `coder/coder-workspace` rev 13 | `charts/coder-workspace/` (0.1.1-platform.1, see *Changes*) |
| First owner | created by hand on the reference cluster | `templates/bootstrap-job.yaml` (new) |

## Layout

```
coder-airgapped/                 the chart (helm install target)
argocd/coder-airgapped-application.yaml   Argo CD Application (+ OCI repository Secret) installing the chart from the registry
argocd/coder-decorated-application.yaml   Argo CD decorator install: the Coder installation (coder-airgapped-base) and the
                                 customization layer (coder-airgapped-layer) in one Application; coder-plain-application.yaml
                                 is the same without the layer (application.py --plain derives it)
argocd-support                   the steps of `./make --argocd <harbor>[/<project>] [--plain]`: Harbor push, prerequisites,
                                 Secrets, Argo CD's repository and the Application (DEPLOY.md › Argo CD)
layer-support                    the layer bundle (update a cluster from the previous release): build, check, restore
values-eks-airgap.example.yaml   the same settings as a values file for plain Helm / install.sh
values-ha.example.yaml           high availability on top of it: Coder on 3 replicas across zones, its database on 3
                                 instances (DEPLOY.md › High availability)
make                             `./make --deploy`: the guided install (Minikube or EKS; domain, certificates, ...);
                                 `./make --push-images <harbor>[/<project>]`: images + charts into your Harbor
harbor-support                   the steps of --push-images: Harbor's CA, docker + helm logins (Harbor, Docker Hub),
                                 the project, push, check
minikube-support                 Minikube steps: profile, local-path storage, images, CoreDNS, dev Keycloak,
                                 minikube-expose-services (tunnel) + minikube-sync-hosts (/etc/hosts), trust-ca
x509-support                     self-signed PKI (CA, wildcard server cert, CA bundle, client certs) + certificate checks
install.sh                       Secrets from files, default logo/avatar ConfigMaps, helm upgrade --install
                                 (--prepare-only: just the Secrets and ConfigMaps, for Argo CD)
mirror-images.sh                 push / save / verify / list the images in images.txt; `chart REPO` pushes the chart to OCI,
                                 `charts REPO` with the prerequisites' charts
charts/                          every chart of ours, packaged: coder-airgapped-<version>.tgz, and the decorator install's
                                 coder-airgapped-base-<version>.tgz and coder-airgapped-layer-<version>.tgz; index.yaml
                                 (a Helm repository: serve the folder, or `mirror-images.sh charts` pushes them), SHA256SUMS
images.txt                       every image by section (its folder below), with the digest saved and tested
images/                          every image as a docker-save archive, linux/amd64, one folder per part (images/README.md):
  ui/                              the user interface: Coder (the fork), the platform service, the image they run
                                   on, their database
  workspaces/                      the workspace templates' images
  cloud-drive/ image-builder/      the Cloud Drive (MinIO, CSI driver); Templates > Images (BuildKit, registry)
  cluster/ prereqs/                metrics-server; CloudNativePG operator and Traefik (for prereqs/)
  rollback/                        plain upstream Coder (the decorator install's base, rollback)
  reference/                       Argo CD + Keycloak as the reference cluster runs them (not pushed unless asked)
                                 Ours (ghcr.io/user187x/...) are on no public registry: always keep them; public archives
                                 can go for a smaller bundle (the -slim tarball has none)
defaults/                        default logo + avatar (kept out of the chart: Helm's 1 MiB release record)
prereqs/                         cloudnative-pg-0.29.0.tgz, traefik-41.4.0.tgz, Traefik values used on the reference cluster
```

## Prerequisites (on the target cluster)

* Kubernetes 1.27+. The workspace PVCs use the default StorageClass.
* **CloudNativePG operator.** The reference cluster runs chart 0.29.0 / operator 1.30.0: `./install.sh --cnpg`, or
  `helm install cnpg prereqs/cloudnative-pg-0.29.0.tgz -n cnpg-system --create-namespace`.
* **Traefik v3 with the Gateway API provider** and a Gateway `traefik/traefik-gateway` that has an HTTPS listener for
  `coder.<domain>` and `*.<domain>`. The reference cluster's Traefik values are in
  `prereqs/traefik-41.4.0.reference-values.yaml`.
* **OIDC (Keycloak)** with a confidential client `coder` and redirect URI
  `https://coder.<domain>/api/v2/users/oidc/callback`.
* **DNS** for `coder.<domain>` and `*.<domain>` that resolves both inside and outside the cluster.

## Configuration: `global`

Every component reads `global` (Helm passes it to all subcharts), and any string value in the chart may reference
it, e.g. `'coder.{{ .Values.global.domain }}'`. The defaults reproduce the reference cluster.

| Value | Default | Used for |
|---|---|---|
| `global.domain` | `grey-marshall.com` | everything below that is left empty |
| `global.coderHost` / `global.wildcardHost` | `coder.<domain>` / `*.<domain>` | Coder's access and wildcard URLs, all HTTPRoutes, banner, add-ons, template push |
| `global.registry` | `""` (each image's own registry) | every image as `<registry>/<path>`, the layout `mirror-images.sh push` creates |
| `global.imagePullSecrets` | `[]` | every pod that sets none of its own |
| `global.gateway.{name,namespace}` | `traefik-gateway` / `traefik` | parentRef of every HTTPRoute |
| `global.oidc.*` | issuer `https://keycloak.<domain>/realms/master`, client `coder`, ... | Coder's OIDC settings |
| `global.disablePasswordAuth` | `"false"` | `"false"`: the admin signs in with its password, everyone else with Keycloak. `"true"`: Keycloak only |
| `global.firstUser.{username,email,password}` | `admin` / `admin@admin.com` / `admin` | first owner, created on a fresh database (password set once, never reset). With `disablePasswordAuth: "true"`: the Keycloak account with this email |
| `global.database.name` | `coder-db` | CNPG Cluster; Secrets `<name>-app`, `<name>-ca` |
| `global.secretNames.*` | `coder-init-auth`, `coder-ui-logs-db`, `tls-ca`, `keycloaking-coder-ca`, `keycloaking-coder-oidc`, `tls-wild-cert` | every reference to those Secrets, including the workspace template's `tls-ca` |
| `global.coderImages.{fork,upstream}.{repo,tag}` | the fork's `coder-platform:2.0.0-platform.N-airgap` / `coder-upstream:2.38.0-main.70bc2e554-airgap` | Coder's server image: the fork's here and on a decorated base; upstream Coder on a base without the layer |
| `global.decorator.part` | `all` (set by packaging: `base`, `layer`) | which part of the platform a chart installs (DEPLOY.md › Argo CD) |
| `global.decorator.layer` | `true` (`false` in coder-airgapped-base) | the base only: the customization layer is installed alongside, so Coder runs the fork's image with the platform's settings |

Extra Coder environment goes in `coder.coder.extraEnv` (appended), so you never have to repeat the chart's `env` list.

## Argo CD

Two ways: this chart as one Application (below), or Coder and the customization layer as two charts in one
Application, the layer decorating a plain Coder that it can be taken off again (`argocd/coder-decorated-application.yaml`,
`./make --argocd`: DEPLOY.md › Argo CD). The settings below apply to both.

1. Images: `./mirror-images.sh push <REGISTRY>` (from `images/`; `push <REGISTRY> ours` when the public ones are already there)
2. Chart: `helm registry login <REGISTRY>`, then `./mirror-images.sh chart <REGISTRY>/charts` (charts/'s package;
   `ECR=1` creates the ECR repository, `PLAIN_HTTP=1` for a registry without TLS).
3. The Secrets and ConfigMaps the chart does not create:
   `./install.sh --prepare-only --ca ca.crt --oidc-ca keycloak-ca.crt --oidc-secret-file oidc-client-secret.txt
   --tls-crt wildcard.crt --tls-key wildcard.key`. Add `--secret-name tlsCa=<name>` etc. when you rename them in
   `global.secretNames`.
4. Edit the `CHANGE-ME`s in `argocd/coder-airgapped-application.yaml`, then `kubectl apply -f` it.

The Application must keep three settings:

* `ServerSideApply=true`: the `coder-ui-updates` ConfigMap (about 800 KB) exceeds client-side apply's 256 KB
  annotation.
* The annotation `argocd.argoproj.io/compare-options: ServerSideDiff=true`: without it, three HTTPRoutes stay
  OutOfSync over fields the Gateway controller fills in, and self-heal keeps re-syncing.
* `ignoreDifferences` on Secrets' `/data/password` with `RespectIgnoreDifferences=true`: Argo CD renders without
  cluster access, so the generated passwords would otherwise change on every refresh.

The database, the add-on PVC and the generated Secrets carry `argocd.argoproj.io/sync-options: Prune=false,Delete=false`,
so deleting the Application never deletes data. The Keycloak view reads the Application but does not edit
`helm.valuesObject`; change Coder's settings in the Application.

## Install with Helm

Connected side (only for the `-slim` bundle; the full one already has every image in `images/`):

```bash
./mirror-images.sh save               # pulls the public images by digest into their folders of images/
```

Air-gapped side:

```bash
./mirror-images.sh push 123456789012.dkr.ecr.us-east-1.amazonaws.com             # ECR=1 to create repositories
cp values-eks-airgap.example.yaml my-values.yaml                                     # replace every CHANGE-ME
./install.sh -f my-values.yaml --cnpg \
  --ca ca.crt --oidc-ca keycloak-ca.crt --oidc-secret-file oidc-client-secret.txt \
  --tls-crt wildcard.crt --tls-key wildcard.key
./install.sh -f my-values.yaml --dry-run    # render + server-side validation only, changes nothing
```

Plain Helm works too: `helm upgrade --install coder ./coder-airgapped -n coder -f my-values.yaml` after
`./install.sh --prepare-only ...` (or create the four `global.secretNames` Secrets yourself, or set `secrets.*.create`).

Use namespace `coder` and release `coder`: the workspace template refuses other namespaces.

What happens: Coder, its database, the banner and the platform service start. Then the
`coder-bootstrap-first-user` hook creates Coder's first user (owner) from Secret `coder-init-auth` if Coder has
none, with the password `global.firstUser.password` (`admin`). With password sign-in off it instead links that owner
to Keycloak by email. Every run it mints a 30-minute API token into Secret `coder-workspace-push-token`. Finally
`coder-workspace-push-template` pushes `default` (DEFAULT) with that token. The admin signs in with its password
(change it after the first sign-in); everyone else signs in with Keycloak.

## Changes from the live deployment (deliberate)

* **Bootstrap Job (new).** Coder does not read `CODER_BOOTSTRAP_INITIAL_USER_PASSWORD` (the env var is still set,
  as live, but has no effect), so a fresh install had no first user. The Job creates it (`admin` /
  `admin@admin.com`) and sets its password to `global.firstUser.password`; Coder's API rejects weak passwords, so it
  creates the user with a random one and then writes the hash (Coder's own PBKDF2 format) into the database. Coder
  checks strength only when a password is set, not at sign-in. It also writes a short-lived owner token for the
  template push into Coder's database (`files/bootstrap/bootstrap.py`).
* **Password sign-in on (live: off).** Live sets `CODER_DISABLE_PASSWORD_AUTH=true`, which makes this Coder refuse
  **every** password login, owners included (`coderd/userauth.go`). Default here: `"false"`, so the admin can use
  its password; OIDC users have no password, so they still sign in with Keycloak only. With `"true"` the Job switches
  the admin to OIDC instead (Coder links a Keycloak sign-in to an existing OIDC user by email).
* **No nginx** (live: an nginx Deployment served the template's icons at `/__icons/`). Traefik routes `/__icons/` to
  the platform service (`coder-ui-updates`), which mounts the icons ConfigMap and serves them (`TEMPLATE_ICONS_DIR`;
  images only, cacheable, SVGs sandboxed). One pod and one image fewer.
* **The banner starts blank** (live: a published maintenance notice). An admin publishes one in Admin Settings ›
  Announcement; Coder keeps it (in its database) and serves it at `/__banner/` itself.
* **`agent-audit.tf` is off by default** (`coder-workspace.agentAudit`). The live active template version (Sep 28)
  is `main.tf` + `certificates.tf`, byte-identical to the chart's. `agent-audit.tf` was added later and never went
  live: its `%{...}` snoopy format strings are Terraform template directives, so `terraform init` failed. The
  release's Oct 2 push never produced a template version. The strings are now escaped (`%%{`), and since 1.29.0 its
  forwarder starts (its script's heredoc end marker was indented, so bash never found it), so it can be switched on.
* **Push Job sign-in (fixed, coder-workspace 0.1.1).** 0.1.0 signs in with `curl`/`jq`, but neither the `coder`
  image (`latest` or `v2.37.3`) contains them. Live only worked because `install-workspace-chart` pre-created a token
  Secret. A python3 init container now does the sign-in. The push goes to the in-cluster Service
  (`coder-workspace.coder.internalUrl`).
* **Platform patch on the vendored subcharts** (`coder` 2.37.3-platform.1, `coder-workspace` 0.1.1-platform.1, applied by `../development/tools/apply-platform-patch.py`). Templated string
  values, `global.imagePullSecrets`, and `coder.extraEnv`. The upstream templates are otherwise untouched. Do not run
  `helm dependency update` on this chart: there is nothing to fetch.
* **`ui-service.py` reads `OIDC_SECRET`, `OIDC_CA_SECRET` and `CODER_DB_CLUSTER`** (with the old names as defaults)
  so renamed Secrets and databases work. The chart sets them.
* **Parameterized for air gap.** Images of every component, the workspace image inside `main.tf`
  (`coder-workspace.workspaceImage`), `imagePullSecrets`, and the CNPG `imageName` (live: the operator default,
  same image). With the default values, the rendered Terraform is byte-identical to live.
* **Coder image `2.0.0-platform.4-airgap` (new default).** Live runs `2.0.0-platform.4`, which downloads Terraform
  providers from `registry.terraform.io` at every template push and workspace build. Offline, every push fails. The
  `-airgap` image is the same image plus a provider mirror (`coder/coder`, `hashicorp/kubernetes`) and a
  `TF_CLI_CONFIG_FILE` that only uses it (`../development/airgap-image`). Other templates' providers: add
  `.tf` files to its `extra-providers/` and run `../development/tools/build-airgap-image.sh`.
* **Fixed while testing the install air-gapped (1.2.0):** all `checksum/*` annotations quoted (an all-digit hash
  was read as a number and rejected); `install.sh` uses server-side apply (the 1 MB default-logo ConfigMap broke
  client-side apply); `images.txt` takes Python from `docker.io/library/python` instead of the reference cluster's
  private Harbor; the Gateway API CRDs (Traefik's chart does not install them) ship in `prereqs/`.
* **Left out because unused or broken on live:** Secrets `cloudflare-token`, `coder-ca-cert` and `coder-server-tls`
  (nothing references them); the CNPG `Database` `coder-db-object` (never applied: role "coder" does not exist).

## Verification done at capture time

* `helm template coder ./coder-airgapped -n coder` was diffed against every live object. All match except for
  server/operator defaults, `2000m` vs `2` quantity forms, a duplicated name in the live Role, the checksum
  annotation, and the banner's `app.kubernetes.io/instance` label (it follows the release name: `coder` here,
  `coder-banner` live).
* `kubectl apply --server-side --dry-run=server --validate=strict` against the reference cluster accepted all 51
  objects. The one rejection was the banner Deployment's selector, which is immutable and changes because of that
  instance label. This only matters when adopting the reference cluster in place: delete `deploy/coder-banner`
  first there. A new cluster is unaffected.
* The EKS example values render with no reference-cluster hostname or registry left anywhere.
* 1.1.0 (`global`): with default values it renders the same 51 objects as 1.0.0, apart from the Argo CD
  annotations and the three new `coder-ui-updates` env vars. A render with every `global` value changed (domain,
  hosts, registry with port, Gateway, OIDC, every Secret name, database name, first user, pull secret) leaves no
  default name in any reference. The chart was pushed to an OCI registry with `mirror-images.sh chart`, pulled back
  with `helm pull`, and rendered with the Application's values, identical to the local chart (49 objects).

## End-to-end air-gap test (1.5.0)

DEPLOY.md was followed step by step, from a fresh extraction of `coder-airgapped-1.5.0.tar.gz`. The target was a
kind cluster (Kubernetes 1.37) whose node had **all non-private egress blocked** (both pulls from Docker Hub and pod
traffic to github.com fail). The registry was empty and the node had no cached images. Step 3 ran in a docker with
no images at all: all 7 images were loaded from `images/` (none pulled). Prerequisites in place beforehand: Gateway
API v1.6.0 CRDs, Traefik 41.4.0 (`prereqs/`) with the rewrite-body plugin, Argo CD 3.5.2, Keycloak 26.4 with client
`coder`, and wildcard DNS.

* Steps 1–7: every step succeeded. Argo CD reached **Synced / Healthy / Succeeded** in under 3 minutes. Every
  container (Coder, database, banner, add-ons, logs DB, workspace) ran from the mirror registry, with no
  pull errors.
* Step 8, as a browser inside the network, **22/22 checks**. Coder answers over HTTPS through the Gateway.
  `admin@admin.com` / `admin` signs in as owner `admin` (a wrong password is refused). A Keycloak user signs in and
  gets a normal account. The banner starts blank (hidden, no message). The template was pushed. `/__coder-ui/`,
  `/__banner/`, `/__icons/` and the dashboard load. A workspace builds and its agent connects. The workspace's apps
  were unhealthy, as expected (first gap below).
* Not re-run since 1.3.0: `global.disablePasswordAuth: "true"` (Keycloak only). 1.2.0 tested it; the bootstrap code
  for it was reorganized since (same steps).

Problems the 1.2.0 run found, all fixed in 1.2.0: no owner could ever sign in and the template push failed
(password login was fully disabled); `terraform init` needs `registry.terraform.io` (fixed with the `-airgap`
image's provider mirror); `agent-audit.tf` broke `terraform init`; an all-digit checksum annotation was rejected;
`install.sh` failed on the 1 MB logo ConfigMap; `images.txt` pointed at the private Harbor; the Gateway API CRDs
were missing from `prereqs/`; three HTTPRoutes stayed OutOfSync. The harness to repeat the test is in
`../development/tools/airgap-e2e/`.

## Known gaps for a strict air gap

Fixed in 1.28.0: code-server and File Browser are in the workspace image (nothing is downloaded at workspace start);
the push Job's CLI is Coder's own image (no floating `ghcr.io/coder/coder:latest`); Coder starts without Keycloak;
the image builder's base comes from its own registry. What is left:

* **Apt packages in the image builder need an apt mirror** (`imageBuilder.aptSources`, or Images › Settings). Without
  one, everything else in a build works offline (uploaded .deb files, installations, dotfiles, hardening, FIPS
  settings, XFCE or no desktop, the scan). Builds that need a download (apt packages, the GNOME desktop) are refused
  before they start, saying so.
* **The security data ages:** the vulnerability database in `coder-image-tools` is as old as the bundle. Load a newer
  one with `development/tools/build-security-data.sh` (DEPLOY.md › *Keeping the security data current*).
* **Admins' kubectl on EKS needs a Keycloak that EKS can reach:** EKS checks tokens from its own control plane, so an
  issuer that only the private network can reach cannot be used there (DEPLOY.md › *kubectl and k9s for admins*).
* **amd64 only:** every image is linux/amd64 (no Graviton nodes).
