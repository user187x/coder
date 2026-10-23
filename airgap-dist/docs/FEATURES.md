# What coder-fork adds to Coder Community Edition

The base is upstream Coder `main` at `70bc2e554` (2026-10-03, after v2.38.0), with 72 commits on top in
[`user187x/coder`](https://github.com/user187x/coder). The database schema is upstream's, with no migration added.
Everything below is on top of what Coder Community Edition does. Coder's own features (workspaces, templates,
provisioners, the agent, apps, SSH, port forwarding, audit, insights) are all kept.

**Where it lives:**
- **fork:** the Coder server and dashboard (`user187x/coder`);
- **service:** the platform service `coder-ui-updates` (`helm-chart/coder-airgapped/files/ui-updates/`), served at
  `/__coder-ui/` (the announcement banner at `/__banner/` is the fork's own, `coderd/platformbanner`);
- **chart:** the Helm chart and its installers (`helm-chart/`);
- **image:** the workspace image (`development/workspace-image/`) and template
  (`helm-chart/coder-airgapped/charts/coder-workspace/files/main.tf`, its scripts in `files/scripts/`).

**Test:** where the feature is checked. `vitest` and `go test` are the fork's unit tests; `step8`/`step9` are the
air-gapped end-to-end checks (`development/tools/airgap-e2e/`); `verify` is the live suite
(`development/tools/verify/`).

## 1. Air gap and packaging

| Feature | Where | Test |
|---|---|---|
| One self-contained bundle: chart, installers and every image as `docker save` archives, pinned by digest (`images.txt`, `SHA256SUMS`) | chart | e2e step 1–3 |
| `./make --deploy`: one guided install for Minikube, EKS or any cluster (domain, certificates, registry, storage class, Keycloak, Helm or Argo CD) | chart | e2e (Argo CD path) |
| `./make --push-images <harbor>[/<project>]`: every image and chart into your Harbor, with help for Harbor's CA, the docker and helm logins (Harbor, Docker Hub) and the project; checked after | chart | static checks, a test registry with a stand-in Harbor API (interactive and --yes) |
| `install.sh` (Secrets, ConfigMaps, CloudNativePG) and `mirror-images.sh` (verify, push, save, chart, `seed-builder`) | chart | e2e |
| Argo CD Application with values in the Application (server-side apply and diff) | chart | e2e step 6–7 |
| Coder image with a Terraform provider mirror (`-airgap`): template pushes and builds never reach `registry.terraform.io` | chart | e2e step 8 |
| No telemetry, update check, trial or premium funnel, STUN servers or GitHub/GitLab default login: Coder contacts nothing outside the network | fork | `go test ./cli` (OIDC), egress crawl |
| Coder starts and password sign-in works before Keycloak is set up or while it is down (Keycloak's standard endpoints; other OIDC providers: password-only, then a restart once they answer). Keycloak's Secrets optional | fork, chart | `go test ./cli -run OIDC`, verify |
| Desktop themes (the Desktop theme parameter): Serenade (Miserable_Xfce's: Tokyo Night, a floating dock with rofi and eww, picom's animations) by default, or Classic (plain XFCE, lighter over a slow connection); applied once per choice by `coder-desktop-theme`, the user's own settings kept and given back | image, chart | image build check, chart check, live |
| Workspace image with everything preinstalled: desktop (XFCE, noVNC), Chromium (the default browser) and Terminator (the default terminal), Firefox, code-server, File Browser (FileBrowser Quantum), tmux, btop, k9s, kubectl, kubelogin, JetBrains Mono Nerd Font | image | image build checks (offline), e2e step 8 |
| Cloud Drive share approvals: every admin asked in chat (Approve / Deny in the message, names opening the drive), an Approve button on both people's Accounts rows | service, fork | platform unit tests, vitest, live |
| Admins read any account's Cloud Drive (read only, logged), never an owner-encrypted one | service, fork | platform unit tests, live |
| Forced Focus (Accounts' chat menu) and Force Response (console): a message in front of the user's dashboard until acknowledged | service, fork | platform unit tests, live |
| The chat console as the first card of Controls › Settings › Chat, popped out into its own window and back; several conversations chosen (Select all: the whole list) deleted together, or a group chat with their people; right-click Delete / Workspace / Cloud Drive / Force Response; unread count on the Chat entry; Online Users a card there | fork | vitest, live |
| Accounts: the table and filter in a card of their own, first; the Inbox's search and padded list | fork | vitest, live |
| Overview removed: its Access URL, Wildcard Access URL and Experiments rows lead Network's table | fork | vitest, live |
| The workspace's Linux user is the owner's username (renamed at each start, home /home/coder, sudo kept; not under Lock Down's Sudo Command) and its hostname `<owner>-<workspace>` | chart | chart checks, container test (rename, repeat, taken and invalid names, sudo jailed) |
| Only the noVNC viewer in use resizes the desktop (Remote resizing): two viewers no longer fight over its size | image | browser test (two viewers, focus switched) |
| The desktop's clipboard shared with the computer both ways in noVNC (copy on the desktop; Ctrl+V, Ctrl+Shift+V, Shift+Insert, or coming back to the page, to paste the computer's); only copies go out (`-SendPrimary=0`) | image, chart | image build check, browser test (both ways, a paste into a desktop field) |
| JetBrains Mono Nerd Font in every terminal (XFCE's, Terminator with or without its own config, GNOME's monospace setting, code-server's terminal: the font served by code-server, a built-in extension's default) and Noto Color Emoji after it | image | image build checks, browser test (code-server's terminal) |
| Serenade's compositor (picom) kept up: the dock out of its animations (it crashed on it), started again after a crash | image | image build check, desktop test (5 starts) |
| Images: every entry deletable from its row (beside Download) and its page, confirmed first; the workspace template's own entry back with the next workspace image | service, fork | platform unit tests, vitest |
| The Coder fork's own images tagged "Coder fork" in every Images table, each opening a tree of what it holds (programs and versions, add-ons, OS and Python packages, configuration, build steps; a filter over it), and listed in Coder fork images (`image-contents.py`, `/api/images/contents`) | service, fork, tools | platform unit tests, vitest, chart check |
| Template settings on one page in the same look: General, Operations, Port sharing, Deprecate, Schedule, Variables, Permissions, Parameters; one save bar (metadata, then schedule with its confirmation, then variables as a published version); former addresses open their card | fork | vitest (save routing and order, toggles, validation, schedule conversions and confirmation, variables), browser check |
| Workspace settings on one page (the design's): header with the template version, section list and At a glance, General / Resources (tiles, GPU, home disk) / Environment (theme cards, image, start folder) / Schedule / Sharing cards, one save bar (each group through its own endpoint; a build only for build parameters, asked first on a running workspace); tokens for both themes, aria-pressed, labels, focus rings, 44px touch areas | fork, chart | vitest (dynamic parameters, save routing, GPU, schedule, renaming, Discard), browser comparison with the design |
| New workspace (/templates/<t>/workspace) in the settings pages' look: header (Templates / the template, its version, View source), section list and At a glance, General (name and a suggestion, owner, version, preset; Show preset parameters) / External authentication / Resources / Environment (the workspace settings page's cards: immutable parameters set here) / Schedule (the Global Workspace Scheduler's) cards, and a bar with Cancel and Create workspace | fork | vitest, live (dev server) |
| Who talks to whom (Controls › Settings › Chat): the latest 25 pairs, then a page at a time, with the total | service, fork | platform unit tests, vitest |
| A GPU parameter on every template, disabled (styling): no template runs its workspaces on GPUs | chart | chart check, preview engine (offline) |
| The workspace start's progress bar as moving construction tape; an animated GIF background still (its first frame) with Moving background or Animated GIFs off | fork | vitest |
| Images lists the workspace template's own image (read-only): its security report and its add-ons (every program with its version, apt and Python packages, from the image's addons.json) | service, fork, image | platform unit tests, vitest |
| Workspace template DEFAULT (`default`, Ubuntu icon): its scripts as files (`files/scripts/`, `shfmt -i 1`; the metrics as functions of `metadata.sh`), read with `file()` / `templatefile()`; a workspace load average beside the node's | chart | chart checks, step8 |
| Workspace network lights: RX / TX LEDs in the workspace header, flickering with the workspace's own traffic (template metadata `net`); hover for a live graph of the last minute (received green, sent blue, the axis in B/s to GB/s); red and still while Lock Down cuts the network, the graph showing no traffic | fork, chart | vitest |
| Pure upstream Coder at the fork's base, as a rollback image in the bundle (`coder-upstream:2.38.0-main.70bc2e554-airgap`) | chart | verify rollback |
| Prerequisites in the bundle: Gateway API CRDs, Traefik, CloudNativePG; Argo CD and Keycloak images for reference | chart | e2e |

## 2. Sign-in and identity

| Feature | Where | Test |
|---|---|---|
| Keycloak OIDC with certificate (PKCS#12) sign-in; first owner bootstrap with a password | chart, service | e2e step 8 |
| Sign-in page: the deployment's name as a traced outline (ContourTitle), background images and animated or HTML backgrounds; Keycloak's logo as its button, no footer | fork | vitest, verify UI |
| Customize > Sign-in and sign-out page: title, text effect (Wireframe, Neon, Plain), colour, speed, a sign-in and a sign-out message, live preview | fork, service | platform unit tests, vitest, verify UI |
| Certificates: each user's PKCS#12 in Settings, installed in their workspaces (`~/.cert/<user>.p12`), with the x509 fingerprint | fork, service, image | verify |
| SSH key from the user's .p12 private key (P12), or regenerated as RSA (4096-bit) or ED25519 | fork | `go test ./coderd -run GitSSHKey` |
| Admins' kubectl and k9s on the cluster from their workspaces, each signed in as themselves (Keycloak device login, `keycloak:<user>`), the group synced with Coder's owners (password owners too) | chart, service, image | verify (RBAC), manual sign-in |
| Keycloak status and settings page | fork, service | vitest |

## 3. Workspaces

| Feature | Where | Test |
|---|---|---|
| Workspace page: animated agent-card borders by state, with a pulse in the theme's colour once ready | fork | vitest, verify UI |
| Workspaces list: a row being started, updated or restarted has a semi-transparent barber pole moving across it until the workspace is completely initialized (its app icons show the moment it ends) or failed | fork | vitest, verify UI |
| Apps and terminal open only once the workspace is ready, after the apps' health checks; "Workspace initializing" panel with real progress | fork | vitest, e2e step 8 |
| Workspaces table: more than four apps in a carousel (four at a time, an app at a time: its arrows, the arrow keys, a sideways scroll; a bar for where it is), the update and restart buttons always to its right, never in it | fork | vitest, live |
| Workspaces, Templates and Images lists in rounded cards (GUI-UPDATES): header inside, a footer with what the list holds ("Showing N of N workspaces · N running · N with Cloud Drive mounted") and, on the right, the hover or focus text of anything in the table in one place; Workspaces columns Lock Down, Name, Template pill, Status pill, Apps (a framed carousel as wide as four apps, the side with more lit), Controls, Drive (each row's Cloud Drive socket: click to plug in or pull out) | fork | vitest, live (dev server) |
| Quick Menu (Admin Settings): admins arrange the Escape wheel's wedges (3-12) from the dashboard's pages and every admin category, with a live preview; saved for everyone, reset to the default eight | fork, service | unit, vitest, live |
| Image store: every picture chooser (announcement image arrow, dashboard and sign-in backgrounds, avatar, logo, template icons) offers one store - 30 provided animated pictures (the platform's logo, minecraft-cube.gif, among them) baked into the platform service's image (own layer), the dashboard's baked pictures, the gallery's, the announcement's uploads - with animated previews; backgrounds keep a reference, avatars/logos/icons are resized from it | service, fork | unit, vitest, chart checks, live |
| The banner's terminal in the banner's colours and background picture (span) | fork | vitest, live |
| DATAFLOW's terminal is Ghostty: the Ghostty app in the web terminal's place (every place it showed), Coder's terminal page drawn by ghostty-web (Ghostty's VT engine in WebAssembly, bundled); any terminal of an agent with the app is Ghostty's; template variable terminal_app (web/ghostty), chart value dataflowTemplate.terminal | chart, fork | chart checks, vitest, live |
| `/dev/mouse` at the banner terminal: the mouse pointer becomes sparks (see-through, clicks pass through) until any key | fork | vitest, live |
| Quick access wheel: Escape opens a radial menu over every signed-in page, full-page views included (the page blurred behind it) - Workspaces, Templates, Images, Users, Account, Chat, Announcement, HUD, each straight to its page (admins' pages dimmed for members); always - from a field, an open menu or dialog closing under it - but in a terminal (Shift+Escape there, and anywhere); Escape or a click off it closes it; arrow keys and Enter | fork | vitest, live |
| Top bar (GUI-UPDATES): rounder controls, the banner's expand and close both at its right, the HUD and latency as one split button (admins), quieter dropdown chevrons; the Chats panel a floating card, the status bar's last-update time in a pill | fork | vitest, live (dev server) |
| Reorderable drop-down panels (Logs, Terminal, any app embedded); app panels pop out to a window and back; a half-moon "+" tab (the plus in the theme's accent colour) adds an app panel | fork | vitest |
| Workspace page: the apps centred in equal columns across the card, as wide as the metrics; metrics a little wider, readings to one decimal place | fork | vitest, verify UI |
| Terminal: tmux with btop, pop-out window, text size (its columns x rows in a pill for a few seconds after each change), custom command, JetBrains Mono Nerd Font | fork, image | vitest |
| Workspace metrics in two groups (Workspace, Cluster) with live bar graphs coloured by magnitude, a gauge of the current reading, the percentage in a chip; Metrics Interval menu (1 s – 5 min, off); memory and disks in GB | fork, image | vitest, verify UI |
| Agent Update pill (another build, a newer template, an older agent) | fork | vitest |
| Admins' post-it notes on workspace pages and in the users table | fork, service | vitest |
| Workspace icons; home backups (S3 or download); disk growth (in place, or a copy to a bigger volume) | fork, service | verify |
| Global Workspace Scheduler: required start/stop schedules, enforced | fork, service | e2e step 8 |
| Image scans set apart what cannot apply to a container (the kernel's header package; Ubuntu's snap advisories on Mozilla's Firefox, two years old or more), each rule with its reason and findings, not graded | service, fork | platform unit tests, vitest |
| Workspace image without what a pod cannot use (PulseAudio with ffmpeg's libraries, libsoup, Docker's engine, ...) and with GNU coreutils: no critical or high finding, the rest waiting on Ubuntu's fixes | workspace image | build checks, scan, verify |
| Layer bundle per release: the customization layer alone (chart, installers, changed images; ours as thin deltas of their previous version), checked against the cluster before it installs | bundle | layer build + restore check, layer deploy on Minikube |
| Argo CD decorator install: the Coder installation (coder-airgapped-base, upstream Coder) and the customization layer (coder-airgapped-layer) as two charts in one Application; the layer comes off again (`--plain`) with the data kept; `./make --argocd` pushes to Harbor and deploys | bundle, chart | static checks, kind + Argo CD e2e |
| **Lock Down**: admins jail a workspace (Disconnect Network: only Coder reachable; Disable Privilege Escalation: no sudo; Lock Down: both; Freeze: Lock Down and everything paused, with a snapshot of its disk), live while it runs or from its next start, and again after every restart until lifted; a centred notice for everyone who sees it; red, still network lights | fork, service, chart | platform unit tests, vitest, live Lock Down test |
| Per-user quota | fork, service | e2e step 8 |
| "Animations" switch; no Favorite; no links to Coder's online docs | fork | vitest |
| Cloud Drive encryption wrapped with a Password, a PEM certificate, or a PFX (the certificate read out of the P12 in the browser - the Account's own, handed back to its owner only - its password never sent, stored or logged) | fork, service | vitest, unit |
| Cloud Drives shared between users: asked for in chat (a request card), shared read only or read and write by the owner, approved by an admin (both switches in Cloud Drive › Sharing), mounted at `~/cloud-drive-shared/<owner>` from the next start | fork, service, chart | vitest, unit, live |
| A shared Cloud Drive open at once in the Cloud Drive window (its drive switcher; read only: no Upload, New folder or Delete, writes refused by the service); the Sharing view names the workspaces a restart brings the shares to | fork, service | vitest, unit, live |
| The Accounts table's cables: each active share a Cloud Drive cable from the owner's row (its socket) to the row of whom it is shared with (a plug; green prongs read and write, blue read only), pointed at: who and how, both rows marked | fork | vitest, live |
| The Cloud Drive above the Workspaces table (flush with its right edge, its cables to the rows): its readout on one line, its capacity bar on the next; its leading cloud (a plus, glowing and pulsing, while something is shared with you) opens the shares, a card per owner (owner, what - a drive shared in parts: its first part, how many more, that part's access - files, size, the newest; Open) | fork, service | vitest, unit, live |
| The Cloud Drive attaching: an orange cloud with an unplugged plug in it, glowing and pulsing, beside a running workspace's status, and its cable red, until the workspace says the drive is attached in its container (its agent's metadata `cloud_drive`, read by the service from Coder's database); a connect or disconnect reaches the running workspace within a second (the service tells it by exec as well as by the pod's annotation, which the kubelet may take a minute or more to pass on) | fork, service, template | vitest, unit, chart checks, live |
| An entire Cloud Drive shared with you read and write counted in your capacity: a striped part of the bar, "+N shared" | fork, service | vitest, unit |
| Sharing a file, a folder or the entire Cloud Drive (Share in the Cloud Drive window: with whom, read only or read and write); shared with you, only that is reached (checked per path), mounted by subPath at `~/cloud-drive-shared/<owner>/<name>` from the next start, a shared folder a File Browser source | fork, service, chart | vitest, unit, chart check, live |
| Workspaces list: an outdated workspace's update icon pulses in the workspace page's orange | fork | vitest |
| File Browser is FileBrowser Quantum (the workspace's own build of 2.1.2, `2.1.2-coder.1`: symlinked folders as folders, opt-in `symlinkTargets`; the Cloud Drives' links open in place), its icon Quantum's logo (template icons as `binaryData`: any image), under the app's path, on 127.0.0.1, no sign-in of its own; every Cloud Drive here a source of its own in its sidebar (yours, and each shared with you: read only unless shared read and write), restarted as the drive is connected or disconnected; through restarts (PID file per container) and in templates made in the builder (the helper comes with the Cloud Drive's platform section; an older File Browser of this config taken over) | image, chart | image build check, chart check, live |

## 4. Templates and images

| Feature | Where | Test |
|---|---|---|
| A template's page is its Source Code (Overview and the tabs gone; members land on New workspace): the apps a workspace of it gets at the top, in the files' panel style (the agent, its OS and resource; the apps as centered tiles), the file tree and files taller; versions (squash ranges, Promote) | fork | vitest, live |
| Accounts table: each user's Latency (median, 95th percentile on hover) and Activity (time connected, a bar against the busiest) over the last seven days, every template - before Status; not shown to those who may not read the insights | fork | vitest, live |
| Templates table: Access - a menu with a user search and a tick per account; who is ticked may see and use the template, saved at once; none: everyone; its editors always may. The platform's own list (the fork's /templates/{id}/access, in the runtime config; lists, reads by ID and name, and a workspace's creation for its owner check it), as Coder's template permissions are Premium | fork | Go test, vitest, live |
| Export as ZIP: the template's Terraform, scripts and other files and every icon it uses (the Embed tab and Share menu removed) | fork | vitest, verify UI |
| Images: Needs fixing (graded D/F, raised by its fixes), "N fixable → grade", Fix CVEs and View fix →, the header's "N images need fixing" filter; Fix image (/images/<id>/fix): findings grouped by fix type (apt / pip per environment / base image / add-on / no fix), selection drives the grade after, the Dockerfile change, Apply = an installation step built and rescanned (on the image, or a fixed copy); Pit stop = Copa patches in place (OS, and pip with library patching up to a chosen level; pip let into distribution-managed environments for the patch only), rescans, a lap per library level (up to 3), back on the track as the next version or a `-patched` copy, the pit lane live on the page and "In the pit" on the list; agent runs, pull requests and accepted risks proposed in docs/fix-image-api.md (off until reviewed) | service, fork | platform unit tests, vitest, live (dev server; pit stop on the dev cluster) |
| Templates › Images: an image builder in the cluster (BuildKit rootless): base, apt packages (checked as you type), uploaded .deb files, installations, removals, hardening, XFCE/GNOME/no desktop, dotfiles; review and Dockerfile; builds with progress | fork, service | step 9 |
| Every build scanned offline: trivy (vulnerabilities, secrets), users/sudo/setuid checks, FIPS readiness; reports say what graded them | service | step 9 |
| The Images view's registry (`coder-registry`) built from source with Go's and its modules' fixes, as a regular user: no critical, high or medium finding; the images running pods use count as on their node (a node reports only its 50 largest) | image, service | build check, unit, live |
| Security data kept current in an air gap: load trivy's databases and FIPS rules from a file made outside (`build-security-data.sh`), dated, rescans | service | verify |
| Built images downloadable, backed up to S3 | service | verify |
| A template renamed in the dashboard keeps getting the chart's updates | chart | verify |
| Workspace image parameter: a dropdown of the template's image (follows the template), Templates › Images' images and Another image… with guidance; earlier literal values run the template's image | chart, service | verify, live |
| Template versions deleted from the history (not the active one, one building, or one a workspace runs) | fork | go test, vitest |
| Create new template: admins rename the base template; icon fields upload an image (Emoji or icon / Upload image) | fork | vitest |
| Create new template on the deployment's base: seven modules only (Git Clone, Dotfiles, Personalize, File Browser, Git Config, code-server, VS Code Desktop; the server lists and composes no other), no category tabs; the new template's ID follows its display name until edited (never the base's ID); a template's Delete names its ID beside its display name | fork | Go test, vitest |
| Source Code: a file picked in the tree is centred, without the hash jump | fork | vitest |

## 5. Administration and monitoring

| Feature | Where | Test |
|---|---|---|
| HUD: live, sortable platform overview with graphs (users, workspaces, CPU, memory, GPU, top users, failures) and Coder's System Uptime; an icon before each figure for what it measures; the totals on one line, their text shrinking to fit | fork, service | e2e step 8 |
| Health view, monitoring and security posture (zero-trust checks, runtime signals) | fork, service | e2e step 8 |
| Network and persistence maps | fork, service | vitest |
| Inbox (the bell): Clear all (deletes the user's notifications, asks twice) beside an icon-only Mark all as read | fork, service | vitest |
| Classification banners (e.g. UNCLASSIFIED; not on the terminal page, which the terminal fills), announcement banner (an LCD screen over a background image - span, tile, stretch, center, fill; a plain-text editor with font, outline, effect, colours, emoji, alignment; a countdown shown as a split-flap clock; optional receipts and Clear all; typewriter, crawl, Pew-Pew, Split-Flap, Ghostwrite, Knight Rider, open and close transitions, Viewed box; a terminal view with an easter egg) | fork, service | verify |
| Chat between users and admins, with screenshots, and the admins' chat console; peer-to-peer chat (Controls › Settings › Chat: on/off, a People list of who is online or active today, invisibility but to admins, retention 30 days by default, purge, who talks to whom) | fork, service | vitest, unit, verify UI |
| Controls menu (its Settings: the deployment's, once Admin Controls) with the cluster's CPU, memory and network traffic (last 15 minutes; kubelets' counters, RBAC nodes/stats); workspace settings as one page of cards; quick links, breadcrumb, arrangeable top bar, Resources menu; an icon before every item of both menus, each category's quick-link icon in General's sidebar and the breadcrumb, and an icon before every page of the account view | fork | vitest |
| Logo and avatar (uploaded, a gallery, defaults) | fork, service | verify |
| Agent Activity (optional `agent-audit.tf`): every command run in a workspace | chart, service | manual |
| metrics-server where the cluster has none | chart | verify |

## 6. Removed from upstream

GitHub OAuth (default provider and device flow), GitLab login, telemetry (server, CLI, network), the update check,
trial licences and the premium funnel, and STUN defaults. Their upstream tests are removed with them. None of these
removals touch the database.
