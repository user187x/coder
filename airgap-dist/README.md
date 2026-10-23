# coder-airgapped

A complete, self-contained **Coder** platform for **air-gapped Kubernetes** (EKS, or any cluster, Minikube for
development): a fork of Coder Community Edition with a reworked dashboard, an add-on platform service, an
announcement banner and a full-featured workspace template, packaged as **one Helm chart and one bundle that carries
every container image it needs**. Nothing is downloaded during the install, and nothing at run time reaches outside
your network.

| | Current release: [**v1.45.0**](https://github.com/user187x/coder-fork/releases/latest) |
|---|---|
| Coder server | `ghcr.io/user187x/coder-platform:2.0.0-platform.99-airgap`, upstream Coder `main` at `70bc2e554` (after v2.38.0) + 178 fork commits ([`user187x/coder`](https://github.com/user187x/coder)), with a Terraform provider mirror |
| Workspace image | `ghcr.io/user187x/coder-workspace:1.9.4` (desktop with two themes, Chromium, Terminator, IDEs, FileBrowser Quantum, Kubernetes tools; nothing fetched at start) |
| Platform service | `ghcr.io/user187x/coder-ui-updates` (its code on `coder-image-tools:1.2.0`: BuildKit helpers, trivy with its databases, Copa; and the image store's provided pictures, `development/image-store`) |
| Release | One folder: our six images (Coder, the platform service, the DEFAULT and DATAFLOW workspace images, MinIO, the image registry; split where over 2 GiB), `push-images.sh`, the one chart and `INSTALL.md`; scanned with no fixable CVE (`CVE-REPORT.md`). The public images come from your registry |
| Rollback image | `ghcr.io/user187x/coder-upstream:2.38.0-main.70bc2e554-airgap`: pure upstream Coder at the fork's base (in the repository's bundle, not in a release) |
| Bundle (built from the repository) | Every image pinned by digest, in one folder per part (`images/ui/`: the user interface - Coder, the platform service, their databases; `workspaces/`, `cloud-drive/`, ...), and every chart packaged (`charts/`, a Helm repository); `-slim`: only our images; the same release in parts: `-charts` (no images) and `-images-<part>` per folder, together the bundle; `-layer`: the update for a cluster at the previous release, only what changed (often a few MB); `-decorator-update`: an Argo CD decorator install's update, the Coder image and both charts (~300 MB) |

**Contents:** [Quick start](#quick-start) · [Architecture](#architecture) · [Features](#features) ·
[Security](#security) · [Testing and verification](#testing-and-verification) · [Build a release](#build-a-release) ·
[Upgrades and rollback](#following-upstream-and-rolling-back) · [Known limits](#known-limits) ·
[Repository layout](#repository-layout)

---

## Quick start

The release is one folder (download every asset of the GitHub release into it): our images (Coder, the platform
service, the DEFAULT and DATAFLOW workspace images, MinIO, the image registry) and the one Helm chart. The public
images the chart runs (PostgreSQL, PgBouncer, Python, BuildKit, the CSI driver, metrics-server, Traefik, the
CloudNativePG operator) come from your registry - `INSTALL.md` lists each one's path and tested digest; their CVEs are
their projects', the release's CVE gate covers ours. `pull-public-images.sh` saves them into the folder on a connected
machine, so the push takes them too. Then one push and one install:

```bash
./pull-public-images.sh                                   # connected side, optional: the public images into the folder
sha256sum -c SHA256SUMS                                   # every file: OK
./push-images.sh $REGISTRY                                # our images (and those public ones), where the chart pulls them
cp values.example.yaml values.yaml                        # set every CHANGE-ME (domain, registry)
helm install coder-fork coder-airgapped-1.46.0.tgz -n coder-fork --create-namespace -f values.yaml --timeout 20m
```

The chart brings Traefik (with the Gateway API) and the CloudNativePG operator where the cluster has none
(`global.bundled`), makes its CA and wildcard certificate unless you give yours (`secrets.generateTls`), and can teach
the cluster's DNS the platform's names (`global.inClusterDNS`); `INSTALL.md` in the release has every option.

[DEPLOY.md](helm-chart/DEPLOY.md#a-single-helm-install) has the prerequisites and the OIDC options. Every image in
the release is scanned before it ships, with no fixable CVE left (`CVE-REPORT.md`; `build-release.sh --scan`).

Building from this repository instead (Minikube, or a cluster your machine reaches) keeps the full tooling:
`development/tools/build-bundle.sh` writes the bundle with every image (public ones too), and `./make --deploy` in it
installs everything:

```bash
tar -xzf coder-airgapped-<version>.tar.gz && cd coder-airgapped-<version>
./make --deploy
```

Or take only what you need: a release can also come in parts by content (`build-bundle.sh`; not the slim releases) -
`coder-airgapped-<version>-charts.tar.gz` (installers, chart, every chart packaged; no images) and one
`-images-<part>.tar.gz` per image folder (`-images-ui`: the user interface; `-images-workspaces`, ...; `-ASSETS.txt`
says which holds what). Unpacked into one directory they are the bundle, file for file.

`./make --deploy` asks only what it cannot work out: Minikube or EKS (or any cluster `kubectl` reaches), your
domain, certificates (new self-signed ones or your own), and on EKS the registry to push the images to, the storage
class, your Keycloak / OIDC provider, and Helm or Argo CD. It then installs everything and prints the URL and the
first sign-in (`admin@admin.com` / `admin`; change the password right away).

Your images in Harbor first? `./make --push-images harbor.example.com/<project>` pushes every image and chart there:
it helps log your docker and helm in to Harbor (and Docker Hub), checks or creates the project, and checks every push.

**Already running the previous release?** A release can also have a **layer bundle** (not the slim releases),
`coder-airgapped-<version>-layer.tar.gz`: the customization layer alone (this chart, its installers, and only the
images changed since the previous release, our own ones as thin deltas of the image the cluster already has), with
no third-party chart or image. Carry that one file across instead of the whole bundle:

```bash
sha256sum -c coder-airgapped-<version>-layer.tar.gz.sha256
tar -xzf coder-airgapped-<version>-layer.tar.gz && cd coder-airgapped-<version>
PREVIOUS=../coder-airgapped-1.38.1 ./make --deploy      # the folder you installed from (its .deploy settings)
```

It first checks that the cluster has what the layer does not carry: Coder installed from a full bundle, Traefik,
CloudNativePG, the Gateway API CRDs and (Minikube) Keycloak at this release's versions, and every image it needs,
on the nodes or in your registry. If anything is missing it says what, changes nothing, and the full bundle is the
way. A thin image is made whole again from its base image, every layer checked by its digest. `./layer-support info`
in the extracted folder lists what the layer carries and needs.

**Installed with Argo CD (the decorator install)?** Its update is smaller still (not the slim releases):
`coder-airgapped-<version>-decorator-update.tar.gz` (~300 MB) carries only the fork's Coder image and the two charts,
with `update-application.sh`, which pushes them to your Harbor and moves your existing Application to the new
version (it shows the change and keeps your file as a backup):

```bash
sha256sum -c coder-airgapped-<version>-decorator-update.tar.gz.sha256
tar -xzf coder-airgapped-<version>-decorator-update.tar.gz && cd coder-airgapped-<version>-decorator-update
./update-application.sh --app /path/to/your-application.yaml --push --apply
```

The ubuntu-dataflow template's image (Apache NiFi and Airflow) is not in it: the helper keeps that template off
unless you give it the image (`--dataflow`). See [DEPLOY.md](helm-chart/DEPLOY.md#updating-an-argo-cd-install-the-decorator-update).

**Argo CD, with the customization layer as a decorator.** The bundle also installs as two charts in one Argo CD
Application (`argocd/`):
1. `coder-airgapped-base`, the Coder installation: upstream Coder, its database and its first owner;
2. `coder-airgapped-layer`, the customization layer: everything this project adds on top;
3. `argocd/coder-decorated-application.yaml`, the Application with both;
4. `./make --argocd`, which pushes every image and chart to your Harbor, installs what the cluster lacks (Gateway API
   CRDs v1.6.0, Traefik, CloudNativePG), creates the Secrets, gives Argo CD the chart repository, and applies the
   Application filled in with your values (or leaves it for you to add):

```bash
./make --argocd harbor.example.com/coder-airgapped           # Coder decorated by the customization layer
./make --argocd harbor.example.com/coder-airgapped --plain   # the layer taken off again: plain Coder, data kept
```

The layer hooks into the base in one place, `global.decorator.layer: true` (the base then runs the fork's Coder
image). Taking it off prunes everything it added and restarts Coder as upstream Coder, keeping every user,
template and workspace; applying the decorated Application again puts it back. Details: DEPLOY.md › Argo CD.

The step-by-step manual install, Argo CD, and the optional pieces are in
[`helm-chart/DEPLOY.md`](helm-chart/DEPLOY.md); every chart value is in [`helm-chart/README.md`](helm-chart/README.md).
The installing machine needs `docker`, `helm` and `kubectl` (`minikube` for Minikube, `aws` for ECR).

---

## Architecture

```
                         ┌──────────────────── namespace coder ─────────────────────────────────┐
 browser ─ HTTPS ─▶ Traefik ─▶ Coder server (fork) ── CloudNativePG (2 instances, coder-db)     │
  (Gateway API,     │          │  dashboard, API, provisioners (Terraform + provider mirror)    │
   wildcard TLS)    │          └─▶ workspaces (pods): agent, desktop, code-server, File Browser, │
                    │               terminal; home on its own volume                            │
                    ├─▶ /__coder-ui/  platform service coder-ui-updates (HUD, health, images,  │
                    │                 quotas, scheduler, notes, chat, certificates, ...)        │
                    │                 └─ image builder: BuildKit rootless Jobs, trivy scans,    │
                    │                    its own registry (coder-image-registry)                │
                    ├─▶ /__banner/    the announcement banner (Coder itself: coderd/platformbanner) │
                    └─▶ /__icons/     template icons (served by the platform service)          │
                         Keycloak (OIDC, certificate sign-in) · metrics-server (where missing)    │
                         └───────────────────────────────────────────────────────────────────────┘
```

| Part | Where it comes from |
|---|---|
| Coder server and dashboard | the fork, [`user187x/coder`](https://github.com/user187x/coder) ([`development/coder-fork/FORK.md`](development/coder-fork/FORK.md)) |
| Platform service `coder-ui-updates` | [`helm-chart/coder-airgapped/files/ui-updates/`](helm-chart/coder-airgapped/files/ui-updates/) (Python, standard library only) |
| Workspace template **DEFAULT** (`default`) | [`charts/coder-workspace/files/`](helm-chart/coder-airgapped/charts/coder-workspace/files/): `main.tf` and its scripts in `scripts/` |
| Workspace image | [`development/workspace-image/`](development/workspace-image/) |
| The chart, installers, images list | [`helm-chart/`](helm-chart/), the deliverable and source of truth |

The full feature list, with where each piece lives and how it is tested, is
[`docs/FEATURES.md`](docs/FEATURES.md).

---

## Features

### Air-gapped by design

- **One bundle, everything in it:** the chart, its installers (`make`, `install.sh`, `mirror-images.sh`), the
  prerequisites (Gateway API CRDs, Traefik, CloudNativePG) and every image as a `docker save` archive, each pinned by
  digest in `images.txt` and checksummed in `SHA256SUMS`.
- **Guided install** for Minikube, EKS or any cluster, with **Helm or Argo CD** (an Application with server-side
  apply and diff, sync waves and hooks ordered so the first owner and the template always come up).
- **Terraform without the internet:** the Coder image carries a provider mirror, so template pushes and workspace
  builds never reach `registry.terraform.io`.
- **No phoning home:** telemetry, the update check, trials and the premium funnel, STUN servers and the
  GitHub/GitLab default logins are removed from Coder. code-server and Firefox run with their own telemetry and
  update checks off.
- **Workspaces start offline:** code-server, File Browser, the desktop and every tool are in the workspace image.
- **Coder runs without Keycloak:** it starts, and password sign-in works, before Keycloak is set up or while it is
  down. Keycloak sign-in starts working the moment it answers.

### Sign-in and identity

- Keycloak OIDC with **certificate (PKCS#12) sign-in**; the installer's admin signs in with a password.
- **Settings › Certificates:** each user uploads their `.p12`; it is installed in their workspaces as
  `~/.cert/<user>.p12`. Its fingerprints (SHA-256 and MD5) are recorded, and its private key can become their SSH key.
- **Admins' `kubectl` and `k9s` on the cluster** from their workspaces, each signed in as themselves (Keycloak device
  login), with the cluster-admin group kept equal to Coder's owners.
- A sign-in page with the deployment's name as a traced outline, background images and animated backgrounds; its
  title, text effect (traced outline, neon or plain), colour, speed and messages (one for signing in, one for right
  after signing out) are set in Appearance (General > Appearance). The Keycloak button is Keycloak's logo (no text, no footer).
- **Settings › SSH keys:** Regenerate Key as RSA (4096-bit) or ED25519, or use the `.p12`'s key (P12).
- **Home disk:** Expand disk from the workspace's ⋮ menu or under Home disk size in its parameters (volume expansion
  where the storage class allows it, else a copy onto a bigger volume); backups to a download or S3.

### Workspaces

- **Workspace page:** animated borders by state with a pulse in the theme's colour; apps and the terminal open only
  once the workspace is ready (a real-progress "Workspace initializing" panel); its apps centred in equal columns
  across the card, as wide as the metrics under them; reorderable, embeddable app panels that pop out to a window and
  back, added from a half-moon "+" tab in the theme's colour.
- **Live metrics in two groups**, Workspace and Cluster, on one line, in the same order: CPU, RAM, Disk and Ø Load (the load average) each. They show
  live bar graphs coloured by magnitude, a gauge and a percentage chip, with a Metrics Interval menu (1 s to 5 min, or
  off), every reading to one decimal place. The workspace's own load average is computed the kernel's way from its
  own threads.
- **Network lights:** RX ↓ (green) and TX ↑ (blue) by the workspace's name, lighting up like a network card's LEDs
  when it receives or sends data. Hovering over them shows a live graph of the last minute, received and sent side
  by side, with the axis scaled from B/s up to GB/s. While Lock Down cuts the network, both are red and still, and
  the graph shows no traffic.
- **Terminal:** tmux with btop, a pop-out window, text size, a custom command, JetBrains Mono Nerd Font.
- **Per-user quotas** and a **global workspace scheduler** (required start/stop schedules, enforced).
- **Home volumes:** backups (S3 or download) and disk growth (in place, or a copy to a bigger volume).
- **Cloud Drive:** each account's own files on S3, at `~/cloud-drive` in each of its connected workspaces; on the
  Workspaces page, a cable from it to each connected workspace: drag a plug away to disconnect one, a cable onto
  another to connect it, live (no restart). Encryption with a key of one's own, wrapped with a **Password**, a **PEM**
  certificate or a **PFX** (the certificate read out of the P12 in the browser; its password never leaves the page).
  **Sharing between users** (admins turn it on, and approve each share): one user asks another in chat, the owner
  shares it read only or read and write; it opens at once in the requester's Cloud Drive window (its drive
  switcher) and is at `~/cloud-drive-shared/<owner>` in their workspaces from their next start. The Accounts table
  draws who shares with whom as the Cloud Drive's cables, from the owner's row to the other's.
- **Lock Down:** admins jail any workspace, for instance one where an agent runs away. Its menu turns each lock on or
  off (red while on, green while off):
  - **Disconnect Network** / **Reconnect Network:** only Coder stays reachable;
  - **Disable** / **Enable Privilege Escalation:** nobody in it can use sudo;
  - **Lock Down** / **Unlock:** both;
  - **Freeze** / **Unfreeze:** locked down, and everything in it paused where it is (its agent too), with a snapshot of
    its disk.

  It works live on a running workspace: with the first three, its processes keep running, and its terminal and apps
  still open, so admins can inspect what the agent is doing. On a stopped workspace it applies from the next start.
  Every mode comes back with each restart until an admin lifts it. Its badge (with the menu) sits in the Workspaces
  list between Name and Template, and on the workspace page right of Open Ports.
- Admins' **post-it notes** on workspace pages; workspace icons; an agent Update pill.

### The workspace template and image

- **DEFAULT** (`default`, with the Ubuntu icon):
  - an XFCE desktop in the browser (TigerVNC + noVNC);
  - Firefox (Mozilla's build, with offline policies);
  - code-server and File Browser (FileBrowser Quantum);
  - tmux, btop, bat, eza, fzf, jq, yq and Vim;
  - k9s, kubectl and kubelogin;
  - the JetBrains Mono Nerd Font.
- **The template's scripts are files** (`files/scripts/`, formatted with `shfmt -i 1`): the startup script, the
  dataflow template's `apache_nifi.sh` and `apache_airflow.sh` (each its own script in the workspace's Logs), the
  Cloud Drive's one `cloud-drive.sh`, the certificate install, the agent activity monitor, and every metric as a
  function of one `metadata.sh`.
- **The image documents itself:** each build records what it adds over its base in
  `/usr/share/coder-workspace/addons.json`: every program with the version it reports, and the apt packages asked
  for.

### Templates and the image builder

- **A template's page is its Source Code** (no Overview, no tabs): the apps a workspace of it gets at the top, then its
  files with versions (squash ranges, Promote, Delete - not the active one or one a workspace runs); members land on
  New workspace. Each user's latency and activity (the last seven days, every template) are on the Accounts table. The
  Templates table's **Access** menu names who may see and use a template (none: everyone; template admins always may):
  the platform's own list, enforced by the fork - Coder's template permissions are Premium. Export as ZIP with
  everything the template is made of: its Terraform, scripts and icons. Icons are an emoji, one of the library's, or an image uploaded from the
  icon field's menu; admins rename the base template in Create new template.
- **Workspace image, chosen from a list:** the template's image (it follows the template), the images built or
  imported in Templates › Images, or another one entered with guidance - a workspace whose image went away is offered
  the list at its next update instead of a validation error.
- **Templates › Images, an image builder in the cluster** (BuildKit rootless). You can add:
  - apt packages (checked as you type) and uploaded `.deb` files;
  - installation scripts and removals;
  - hardening options;
  - an XFCE, GNOME or no desktop;
  - dotfiles.

  Each build has a review step with its Dockerfile and shows its progress; built images can be downloaded and backed
  up to S3.
- **Fixing an image's CVEs:** the list tags an image graded D or F that its fixes would raise (**Needs fixing**,
  "31 fixable → B", **Fix CVEs**). **Fix image** groups its findings by how they get fixed, shows the grade the
  selected fixes leave, and applies them as an installation step that is built and scanned again (on the image, or
  on a fixed copy of an imported one). Or a **pit stop**: [Copa](https://github.com/project-copacetic/copacetic)
  patches the image's packages in place (OS packages, and Python ones with library patching), it is scanned again,
  patched again a library level further while that helps (up to three laps), and goes back on the track as the next
  version or a patched copy - all from the page. Agent runs, pull requests and accepted risks are proposed in
  `docs/fix-image-api.md`.
- **Every image is scanned offline**, built ones and the workspace image the template runs (listed first, read-only,
  "In use by workspaces"). See [Image security](#image-security).
- **Delete any image** in Images (confirmed first; the workspace template's own entry comes back with the next
  workspace image), and see **what each of the Coder fork's images holds:** a "Coder fork" tag on them opens a tree
  of their programs and versions, OS and Python packages, configuration and build steps, read from the images as
  built (`image-contents.py`), with a filter over all of it.
- **The base template is a prototype, its platform parts a decorator:** Create new template starts every template
  from DEFAULT (Desktop, File Browser and Terminal each in or out, and any of seven modules: Git Clone, Dotfiles,
  Personalize, File Browser, Git Config, code-server, VS Code Desktop) with the template's own logic only; Coder injects
  the platform's sections (the certificate, Lock Down, the Cloud Drive, the metrics, code-server HA) into every
  template when it is built. Source Code shows the code and, beside it, the **Materialized** main.tf; **Global files**
  lists what every template gets.
- **code-server HA:** a template can make its code-server a global singleton - one instance per workspace across the
  clusters sharing Coder's database, replaced when it fails, taken over by another healthy cluster - kept by the
  code-server-replicator and reached through relays, its state in Coder's database.

### Administration and monitoring

- **HUD:** a live, sortable platform overview with graphs (users, workspaces, CPU, memory, GPU, top users,
  failures) and the Coder server's **System Uptime**; its totals on one line. The Controls menu shows the cluster's
  CPU, memory and network traffic (last 15 minutes) at a glance.
- **Workspace settings** on one page: General, Resources (CPU and memory tiles, the GPU, the home disk and Expand
  disk), Environment (desktop theme, workspace image, start folder), Schedule and Sharing, with a section list, the
  workspace at a glance, and one save bar that restarts the workspace only when its build parameters change.
  **Template settings** in the same look: one page of cards (General, Operations, Port sharing, Deprecate, Schedule,
  Variables, Permissions, Parameters) with one save bar. **New workspace** (a template's Create workspace) too: the
  same Resources and Environment cards, General (name, owner, preset), External authentication and Schedule, with
  Cancel and Create workspace in its bar.
- **Two workspace templates:** DEFAULT (code-server) and DATAFLOW (Apache NiFi, Apache Airflow, and Ghostty as its
  terminal); the same workspace otherwise; everything offline.
- **Health, monitoring and security posture** views; network and persistence maps.
- **Banners:** classification banners (e.g. UNCLASSIFIED), and an announcement banner with:
  - its message on an LCD screen set into the banner, over a background image (uploaded or a preset; animated GIFs
    too) that rolls through it, tiles, stretches, centers or fills it;
  - an editor like a small word processor: plain text, font, an outline for legibility over any background, effect,
    text and banner colours, emoji, alignment, a countdown shown as a split-flap clock at the banner's left;
  - receipts (Viewed, Confirm) optional per announcement, and Clear all for their records;
  - effects: typewriter, crawl, Pew-Pew, Split-Flap, Ghostwrite, Knight Rider and more, and open and close
    transitions;
  - a "Viewed" receipt with the user's certificate fingerprint;
  - a terminal-style full view (with an easter egg or two).
- **Inbox:** a search box, Clear all (asks twice) beside Mark all as read.
- **Chat** between users and admins (with screenshots and files of any kind, sent with a progress bar), and the admins'
  chat console - the first card of Controls › Settings › Chat, popped out into a window of its own when wanted: several
  conversations chosen (Select all takes the whole list) and deleted together, or a group chat with their people, a
  right-click menu (Delete, Workspace, Cloud Drive, Force Response), and
  **Forced Focus** (a message in front of the user's dashboard until acknowledged); **peer-to-peer chat** between
  developers when admins turn it on (a People list of who is online or active today, grey after 30 seconds without
  input; anyone can be invisible but to admins); chats kept 30 days by default (admins set it, and can purge them);
  admins see who talks to whom, and **Online Users** (a card of the Chat page): everyone online now, live (active or
  idle, tabs, last input, running workspaces). Cloud Drive shares waiting for an admin are asked for in chat and
  approved there or from Accounts, after a look at the drive (admins read any unencrypted Cloud Drive).
- The **Controls** menu (Settings and quick links), an arrangeable top bar, logo and avatars (uploaded, gallery,
  defaults).
- **Agent Activity** (optional): every command run in a workspace, for review.
- metrics-server installed where the cluster has none.

---

## Security

### Air gap and supply chain

- **No outbound traffic:** the dashboard is crawled in a browser to check that no request leaves the deployment's
  domain, and the end-to-end test installs and runs on a cluster whose internet egress is blocked.
- **Every image pinned by digest** (`images.txt`) and every archive checksummed (`SHA256SUMS`); no floating tags
  (enforced by the static checks); release parts and bundles carry SHA-256 files.
- **Downloads at build time are verified:**
  - code-server, File Browser and the `shell-quote` replacement by their published SHA-256 / SHA-512;
  - Firefox through Mozilla's signing key, checked by fingerprint.
- **Terraform providers** come from the image's own mirror (`TF_CLI_CONFIG_FILE` allows nothing else).

### Identity and access

- **The first owner is always the installer's:** OIDC sign-ins are refused while Coder has no user
  (`CODER_PLATFORM_FIRST_OWNER=bootstrap`), so the first person through Keycloak cannot become owner.
- **Keycloak** with client certificates (PKCS#12).
- Coder's own protections are kept: sign-in rate limits, and RBAC with owner, template-admin and member roles.
- **Admins' cluster access** is personal and short-lived:
  - each admin signs in to Kubernetes as themselves (`keycloak:<user>`), through Keycloak's device login;
  - the tokens live in `/tmp` and last only as long as the Keycloak session;
  - no long-lived credential sits in any workspace;
  - someone who stops being an owner loses the kubeconfig at the next start.
- **The platform service checks every caller:**
  - it validates the Coder session against Coder itself;
  - it enforces each view's role (admins, template admins, the owner);
  - it refuses cross-site requests: changes need its `X-Requested-With` header and a JSON body, which a
    form on another site cannot send.

### Secrets and certificates

- **A certificate's password is never sent or stored:** it is checked in the browser only.
- **Certificates reach only their owner's workspaces:** stored as the user's own Coder secret, written by Coder's
  agent to the owner's workspaces only, installed as `~/.cert/<user>.p12` with mode `0600` in a `0700` directory.
  A certificate deleted in Coder is removed from `~/.cert` at the next start.
- **TLS end to end:** a local PKI (`x509-support`: CA, wildcard server certificate, client certificates); workspaces
  trust the cluster CA alongside the public roots.
- **Installer-generated passwords** stay out of Helm values and the release record (Secrets, ignored by Argo CD's
  diff).

### Workspace isolation

- Workspace pods run as a **non-root user** (uid 1000, `runAsNonRoot`), only in the `coder` namespace (the template
  refuses others), with **core dumps disabled** for everything the agent starts.
- **Nothing in a workspace listens on its network:**
  - the desktop's VNC server listens only on a Unix socket (directory `0700`, socket `0600`), with no TCP port;
  - every app (code-server, File Browser, websockify) and the agent's own ports listen on `127.0.0.1`.
  - The only way in is Coder's authenticated app proxy, with every app shared with its owner only.
- **Home volumes are protected:** their storage class can never change after creation, and they only ever grow, so
  a template change cannot replace (empty) anyone's home.

### Lock Down (containing a workspace)

- **Disconnect Network:** firewall rules in the workspace pod's own network namespace refuse everything in or out except
  loopback, DNS and Coder; connections already open stop at once, and IPv6 is blocked entirely. The agent's
  connection to Coder is kept, so admins can still reach the workspace.
- **Disable Privilege Escalation:** a last sudoers rule denies every command to everyone. A process that is root already stays root,
  and nothing else in the workspace can become root.
- **It can't be undone from inside the workspace:**
  - the workspace container has no `NET_ADMIN`, so not even root there can change its firewall;
  - the setting lives outside the workspace, in a ConfigMap only the platform service writes.
- **It applies live:**
  - a running workspace is locked by a short-lived helper container, with no restart and nothing killed, so the
    evidence stays in place;
  - a stopped one is locked at start, before anything runs;
  - a watcher keeps every running workspace as the setting says.
- **Freeze:** every process of the workspace container is paused (SIGSTOP), Coder's agent too, so no session opens in
  it; its PID 1 only waits for its children. Its home volume is snapshotted while everything is paused: a
  VolumeSnapshot where the cluster supports it (EKS with the EBS CSI driver and a VolumeSnapshotClass), else a copy in
  a new volume made on the workspace's node. The processes that were running are recorded with it. Lifting it resumes
  exactly the paused processes. The snapshot is kept until an admin deletes it or freezes the workspace again.
- **It survives restarts:** Network and Sudo are set at start before anything runs, Freeze within seconds of the
  start, until an admin lifts the lock.
- **It's visible:** everyone who sees a locked workspace, its owner included, gets a notice of what is locked, by
  whom and since when; its network lights turn red. Only admins can set or lift it, and every change is logged.

### Image security

- **Every image is scanned offline** by trivy (vulnerabilities and secrets) plus the image's own checks:
  - a non-root default user;
  - no account without a password, and root locked;
  - no passwordless sudo;
  - few setuid programs, and no world-writable paths;
  - no baked SSH host keys, private keys or shell history;
  - whether compilers are present.
- **Each scan gets a grade** (A to F) and a **FIPS 140 readiness** check: a validated OpenSSL module, OpenSSL's
  default provider, the TLS floor, SSH ciphers and other crypto libraries.
- **Hardening in the builder:**
  - strip docs and caches;
  - no sudo for the workspace user, and root locked;
  - no setuid bits, and no compilers;
  - umask 027 and no core dumps;
  - hardened SSH;
  - FIPS-aligned crypto settings.
- **Security data stays current in an air gap:** trivy's vulnerability and Java databases and the FIPS rules are
  loaded from a file made outside (`build-security-data.sh`). Each report records which data graded it, and every
  image can be rescanned.
- **The workspace image is tracked and scanned too**, and its findings are acted on. Workspace image 1.8.5 grades
  **B: no critical and no high finding** (1.8.3 was D, with 64 high), and 83 medium (1.8.4: 223): every package
  upgraded; File Browser built from its source with the current Go and fixed Go modules (since 1.8.7 FileBrowser
  Quantum's release binary, unpacked from UPX so the scanner reads its Go modules); `basic-ftp` replaced in
  code-server (as `shell-quote` was for CVE-2026-102422); GNU coreutils instead of Rust coreutils; removed, as a
  workspace pod has no use for them: Docker's engine and plugins, PulseAudio with ffmpeg's libraries, libsoup (and
  the weather plugin that needed it), the USB printer daemon and a stray `pebble`. What is left is medium findings with no fix released, in packages in use. Findings that cannot apply to a container are listed apart in the report, each with its reason, and not
  graded: the kernel's header package (a container runs its node's kernel) and Ubuntu's snap-package advisories,
  two years old or more, on Mozilla's own Firefox.

### Data protection and rollback

- The database, the add-on volume and the generated Secrets carry `Prune=false,Delete=false`: deleting the Argo CD
  Application never deletes data.
- **The fork adds no database migration**, so a rollback to pure upstream Coder (the rollback image in the bundle)
  reads the same data, and running workspaces keep working
  ([`development/coder-fork/ROLLBACK.md`](development/coder-fork/ROLLBACK.md)).
- PostgreSQL runs as two CloudNativePG instances.

### Audit and policy aids

- **Agent Activity** (optional `agent-audit.tf`): every program run in a workspace, with its arguments, working
  directory and parent, recorded and sent off the workspace at once. The workspace's agent token authenticates it,
  so records cannot be forged for another workspace.
- **Classification banners**, announcement receipts (who saw and who confirmed each announcement), quotas and
  enforced schedules.

---

## Testing and verification

Every capability is tested at the level it lives at, and the suite says whether Coder's own features still work
next to the fork's. [`development/tools/verify/`](development/tools/verify/) runs the suites and writes a report;
[`development/tools/airgap-e2e/`](development/tools/airgap-e2e/) is the air-gapped install test.

| Layer | What it proves | How |
|---|---|---|
| **Static** (`chart_checks.py`, 31 checks) | The chart renders for Minikube, EKS, a private registry, Keycloak-only and admins' kubectl, plus: every image pinned and archived; no floating tags; Keycloak's Secrets optional; nothing at workspace start needs the internet; the first owner is the installer's; Argo CD hook order; the template's scripts shipped, `shfmt -i 1` formatted and `bash -n` clean | `./run.sh static` |
| **Unit: fork** | `go test` on every package the fork changed (or upstream's whole suite), and the dashboard's vitest suite (upstream's ~4,700 tests and the fork's). New fork code comes with tests, e.g. OIDC fallback, first-owner guard, MD5, uptime, network lights, Inbox, Images | `./run.sh unit` |
| **Unit: platform service** (`platform_unit_test.py`, 16 tests) | The session cache, admin sync, image builder offline refusals and base seeding, the tracked workspace image, add-ons parsing, Coder uptime | `python3 -m unittest` |
| **Image build checks** | Every workspace image build asserts its tools, desktop, fonts and shell setup. With **no network**, it then runs Firefox and starts code-server and File Browser. | `build-workspace-image.sh` |
| **code-server HA on PostgreSQL** (`csha_db_test.py`) | A throwaway PostgreSQL: the relay role confined to its workspace, two clusters' operators keeping one instance (replaced, taken over, fenced), the relays carrying a connection to the active code-server, its state restored | `python3 csha_db_test.py` |
| **Air-gapped end to end** | DEPLOY.md followed from a fresh bundle on a kind cluster with **all internet egress blocked**, every image loaded from the bundle. The steps: sign-in and workspace checks (8), the image builder offline (9), Keycloak down and its Secrets missing (10) | `airgap-e2e/e2e.sh`, `step8–10.sh` |
| **Live conformance** (`live.py`) | On a real deployment with a throwaway user and workspace. **Upstream:** users, tokens, organizations, templates (offline `terraform init`), the workspace lifecycle, agent, apps through Coder's proxy, the web terminal, ports, logs, insights, health, provisioners, notifications. **Fork:** every platform service view and its access rules | `./run.sh live` |
| **Browser** (`ui.mjs`) | Every dashboard page loads; **no request leaves the domain**; no page throws; key pages render correctly. A memory soak (workspace page, HUD) requires the JS heap and the DOM to level off | `./run.sh ui` |
| **Rollback** | The deployment's database copied; pure upstream Coder and the fork run on it and see the same; the schema unchanged; a live switch to upstream and back | `./run.sh rollback`, `rollback-live.sh` |
| **Load** (`load.py`) | Hundreds of developers' and admins' dashboards polling at once, with latency percentiles and error rate | `./run.sh load` |

**Latest results** (full report: [`docs/READINESS.md`](docs/READINESS.md)):

| Check | Result |
|---|---|
| Static checks | **154/154** (1.46.0) |
| Platform service unit tests | **163/163** (1.46.0) |
| Air-gapped install, egress blocked | Argo CD Synced / Healthy in 297 s; step 8 **39/39**; image builder offline **12/12**; Keycloak down **3/3** (1.28.0) |
| Argo CD decorator install (`./make --argocd`; kind, egress blocked, Gateway API v1.6.0, Argo CD 3.5.2) | decorated: Synced / Healthy in ~3 min, **7/7**; layer off: **7/7** (upstream Coder, data kept); layer back: **7/7**, every volume the same (1.38.0) |
| A real Harbor 2.15.2 with a private CA (`harbor-setup.sh`; installing machine: docker-in-docker, no images) | `./make --push-images`: CA trusted, project created, 11 images (all from the bundle) and 5 charts, all checked; a single-chart Argo CD install (robot account, Harbor's CA) migrated to the decorated one by `./make --argocd` in place: **23/23** objects kept, **7/7** (1.39.0) |
| Live conformance | **76/76** (1.28.0) |
| Load, ~1,050 dashboard tabs for 8 minutes | **0 errors** of 157,626 requests, worst p95 0.28 s, no restarts (1.28.0) |
| Browser memory soak, 8 minutes | JS heap +0.3 MB; no external requests (1.28.0) |
| Rollback to upstream and back | **7/7** on a database copy, **4/4** live (1.28.0) |
| Lock Down, live (Network, Sudo, Complete, Freeze, restarts) | **35/35** (1.37.1, workspace image 1.8.5) |
| Workspace image 1.8.5 scan | Grade **B**: 0 critical, **0 high**, 83 medium with no fix released (1.36.0; 1.8.4: 223) |

```bash
cd development/tools/verify
./run.sh static unit                                   # before every commit to the fork or the chart
./run.sh live ui rollback load --url https://coder.example.com --domain example.com \
    --context my-cluster --workspace /@admin/my-ws --soak-minutes 10 --load "--developers 100 --admins 5 --speed 10"
```

---

## Build a release

```bash
development/tools/build-workspace-image.sh             # the workspace image (offline checks, saved into the bundle)
development/tools/build-airgap-image.sh 2.0.0-platform.31   # the fork's Coder image + Terraform provider mirror
development/tools/build-release.sh --scan              # -> dist/coder-fork-<version>/: the release (our images + the
                                                       #    chart), every image scanned: fails on a fixable CVE
development/tools/build-bundle.sh                      # -> dist/coder-airgapped-<version>.tar.gz, -slim, the parts
                                                       #    (-charts, -images-<part>, -ASSETS.txt) and -layer
development/tools/build-decorator-update.sh            # -> dist/coder-airgapped-<version>-decorator-update.tar.gz
```

Image archives are not in git: `images.txt` pins every image by digest, and `build-bundle.sh` fetches the missing
public ones (`mirror-images.sh save`). The Coder server is built from the fork (`scripts/build_platform_image.sh`
there; see [`development/coder-fork/FORK.md`](development/coder-fork/FORK.md)). A release on GitHub is
the folder `build-release.sh` writes, its files as the assets (GitHub takes files under 2 GiB: an image archive over
that comes in parts, `.part-NN`, checked one by one in `SHA256SUMS` and joined in `SHA256SUMS.joined`); it passes
`--scan` first (with `--vex development/workspace-image/firefox.openvex.json`). `build-bundle.sh --parts` writes the
bundles in parts the same way, straight from tar.
`main` is always release-ready in both repositories.

## Following upstream and rolling back

- [`development/coder-fork/UPSTREAM.md`](development/coder-fork/UPSTREAM.md): how the fork follows each upstream
  Coder release (merge rules, conflicts, the test gate), with no breaking changes to what the fork adds.
- [`development/coder-fork/ROLLBACK.md`](development/coder-fork/ROLLBACK.md): how to switch a deployment to pure
  upstream Coder and back, without losing or corrupting workspaces.

## Known limits

- **Apt packages in image builds need an apt mirror** (Images › Settings). Everything else in a build works
  offline, and builds that would need a download are refused up front, with the reason.
- **Security data ages** with the bundle: load newer data with `development/tools/build-security-data.sh`.
- **Admins' kubectl on EKS** needs a Keycloak that EKS's control plane can reach (otherwise an in-cluster OIDC proxy).
- **Not yet run on a real EKS cluster:** EKS is tested by renders, and the install by the air-gapped kind test.
- **Images are linux/amd64 only.**
- **The workspace image grades D:** no critical findings, but 64 high ones remain in bundled third-party software,
  as its report in Templates › Images shows.

## Repository layout

| Path | What |
|---|---|
| [`helm-chart/`](helm-chart/) | **The deliverable:** the chart, `DEPLOY.md`, the chart reference `README.md`, the Argo CD Application, `make`, `install.sh`, `mirror-images.sh`, `images.txt`, prerequisites |
| [`docs/`](docs/) | [`FEATURES.md`](docs/FEATURES.md) (everything the fork adds over Community Edition) and [`READINESS.md`](docs/READINESS.md) (the release-readiness report) |
| [`development/`](development/) | Building and testing: the workspace image, image tools, the air-gap image, `tools/` (builds, `verify/`, `airgap-e2e/`), the fork's notes (`coder-fork/`), a reference capture of the original deployment |
| [`CHANGELOG.md`](CHANGELOG.md) | What changed in each version |
| `dist/` | Built bundles (git-ignored) |
