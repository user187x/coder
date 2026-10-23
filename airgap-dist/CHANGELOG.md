# Changelog

## 1.46.0 – unreleased

Coder `2.0.0-platform.108` (fork `866faf2ff`).

* **Fixes:**
  * **Ghostty's text size buttons** (the workspace page's Terminal panel) did nothing: on connecting, the terminal's
    options were replaced by a plain object, which Ghostty's emulator then ignored. Now they resize it, as with xterm.
  * **Ghostty fills its panel's width:** its fit kept 15px free for a scrollbar it draws over the text anyway, an
    empty strip down the right.
  * **No scrollbars in the workspace dashboard's panels** (Logs, Terminal, apps, ports); they still scroll.
  * **The sign-in and sign-out page's announcement** was clipped at its right end: the banner above the sign-in made
    the page 14px too tall, and its scrollbar covered the banner. The two now share the window's height.
* **Cloud Drive:**
  * **Admin Settings › Cloud Drive**, a category of its own: at its top the **Cloud Drive on or off for everyone**,
    then where it keeps files and every account's capacity. Off, no one is shown a Cloud Drive, its routes refuse,
    and it is unlinked from every running workspace at once; its files stay. On again, everything links back.
  * **The Cloud Drive pill's green light flashes like an LED** while the user's drive uploads or downloads, from the
    workspaces, the dashboard or File Browser alike. The platform service reads MinIO's admin trace (the chart's
    MinIO only) and answers each user for their own drive (`/api/safe/activity`).
  * **The Workspaces table's connecting cloud** is the `cloud-disconnect.svg` artwork (a cloud struck through).
  * **A deleted workspace lets go of its cable:** the plug pops off its row and the cord reels back into the Cloud
    Drive like a retractable one, while the row is still there (shining), before it goes. Cables are no longer
    remade when the list re-sorts.
* **Restore workspace** (a workspace's ⋮ menu, beside Back up home): a home backup - a file, or one of the owner's
  workspaces' backups in S3 - restored into **a new workspace** made as the backup's (its template and parameters),
  or **over this workspace's home** (stopped, its home replaced, started again). Each backup now starts with what it
  was taken from (`.coder-backup.json`: the workspace, template, parameters - CPU, memory, disk - in a small gzip
  member of its own), so the dialog reads only a file's first 256 KB, or a range of the S3 object, and asks the user
  quota **before anything is uploaded, downloaded or created**; over quota it says why and Restore stays off, and the
  platform service refuses an upload over quota from its first bytes as well. A backup from before carries none: a
  new workspace gets this one's template and parameters. The backup is read to its end first - a damaged file, or an
  entry outside the home, is refused before anything changes; owners and modes come back as they were.
* **The quota pill** (Workspaces, above the search): the signed-in user's limits (Health › User Quota) - what their
  workspaces take of each and what is left, amber from 80%, red at the limit - shown only where a limit applies to
  them (`/api/quota/me`). It follows the table: a workspace made, deleted, rebuilt or started updates it at once;
  else every 10 s.
* **The workspace page's top bar floats** - a smoothly rounded rectangle like the dashboards' cards (18 px) - as wide as the dashboard (its 1200 px), every part kept,
  evenly spaced (the same gap to the navbar above and the dashboard below), staying in view as the dashboard
  scrolls. **The left sidebar is gone:** Resources and History are a toggle pair at
  the pill's start, each dropping its list as a card over the dashboard (again, Escape or a click elsewhere closes;
  `?sidebar=` links still open them); an admin's note button sits beside them.
* **Chromium as a workspace app** (DEFAULT and DATAFLOW, with the Desktop app): a maximized browser - its tabs and
  address bar - on an X display of its own (`:2`, xfwm4 with settings of its own: no title bar), shown through noVNC
  on port 6902, so it fits a dashboard panel and follows its size. Its profile is `~/.config/chromium-panel`;
  closed, it comes back.
* **The dashboard's Add a panel (+) button** lists the workspace's apps only (no ports, no web address) and takes the
  theme's own add colour, so it changes with the theme.
* **Workspaces in the latency menu** (a member's narrower menu): template names give way to the room each row has, so
  none is clipped under the menu's edge.
* **Images is for admins only:** its menu items (Resources, the mobile menu, the quick access wheel) and pages are
  theirs alone, and its API refuses anyone else (template admins included).
* **Workspace pods are named `coder-<username>-<template>-<workspace>`** (Kubernetes' letters, cut to 52 characters
  with a piece of the workspace id); the home volume keeps its id name, so no files move. A workspace takes the new
  name at its next start.
* **The Workspaces pill counts its hold** with chevrons each side of its words: one more each third of the hold, in
  step with the ring, three when it locks; gone when it is let go or closed.
* **The announcement terminal:**
  * `ls` lists the user's workspaces with their state and uptime;
  * `date` (or `data`) gives the date, `whoami` answers "Skynet", `clear` empties the screen, and anything else is
    "command not found";
  * the wagging finger answers only commands starting with `rm`, and fades away after 1.5 s;
  * `matrix` pours the Matrix's rain over the screen until a key or a click;
  * Skynet, the broken screen and the Matrix go fullscreen while they last.
* **The install's look is the reference deployment's:**
  * the logo (the Minecraft cube, animated) and the Doom face default avatar ship in the platform service's image,
    so a one-step Helm install has them too (no ConfigMap needed; the logo is past a ConfigMap's 1 MiB);
  * the sign-in background (`minecraft-cube.gif`) and the dashboard's (`spiral.gif`) are set once on a fresh install
    (`uiUpdates.appearanceDefaults`), in slots no one has set;
  * the colour theme for everyone who has not chosen one is `dark-tritan`;
  * the sign-in page's effect and text were the defaults already.
* **The workspace card:** the build's time sits just after "Build timeline", and the Uptime pill at the footer's right.
  The Cloud Drive glyph sits left of the Lock Down shield, and the network pill between the RX/TX lights and the
  latency, showing its graph's time span (`08:10–08:15`; the day and seconds on hover).
* **DATAFLOW's NiFi: one HTTPRoute for every workspace, `coder-enhanced-nifi`** (was one per workspace,
  `coder-<id>-nifi`, made by the template):
  * a regular expression matches any workspace's NiFi path (`/@<owner>/<workspace>.<agent>/apps/nifi...`) and sends it
    to Coder, which proxies it to that workspace's NiFi as for any app (and decides who may open it);
  * the route sets what is the same for all (the proxy scheme, host and port) and removes a client's own context-path
    headers; each workspace's path comes from Coder: the fork's app proxy now sends every path-based app
    `X-Forwarded-Prefix`, its base path (NiFi 2.12 reads it);
  * a workspace's old route goes at its next build (Coder's service account keeps its HTTPRoute permissions until
    every workspace has been rebuilt); the template's route variables are gone.
  * On the dev cluster: skibbity rebuilt, its route deleted, NiFi's UI and its 16 API calls answered under its path.
* **A workspace being deleted shines in the Workspaces table:** a soft band sweeps across its row, left to right
  every 1.2 s, over a faint tint of the theme's destructive colour, until it is gone (still with animations off). The
  table asks again every 10 s when no build is active (was 30), so a delete started elsewhere shows too.
* **Deleting a workspace with code-server HA no longer hangs for two minutes** on "Still destroying" its home volume.
  The code-server-replicator's instance pod mounts that volume, and was only removed after a stopped workspace's wait
  (two leases) plus the pod's 30 s to end. Now a workspace whose home volume is being deleted loses its instance on
  the replicator's next round, its pod ending within 5 s (a restart, its volume still there, waits as before). The
  replicator may read volume claims (get only). On the dev cluster: the volume went in 35 s (was 1m56s).
* **One platform route, `coder-enhanced`:** the platform service's HTTPRoute (was `coder-ui-updates`) now also carries
  `/__icons/`, the workspace template's icons, so coder-workspace's own `coder-workspace-icons` route is gone (its
  new `icons.httpRoute`, on by default for the chart alone, is off in coder-airgapped). Routes beside Coder's own:
  `coder-enhanced` only. A static check keeps it so (157).
* **platform.108:**
  * **The workspace grid.** Lock the Controls menu's Workspaces list open (hold through the ring, or double-click):
    * a workspace's row then ticks it (its arrow, at the row's end, still opens its page), with Select all / Clear;
    * "View N in a grid" opens the ticked workspaces together in a window over the page, the page blurred behind it;
    * each cell is the workspace's dashboard alone, live - its agent card(s), the rest of its page (top bar, side
      bar, resource strip, notes) left behind - scaled to fit the cell's width and height, whole (never a
      scrollbar), and centred in it; one fills the window, two sit side by side, three or four make a 2x2;
    * the grid sits over the floating chat bar too: the bar goes under the blur with the rest of the page;
    * with more than four, the cells keep that size and a hand grabs and drags the grid round to the others (the
      wheel scrolls it too); the dashboards are pictures to drag by until one is clicked, which makes it usable;
    * the browser remembers the choice; a link out of a dashboard, or a cell's arrow, goes to that page and closes
      the grid;
    * a dashboard page in the platform's own frame has no navbar, banners or deployment bar. A page never knew it
      was in such a frame (the check compared the frame with the wrong window's element type), so the frame also
      showed its own classification bars, chat and background.
  * **The Workspaces list** shows each workspace's template in a pill beside its name (the grid's cells too). Each
    template keeps one colour wherever its pill shows: DEFAULT green, the others picked from their names among
    colours clear of green (DATAFLOW sky blue).
  * **The Workspaces list's template pills line up** in one column: every name is as wide as the widest (up to
    120px, cut short beyond and whole on hover).
  * **The quick access wheel:** each petal lights in its own colour when pointed at, focused or chosen (emerald
    first, then sky, violet, amber...; neighbours never alike), the hub's icon too; with nothing pointed at, the hub
    shows a hamburger instead of the compass.
  * **The Controls menu**, Settings down to the Network graph, sits in one rounded, bordered box under the
    Workspaces row (the separator above it is gone).
  * **The locked Workspaces list** lets go of a press elsewhere in the menu when the press ends. Sliding shut at once,
    it brought another item under the pointer, which the release then chose (Appearance, in a test).
  * **The Workspaces table has a Resources column**, right beside the names (Name is as wide as they are) and
    centred, for each running workspace:
    * its CPU and RAM as small live bar graphs (its last 12 readings, each bar coloured by its level, as on its page),
      each with its share now, their corners rounded and the bars cut to them;
    * its disk as a segmented bar of what is used of what it was given: 16 segments, as many lit as the share used,
      each in the theme's success, warning or destructive colour for where it sits, the bar's ends rounded, with both
      figures under it;
    * the readings are its agent's (the page's Workspace group), a new bar about every 10 s away from its page; a
      workspace that is not running shows a dash.
  * **Toasts** show in the bottom left corner, clear of the chat bar, and smaller (288px wide, smaller text), 12px
    above whatever bars run along the bottom (the deployment's bar, the classification bar), measured as the chat
    dock measures them.
  * **The announcement terminal** (the banner's arrow):
    * its title bar says "Broadcast Announcement", centred, without the red, yellow and green window buttons or the
      file name;
    * the `cat broadcast.md` line is gone: the message, then the one prompt;
    * a hidden command, `time`, prints the time now on a dot-matrix display (5x7 dots a character, the lit ones
      glowing in the terminal's ink, the colons blinking with the seconds), ticking, with the date and time zone.
  * **Chats settings: Export**, beside Purge all Chats, downloads every record as one JSON file: messages, groups and
    their members, read marks, focus acknowledgements and the settings. Admins only; logged as `chat-exported`.
  * **The workspace page's Cloud Drive glyph** opens the user's Cloud Drive window, centred over the blurred page.
  * **The workspace page's metric readings** (`0.2 / 2 cores`...) are centred under their graphs.
  * **btop's disks panel shows the workspace's own disk.**
    * It was empty: btop takes its disks from `/etc/fstab`, which a container leaves unconfigured, and counts
      "physical" filesystems only. A btop configuration still on btop's defaults now gets `use_fstab = false`,
      `only_physical = false` and `disks_filter` = the home (the workspace's own disk; the others are the node's).
    * Only the user's `~/.config/btop/btop.conf` changes: `/etc/fstab`, the mounts and their permissions are
      untouched.
    * Where the cluster's volumes are folders of the node's disk (local-path, hostpath: minikube, kind), the home
      read as the node's whole disk (935G). A small library built at start (`scripts/home-statfs.c`, preloaded by a
      btop wrapper in `~/.local/bin`) answers for the home with the volume's size and the home's use, as the Disk
      metric measures them (`metadata.sh` writes them to `/tmp/coder-home-disk`). On a real volume (EBS...) there is
      no such file and nothing changes. Only btop's own process loads it.
    * The startup script keeps that file fresh itself too, every minute (the Disk metric's own measurement): an agent
      without its metadata (a DATAFLOW workspace on the dev cluster, after the database lost its rows) had none, so
      its btop still read the node's disk.
* **platform.107:**
  * **The attached chat** runs up to the classification bar (the window's top without one). The navbar narrows
    beside it like the page, its items sizing to what is left. On a wide screen only: below 1024px the panel lies
    over the page's right edge, from below the navbar.
  * **code-server HA, switched per template** in Settings › Network › code-server HA:
    * every template with a `code_server_ha` variable has a switch;
    * a switch makes a new version of the template (the active one's files and variables, the variable changed),
      made active, and its workspaces follow at their next start;
    * the chart's template push keeps each template's setting (it used to push the default, off);
    * on the dev cluster, DEFAULT now runs it: its workspace's code-server is an instance of its own, behind a relay;
      with that instance lost, a new generation served again 6.8 s later.
  * **The workspace page's Cloud Drive glyph** is grey like "Open ports":
    * connected, a green glow sweeps across it every 2 s;
    * disconnected (it now shows), its edge pulses red and the cloud frowns, crossed out.
  * **The Workspaces table's attaching cloud** is bigger (32px), its plug drawn bold enough to read, and centred on
    the whole status, so in the middle of the row.
  * **Cluster Network:** the mesh's components carry the same icons as the map's chips.
  * **Drawers** (an entity's details, ...) open inside the classification bars, not under them.
  * **The Appearance backgrounds** (the dashboard's and the sign-in page's): Upload with an arrow. The arrow opens
    the image store in a centred dialog (five columns, four rows in view, scrolling) instead of its tiles on the page,
    so the animated previews load only while it is open.
  * **The image store** has 24 more pictures (54 in all; the owner's `baked-in-images`), each with its preview.
  * **The announcement terminal's broken screen** has no note or button: any key (or a click) restores it.
* **platform.106:**
  * **The announcement banner could not be turned on.** On an empty banner (the chart's defaults, or after a reset)
    the Show banner switch refused, and said why only at the bottom of the page. Now:
    * with a message written, turning it on publishes it, showing;
    * with nothing written, it says so beside itself and brings the message box into view.
  * **The navbar:**
    * The HUD | latency split button now reads: the latency in a pill, then "Controls". There is no separate
      Controls button.
    * Its menu starts with the Workspaces row: the icon, word and count in a pill as wide as the menu.
      * Pressed and held, it slides down the workspaces with their latency, while a ring draws round the pill's
        border (hold to confirm).
      * Held through the ring (0.8 s), the list locks open, the ring green, until a press elsewhere. A double click
        locks it too.
    * Below that comes the whole Controls menu, graphs last.
    * The logo sits in the same tile as the avatar, cropped to a squircle unless its corners are transparent.
  * **The chat console** opens centred over the page from the chat bar's console button, the rest blurred like the
    quick access wheel. Escape there no longer also opens the wheel.
  * **The Cluster Network view:**
    * pods and Services are coloured by kind, each with an icon of what it is right of its colour mark (a database,
      Traefik a network, the image registry a container...);
    * every pod, Service, node and line opens its details;
    * a code-server HA and storage card;
    * a mesh of the components with measured latencies (edges that can't be measured say why);
    * a node topology card;
    * the platform service reads Services, events, persistent volumes, EndpointSlices and CSI drivers (new
      read-only rules).
  * **The workspace page:** its Cloud Drive glyph sits just left of the Uptime pill.
  * **The tab row is gone** from Workspaces, Templates and Images: the navbar's Resources menu already has them.
  * **Images:** a finished scan is deleted with its row's trash can, after a confirmation.
  * **A terminal:**
    * a shell that exits (`exit`, `logout`, Ctrl-D) closes Coder's terminal window instead of reconnecting into a new
      shell; a window the browser keeps open says the session ended;
    * the workspace page's Terminal panel already rolls up.
  * **File Browser** always opens with its sidebar hidden: the user's `stickySidebar` is turned off at every start.
    Its config refuses the key as a default; a static check now guards that.
  * **code-server HA, measured on the dev cluster:**
    * when the active instance's pod was lost, code-server answered again 2.6 s later (a new generation);
    * the open IDE asks to reload its window, as VS Code can't resume a session on a new server process.

Earlier in this release (platform.105, the bake-in's first step, the VM's 1.45.0 findings):

* **The template lock-down** (the owner's report: the template settings' Permissions card said "Template permissions
  is not enabled on this deployment"). Coder's template permissions are a Premium feature, and the platform runs the
  open-source build. So the card is now the platform's own lock-down:
  * a switch locks the template to the members listed and its admins;
  * members are added and removed in the card;
  * it uses the same access list as the Templates table's Access menu, which gains a `restricted` flag: locked with
    nobody listed means admins only.
* **The workspace page:** the Build timeline is the last agent card's footer, under its last panel, made like the
  table cards' footer. A grip with jimping in its middle is pulled down to open it (a click works too). It starts
  collapsed.
* **The Workspaces page:**
  * the search's left edge and the Cloud Drive's right edge line up with the table's;
  * the Cloud Drive's usage sits in a pill;
  * files dropped on the Cloud Drive upload to it;
  * while the user's own drive is shared, its cloud's outline is a line of blue dots marching round it, with a
    breathing blue glow.
* **The chat:** the Chats bar raises into a small window, as in Gmail. From there it can be:
  * attached to the right side, from the navbar down (the page narrows beside it; conversations open in it);
  * made full screen;
  * minimized back to the bar;
  * opened in the admin chat console (admins).
* **Bake-in, step 1 (ADR-0002):** the workspace pods' admission webhook (`platformWebhook`, off by default). It adds
  Lock Down, the cluster's CA, the Cloud Drive and the code-server relay to any workspace's pod, including Coder's own
  Kubernetes example. It runs as two replicas with `failurePolicy: Fail`. On the dev cluster a plain upstream template
  got every piece and its agent connected (9/9).
* **The VM's 1.45.0 findings:**
  * `pull-public-images.sh` saves the public images into the release folder on a connected machine;
    `push-images.sh` pushes them with ours (`IMAGES-public.txt`, `SHA256SUMS.public`).
  * `INSTALL.md`:
    * `helm install --timeout 20m` (Helm waits for the first owner and the templates; past its 5-minute default
      the release is marked failed);
    * the local-path helper image to pull before going offline;
    * the issuer's DNS from inside the cluster;
    * Released Cloud Drive volumes of former accounts.

## 1.45.0 – 2026-10-20

Coder `2.0.0-platform.104` (fork `ad1866e1c`). **The one-step install** (the owner's goal): on any air-gapped cluster
whose registry holds the public images, push the release's images, then one `helm install` with one values file,
under any release name and in any namespace.

* **The release carries our images only** (the owner's choice): carrying the 9 public ones too failed the CVE gate
  with 1,386 findings their projects have fixed upstream (29 critical; about half in Go libraries inside their
  binaries), none in ours. So the gate covers what is ours, and `INSTALL.md` step 1 lists every public image the chart
  runs - with high availability and its bundled prerequisites too - at the path and tested digest your registry
  must hold it; their CVEs are their projects'.
  * `push-images.sh` pushes ours to where the chart pulls them (`--ours-only` stays, for a release folder with
    public archives added by hand).
  * The release folder now ships `values.example.yaml`: every input of the install in one file.
* **The chart can bring its own prerequisites** (`global.bundled`, off by default; on in `values.example.yaml`):
  * **Traefik 41.4.0 with the Gateway API v1.6.0 CRDs.** Its Gateway is in the release's namespace, on the chart's
    own wildcard certificate. It runs the Gateway API provider only (no Traefik CRDs, no Ingress).
  * **The CloudNativePG operator 0.29.0** and its CRDs.
  * **How the CRDs ship:** both charts are vendored with the platform patch, so their images follow
    `global.registry`. Their CRDs are in `crds/`, with the schemas' documentation strings taken out: Helm keeps the
    whole chart in its release Secret (1 MiB), and the packaged chart is about 290 KB.
  * **The database with the chart's own operator** is created by a Job that retries until the operator's webhook
    answers. Helm would otherwise create it before the webhook is up and fail the install. Uninstall removes it
    first (a pre-delete hook).
  * **Existing installs are unchanged:** without `global.bundled`, the database renders as before (checked
    byte for byte).
* **Certificates:** `secrets.generateTls` makes a CA and the wildcard certificate when none are given. They are made
  once and kept across upgrades.
* **In-cluster DNS** (`global.inClusterDNS`, off by default) is for a cluster that does not resolve the domain. A Job
  adds anchored rewrite rules for Coder's host and the wildcard host to CoreDNS, pointing at the Gateway, and
  uninstall takes them out. Workspace agents and Coder itself then reach Coder by its URL.
* **Any namespace, any release name:**
  * The workspace template takes any namespace (a DNS label), where it took only `coder`.
  * The workspace subchart defaults to the release's namespace.
  * The platform service recognises Coder's pods by the release's own name.
  * The Keycloak and Argo CD views' Roles are made only where those namespaces exist.
* **Proven end to end** (`development/tools/onestep-e2e/run.sh`) on a bare 2-node kind cluster with all non-private
  egress blocked and nothing preloaded:
  * `push-images.sh` to a site registry, then exactly `helm install coder-fork ... -n coder-fork --create-namespace
    -f values.yaml`;
  * `helm install` returned in 75 s, and the database was up at 70 s;
  * no restarts, and every image came from the site registry;
  * HTTPS through Traefik's NodePort was trusted by the chart's own CA;
  * the owner signed in, both templates were pushed, and a DEFAULT workspace's agent connected in 110 s.
  * **14/14**, and the same after an uninstall (133 s, the DNS rules and the database removed) and a reinstall.
* **Reinstalling no longer leaves every workspace Pending** (found on the VM): the Cloud Drive's volumes, kept
  (Retain) from the earlier install, are adopted by the new install's claims. A volume still bound to a live claim
  elsewhere is not taken.
* **Coder waits for its database** (an init container), so a fresh install no longer restarts it once.
* **The radial menu's hub** shows the pointed-at item's icon above its name, centred.
* **Checks:** 148 static (12 for the one-step install, among them the bundled CRDs and the chart's size), 156 unit.

## 1.44.0 – 2026-10-20

Coder `2.0.0-platform.103` (fork `365fa0db2`): **the open-source (AGPL) build of Coder** (Platform HA phase 3, step 1;
the owner's choice). The workspace images are 1.43.1's.

* **No Enterprise code in the image**, so no licence gate. The platform's own active/active high availability (next)
  can run several Coder replicas without the unlicensed Enterprise binary's permanent error ("multiple replicas but
  high availability is an Enterprise feature"), which may not be hidden. `coder version` says `Coder (AGPL)`.
* **What changes in the dashboard** (where the Enterprise binary answered unlicensed and the open-source one has no
  route):
  * Workspace sharing follows the organization's own setting (everyone by default), and the Share dialog and Sharing
    card work through the open-source ACL routes.
  * A notification template's delivery method shows read-only (its default).
* **Also gone:** audit and connection-log rows (nothing read them), 90-day dormancy, and adding a licence.
* **Live:** the open-source checks 11/11 (sharing a workspace with a member, the Sharing page, the notification events,
  no licence error); HA 15/15 (a crash back after 9.4 s, a rolling restart 1.9 s), Keycloak, the banner, the logo.

## 1.43.1 – 2026-10-20

Coder `2.0.0-platform.102` and every image as 1.43.0's: a chart and documentation release (found installing plain Helm
air-gapped on a 2-node VM).

* **Uninstalling no longer hangs on the Cloud Drive.** Workspace pods that mounted a Cloud Drive used to keep the
  namespace in Terminating: Helm removed the CSI driver's node plugin while those pods still had volumes it alone could
  unmount.
  * **The fix:** a pre-delete hook (Helm `pre-delete`, Argo CD `PreDelete`) first scales every Deployment whose pods
    mount a Cloud Drive volume to 0, deletes any other such pod, and waits until they are gone. It never fails the
    uninstall.
  * **Measured** with a running workspace that mounted its owner's Cloud Drive: `helm uninstall` took 9 s, then the
    namespace was gone in 246 s, with no GeeseFS mount left and the volumes Released (the files stay).
  * **Docs:** INSTALL.md step 5 and DEPLOY.md give the order (`helm uninstall` first, then the namespace) and the
    recovery.
* **A single-label domain** (`vm`, `lab`) without `global.wildcardHost` is refused with advice: browsers reject a
  wildcard certificate and cookies directly under it, so use e.g. `*.coder.vm`.
* **The in-cluster DNS rewrite is anchored** to the domain (`^(.+)\.<domain>\.?$`): in `./make`, INSTALL.md and
  the e2e kit. A short domain no longer catches other names.
* **INSTALL.md:** what a minikube started offline needs besides the images (kicbase, the preload, the storage addon's
  images).
* **Checks:** 136 static (4 new), 153 platform unit (the hook against a fake API).

## 1.43.0 – 2026-10-20

Coder `2.0.0-platform.102` (fork `5ec304d58`); the workspace images as 1.42.0's (workspace 1.9.4, dataflow 1.1.4).

* **The announcement banner is Coder's own; nothing rewrites a response any more** (the owner's rule: no Traefik
  response-body rewriting, in any mode). Coder serves `/__banner` itself (fork `coderd/platformbanner`):
  * **What it serves:**
    * `banner.json` for every page;
    * the live WebSocket (the banner at once and at every change, a heartbeat every 20 s);
    * the admin calls behind Admin Settings › Announcement, for whoever may edit the deployment's settings.
  * **Contract:** the same as the banner service's (cross-site checks, JSON, error texts), and the banner's id is
    byte for byte the service's, so dismissals and receipts carry over.
  * **State:** kept in Coder's database (one runtime-config entry) and announced on Coder's pubsub, so every replica
    pushes a change to its own tabs.
  * **"Show again"** now works for an announcement that is only a picture or a countdown.
  * **Gone:**
    * the `coder-banner` subchart (its Deployment, Service, 5 ConfigMaps, RBAC and HTTPRoute, a Python pod) and its
      6 Traefik Middlewares, the two that rewrote Coder's HTML and JavaScript among them;
    * the `rewrite-body` local plugin, so Traefik's reference values (`prereqs/`, the release folder) are stock
      Traefik.
  * **Upgrading:** the published banner starts empty again; publish it once more in Admin Settings › Announcement.
  * **Guarded by static checks:** no rendered Middleware runs a plugin, under every values scenario, with the platform
    service off, and in the decorator's base and layer; no Traefik values load a plugin; no banner subchart.
* **Platform HA phase 2: the senior standby takes over.** A lapsed active lease goes first to the longest-running
  ready standby (anyone after one more lease). A crashed leader's container, restarted in place, therefore does not
  win the lease straight back, and a crash-looping pod cannot keep retaking it. A leaving replica reports itself
  draining at once.
* **Checks:** 132 static, 151 platform unit (the banner service's Python tests replaced by Go tests in the fork,
  against the Python service's ids).

## 1.42.0 – 2026-10-20

Coder `2.0.0-platform.101` (fork `98c3d3f4c`); the workspace images as 1.41.0's (workspace 1.9.4, dataflow 1.1.4).

* **Platform HA phase 2: active/standby Coder** (fork `coderd/platformha`, Community code; chart
  `global.platformHA.mode: activeStandby` with `coder.coder.replicaCount` 2 or more, off by default;
  `values-ha.example.yaml` turns it on).
  * **One replica runs Coder; the others wait warm.** They don't start Coder until their turn, so an unlicensed
    deployment never runs two Coder replicas and never reports the multiple-replicas entitlement error. The active
    replica holds the lease `coder-active` (compare-and-set, fenced like the registry lease).
  * **Routing:** the active pod is labeled `coder-airgapped/ha-role=active`, and the coder Service selects that
    label. The active pod also has a higher `pod-deletion-cost`, so rolling updates remove the standbys first.
  * **Health server** on port 2113: probes `/livez` and `/readyz` (a standby is ready, so rollouts never wait on it),
    plus `/status`.
  * **Rolling updates:** the preStop hook calls `/handover`, which only acts while the pod is terminating. The
    successor starts Coder and takes traffic before the leader lets go.
  * **Crashes:** a standby watching the lease takes it once it lapses. A replica that loses the lease any other way
    exits and comes back as a standby.
  * **RBAC:** Coder may read and label its own pods (Role `coder-platform-ha`).
  * **Measured live:** a crash is back through Traefik after **12.3–12.8 s**; a rolling restart has **about 2 s**
    without Coder (1.9–2.1 s; the old pod leaves the endpoints the moment it is deleted); no entitlement warning.
  * **Tested:** a full uninstall and reinstall of the coder namespace, and sign-in with Keycloak.
  * **Tests:** 9 against PostgreSQL, 20× under the race detector:
    * a crash takeover;
    * a handover with the successor serving before the leader lets go;
    * a standby or successor leaving mid-rollout;
    * the let-go lease kept for the successor;
    * a void claim stopping Coder.
  * Switching a running install to activeStandby costs one Coder start of downtime.
* **The release folder installs on its own** (from a plain `helm install` on a fresh 2-node minikube):
  * **Prerequisites shipped:** the Gateway API CRDs, Traefik's chart with its reference and HA values, and
    CloudNativePG's chart, with INSTALL.md's new step 0. Traefik's values use the TLS Secret `coder-airgapped-tls`.
  * **INSTALL.md covers:**
    * in-cluster DNS (a CoreDNS rewrite);
    * `metricsServer.kubeletInsecureTLS` for self-signed kubelets;
    * the optional logo;
    * loading images into a node without a registry.
  * **Defaults:** the database's and the platform service's storage classes default to the cluster's (`""`). An
    existing volume keeps its class.
* **code-server HA's replicator waits for the database** on a fresh install instead of crash-looping: while it is
  refused or starting up, and while the other replica creates the same schema at the same moment.
* **The install NOTES** no longer point at template-push Jobs, which are deleted once they succeed.

## 1.41.0 – 2026-10-20

Coder `2.0.0-platform.99` (fork `f69299bdc`); the workspace images as 1.40.1's (workspace 1.9.4, dataflow 1.1.4).

* **Platform HA phase 1: the replica registry** (fork, `coderd/platformha`, Community code; chart
  `global.platformHA.mode: registry`, off by default). Each Coder replica holds a lease in PostgreSQL (schema
  `platform_ha`, not a Coder migration) under an epoch, renewed by compare-and-set every 3 s for 10 s. A replica that
  cannot renew fences itself by a timer of its own a full renew interval before its lease can end - measured from the
  renewal's start, every database call cut off by that deadline - and rejoins under a new epoch when the database
  answers; one whose row was taken fences at once. It leaves the registry when it stops. Metrics
  `coderd_platform_ha_{fenced,epoch,members,lease_renewals_total}`. Tested against PostgreSQL 25 times over under the
  race detector: a replica fences with 297-301 ms of its lease left (the 300 ms interval of the test); live on the dev
  cluster (one lease, its pod's name and IP, renewed; a restart leaves and rejoins under a higher epoch).
* **The platform's logo is a baked picture of the image store**: `minecraft-cube.gif` (the Minecraft grass-block
  cube, the logo set on the reference deployment) ships in every platform service image - 30 provided pictures now -
  offered by every picture chooser; a static check keeps it there.
* **Platform HA ([ADR-0001](docs/adr/0001-platform-ha.md), accepted): phase 0, the infrastructure part** (chart; all
  opt-in through `values-ha.example.yaml`, nothing changes by default but a budget for the code-server-replicator):
  * the database's **synchronous replication** (`database.synchronous`: a commit waits for one standby, so a failover
    loses no committed transaction);
  * **PgBouncer** in front of it (`database.pooler`, a CloudNativePG Pooler: 2 pods, transaction mode, image
    `ghcr.io/cloudnative-pg/pgbouncer:1.25.1`, pinned in `images.txt`) for code-server HA's relays, whose connections
    then stop counting against `max_connections`; its name is added to the server certificate, which the relays verify
    (tested on CloudNativePG: TLS by name, parameterized queries and writes through it, an unlisted host refused);
  * **PodDisruptionBudgets** and zone spread for every component with more than one copy: the
    code-server-replicator (always), the banner and metrics-server (`metricsServer.replicas`), the pooler;
  * **Traefik's HA overlay**, `prereqs/traefik-41.4.0.ha-values.yaml` (2 replicas, spread, a budget);
  * `build-release.sh` lists the public images high availability adds in the release's INSTALL.md.

## 1.40.1 – 2026-10-20

Coder `2.0.0-platform.98` (fork `61769b225`); the images otherwise as 1.40.0's (workspace 1.9.4, dataflow 1.1.4).

* **DEFAULT is the basic template, with nothing of DATAFLOW's** (chart): its files are `main.tf` and the shared
  scripts only, naming no other template's app - its apps are Desktop, File Browser, code-server, the web terminal
  and Ports. DATAFLOW's own part moved to `files/dataflow/` (`dataflow.tf`: Apache NiFi and Apache Airflow, NiFi's
  route on the Gateway, Ghostty in place of the web terminal; `apache_nifi.sh`, `apache_airflow.sh`), in a ConfigMap
  only DATAFLOW's push mounts. `app_set` is gone: `main.tf` has `code_server` and `default_memory` like its `desktop`,
  `file_browser` and `terminal`, which DATAFLOW's push sets (code-server off, 6 GB, Coder's terminal off for Ghostty).
  `moved` blocks keep a DATAFLOW workspace's NiFi and Airflow objects as they were. Templates made in Create new
  template start from DEFAULT, so they have none of it either.
* **The Model Library and the garak model-scanner plug-in are removed** (service, fork, chart), as the AI workspaces
  are: the Images page has the ISO library only; the platform service drops `/api/models*` and the scan Jobs'
  `/internal/model-scans` routes, `modelscan.py`; the chart drops `modelScanner` and its `MODEL_SCANNER_*` settings;
  `development/garak-image/` and `build-garak-image.sh` are deleted. On an upgrade the `coder-models` PV/PVC the
  service created stay, unused (the PV is Retain), as do the bucket's `library/models/`, `library/quarantine/models/`
  and `library/scans/models/`: delete them by hand if wanted. The ISO library is unchanged (its "needs the Cloud
  Drive's storage" message reads right again).

## 1.40.0 – 2026-10-20

Coder `2.0.0-platform.97` (fork `1b6b14dbf`), platform service on `coder-image-tools:1.2.0`, workspace image
`coder-workspace:1.9.4`, dataflow image `coder-workspace-dataflow:1.1.4`, image registry `coder-registry:3.1.2-1`; the
model scanner `coder-garak:0.17.1-2` is a plug-in now (`dist/plugins/`, not in the bundle).

* **A slim release: our images and one chart.** The release is one folder (`coder-fork-1.40.0`,
  `development/tools/build-release.sh`): only the coder-fork images that run Coder - Coder, the platform service, the
  DEFAULT and DATAFLOW workspace images, MinIO and the image registry; split where over 2 GiB - with `push-images.sh`
  (verifies, loads and pushes them as `$REGISTRY/user187x/...`), `IMAGES.txt`, `SHA256SUMS`, `INSTALL.md` and the one
  chart, `coder-airgapped-1.40.0.tgz`, which installs everything with a single `helm install` (the Secrets from
  values, `secrets.*.create`; DEPLOY.md: A single `helm install`). No public image (NiFi and Airflow are inside the
  dataflow image; PostgreSQL, Python, BuildKit, the CSI driver, metrics-server, Traefik and CloudNativePG come from your
  registry, under the same paths), no rollback image. `build-release.sh --scan` is the release's CVE gate: trivy with
  fresh vulnerability and Java databases on every image, failing on any finding with a fix (`CVE-REPORT.md`).
  `build-bundle.sh` gained `--no-full` and `--parts` (tarballs written straight as parts of under 2 GiB).
* **No fixable CVE in any image we ship** (trivy, 2026-10-20's databases):
  * Coder (platform.97, 35 -> 0): Go 1.26.10, `golang.org/x/net` 0.60.0, `gomarkdown`, the OpenTelemetry exporters
    1.46.0; Terraform 1.16.6 built from its source with Go 1.26.10 (Coder's provisioner takes up to 1.16.9); the Alpine
    packages upgraded.
  * The platform service (97 -> 0): `coder-image-tools:1.2.0` - trivy 0.76.0; copa 0.15.0, regctl 0.11.6 and shfmt
    3.14.1 built from source with Go 1.27.3 (copa with trivy 0.72, containerd 2.3.7, grpc 1.83.2, x/net 0.60...); the
    Alpine packages upgraded; pip removed (its vendored urllib3/setuptools/msgpack had no fixed pip; nothing runs it).
  * The workspace image (1.9.4, 22 -> 0): File Browser 2.1.2-coder.1 rebuilt with Go 1.27.3 and x/net 0.60.0;
    code-server's KaTeX 0.18.2; Firefox's 16 Ubuntu snap-transition advisories are false positives for Mozilla's
    Firefox 158 (fixed in 98/113/138), declared `not_affected` in `development/workspace-image/firefox.openvex.json`
    (pass it to trivy with `--vex`); the build takes Ubuntu's phased updates (systemd 259.9), which apt otherwise held
    back, dropping packages.
  * The dataflow image (1.1.4, on 1.9.4): NiFi 2.12.0's vulnerable jars replaced inside its NARs (and their WARs) and
    `lib/bootstrap` before NiFi first unpacks them - Jackson 2.22.4 and 3.2.4, lz4-java 1.11.4, amqp-client 5.37.0,
    Wire 6.4.7 (the AWS NAR's Glue Protobuf serde) - each from Maven Central, pinned by SHA-256, and checked for no old
    jar left (`patch-nifi-jars.py`); the two jars that shade Jackson (no newer release of either), Hazelcast 5.7.0's
    and parquet-jackson 1.18.1's, are re-shaded with Jackson 2.21.8 / 3.1.8 and 2.22.4 by their own projects'
    relocation rules - checked in every build by re-shading the original Jackson and matching the published jar class
    by class - so the Hazelcast cache services and the Iceberg Parquet writer keep working (a cache put/get and a
    Parquet write tested); every processor and service still loads (294 / 125 / 10). Airflow's venv takes
    Mako 1.4.3, PyJWT 2.15.1 and urllib3 2.8.0 over its constraints (`airflow-overrides.txt`, `pip check` clean), and
    its pip is removed after the install (pip's own vendored libraries have no fixed release).
  * MinIO and the image registry: none to fix.
* **The AI workspace template is removed**: UBUNTU OPENCODE (`ubuntu-opencode`, OpenCode on Unsloth Studio) and its
  image `ghcr.io/user187x/coder-workspace-ai` are no longer built, pushed, bundled or listed in the Images view; gone
  too: `coder-workspace.aiTemplates`/`aiImage`, `build-ai-image.sh`, `development/workspace-image-ai/` and the Argo CD
  helper's `--ai`. DEFAULT and DATAFLOW are unchanged. A deployment that has the old template keeps it until an admin
  deletes it.
* **A template's Parameters card reads Dynamic parameters** (fork): on, as every template here uses them; the
  deprecated compatibility mode ("Rich parameters") shows its warning only when a template is in it.

* **Pit stop: Copa patches an image from the Fix image page** (service, fork, tools image), the page's first way in
  beside Dockerfile and Agent. [Copa (Copacetic)](https://github.com/project-copacetic/copacetic) v0.15.0 patches
  the image's packages in place - no rebuild - from its scan: the image pits in, its report is taken again (fixable
  findings only), Copa patches, the patched image is scanned, and it goes back on the track as the next version
  (`latest` retagged) - or, for an image only scanned here (the template images), as a patched copy
  (`<name>-patched`, tagged **Patched**, its own Pit stop button). OS packages always; Python packages too with
  library patching (Copa's experimental), each lap from the original image with the whole report and a library
  level further (patch, minor, major, up to the one chosen: as many laps as levels). pip refuses environments the
  distribution or uv manage (PEP 668), so for Python Copa patches a copy of the source whose configuration sets
  `PIP_BREAK_SYSTEM_PACKAGES=1` (the same layers; the Dockerfile fix uses `--break-system-packages` alike), taken out
  of the patched image again (checked live: an image with old urllib3 and requests in Ubuntu's system Python, 12 of 12
  findings fixed over three laps - patch, minor, major). Node.js packages are left out: Copa patches them through a tooling image from Docker
  Hub, and on the AI image that failed the whole patch. The page shows the pit lane (the car at its station, the
  laps with their grades, Copa's log, the pit time, Cancel) and the result (the grade before and after, the findings
  fixed, the reference workspaces pull); the Images list shows **In the pit · lap n/N**. Copa runs in a Job of the
  platform service's image beside BuildKit (a native sidecar), reaching the builder's registry through its own
  forwarder on `localhost:5000`; it writes a VEX document of what it fixed. Each lap's Jobs go as soon as it is
  done: BuildKit unpacks the whole image (about 30 GB of node disk for the 14.8 GB AI image while a lap runs). The
  packages come from the distribution's repositories and PyPI: the cluster must reach them or the mirrors the image
  names. `coder-image-tools:1.1.0` adds `copa`; a minikube deploy seeds the template images (workspace, dataflow,
  AI) into the builder's registry, since their GHCR packages are private.
* **The Workspaces, Templates and Images lists in rounded cards** (fork, GUI-UPDATES): the header inside the card,
  and a footer - what the list holds on the left ("Showing 2 of 2 workspaces · 2 running · 2 with Cloud Drive
  mounted", in place of the line above the table), and on the right one place for what any element of the table
  says on hover or focus (its hint, title or label) instead of a tooltip by each. The Workspaces table's columns
  as in the mockup: Lock Down, Name, Template (a pill), Status (a pill tinted with its colour, when last used under
  it), **Apps** (a frame as wide as four apps on every row, its arrows inside, the side with more apps lit faintly),
  **Controls** (the update and restart button amber, the row's menu) and **Drive**: each row's Cloud Drive socket
  - a plug while it has the drive (amber until attached), an empty socket while not; a click plugs it in or pulls
  it out, as dragging a cable does. Above it, the search and the Cloud Drive in one rounded bar without border lines
  (padded 10px, as far as the Chats card floats above the page's bottom bar), with rows selected their bulk actions
  too.
* **The quick access wheel** (fork; `radial-menu.html`): Escape opens a wheel over any signed-in page - the
  dashboard's and the full-page ones (the template editor, a terminal, the chat console window) - the page behind it
  under a see-through Gaussian blur, with a wedge for each part: Workspaces, Templates, Images (the Resources menu's
  icon), Users, Account, Chat (the chat console for admins, the Chats panel for the others), Announcement and HUD,
  each going straight there. Pages a user may not open show dimmed ("Admins only"). Escape opens it always - from a
  field, and with a menu or dialog open (that closes as it would, then the wheel opens) - but in a terminal, whose
  programs need Escape: there Shift+Escape (which works anywhere). Escape again or a click off the wheel closes it;
  the arrow keys go round it and Enter opens.
* **Quick Menu** (fork, service; Admin Settings > Quick Menu): admins arrange the quick access wheel's wedges -
  which choices, from the dashboard's pages (Workspaces, Templates, Images, Account, Chat, HUD) and every admin
  category (Accounts, Announcement, Appearance, Authentication, Classification, Health, Monitoring, Network,
  Notifications, OAuth2 Applications, Observability, Persistence, Quick Menu, Security), in what order, 3 to 12 -
  beside a live preview of the wheel; Save gives everyone that wheel, Reset to default the eight. A wedge someone
  may not open shows dimmed for them; long names are set smaller to fit their wedge. Kept by the platform service
  (`/__coder-ui/api/quick-menu`).
* **The image store** (service, fork, platform service image): one store of pictures behind every picture chooser -
  the announcement's image (its Upload image arrow), the dashboard's and the sign-in page's backgrounds, avatars, the
  logo and template icons (Image store, beside Upload). It holds 29 provided animated pictures baked into the platform
  service's image (`development/image-store`, 155 MB, a layer of its own under the code's so later builds do not ship
  it again), the pictures baked into the dashboard, the gallery's, and every picture uploaded for the announcement.
  The choosers show small animated previews (`thumbs/`, 2.6 MB in all) rather than the pictures. A background keeps a
  store picture's address; an avatar, logo or icon is resized from it as from an upload. Served publicly (the sign-in
  page shows them) and streamed: `/__coder-ui/image-store/<name>`; listed at `/__coder-ui/api/image-store`.
* **The banner's terminal in the banner's colours** (fork): the announcement's full view (its fake terminal) takes
  the banner's background and text colours, and the banner's background picture - an animated GIF moving - runs
  across its screen too, with the banner's fit (span: rolling), under a light veil so the text stays readable.
* **The Workspaces bar see-through** (fork): the bar holding the search and the Cloud Drive has no background.
* **DATAFLOW's terminal is Ghostty** (chart, fork): the template's web terminal is replaced by the **Ghostty** app,
  wherever the Terminal was (the Workspaces table's apps, the workspace page, the template's apps panel): it opens
  the same session in Coder's terminal page, in its own window, a login shell in the Start folder - drawn by
  Ghostty's terminal emulator ([ghostty-web](https://github.com/coder/ghostty-web), Ghostty's own VT engine in
  WebAssembly, bundled into the dashboard: nothing fetched at run time; Coder's Content-Security-Policy adds
  `'wasm-unsafe-eval'` to `script-src`, which lets WebAssembly compile and nothing else). Any terminal of an agent that has the app
  (the workspace page's terminal too) is Ghostty's. The template variable `terminal_app` (`web` or `ghostty`) sets
  it; the chart's `coder-workspace.dataflowTemplate.terminal` is `ghostty`. Existing DATAFLOW workspaces get it at
  their next update.
* **`/dev/mouse`** (fork): run at the announcement banner's terminal prompt, it turns the mouse pointer into sparks
  (codepen-effect-sparks.html, Nik Rowell's pen, MIT) - on a see-through layer the pointer passes through, so the
  dashboard is used as usual - until any key is pressed.
* **The top bar** (fork): its controls rounder; the announcement banner rounder, its expand and close buttons both
  at its right; the HUD and the latency menu one split button (the HUD's link, then the latency and the menu's
  chevron) for admins; every dropdown's chevron smaller and fainter. **The bottom**: the Chats panel a floating
  card clear of the bar ("0 unread"), and the bar's "a few seconds ago" in a pill.
* **UBUNTU is DEFAULT** (chart, docs, fork): the base template is `default` (DEFAULT), as it was renamed on the dev
  cluster; a cluster that still has `ubuntu-vnc-desktop` (UBUNTU) has it taken over and renamed at its next deploy
  (its workspaces and history kept). The dataflow template's default display name is DATAFLOW.
* **Fixed: renaming the base template in the dashboard switched off the template builder's base and the template
  decorator** (fork): both looked it up by its configured name only, so after `ubuntu-vnc-desktop` became `default`
  Create new template had no base and other templates got no platform sections (Lock Down, the certificate, the
  Cloud Drive, the metrics). They now record its ID and follow a rename.
* **A template's page is its Source Code** (fork): the Overview and the tabs are gone (Prebuilds aside, where on). The
  template's address, and the old tabs' (Overview, Docs, Resources, Details, Versions), open Source Code for those who
  may edit it and New workspace for the others. At its top, the apps a workspace of it gets, in the files' panel
  style - the agent, its OS and its resource in the header, the apps as centered tiles - and the file tree and files
  take the height the tabs had.
* **Latency and Activity on the Accounts table** (fork), from the Overview's "by user" panels: each user's median
  latency (95th percentile on hover) and time connected (a bar against the busiest), over the last seven days and
  every template, before Status; not shown to those who may not read the insights.
* **Who may see and use a template** (fork, the Templates table's **Access** menu): a user search and a tick per
  account, saved as you pick; only the ticked users see the template and create workspaces from it, none ticked:
  everyone; its editors (owners, template admins) always may. Coder's own template permissions are a Premium feature
  this deployment is not licensed for, so this is the platform's own list (`/api/v2/templates/{id}/access`, in the
  runtime config), checked by the templates lists, a template read by ID or name and its versions by name, and a
  workspace's creation for its owner. Workspaces made before a user was left out keep running.
* **Old images cleaned up** (dev host and node): the superseded platform, platform-service, workspace and dataflow
  builds (~24 GB); the last release's (v1.39.1) stay in the node for the next layer bundle, and workspace image 1.9.2
  while a workspace runs it.
* **Fixed: a Cloud Drive connected or disconnected on the Workspaces page took up to minutes to reach the
  workspace.** The workspace followed its pod's annotation through the downward API, and the kubelet sometimes took
  over 90 seconds to update that file (seen on the dev cluster). The platform service now also tells the running
  workspace at once, by exec (`cloud-drive.sh push`), and the workspace follows whichever of the two was written last:
  the change is in the workspace within a second, and the annotation still decides when a push does not arrive (a
  template version from before it, a workspace still starting: pushed again for a minute). Checked against an
  annotation file left stale: disconnect about a second, connect under one, no flapping back when the file catches up.
* **The Cloud Drive attaching, on the Workspaces page** (fork, service, template): beside a running workspace's
  Running, an orange cloud with an unplugged plug in it, glowing and pulsing, while its Cloud Drive is connected but
  not attached in its container yet; its cable stays red as long. The workspace says it itself
  (`cloud-drive.sh status`: attached, waiting, unanswered, offline, ... - its agent's metadata `cloud_drive`, in the
  Cloud Drive's platform section, so templates made in Create new template have it too, and no metric display); the
  service reads it from Coder's database for its connections (`attachment`), and the page reads them every two seconds
  while one waits - and again at once as one of your workspaces starts or changes state (platform.86: .85 read them
  only when the page opened, so a workspace started after that showed neither until it was attached). Workspaces need their template's new version (DATAFLOW, UBUNTU) to report it; until then they show
  no cloud.
* **More than four apps in a carousel** (fork, the Workspaces table): four at a time, an app at a time - its arrows,
  the arrow keys, a sideways scroll - with a bar for where it is; the apps out of view are not tabbed to. Before, the
  apps past the fourth were left out (DATAFLOW has five with the Terminal). The update and restart buttons stay to its
  right, never in it.
* **The template's startup script, decoupled** (template DEFAULT, and every template the chart pushes): Apache NiFi
  and Apache Airflow start in scripts of their own, `apache_nifi.sh` and `apache_airflow.sh`. Each is a `coder_script`
  of the dataflow template only, shown in the workspace's Logs under its own name, with a failure of its own (NiFi's
  start log is shown when it does not start). The startup script no longer knows of them (whether the template has
  code-server comes as its own value). The scripts run side by side, so Airflow's line in `~/.bashrc` waits for the
  startup script's default `~/.bashrc` (added first, it would have kept the default out).
* **The Cloud Drive in one script** (`cloud-drive.sh`): the link and the watcher that follows it, the drives shared
  with the owner, the `cloud-drive` command's install, and which drives File Browser shows. At start it writes itself
  (that start's values and its functions) to `/tmp/coder-cloud-drive/cloud-drive.sh`, which runs the watcher and
  answers File Browser. File Browser's helper (version 5) asks it which drives are here, where their links are and
  where they lead, instead of knowing the drives' paths itself; the startup script no longer passes the drive's link.
  The `cloud-drive` command stays its own file, because the platform service runs the same one. Checked by running
  the old and new scripts as the agent does, in the dataflow image with no network: the same links, the same File
  Browser sources and rules (an older File Browser build too), NiFi, Airflow and File Browser answering, the drive
  followed off and on, and no script holding the agent's output open. An older startup script (a template made in
  Create new template keeps its own) works with the new Cloud Drive script. New chart checks keep the layout.
* **Fixed: a workspace set to Serenade started Classic** (template DEFAULT, the dataflow image): the dataflow image
  1.1.2 was built on a workspace image from before the desktop themes, so it had no `coder-desktop-theme` and the
  choice was skipped. Rebuilt as `coder-workspace-dataflow:1.1.3` on workspace image 1.9.3 (NiFi and Airflow offline
  checks passed). A theme an image cannot apply is now said in the startup log (a chart check keeps it), not silent.
* **Images: the ways into fixing an image** (the TASK design `images-list.reference.html`; fork and service): an
  image graded D or F that fixing would raise is tagged **Needs fixing**, its Security cell says "31 fixable → B", and
  its row has **Fix CVEs**; others with fixable high or critical findings have **View fix →**; the header's "N images
  need fixing" narrows the list to them. "Fixable" counts what Fix image can fix - OS and Python packages - not the
  packages inside programs the image ships (Go, npm, Java: a newer release of the program fixes those), so the list's
  projected grade is the one the page reaches (platform.84; .83 counted every fixed version). The service's summary
  gives `fixableCounts`, `fixableHere`, `projectedGrade` and `needsFixing` (scans record each finding's package
  class, type and path).
* **Fix image** (`/images/<id>/fix`, the TASK design `image-fix.reference.html`): the findings grouped by how they get
  fixed - upgrading a package (apt, or pip in the package's own environment), rebasing (OS packages the base brought),
  a newer add-on (Go, npm and other programs' packages), no fix yet - all fixable ones selected, the grade after the
  selection beside the grade now, the 5-step pipeline, the Dockerfile change, and **Apply N fixes, rebuild and
  rescan**: an installation step added to an image built here (or to a fixed copy of an imported image or the
  workspace image) and built, which scans it again. An image scanned in place is offered for import first. Activity
  shows its scan, builds and arrival. Handing the fixes to an agent, opening a pull request and accepting a risk have
  no backend yet: their controls are shown off, and their API is proposed for review in `docs/fix-image-api.md`.
* **Fixed: a template's Parameters usage repeated itself** (fork, the template's Overview): the insights report
  counts a parameter once per definition, so every template version with other options or wording added another card
  (UBUNTU's Workspace image had 8, CPU and Memory 2 each). Now one card per parameter, named, described (in plain
  text, not its Markdown) and ordered as the active version has it, its values' counts added up; a value the template
  no longer offers says so, and a parameter it no longer has is marked.
* **Fixed: At a glance overflowed with a long value** (fork, the settings pages): a version's name without spaces
  (troubling_holmes10) ran past the panel; it now breaks after its _ or - and never past the edge.
* **Create new template keeps to seven modules** (fork): on the deployment's base, the module step offers Git Clone,
  Dotfiles, Personalize, File Browser, Git Config, code-server and VS Code Desktop - the server lists no other and
  refuses to compose any other (a Go test) - in that order, without the category tabs.
* **Fixed: a template made with only its display name changed could not be deleted** (fork): the new template's ID
  stayed the base's ("platform"), so its Delete asked for a name it never showed (TEST). The ID now starts from the
  display name and follows it until it is edited; a template's Delete dialog names its ID beside its display name.
  The stuck TEST template was deleted.
* **New workspace in the settings pages' look** (fork, `CreateWorkspacePageView.tsx`): a template's Create workspace
  page has the workspace settings page's header (Templates / the template, its version, View source), section list
  with At a glance (template, owner, preset, CPU, memory, GPU, disk, theme), and cards - General (name and a
  suggestion, owner, a pinned version, preset with Show preset parameters), External authentication, Resources and
  Environment (the very cards of the workspace settings page: CPU and memory tiles, the GPU, the home disk's size,
  theme cards, image, start folder; immutable parameters set here), Schedule - with Cancel and Create workspace in
  its bar. A template with none of the platform's parameters gets a Parameters card.
* **Fixed: a new workspace lost the start and stop times its user set** (Global Workspace Scheduler, user mode): the
  request was rebuilt from the form without them whenever it named the template version (always, in practice).
* **Fixed: the chat console's Delete ignored the conversations chosen** (fork, `ChatConsole.tsx`): with several
  ticked, the trash asked about the open conversation only, in a box below the visible part of the card, and the
  right-click Delete took one. Now choosing (Select, or Ctrl+click) takes any conversation, group chats too, and
  every Delete - the bar's, the trash's, a chosen row's right-click - asks once for all of them in a dialog that
  names them, deletes them a few at a time, and says which were not deleted (a group chat only its admin deletes).
  Group chat with the chosen keeps to their people.
* **Select all in the chat console:** a bar over the list while choosing - Select all (the list as its tab and
  search show it; half-ticked when some are chosen; again: none) beside Delete N.
* **Workspace Health takes one line when nothing needs triage** (fork, Health): the empty table (616 px) gave way to
  a single "Nothing to triage" line (the card 216 px); its "Select a workspace" note only shows with workspaces in
  the list; while the check fails, its error alone.
* **Lock Down's menu reads Disable / Enable Privilege Escalation** (was Privilege Escalation Disable / Enable).
* **Fixed: the workspace page's Terminal would not open** (the template): renaming the Linux user after the owner left
  the agent without its shell - it keeps the name it started with (coder) and finds the shell of every terminal and
  SSH session by it in /etc/passwd, so they exited at once (code 1) and the Terminal panel rolled back up. The old
  name now stays as a second name of the same account, after the new one: whoami and the prompt still show the
  owner's name, and coder still resolves (the agent; `sudo -u coder`, `chown coder`). A chart check keeps it.
* **Template settings in the workspace settings page's look** (platform.79, `site/src/pages/TemplateSettingsPage/`):
  one page instead of five - a header (Templates / the template, its active version with a copy button), a section
  list with the template At a glance (version, status, autostop, port sharing, active users), and cards: General
  (name, display name, description, icon), Operations (the four switches), Port sharing (the maximum level, CORS),
  Deprecate, Schedule (autostop, autostart with its days, dormancy), Variables, Permissions and Parameters. One save
  bar, shown while something is changed: the template's own settings in one update, then the schedule (still asking
  first when a dormancy or deletion threshold affects workspaces within a week), then changed variables as a new
  version made the active one ("Save and publish"). Permissions and Parameters act at once, as before. The validation,
  the unit conversions and the entitlement rules are the former pages'; their addresses (`settings/schedule`, ...)
  open the page at their card. Both settings pages share their tokens, controls, header, section list and save bar
  (`modules/platform/settingsPage/`). A variable field no longer takes the focus (the page scrolled to the last one).
* **Fixed: Materialized in a template's Source Code view** (platform.78, `coderd/templatedecorator`): it said "The
  template decorator's sections cannot be read" since platform.74 - the decorator took a for expression's own name
  (`[for p in ... : p.claim]`, the shared Cloud Drives' volumes) for a resource outside the platform's sections, and
  refused the base template. The same refusal left templates made from the prototype without the platform's sections
  at build (Lock Down, certificates, Cloud Drive, metrics): they get them again at their next build. References are
  read from each attribute's whole expression now, and `chart_checks.py` runs the decorator's extraction on the
  chart's template (where the fork is checked out).
* **Fixed: opening an image in Images crashed the page** (platform.78, `imagebuilder.py`): "Cannot read properties of
  undefined (reading 'packages')" - the Coder fork tree read the add-ons' Python part, which the workspace images'
  addons.json does not have. The service gives the catalog's add-ons in the reports' shape (every part there), and the
  tree takes any part missing.
* **Fixed: the desktop's terminal opened inside another terminal** (the template): a home's copy of Terminator's
  launcher with Terminal=true (what XFCE's launcher editor writes when "Run in terminal" is ticked) made the dock run
  `xfce4-terminal -x terminator`, a second window showing Terminator's start-up warnings (no Keybinder, no Notify).
  At every start the home's launchers of terminal emulators are put back to run on their own; a chart check keeps it.
* **The model scanner is a plug-in** (platform.77, `modelscan.py`, `safe.py`): garak is no longer pinned, bundled or
  pushed (`modelScanner.image: ""`; its line left `images.txt` and the image-builder part). `build-garak-image.sh`
  writes the archive to `dist/plugins/` (with its `.sha256`), and Model library > **Import scanner** hooks it up:
  the archive uploaded (or an image reference chosen), imported, and named the scanner, after which new models wait
  in the hold for their scan as before. Without it Coder runs as usual: models go straight into the library, marked
  "Unscanned: no LLM scanner is hooked up", and the scanner panel's **Shown** switch hides the LLM scanning section
  until an admin brings it back (**Show LLM scanning**). `chart_checks.py` keeps it so (no scanner pinned or
  bundled).
* **Delete any image** (platform.77, `imagebuilder.py`): Images' rows carry a delete button beside Download, confirmed
  first, for every entry. The confirmation says what goes: a built or imported image with its registry versions; a
  scan, the image itself untouched; the workspace template's own image, only its entry and report (the template, its
  workspaces and the registry's copy stay), back when the platform deploys another workspace image
  (`/builder/images/.tracked-dismissed`). Its page has the button too.
* **What our images hold** (platform.77, `development/tools/image-contents.py`, GET `/api/images/contents`): the
  images the fork builds (`images.txt`'s `ghcr.io/user187x/`) carry a **Coder fork** tag wherever they show - the
  Images table, In use, On the nodes, an image's page - and open a tree of what each holds, read from the image as
  built: its reference, pin, size, layers and where it is made; how it runs (user, entrypoint, environment, labels);
  the programs we put in it with the version each reports; the workspace images' add-ons; every OS package (dpkg or
  apk) and every Python environment's packages; every build step with what it added. A filter finds a package, a
  variable or a step anywhere in it. **Coder fork images**, under the Images table, lists them all. The catalog
  (`image-contents.json`, 8 images) ships with the platform service; run the tool after pinning a new image of ours,
  and `chart_checks.py` checks it describes the images `images.txt` pins.
* **Workspace settings, rebuilt** (platform.77, `site/src/pages/WorkspaceSettingsPage/`): one page in the look of the
  design supplied for it (`workspace-settings.reference.html`) - a header (Workspaces / the workspace, the template version
  with a copy button), a section list with the workspace At a glance (CPU, memory, GPU, disk, theme, as changed), and
  five cards: General (the name, locked where the template disables renaming; the icon - Upload, Emoji or icon, its
  uploaded icons in the picker; automatic updates), Resources (CPU and memory as tiles of the template's options, the
  GPU switch, the home disk with Expand disk), Environment (the desktop theme as preview cards, the workspace image -
  "Another image…" with its field - the start folder, and any other parameter of the template), Schedule (autostart
  with its time, timezone, days and Weekdays / Every day / Clear; autostop) and Sharing (search, role, add; changes
  apply at once, as before). One save bar, shown only while something is changed: General and the schedule save
  through their own endpoints; changed build parameters take a new build ("Update and restart", asked first, or
  "Update and start"). The validation, the template's rules (renaming, immutable and disabled parameters, the
  allowed autostart days, the required active version) and the dynamic parameters' evaluation are kept. Its colours,
  sizes and radii are tokens (`workspaceSettings.css`: the design's in the dark theme, the dashboard's palette in the
  light one); buttons say pressed (`aria-pressed`), every control has its label and a focus ring, and smaller ones a
  44px touch area. Narrow, the section list stacks above the cards and the tiles wrap.
* **Who talks to whom, a page at a time** (platform.77, `ui-service.py`): Controls › Settings › Chat shows the latest
  25 pairs, newest first, then pages (Showing 1 to 25 of N, page buttons); `GET /api/chat/pairs?offset=&limit=` gives
  a page and the total (it gave the newest 200, and no more).
* **A GPU parameter on every template** (the template): `gpus` is on UBUNTU and UBUNTU DATAFLOW too, disabled
  (`styling`), so their settings show the GPU switch greyed; only UBUNTU OPENCODE's value reaches the pod
  (`local.gpus`). The desktop theme's options read as the settings page shows them. A chart check keeps it so.
* **Construction tape while a workspace starts** (platform.77): the progress bar is black and yellow stripes, moving.
* **The animation switches stop an animated GIF background** (platform.77): with Moving background or Animated GIFs
  off, a GIF background shows its first frame, still, like every other GIF on the dashboard.

* **Cloud Drive share approvals reach the admins** (platform.76, `drivepeers.py`): a share waiting for an admin told
  nobody - admins found it only in Cloud Drive > Sharing. Every admin now gets an "Approve Cloud Drive share" chat
  message (not the admin who made it wait) whose card approves or denies it in place, and whose two names open that
  person's Cloud Drive. In Accounts, both people's rows carry an Approve button (beside Chat; its menu has Deny and
  Inspect drive; several waiting: a list).
* **Admins look into a Cloud Drive** (`safe.py`): any account's, read only (list, glance, download; logged as
  `cloud-drive-admin-view`) - but never one its owner encrypted. From the share card's names, the Accounts button and
  the chat console; the Cloud Drive window shows it as "<name>'s (admin view, read only)".
* **Forced Focus** (platform.76, the chat): the Accounts chat button's menu sends a message that comes up in front of
  everything on the user's dashboard until they Acknowledge or Reply (`/api/chat/send` `focus`, `/api/chat/focus/ack`
  `message`); the console's Force Response does it with the newest admin message of the conversation
  (`/api/chat/focus/force`). Kept across restarts; the long poll wakes for it (`fv`).
* **The chat console moves to Controls › Settings › Chat** (platform.76): a card at the top of the page, out of the
  dashboard's way; Pop out gives it a window of its own, full size, and Pop back in returns it. The Chats panel's new
  button, the chat windows' "Open in the chat console" and the bell go there; the little chat windows stay at the
  bottom right. Choose several people (Select, or Ctrl+click) for one group chat; a conversation's right-click menu
  has Delete, Workspace, Cloud Drive and Force Response. The Chat entry of the settings list shows the unread count.
  Online Users is a card of the Chat page now (its old address leads there).
* **Accounts first** (platform.76): the table, its filter and the bulk actions in a card of their own, above User Quota.
* **The Inbox** (platform.76): its header no longer covers the first notification (the list scrolls in its own padded
  container), and a search box between the count and the buttons narrows the notifications loaded.
* **Overview is gone** (platform.76): User Engagement removed; Access URL, Wildcard Access URL and Experiments lead the
  Network page's table (with the invalid-experiments warning); `/deployment` and `/deployment/overview` open Network.
* **Your name in the workspace, not "coder"** (the template): the Linux user is the owner's Coder username (`whoami`,
  the prompt, file owners, the desktop) - uid 1000's account renamed at every start, its home still `/home/coder` -
  and the hostname the owner's and the workspace's names (`admin-xxx`, not `coder-<id>-<hash>`). sudo keeps working
  (a rule for the new name, checked by `visudo`, before the rename; Lock Down's rule still comes last). The account
  stays `coder` where sudo is not allowed (Lock Down's Sudo Command), or where the name is another account's or no
  Linux user name. A workspace gets both from its next update.
* **The Desktop no longer flickers with two viewers open** (workspace image 1.9.3): with Remote resizing, every noVNC
  viewer asked the VNC server for its own window's size, and two of them (a Desktop tab and the workspace page's
  Desktop panel, or two tabs) kept answering each other's change - some 18 resizes a second. Only the viewer in use
  (its page has the focus) resizes the desktop now (`novnc/coder-resize.js`); the others show it as it is.
* **Copy and paste between the desktop and your computer** (workspace image 1.9.3): noVNC shares the clipboard both
  ways, without its Clipboard panel (`novnc/coder-clipboard.js`, loaded by its page). Copied on the desktop, it is on
  the computer's clipboard; Ctrl+V, Ctrl+Shift+V or Shift+Insert in the desktop pastes the computer's clipboard (the
  browser's own paste hands it over first, no permission needed); and coming back to the page hands it over too,
  where the browser lets the page read the clipboard (Chromium, once allowed), for a paste by the mouse. Only what is
  copied goes to the computer, not every text selected (the template starts the VNC server with `-SendPrimary=0`).
  The panel stays, showing what the clipboard holds.
* **The Nerd Font in every terminal, emoji included** (workspace image 1.9.3): Terminator in a home without its own
  config (`/etc/xdg/terminator/config`), GNOME's monospace setting (Terminator's "system font"), XFCE's terminal as
  before, and code-server's terminal - drawn by the browser, so code-server serves the font itself and a built-in
  extension makes it the terminal's default (a user's own setting wins). Noto Color Emoji comes right after it, so
  the prompt's 💥 after a failed command (and any emoji) shows instead of a box.
* **Serenade's compositor stays up** (workspace image 1.9.3): picom (fdev31's fork) crashed on about every other
  start - the dock opens 0 pixels high, and its rounded corners and shadow then failed - and nothing started it
  again, so windows lost their rounded corners, shadows and animations. The dock is left out of the animations, and
  `coder-desktop-theme compositor` starts picom again after a crash (its log: `/tmp/coder-picom.log`).
* **The workspace's Ø Load no longer glitches** (platform.75, the template's `metadata.sh`): reading the command line of
  a process that ended mid-count failed the redirection before its `2>/dev/null` applied, so
  `bash: line 73: /proc/<pid>/cmdline: No such file or directory` became the metric's value now and then (most on a
  busy workspace); it is read in braces now, and a chart check keeps it so. And a metric's value is never wider than
  its column: a long reading widened the Workspace box and pushed the Cluster box aside, clipped, until a reload; it
  is cut short now, whole on hover. A workspace gets the script from its next update.
* **UBUNTU UNSLOTH and UBUNTU OBSIDIAN removed:** the chart pushes neither any more (`aiTemplates.unsloth`,
  `obsidianTemplate` and `obsidianImage` are gone, with their Jobs, icons and the template's `unsloth` and `obsidian`
  app sets), the Obsidian image (`coder-workspace-obsidian`, `build-obsidian-image.sh`) is no longer built or bundled,
  and `build-bundle.sh --no-obsidian` and the Argo CD helper's `--obsidian` are gone. UBUNTU OPENCODE stays, on the AI
  image (its Unsloth server, Unsloth Studio's window on its desktop), with the model library and its garak scan. On a
  deployment that has the removed templates, they stay in Coder as they are until an admin deletes them; the dev
  cluster's are deleted, with UBUNTU-x (a template made in the builder).
* **The Controls menu** (platform.74): the navbar's admin menu is now **Controls**, and its first item, the
  deployment's settings (Admin Controls before), **Settings**.
* **File Browser opens the Cloud Drives in place** (workspace image 1.9.2): the image's FileBrowser Quantum is its own
  build of 2.1.2 (`2.1.2-coder.1`), a FileBrowser update for symlinked folders - a source may follow links into the
  folders it is told (`symlinkTargets`, opt-in), and a symlinked folder is listed as a folder. The template's helper
  (version 4) tells it the drives' folders, so `~/cloud-drive`, `~/cloud-drive-shared/...` and `cloud-drive mount`
  links open where they are; the drives stay in the sidebar too. On an image from before it, the links stay hidden as
  before (2.0.1 refuses the setting).
* **File Browser's icon is FileBrowser Quantum's logo:** the template's own icons (`files/icons/`) now go into their
  ConfigMap as `binaryData`, so any image ships byte for byte, a PNG as well as an SVG (`templates/icons.yaml`); the
  chart checks that every icon comes through, is a type the platform service serves, is referenced where it exists,
  and keeps the ConfigMap small. Existing workspaces show it once they update to the new template version.
* **The Cloud Drive's leading cloud, its size line and its room** (platform.73): the Cloud Drive stays above the
  table, flush with its right edge, its cables to the rows as before; inside it, the readout on one line and the
  capacity bar on the next. Its leading cloud - a plus in it, glowing and pulsing, while something is shared with you
  - opens a window listing what is shared, a card per owner (whose, what, your access, how many files and how much,
  the newest; Open): the floating clouds above it are gone, as they did not scale. An entire Cloud Drive shared with
  you read and write adds its capacity to yours - the readout counts it in, the bar gives it a striped part of its
  own, in the shared colour, with "+N shared".
* **Sharing files and folders, not only whole drives** (platform.70-73): Share on each file and folder of your Cloud
  Drive, and Share drive, with whom you choose, read only or read and write (an admin approves it where admins approve shares; a chat
  message tells them). Shared with you, the Cloud Drive window reaches only what is shared (a folder on the way lists
  just those; checked by the service for every path, the shared folder or file itself not removable by you), and
  your workspaces have each at `~/cloud-drive-shared/<owner>/<name>` from their next start - the owner's volume's
  subPath, mounted on its own, a shared folder a source of its own in File Browser (`drivepeers.share`, `access_at`).
  A drive shared only in parts has its card in the leading cloud's window, showing its first part, how many more, and
  that part's own access. (platform.70 moved the Cloud Drive into the table's header, which broke its cables;
  platform.71-72 put it back as platform.69 had it, and platform.73 brings back platform.70's inside of it.)
* **Desktop themes - Serenade, or Classic** (workspace image 1.9.1-1.9.2, the Desktop theme parameter): Serenade, the
  default, is Miserable_Xfce's (github.com/mehedirm6244/Miserable_Xfce, pinned): Tokyo Night colours, the Lavanda GTK
  theme, cirkles window borders, Zafiro icons, its background, a floating dock (rofi, docklike, eww's sidebar and
  System stats - without the widgets that need the internet) and picom's animations, rounded corners and shadows
  (fdev31's fork, drawing without a GPU). Classic is the plain XFCE, lighter over a slow connection. The workspace
  image's `coder-desktop-theme` puts the choice in the home at the next start, once (the user's own changes kept;
  Serenade puts the earlier settings aside, Classic puts them back; 1.9.2's profile 2 gives the dock the theme's
  coloured launchers).
* **Chromium and Terminator by default:** Chromium (xtradeb's build: Ubuntu's is only the snap; offline policies like
  Firefox's, trusting the cluster's CA through p11-kit; without its sandbox where a pod allows no user namespaces) is
  the desktop's web browser, Terminator its terminal - for both themes, set once in each home. Firefox stays.
* **The Cloud Drives shared with you float above yours** (platform.68-69): on the Workspaces page, a dotted cloud above
  the Cloud Drive button for each drive shared with you, its owner's avatar inside, tethered by a cable to a socket on
  the button (green dots and prongs read and write, blue read only). It drifts in and plugs in; when the share ends its
  plug pops out, the cable reels in and the cloud fades away. Pointed at, a HUD: whose it is, your access, how many
  files and how much, the newest of them; clicked, the Cloud Drive window opens on it (`GET /api/safe/glance`).
* **File Browser opens the Cloud Drives:** `~/cloud-drive` and `~/cloud-drive-shared/<owner>` are links to volumes
  mounted out of the way, and FileBrowser Quantum opens no link out of its folder (it answered 403: "permission
  denied", or an empty folder). Each Cloud Drive is now a source of its own in File Browser's sidebar - yours, and each
  one shared with you, read only unless shared read and write - and the links it cannot open are hidden in the home.
  Connecting or disconnecting the workspace's drive restarts File Browser with it (`coder-filebrowser`,
  `scripts/filebrowser.sh`); a workspace has it from its next start on the new templates.
* **...every time, in every template:** File Browser's PID file was kept in the home, so after a restart it could name
  another process (File Browser then never started, or the wrong process was stopped): it is per container now
  (`/tmp`), and a process that exited is never taken for it. The helper also comes with the Cloud Drive's platform
  section, so a template made in the template builder gets the current one at every build (the newer of it and the
  template's own is kept), and the Cloud Drive's watcher checks every 10 seconds, taking over a File Browser an older
  `startup.sh` started with this config. A drive whose storage does not answer is left out rather than waited on, and
  the sidebar's links are set once File Browser answers (up to 5 minutes).
* **The Images view's registry scores an A:** `coder-image-registry` runs `ghcr.io/user187x/coder-registry:3.1.2-1`,
  Docker's registry 3.1.2 built from its source with Go 1.26.9 and the fixed `golang.org/x/net`, `x/crypto` and
  OpenTelemetry exporters, on Alpine 3.24 with its fixes, its default user 1000 (the chart ran it as 1000 already):
  `registry:3.1.2` scored a D (4 high, 8 medium, the root user); this has only GO-2026-5932 (x/crypto's unmaintained
  openpgp package, no fix). `development/registry-image`, `development/tools/build-registry-image.sh`.
* **Images on the nodes include the small ones:** a node reports only its 50 largest images (the kubelet's
  nodeStatusMaxImages), so the images its running pods run are listed and scannable too.

Before (platform.66-67):

* **Unsloth Studio replaces LM Studio:** the AI image 2.0.0 carries Unsloth Studio (AGPL-3.0) - its desktop app (the
  provided `unsloth.AppImage`) and its server, installed at build time by the app's own installer (CUDA PyTorch,
  llama.cpp's CUDA build with CPU fallback, Node), offline at run time; each home links to it (under 1 MB). UBUNTU
  UNSLOTH (the Unsloth app on the desktop) takes over UBUNTU LM STUDIO (renamed, its workspaces offered the update);
  UBUNTU OPENCODE runs OpenCode on the workspace's Unsloth (`unsloth start opencode`: a model loaded at the Context
  length, an API key of it). Models from the model library and the Cloud Drive's `models` folder.
  `build-ai-image.sh [TAG] [--cpu]`.
* **UBUNTU OBSIDIAN:** Obsidian 1.14.4 (the provided package) on its own image, its window the desktop's app, the
  vault `~/Obsidian`, updates off; internal use only (`build-bundle.sh --no-obsidian`, which replaces
  `--no-lmstudio`). `build-obsidian-image.sh`.
* **FileBrowser Quantum** (2.0.1, the provided release binary, unpacked from UPX for scanning) is the File Browser app in
  the workspace image 1.8.7 (and dataflow 1.1.2): under the app's path, on 127.0.0.1, no sign-in or update check of its
  own; an image built on an older workspace image keeps its former File Browser.
* **The Workspace image parameter is a dropdown:** the template's image (stored as such, so a template update brings
  its new image), every version built or imported in Templates › Images (the ConfigMap `coder-workspace-images`, kept
  by the platform service), or Another image… with an example and a plain check; a workspace whose image was removed
  is offered the list instead of "Invalid parameter value", and one created before (an earlier tag of the template's
  image) runs the template's image. Another image… now brings its Image to run field as soon as it is chosen, and the
  list is in order (the template's image, Templates › Images, earlier versions, Another image… last): both used
  try(), which Coder's form settles before the choice and the version's ConfigMap data are known.
* **Workspace start fixed:** File Browser's launch kept the startup script's output open, so every workspace on the
  new templates ended in "start_error" ("script exited without closing output pipes"), its apps working; a running
  workspace shows it until its next start.
* **Cloud Drives shared between users:** admins turn it on and choose whether they approve each share (Cloud Drive >
  Sharing); users ask each other in chat (Ask for their Cloud Drive - a request card), the owner shares it read only
  or read and write, and it is at `~/cloud-drive-shared/<owner>` in the requester's workspaces from their next start -
  and at once in the Cloud Drive window (its drive switcher: Mine, or each drive shared with you; read only hides
  Upload, New folder and Delete, and the service refuses writes too). The Sharing view names the running workspaces a
  restart brings the shares to. The Accounts table draws the shares with the Cloud Drive's cables: from the socket at
  the owner's row to a plug at the row of whom it is shared with (green prongs read and write, blue read only; point
  at one for who and how).
* **Encryption with a PEM or a PFX:** Password, PEM, or PFX - the certificate read out of the Account's P12 (Coder
  hands it back to its owner only) or a chosen file, in the browser, with legacy RC2/3DES exports too; the password
  never leaves the page. A note says so first.
* **Lock Down's menu:** Disconnect / Reconnect Network, Privilege Escalation Disable / Enable (a new icon), Lock Down /
  Unlock, Freeze / Unfreeze, each red while its lock is on and green while off.
* **Templates:** delete versions from the history (Source Code > Versions); admins rename the base template in Create
  new template; icon fields upload an image from their menu; Overview values without quotes; a file picked in Source
  Code's tree is centred (no more jitter).
* **Workspaces:** the update icon pulses in the workspace page's orange; the Cloud Drive's Refresh spins, then shows a
  check.

Before (platform.64-65):

* **The model library's security scan (garak):** every model added waits in a hold, mounted nowhere, until a scan Job
  (`ghcr.io/user187x/coder-garak`: garak 0.17.1 with its detector models and probe data, CPU PyTorch, llama.cpp's
  `llama-server` - offline) has checked its file and run garak's probes against it; graded A-F from garak's DEFCON
  levels, it is released at the release grade or better, else an admin releases it, rescans or deletes it. The report
  as an image's: severities, OWASP LLM categories, failing prompts and answers, the file's checks, garak's own files.
  Profiles Quick / Standard / Thorough; a newer scanner image (imported in the Images view) updates garak and its
  probes; the newest garak release shown where PyPI is reached. `development/tools/build-garak-image.sh`.
* **The Cloud Drive in a folder:** Mount (the window's view, or `cloud-drive mount PATH` in a workspace) links it into
  any folder beside its own files; a file of the same name halts it - Keep both (`data-(cloud_drive).csv`) or
  Overwrite (all, or each occurrence asked: yes / no, `[Y/n]`); unmounting puts overwritten files back.
* **The base template and the decorator:** one `main.tf` (the certificate's install in it; Lock Down's start in
  `lockdown.sh`), its platform sections marked; Coder's template decorator injects them into every template that
  lacks them when it is provisioned. Create new template: the base without a choice shown, the Desktop, File Browser
  and Terminal each in or out, the new template's own logic only. Source Code: Materialized and Global files; the
  editor's Materialized tab.
* **marimo removed** from the template, the workspace image (1.8.6: 1.3 GB, was 1.9 GB) and everything else.
* **code-server HA:** the code-server-replicator, the relays, the schema `code_server_ha` in Coder's database
  (`codeServerHA`, a template's `code_server_ha`).
* **The network pill** slides for as long as the page is open and asks the platform service again when live
  readings stall. **The Cloud Drive** button shows how full it is. **Certificates:** Create SSH Key, Upload PFX.
* Earlier on this line (platform.61-63): Super Intelligence removed; Admin Controls; images on nodes scanned; the
  Cloud Drive's encryption and source; Accounts bulk actions and group chat; disaster recovery.

## 1.39.1 – 2026-10-15

Coder `2.0.0-platform.45` (fork `21d206361`), workspace image `coder-workspace:1.8.5` (unchanged), dataflow image
`coder-workspace-dataflow:1.1.0`.

* **The announcement's Knight Rider**, as a text effect and as a close transition:
  * the effect: KITT's scanner across the banner's screen, behind the message - a row of red lamps and a light
    sweeping from one end to the other and back without a pause, each lamp flaring as it passes and fading behind
    it. One lamp for about every 44 px of the banner; the banner's Speed sets the sweep (2.4, 1.6 or 1.0 s there and
    back); without "Repeat continuously" it sweeps twice, then the lamps go dark. The message keeps a dark halo over
    the glow.
  * the close transition: the banner turns into the scanner, its light runs out to the right and, on its way back,
    sweeps the banner away behind it (1.3 s).
* **Open transitions:** how the banner comes in when it appears (the page loads with it, or a new announcement
  arrives): None (the default, as before), Fade in, Roll down, Knight Rider (the light runs across with the banner
  lighting up behind it, comes back, and the lamps go out), TV switch-on (a dot of light opens into a line, the line
  into the banner), Glitch (slices, jitter and split colours, then it settles). In the editor's Controls beside Close
  transition, with Try it (Replay plays it too). The banner service takes `openEffect` and checks it. Without motion
  (the browser's setting, or animations off) the banner is simply there.
* **No nginx in UBUNTU DATAFLOW: the cluster's Gateway gives NiFi its path.** NiFi serves only at `/nifi` and builds
  its pages' links and API calls from the proxy headers it is sent (`X-ProxyContextPath`, `-Scheme`, `-Host`,
  `-Port`); 1.39.0 ran an nginx in every dataflow workspace only to add them. Now each dataflow workspace has an
  HTTPRoute of its own (`main.tf`, `nifi_route`: created with the workspace, deleted with it) on the Gateway that
  serves Coder, for its NiFi path only, to Coder's Service as Coder's own route (the longer path wins), with these
  headers set (a `RequestHeaderModifier` filter: Traefik). Coder's app proxy passes them on to NiFi, whose own port
  (127.0.0.1:8080) is now the app's URL. Nothing else in front of NiFi; Coder still decides who may open the app.
  * Coder's service account may manage HTTPRoutes in its namespace (the layer's Role `coder-workspace-nifi-routes`)
    and read the cluster's CRDs (ClusterRole `coder-workspace-nifi-routes-<namespace>`: Terraform's
    `kubernetes_manifest` looks the HTTPRoute's type up before it plans; definitions only), with the dataflow template
    only. The Gateway is `coder-workspace.icons.gateway`'s; Coder's Service and service
    account are `coder-workspace.nifiRoute`'s.
  * Workspaces of 1.39.0's dataflow template keep running as they are (their nginx) until they update.
* **Dataflow image 1.1.0:** 1.0.0 without nginx. Its build check now sends NiFi the headers as the Gateway does, on
  Coder's host, and checks that NiFi's root leads to its UI under the app's path. This template runs on 1.0.0 too
  (its nginx unused).
* **The decorator update's `--dataflow keep`** runs the layer chart's dataflow image (it named 1.0.0, whatever the
  chart said), and the helper says which; its README says when that image changed since the cluster's release, and
  how to keep the earlier one. A static check runs `--dataflow keep`.
* `development/tools/build-bundle.sh --no-slim`: without the slim tarball (not a release asset).
* **Tested** on Minikube: a dataflow workspace's HTTPRoute (Accepted by Traefik), NiFi's root, UI and API under the
  app's path through Coder, a processor made through its API, both apps in the panels (**7/7**), no nginx in the pod,
  the route deleted with the workspace; the announcement's Knight Rider effect, the six open transitions and the
  Knight Rider close transition in the editor's preview (**18/18**, nothing published); static checks **51/51**,
  platform unit tests **45/45**, the dashboard's announcement unit tests **58/58**.

## 1.39.0 – 2026-10-15

Coder `2.0.0-platform.44` (fork `6a87d6432`), workspace image `coder-workspace:1.8.5` (unchanged).

* **A second workspace template, `ubuntu-dataflow` (UBUNTU DATAFLOW):** the same workspace as UBUNTU with **Apache
  NiFi 2.12.0** in place of code-server and **Apache Airflow 3.3.2** in place of marimo, both started with the
  workspace and working with no network, opening like the other apps (and in the workspace page's panels).
  * One template file: `main.tf`'s `app_set` (developer / dataflow) chooses the apps; the chart pushes it twice
    (`coder-workspace.dataflowTemplate`, its own Job and push message). Memory defaults to 6 GB there (NiFi's 1 GB Java
    heap and Airflow beside the desktop).
  * Its image, `ghcr.io/user187x/coder-workspace-dataflow:1.0.0` (`development/workspace-image-dataflow`,
    `development/tools/build-dataflow-image.sh`): the workspace image + a Java 21 runtime, NiFi (checked against
    Apache's SHA-512; its NARs unpacked in the image, read-only, so a workspace keeps only its conf, flows,
    repositories and logs in `~/.nifi`), nginx (gives NiFi the app's path: NiFi serves only at `/nifi`), and Airflow
    in `/opt/airflow` (pinned with Airflow's constraints for the image's Python). The build checks both start and
    answer with no network.
  * NiFi: unsecured HTTP on 127.0.0.1:8080 (the app is its owner's alone), behind nginx on 8081; its health check is
    NiFi's own port. Airflow: standalone (SQLite in `~/airflow`, its example DAGs) on 8090, under the app's path
    (`base_url`), every user an admin; its settings in `~/.airflowrc` for the `airflow` command in terminals.
  * Their panels on the workspace page show, in a small oval at the right of the panel's header (before Pop out), the
    protocol and port the service runs on inside the workspace (`HTTP :8080`, `HTTP :8090`): the health check's, else
    the app URL's.
* **The announcement banner has a screen.** The message sits on a long LCD set into the banner: the banner's colour
  is a thin bezel around it (top, bottom, left, and before the Viewed box), the screen's corners follow the banner's,
  dark glass tinted with the banner's colour, faint pixel rows and a glare, the text lit and softly glowing (in the
  banner's text colour, or its own colour when the text colour is dark). The scroll-down key sits on the screen.
* **Three new text effects** for it, from the CSS given (same motion, timing curves and colours; the `--ink`,
  `--ink-2`, `--ink-3` tokens; off with reduced motion or animations off): **Pew-Pew** (each letter fired in as a
  laser bolt, a white flash and spark on impact, a recoil, a faint glow), **Split-Flap** (a departure board, every
  letter on its own plate) and **Ghostwrite** (a band of light sweeping muted letters). In the banner the letters
  wrap like text, a long message's letters fire closer together, and without "Repeat continuously" each plays once
  and the message stays. The banner service accepts the new names (`pewpew`, `flap`, `shimmer`).
* **Receipts are optional.** A new option, *Record who viewed it, and let them confirm it* (on by default, as
  before): off, for a greeting nobody needs to account for, no view is recorded and there is no Viewed box and no
  Confirm button; a dismissible announcement gets a plain close button instead. The banner service keeps the new
  field (`receipts`).
* **The announcement editor is a small word processor.** No Markdown and no "Start from" templates: the text is plain,
  as typed (shown in the banner's font and alignment as you type), formatted by the controls. The Message card has two
  parts:
  * **Compose.** Line 1: the **font**, the **text effect** (with the crawl's speed, and a repeat toggle), the **text
    colour** and the **banner colour** (each a swatch button opening presets, a picker and the hex value; a level's
    own pair is that level), **Emoji** and **alignment** (Left, Center, Right). Beside the font, **Outline**: the
    text ringed by a hair of the opposite colour (dark round light text), to stay legible over a busy or changing
    background image; drawn around whatever the font and the effect paint (a filter), so neither is changed. The
    banner service keeps it (`outline`). Line 2: **Upload image**, with the
    preset images under its arrow, and on the right how the image fills the banner's screen: **Span**, **Tile**,
    **Stretch**, **Center** or **Fill**, each with its icon. Line 3: **Countdown timer**: ticked, only the moment is
    asked for. Then the text. No preview of its own: the page's *What developers see* plays the text effect (and
    *Replay*), and the close transition's *Try it* plays there too.
  * **Controls:** *Let people dismiss it*, *Also show on the sign-in page*, *Record who viewed it, and let them confirm
    it*, and the **Close transition**.
* **A background image for the banner.** The image (uploaded, or a preset) is the banner's background, behind the
  text on its screen, filling it as chosen: **Span** (the default: as wide as the screen, rolling through it from top
  to bottom, as on a rolling pin, round and round at a steady pace), **Tile** (repeated across, as tall as the
  screen), **Stretch** (squeezed to its size), **Center** (the whole image, fitted in the middle) or **Fill** (covering
  it, its middle showing). The banner keeps its size. Uploads are PNG, JPEG, GIF (animated GIFs keep every frame: the
  file is stored as it is), WebP or AVIF, up to 8 MB; the platform service keeps them in Coder's database
  (`coder_ui_updates.banner_picture`, named by their content, the newest 100 kept) and serves them at
  `/__coder-ui/banner-picture/<id>`, publicly (the sign-in page may show the banner).
* **The countdown is a split-flap clock.** A countdown is shown at the banner's far left, before the text: days (when
  there are any), hours, minutes and seconds, each figure on its own black rounded plate (the top half a shade
  lighter, split across the middle, as on a departure board), flipping in as it changes; the colons are light dots
  ringed in black, seen on a dark banner and a light one alike.
  At zero the plates blink 00:00:00. No flipping with reduced motion.
* **The banner service keeps the new fields:** `markdown` (false for the editor's plain text; announcements written
  before it are Markdown and still show as they did), `align`, `picture`, `pictureFit` and `countdown` (UTC). An
  announcement may be only a background image or a countdown, without text. A background image or a countdown makes
  a new announcement (its own receipts), as they did in the message. An
  announcement written in Markdown opens in the editor as plain text, its first countdown and first picture as the
  banner's countdown and background (an unpublished edit until it is published).
* **Acknowledgements: Clear all** deletes every announcement's record and everyone's confirmations at once (after a
  confirmation; the live announcement stays up, its confirmations starting again from nobody):
  `POST /__coder-ui/api/events/clear`, admins only.
* **Close transitions.** A dismissed banner goes with its close transition: **Pixelate**, **Roll up**, **Fade** (the
  default), **Wipe**, **Matrix** (green code rains over it as it dissolves), **Gaussian blur** or **Evaporate**, or
  None; chosen in the editor's Controls (Close transition, with *Try it*, played on the preview), stored by the banner
  service (`closeEffect`). Without motion it goes at once.
* **Workspace page: no ⋮ menu.** Its actions (Settings, Change version, Duplicate, Download logs, Back up home,
  Expand disk, Delete), with **Build parameters** (what the arrow showed before) and **Share** (Workspace Sharing, now
  in a dialog; no Share button) first, are under one arrow right after the action buttons (beside Restart or Start),
  in every state: it stays while the workspace restarts; during a build only Change version, Expand disk and Delete
  wait. Each with its icon. The buttons are evenly spaced and end as far from the edge as the navbar's user menu above
  them. The Workspaces list keeps its ⋮.
* **Cancel where the build's button is.** While a build runs (a restart, a start, a stop, an update, a queued or a
  deleting one), the buttons stay as they were, in their order: the one that started it becomes its **Cancel**
  (clickable, with the confirmation as before), the others wait, disabled. Cancel no longer appears after the arrow
  and goes again, and Stop no longer disappears during a restart. Without the right to cancel, that place says what
  the build is doing (Restarting…), as before.
* **The decorator update** (a new release file, about 300 MB): `coder-airgapped-<version>-decorator-update.tar.gz`
  updates an Argo CD decorator install without the full bundle: the fork's Coder image, the two charts, a README of the
  images changed since the previous release, and **`update-application.sh`**, which pushes the image and the charts to
  your Harbor (`--push`), points your existing Application's two sources at the new version - a text edit that keeps
  your comments and anchors, your file kept as a backup, checked by parsing it back - shows the change and applies it
  (`--apply`). It turns the ubuntu-dataflow template off unless given its image (`--dataflow keep|<image>`). Built by
  `development/tools/build-decorator-update.sh`; the full bundle carries the helper too (`argocd/`). Tested: pushed to a
  throwaway registry, both charts rendered from it with the updated Application's values (Coder on the new image from
  the registry, no dataflow template or image), and the objects compared with 1.38.1's (the same 66; only Coder's
  image, the platform's code, templates and icons, one RBAC rule and one setting change).
* **Fixed: a workspace's Ø Load read near or over 100% while it was idle.** The metric counted the metrics themselves:
  the agent starts all of them at the same moment, so its samples always met the others starting (and the `coder stat`,
  `awk` and `du` they run), about two threads, a whole idle 2-core workspace. The metric scripts (and what they run)
  are now left out, found by their command lines; everything else the workspace runs still counts. Workspaces show it
  once updated to the new template version.
* **Peer-to-peer chat** (Admin Controls › **Chat**, a new page). Off by default; an admin turns it on, and every
  developer's Chats panel lists the **People** online now (a tab open) or active today (Coder's last seen), online first,
  with a search: choose someone to message them, to work on a project together. Anyone can make themselves
  **invisible** (a switch in the panel): left out of everyone's People list but admins', who see them marked; someone
  already talking with them may still write. Off again, developers write to admins only. **Chats are kept 30 days** by
  default, a number of days admins set (1-365; messages and screenshots past it go every hour, and at once when it is
  shortened), and admins can **purge** them all at any time (open windows empty at once; the file is compacted to give
  the space back), with how much is kept beside it. **Who talks to whom**: which developers have chatted (the two, how
  many messages, since and last; never what they wrote), with a button to message either, to find the right points of
  contact; and **who is around**, the invisible too. The platform service: `GET /__coder-ui/api/chat/people`,
  `POST …/chat/presence`, and for admins `GET`/`POST …/chat/settings`, `POST …/chat/purge`, `GET …/chat/pairs`.
* **Particles, richly customizable** (Customize › Background image › Particles). **Themes**, each drawn live in its
  tile: Original, Aurora, Fireflies, Snowfall, Synthwave and three of Minecraft's - **Overworld** (grass, dirt and stone
  pixel blocks tumbling through a blue sky), **Nether** (lava, glowstone and netherrack embers rising through red haze)
  and **XP orbs** (green and gold orbs pulsing in the dark). Then the dials: the background (solid, vertical gradient
  or radial glow, with its second colour), the three colours, the **shape** (soft orbs, dots, bubbles, squares, pixel
  blocks with grain and bevel, diamonds, sparks), the **motion** (orbit, drift, rise, fall, twinkle; tumbling or not),
  how many, how big, **size variety**, **opacity**, the glow's distance and softness (none too), **luminous** blending,
  and **Shuffle places** (another layout, the same everywhere). Speed and the colour filters stay with every HTML
  background's dials. A Particles background saved before keeps its look (the new settings default to it).
* **Prebaked pictures:** `creeper.gif` and `background.gif` are among Customize › Background image's provided
  pictures, and `usa.gif` and `background.gif` are the announcement's preset images (in the dashboard,
  `site/static/pictures/`: there offline from the first install).
* **Settings menu.** The navbar's Admin menu is now **Settings**, and its first item (the deployment's settings)
  **Admin Controls**. Under its CPU and memory bars, as wide as both, the **cluster's network traffic** over the last 15
  minutes: received above the line (green), sent below (blue), the rates now and the window's peak, each bar's time and
  rates on hover. The platform service samples each node's counters from its kubelet's summary every 15 seconds, on
  the kubelet's port as metrics-server does: its ClusterRole gains `nodes/stats` (get) only, and
  `metricsServer.kubeletInsecureTLS` applies to it too.
* **Workspace settings on one page.** General, Parameters, Schedule and Sharing are cards on one page (General and
  Schedule on the left, Parameters and Sharing on the right), each with its own form; no sidebar. Links to the former
  pages (`settings/parameters?templateVersionId=…`, `settings/schedule`, `settings/sharing`) open it at their card.
* **Settings › SSH keys:** **Regenerate Key** asks for the key type, **RSA** (4096-bit) or **ED25519**, whatever the
  deployment's default (`PUT /api/v2/users/{user}/gitsshkey?algorithm=rsa4096|ed25519|ecdsa`; without it the
  deployment's, as before); **P12** uses the `.p12`'s key as before. Both have icons.
* **Sign-in page** (where signing out lands too): no footer (copyright, Coder version); the deployment's logo large
  (112 px tall, up to 320 px wide; it was 48 px); the Keycloak button is Keycloak's logo (key and wordmark), smaller
  than it (120 px wide), centered, without "Sign in with your certificate" (still the button's name for screen
  readers). Another OIDC provider gets its icon on a large square button.
* **HUD:** the totals across the top stay on one line, their text shrinking to fit the window and again whenever a
  figure grows (measured by the figures' own widths: growing ones no longer run under the Sort button). The Sort menu
  moved beside the graphs' note ("Live: sampled every 15 seconds, kept 7 days.").
* **Workspaces:** with no workspaces yet, a template card's name and description are centered on the whole card.
* **Home disk size** (Workspace settings › Parameters; the size the workspace was created with, fixed) now shows the
  disk's size now and an **Expand disk** button: Kubernetes volume expansion where the storage class allows it (EBS
  gp3 on EKS), else the home is copied onto a bigger volume - the same as the workspace's ⋮ menu › Expand disk.
* **Template icons:** Home disk size is a hard drive and Memory a memory module (`files/icons/hard-drive.svg`,
  `memory.svg`, served at `/__icons/`); CPU keeps the chip. Workspaces show them once updated to the new version.
* **Workspace page:** a running, healthy workspace's status has a running light instead of the dot, in HTML and CSS
  only (no image), after the GIF given: broken rings of light turning at their own pace round a pulsing core, glowing
  softly with it; still for reduced motion.

## 1.38.1 – 2026-10-14

Coder `2.0.0-platform.43` (fork `9cb97bba8`, unchanged), workspace image `coder-workspace:1.8.5` (unchanged).

* **Fixed: the single-chart Argo CD Application lost the workspaces' storage class.**
  `argocd/coder-airgapped-application.yaml` set `coder-workspace:` twice, and kubectl (like Argo CD) keeps only the
  last of two equal keys, without a word: `coder-workspace.storageClass` never reached the chart, so on a cluster
  without a default StorageClass (EKS) new workspace homes would not bind. Now one block. A static check makes sure no
  Application or values file gives a key twice.
* **Tested against a real Harbor** (2.15.2, the official chart, private CA; `development/tools/airgap-e2e/harbor-setup.sh`,
  the installing machine a docker-in-docker with no images): `./make --push-images` trusted the CA (docker's
  `certs.d`, through sudo), logged docker and helm in, created the project and pushed all 11 images (every one from
  the bundle) and 5 charts; a single-chart Argo CD install from Harbor (robot account, Harbor's CA in Argo CD) then
  moved to the decorated install with `./make --argocd` **in place**: all 23 of its objects (database, volumes,
  Secrets, Deployments) kept, the data with them.

## 1.38.0 – 2026-10-14

Coder `2.0.0-platform.43` (fork `9cb97bba8`, unchanged), workspace image `coder-workspace:1.8.5` (unchanged).

* **Argo CD: Coder decorated by the customization layer.** The release installs as two charts in one Argo CD
  Application, the customization layer decorating a plain Coder that it can be taken off again:
  1. `argocd/charts/coder-airgapped-base-<version>.tgz`, the Coder installation: the upstream Coder chart running
     upstream Coder (`coder-upstream`, at the fork's base, with the Terraform provider mirror), its CloudNativePG
     database and its first owner;
  2. `argocd/charts/coder-airgapped-layer-<version>.tgz`, the customization layer: the platform service, the
     announcement banner, the ubuntu-vnc-desktop template and its icons, the image builder, metrics-server and
     admins' kubectl;
  3. `argocd/coder-decorated-application.yaml`, the Application with both (one shared `global` block), and
     `argocd/coder-plain-application.yaml`, the same without the layer;
  4. **`./make --argocd <harbor>[/<project>] [--plain]`**: pushes every image and chart to Harbor (as
     `--push-images`), installs what the cluster lacks (Gateway API CRDs, Traefik, CloudNativePG; asked first),
     makes the Secrets, gives Argo CD the chart repository (the password on stdin, never in a file; Harbor's private
     CA in `argocd-tls-certs-cm`), writes the Application with your values (`.deploy/argocd-<domain>/`), applies it
     (asked, or tells you how to add it yourself), waits until it is Synced and Healthy and seeds the image builder.

  The layer's one hook into the base is `global.decorator.layer: true` (the base then runs the fork's image with the
  platform's two settings). `--plain` takes the layer off: Argo CD prunes what the layer added, Coder restarts as
  upstream Coder, and the database, users, templates and workspaces stay; applying the decorated Application puts it
  back. The layer's own data (the platform service's and the image builder's volumes) is kept meanwhile, out of the
  Application, and adopted again. Both charts are packaged from `coder-airgapped` (`./mirror-images.sh
  decorator-charts`): the static checks verify they share no object and together are exactly that chart.
  `coder-airgapped` itself and `./make --deploy` are unchanged.
* **Gateway API CRDs v1.6.0** (was v1.5.1; `prereqs/gateway-api-v1.6.0-standard-install.yaml`), installed only where
  the cluster has none. Traefik 41.4.0 works with them unchanged.
* **Fixed: the image builder's volumes were pruned by Argo CD** (built images, uploads): like the platform
  service's, they now carry `Prune=false,Delete=false` (Helm's `resource-policy: keep` only holds for Helm).
* **Fixed:** `./make --push-images` and `./make --deploy` (EKS) from a layer bundle that carries no image stopped
  after the push (nothing left to show), and pushed a chart named `*.tgz` when the bundle had no prerequisite chart;
  the image builder's base (the 5 GB workspace image) was pushed again at every deploy, as the check missed images
  stored as an OCI index.
* Tested on kind with egress blocked, Gateway API v1.6.0 and Argo CD 3.5.2: `./make --argocd` from scratch
  (Synced / Healthy in about 3 minutes), the layer taken off and put back twice; every volume kept its UID.

## 1.37.1 – 2026-10-14

Coder `2.0.0-platform.43` (fork `9cb97bba8`), workspace image `coder-workspace:1.8.5` (unchanged; the template has a
new version: update workspaces to get its startup log).

* **Fixed: the workspace page's Logs panel showed only a spinner.** The workspace's startup scripts printed nothing
  when all went well, so the agent had no log lines and the panel waited for some forever. The scripts now log each
  step (the desktop, noVNC, code-server, File Browser, marimo, the cluster sign-in for admins, the
  certificate, Lock Down), so the panel shows the workspace's startup; and an agent with no log lines at all gets
  "No logs yet" instead of the spinner. The Certificates and Lock Down scripts have their own icons in the panel's
  tabs (they pointed at an icon Coder does not have).
* **Lock Down menu icons:** Network is a pulled plug and Sudo Command passport control (🛂); Complete keeps the red
  shield and Freeze the snowflake.

## 1.37.0 – 2026-10-14

Coder `2.0.0-platform.41` (fork `342887302`), workspace image `coder-workspace:1.8.5` (unchanged).

* **The layer bundle**, a third deliverable beside the full bundle (and `-slim`):
  `coder-airgapped-<version>-layer.tar.gz`, the customization layer alone, for a cluster that runs the previous
  release (installed from a full bundle). It carries this chart, its installers and only the images changed since
  that release; images of ours as **thin** archives, just the layers their previous version lacks (workspace image
  1.8.4 -> 1.8.5: 0.6 MB instead of 1.9 GB); no third-party chart or image unless it changed. `./make --deploy` from
  it:
  * takes the settings (certificates, answers, client secret) from the previous install's folder (asked once;
    `PREVIOUS=<folder>` with `--yes`), so the cluster keeps its CA;
  * checks first, changing nothing until it passes, that the cluster has what the layer does not carry: Coder
    installed, Traefik and CloudNativePG at this release's chart versions (or the cluster's own, left alone), the
    Gateway API CRDs, Minikube's Keycloak at this release's version, and every image not carried, on every node or
    in the registry; anything missing is listed;
  * makes each thin image whole from its base image (this machine's docker, a Minikube node, or the registry),
    every layer checked by its digest, then loads or pushes only what the layer carries.

  `development/tools/build-bundle.sh` writes it beside the others, on the newest release before this one
  (`--layer-base VERSION` for another, `--no-layer` for none); `helm-chart/layer-support` builds, checks, restores
  and describes it (`./layer-support info`).
* **Workspaces list:** a workspace being started, updated or restarted has a semi-transparent barber pole moving
  diagonally across its whole row until it is completely initialized (startup scripts done and every app's health
  check answered), so the row shows its app icons the moment it ends, or until its start failed (with animations
  off the stripes stay still).

## 1.36.0 – 2026-10-14

Coder `2.0.0-platform.39` (fork `7cf80f05d`), workspace image **`coder-workspace:1.8.5`** (the template has a new
version: update workspaces to get the new image).

* **Workspace image: 223 → 83 medium findings** (still no critical and no high; grade B). Every one left had no fix
  released, so 1.8.5 removes the packages a workspace pod has no use for, and nothing else:
  * **PulseAudio** and its ALSA plugins: no sound reaches the browser over VNC. With them go **ffmpeg's libraries**
    (libavcodec, libavutil, libswresample, x264: 97 findings) and snapd's GLib library with **libsoup** (18), which
    XFCE's weather panel plugin also needed (it needs the internet; it goes too). Firefox still plays WebM, VP9, AV1
    and Opus with its own decoders; H.264 and AAC (MP4) videos need ffmpeg;
  * **GNU coreutils instead of Rust coreutils** (uutils, 20): Ubuntu's own switch (`coreutils-from-gnu`), the
    coreutils every script was written for. The `build-essential` metapackage goes (Ubuntu 26.04's requires the Rust
    ones); gcc, g++, make and the rest it names stay;
  * `ipp-usb` and `avahi-daemon` (USB printers), `dmsetup`, `nodejs-doc`, gstreamer's GL plugin.

  XFCE's other goodies stay, as does everything the template and Lock Down use. The build checks that none of the
  removed packages come back and that the kept ones are still there. No program or library in the image links to a
  library that is missing (as in 1.8.4). What is left: glibc, GLib, jq, Vim, git, tar, poppler, PyJWT (for
  add-apt-repository), pip (for every venv) and others in use, waiting on Ubuntu's fixes.
* **Admin Settings:** each category in General's sidebar shows the icon its quick link has in the Admin menu (Super
  Intelligence and Health too), and so does the breadcrumb (Admin Settings with the Settings icon, then the
  category's).
* **Account view (User Settings):** an icon before every page, in the style of the rest: Account (the avatar menu's),
  Security, SSH Keys, Tokens, Secrets, Certificates, Notifications (and Schedule, OAuth2 Applications where offered);
  User Settings in the breadcrumb has the Account icon.
* **Workspace terminal:** the columns x rows readout is a small pill, further from the top and right edges, shown only
  while the text size is being changed (it fades out 2.5 seconds after the last change).
* **HUD:** an icon before each figure's name, for what it measures: CPU, memory, GPU, users, workspaces, running,
  online time, failures, ping, disconnected agents, unhealthy apps (every CPU figure has the CPU icon, and so on).
* **No classification bars on the terminal page** (the terminal in a browser window of its own): the terminal fills
  the whole window. Every other page keeps them.

## 1.35.0 – 2026-10-14

Coder `2.0.0-platform.35` (fork `ac6508b0e`), workspace image **`coder-workspace:1.8.4`** (the template has a new
version: update workspaces to get the new image).

* **The workspace image's scan: grade B, no critical and no high finding** (1.8.3: D, 64 high). In 1.8.4:
  * every package upgraded at build time (Ubuntu's and Docker's fixes since the base was built);
  * **File Browser built from its source** (2.63.23) with Go 1.27.2 and the fixed golang.org/x modules (net 0.61.0,
    crypto 0.58.0, image 0.47.0): its release binary was built with Go 1.26.5 and older modules (14 high);
  * **`basic-ftp` 6.2.3 in code-server** (it shipped 5.3.1: GHSA-c475-qrg2-pj4r and others), checked by its npm
    SHA-512, like `shell-quote` before;
  * **Docker's engine and plugins removed** (dockerd, containerd, buildx, compose): a workspace pod has no
    privileges to run them, and their Go builds carried known vulnerabilities; the docker CLI stays (29.9.0), for a
    remote daemon;
  * the base's stray `/usr/bin/pebble` removed (no package owns it, nothing uses it; Go 1.26.7);
  * marimo's environment without its own pip (nothing uses it after the build; pip vendors vulnerable `urllib3`,
    `msgpack` and `setuptools`); users' `~/.marimo-venv` has its own.

  What is left is 223 medium findings with no fix released (Ubuntu 26.04's own packages: ffmpeg's libraries, Rust
  coreutils, libsoup, ...), so grade A (at most 20 medium) is not reachable without removing parts of the desktop.
* **The scan sets apart findings that cannot apply to a container**, listed in the report (Images > the image) with
  the reason, the packages and every finding, and left out of the counts and the grade. Two narrow rules:
  * `linux-libc-dev`, the kernel's header files: Ubuntu files every Linux kernel vulnerability under it (2,625 in
    1.8.4: 22 high, 2,603 medium), but a container runs its node's kernel, never one from the image; patch the
    nodes;
  * Mozilla's own Firefox (packages.mozilla.org) matching Ubuntu's advisories for its snap-installer package
    (fixed: `1:1snap1`), only those two years old or more (16 in 1.8.4, from 2021 and 2022): fixed in Mozilla's
    releases long before this one.
* **Fixed (Minikube):** `minikube image load` leaves a copy of each loaded image in every node
  (`/var/lib/minikube/images`), every earlier tag too: about 2 GB a node per workspace image, which filled the disk.
  `./make --deploy` now deletes those copies once the image is in the node.

## 1.34.0 – 2026-10-14

Coder `2.0.0-platform.34` (fork `4885d2c81`), workspace image `coder-workspace:1.8.3` (unchanged); the workspace
template has a new version (Lock Down's Freeze; update workspaces to it).

* **Lock Down: Freeze.** A fourth mode: Complete (no network but Coder, no sudo) and every process in the workspace
  paused where it is, Coder's agent too, so nothing in it runs and nobody can open a session in it. Its disk is
  snapshotted at that moment: a VolumeSnapshot where the cluster can make one (the snapshot API and a
  VolumeSnapshotClass for the volume's CSI driver, as on EKS with the EBS CSI driver), else a copy of the home volume
  in a new volume (`coder-freeze-<workspace>-<time>`) by a Job on the workspace's node. The processes that were
  running are kept with it. Lifting Freeze resumes exactly what it paused, and the agent reconnects. The snapshot
  stays until an admin deletes it from the Lock Down menu, or until the next Freeze replaces it. A stopped workspace
  can be frozen too: its disk is copied as it was left, and it is frozen from its next start.
* **Every lock comes back after a restart**, until an admin lifts it: Network and Sudo at start (as before), and
  Freeze right after (the watcher pauses the new pod's processes within seconds).
* **The Lock Down notice** is centred, between two shields.
* **The network lights while the network is locked** (Network, Complete or Freeze): both red and still, and the
  hover graph starts afresh and records no traffic ("Locked down: no traffic"), whether or not the agent still
  reports (Freeze pauses it).
* **Fixed (Lock Down):** lifting a lock right after a restart, before the watcher had seen the new pod, left what the
  pod's start had set (sudo) in place; Freeze now also pauses the sandboxes programs start in the workspace
  (bubblewrap's, with a root of their own).
* **Workspace page:**
  * the apps' box and the metrics' boxes fill the card's width, and the box of apps is as wide as the metrics under it;
  * the apps are centred in equal columns spread across that width;
  * each metric's graph is a little wider (up to 136 px);
  * both groups, Workspace and Cluster, show their metrics in the same order: CPU, RAM, Disk, Ø Load (the load
    average, "Load Avg" before). The template orders them so (the workspace's Disk now comes before its load), and the
    dashboard does too, for workspaces built from older template versions;
  * readings show one decimal place (`0.6/6 cores`, `19.5/98.6 GB`, rounded half up).
* **The Add Panel tab** is a half-moon above the top panel, with the "+" in a small circle in the theme's accent colour
  (it follows the theme), sitting at the half-moon's foot, centred on the panel's border.
* **The announcement's Viewed badge** sits a little further right and is bigger, its ribbons hanging past the banner
  into the navigation bar.
* **Resources and Admin menus:** an icon before every item: Workspaces, Templates, Images; Settings, each quick link
  (and each page in its add menu), Organizations, Audit logs, Connection logs, AI sessions.
* **`./make --push-images <harbor>[/<project>]`** (new helper `harbor-support`): every image the solution needs and
  its Helm charts into your Harbor. It reaches Harbor's API (a private CA: helm and docker are set up to trust it,
  docker's with sudo after asking), logs your docker and helm in to Harbor (a user or a robot account) and, on
  request, to Docker Hub (passwords on stdin only, never stored), checks or creates the project (public or private,
  with what each means for the cluster), pushes the images and the charts (`coder-airgapped`, CloudNativePG,
  Traefik: `oci://<harbor>/<project>/charts`, new `mirror-images.sh charts`), checks each one is there, and
  remembers the registry for `./make --deploy`.
* **Fixed:** the announcement banner showed inside marimo (and could in any path-based workspace app): Traefik ranked
  the banner's page-load rule (prefix `/` with an Accept header) above the apps' passthrough (`/@`, no header), so
  the loader was injected into marimo's page. App page loads now have a rule of their own, and the loader does
  nothing on a workspace app's page.
* **Templates:** the Embed tab is gone, along with the ⋮ menu's Share entries and Export as TAR. **Export as ZIP** now
  holds the whole template: its Terraform, its scripts and other files, and every icon it uses that this deployment
  serves (the template's own, its apps', parameters' and metadata's), under `icons/`, with `icons/index.json` saying
  where each one is served. The ⋮ menu shows only to template editors. Old `…/embed` links open the template.
* **Customize > Sign-in and sign-out page:** the sign-in page's title (the deployment's name by default), the text
  effect it is drawn with (Wireframe, the traced outline it has always had; Neon; or Plain), that effect's colour and
  speed, and a message under it, with a different one right after signing out. With a live preview of both. Saved by
  the platform service (`/__coder-ui/api/login-page`, public to read) and handed to every page in `boot.js`, so the
  page never flickers.
* The live Lock Down test (`verify/lockdown_live.py`) checks Freeze, its snapshot's contents, restarts with each mode,
  and lifting.

## 1.33.0 – 2026-10-13

Coder `2.0.0-platform.33` (fork `599afe8ed`), workspace image `coder-workspace:1.8.3` (unchanged).

* **The network lights' live graph:** hovering the workspace's RX / TX lights (or focusing them from the keyboard: the
  oval is a button now) shows its traffic over the last minute: for each reading, a bar for what it received (green)
  and one for what it sent (blue), side by side across the seconds the reading covers. The time axis follows the
  readings' own times (the agent batches its metadata, so they arrive every few seconds although the template asks
  for one a second). The Y axis scales with the busiest reading shown, to a round top in B/s, KB/s, MB/s or GB/s
  (0 / 25 / 50 MB/s, not raw bytes), and the legend gives the current rates. The readings are kept from when the
  page opened, so the graph already has them when it opens; it updates live while it is open.

## 1.32.0 – 2026-10-13

Coder `2.0.0-platform.32` (fork `716ec4dec`), workspace image `coder-workspace:1.8.3` (unchanged).

* **Lock Down: admins jail a workspace**, for instance when an agent in it runs away. From the workspace page's left
  sidebar (the shield; admins only), three modes:
  * **Network:** the workspace reaches nothing but Coder: everything in or out is refused, connections already
    open too, IPv6 entirely. Its agent stays connected, so admins still open its terminal and apps (they go through
    Coder) and inspect what runs there.
  * **Sudo Command:** nobody in the workspace can use sudo any more (a last sudoers rule denies every command).
  * **Complete:** both.

  It works on a **running** workspace at once, without a restart: an ephemeral container (the workspace's own
  image, root with NET_ADMIN and SYS_PTRACE, sharing the workspace container's processes) sets it, so the
  processes keep running for the admins to look at. On a **stopped** one it holds from its next start: the pod's init
  container sets Network before anything runs, and a start script that blocks login sets Sudo. It cannot be undone
  from inside: the workspace container has no NET_ADMIN, so not even root there can change the firewall, and
  without sudo nobody becomes root. Everyone who sees a locked workspace (its owner too) gets a notice of what is
  locked, by whom and since when; it stays until an admin lifts it. The settings are the ConfigMap `coder-lockdown`
  (the platform service makes it; Helm and Argo CD leave it alone), and a watcher keeps every running workspace as
  it says. Needs a namespace that allows NET_ADMIN and SYS_PTRACE in those two containers (Pod Security `privileged`,
  or none set, as by default).

## 1.31.0 – 2026-10-13

Coder `2.0.0-platform.31` (fork `2e7ae6ff9`), workspace image `coder-workspace:1.8.3`.

* **The workspace's network lights:** in the workspace panel's header, between the workspace's name and the latency,
  a small oval with **RX ↓** (green) and **TX ↑** (blue) that light up like a network card's activity LEDs when the
  workspace receives or sends data: each second with traffic flickers its light, more often the busier it is (the
  tooltip gives the rates). The template reports the workspace's own byte counters every second (`net` in
  `metadata.sh`, metadata `8_net_io`, every interface of its pod but loopback); it is not one of the metric displays.
  A workspace on an older template version shows the lights dimmed until it is updated.
* **The Inbox's buttons show what they do.** Both worked, but looked broken: Mark all as read stayed clickable with
  nothing unread (and then changed nothing), and Clear all's first click only turned its icon red. Now Mark all as
  read is disabled when nothing is unread ("Nothing unread") and says how many it marked; Clear all's first click
  opens it into a labelled "Clear all?" for 4 seconds, and it says how many notifications it deleted.
* **The workspace image's critical vulnerability is fixed** (CVE-2026-102422, arbitrary command execution in
  `shell-quote`). code-server 4.141.0, the newest release, ships shell-quote 1.10.0 among VS Code's modules; the
  image build replaces it with 1.12.0 (the newest; 1.11.0 fixed it), checked by its npm SHA-512. quote and parse give
  the same results as before, and nothing in VS Code's own code loads it directly. The step goes once a code-server
  release carries a fixed shell-quote. The Images entry of the workspace image scans 1.8.3 when it is deployed.
* **The HUD shows System Uptime**, a small pill under Live: how long the Coder server has been up and online, since
  its oldest ready replica started (from Kubernetes; a restart starts it again). It counts on between updates.
* **The workspace page's eight metrics fit on one line** (Workspace: CPU, RAM, Load Avg, Disk; Cluster: CPU, RAM,
  Disk, Load Avg) from 1280 px wide up, where they scrolled before: graphs 104 px wide (were 120), tighter gaps and
  13 px values. The workspace Load Avg (1.29.0's `load` in `metadata.sh`) shows once a workspace is updated to a
  template version from 1.29.0 on.

## 1.30.0 – 2026-10-13

Coder `2.0.0-platform.28` (fork `4e31952b0`), workspace image `coder-workspace:1.8.2`.

* **Images lists the image the workspaces run.** The workspace template's own image (`coder-workspace`, "In use by
  workspaces") is an entry of Templates › Images, first in the list, so everyone can see what they would take into
  their enclave before building on it or starting a workspace:
  * its **security health**, scanned like a built image (vulnerabilities, secrets, the image checks, FIPS readiness)
    from the builder's own copy of it (seeded at install), with no internet; rescanned with every new security data
    set (Rescan all) or on demand;
  * its **add-ons**: every program it adds over `enterprise-base` with the version that program reports (21: the
    desktop, code-server, File Browser, marimo, Firefox, k9s, kubectl, kubelogin, tmux and the command-line tools),
    the 20 apt packages it asks for (601 dependencies counted beside them) and marimo's 142 Python packages.
  * It follows the platform: a chart upgrade that ships another workspace image updates the entry and scans it. It
    is read-only there (no edit, build, delete or S3); New Image still builds on it.
  * Workspace image 1.8.2 records its add-ons when it is built (`/usr/share/coder-workspace/addons.json`, from
    `development/workspace-image/addons/addons.py`): the base's package list is saved before anything is installed,
    and the build fails when a program does not say its version. Images built on it show the same list.
* **The Inbox (the bell) can be cleared:** a Clear all icon button left of Mark all as read, which is an icon button
  now too. Clear all deletes the user's own notifications (Coder can only mark them read), through the platform
  service; it asks twice (the first click arms it for 3 seconds).

## 1.29.0 – 2026-10-13

Coder `2.0.0-platform.27` (fork `6b26be930`), workspace image `coder-workspace:1.8.1` (unchanged).

* **The workspace template's scripts are files of their own,** in `charts/coder-workspace/files/scripts/`: the
  startup script, the certificate install, the agent activity monitor, and the metrics in one `metadata.sh` with a
  function each (`ram`, `ram_host`, `disk`, `disk_host`, `load`, `load_host`): a metric runs the file with its
  function's name appended (`bash metadata.sh ram` tries one by hand). The `.tf` files read them with `file()`, or
  `templatefile()` where they need the template's values; `main.tf` went from 967 lines to 530. Formatted with `shfmt -i 1`; the static checks keep them formatted,
  `bash -n` clean and in the push's ConfigMap, and no script back inline.
  * `startup.sh` gets the template's values once, as shell variables at its top (`OWNER_NAME`, `CLUSTER_ADMIN`, …),
    instead of Terraform references throughout.
  * Checked by rendering the template with Terraform (offline): extracted as they were, every script came out byte
    for byte the same; after formatting, they differ only in layout, comments and those variables.
  * **The agent activity monitor's forwarder starts** (`agentAudit`, off by default). The end marker of its
    `forward.py` heredoc was indented, so bash never found it: the heredoc ran to the end of the script, which
    left the forwarder unstarted. As a file, the Python sits in column 0 and needs no `sed` to un-indent it.
* **A workspace load average** (Load Avg, in the Workspace group next to CPU and RAM). `/proc/loadavg` is the
  node's, so `load` counts the kernel's way from the workspace's own threads (running, waiting for a CPU, or in
  uninterruptible sleep), in a 1-minute decaying average with the kernel's weight, over the workspace's CPU limit:
  three busy processes in a 2-core workspace read `3.00 / 2 cores (150%)`.
* **An easter egg in the announcement's terminal** (the banner's down arrow): its prompt takes typing. Enter answers
  any command with a wagging finger (`no-no.gif`, printed inline as image-capable terminals do) and
  "ahh ahh ahh..." typed out with the banner's typewriter effect; typing `skynet` fades the whole screen into the
  Skynet logo (fitted to any screen shape, on black). A click or any key dismisses it: the
  picture tears into shifted, colour-split slices and collapses like an old screen switching off. Without animations
  (the setting, or reduced motion) it simply fades.
* **The Viewed box's tooltip names the user's certificate:** `Certificate Fingerprint:` (its SHA-256) and, on the
  next line, `MD5 HASH:` (its MD5), in place of `TLS/x509 Fingerprint:`; both lines are left out when the user has
  no certificate. Settings › Certificates now records the MD5 with the SHA-256 at upload (WebCrypto has no MD5:
  the dashboard computes it, checked against RFC 1321's test vectors). A certificate uploaded before says "not
  recorded" for its MD5 until it is uploaded again.
* **The template is shown as UBUNTU, with the Ubuntu icon** (`coder-workspace.template.displayName` / `icon`). Its
  name, and so its URL and the CLI's `ubuntu-vnc-desktop`, stay. They are set where the template has none (a new
  install, or one that never had them): a display name or icon set in the dashboard is kept.

## 1.28.2 – 2026-10-13

Coder `2.0.0-platform.25` (fork `c174bed4b`), workspace image `coder-workspace:1.8.1` (unchanged).

* **Template Details, Parameter usage: number values without quotes.** A number parameter such as the home disk size
  showed as `"20"`. The stored values were plain numbers: upstream's panel puts every value without options in
  quotation marks, the mark of text, numbers included. Numbers now show as themselves; text values keep the quotes.

## 1.28.1 – 2026-10-13

Coder `2.0.0-platform.24` (unchanged), workspace image `coder-workspace:1.8.1`.

* **code-server 4.141.0 (VS Code 1.141), the newest release,** in the workspace image. 1.8.0 pinned 4.139.1 (VS Code
  1.139), while workspaces had been downloading the newest at every start, so updating a workspace to 1.28.0's
  template moved VS Code back. Still pinned by SHA-256 (the same as GitHub's for the release file) and checked
  offline when the image is built. File Browser stays 2.63.23, its newest release.
* Nothing else changes: the template, the server and the other images are 1.28.0's. Workspaces show as outdated;
  **Update** restarts them on the new image and keeps their home.

## 1.28.0 – 2026-10-13

Coder `2.0.0-platform.24` (fork `fafe5314b`), workspace image `coder-workspace:1.8.0`. Release-readiness work: a
full check of the published 1.27.2 against an air gap, Keycloak outages, EKS, rollback and load, with fixes for what
it found. The report is [`docs/READINESS.md`](docs/READINESS.md).

* **Coder runs without Keycloak.**
  * Upstream Coder fetches the OIDC issuer's discovery document at startup and exits when it can't. So while
    Keycloak was not set up, or down, Coder crash-looped and nobody could sign in, owners with passwords included.
  * Now a Keycloak issuer gets its standard endpoints without discovery: Coder starts, password sign-in works, and
    "Sign in with your certificate" works as soon as Keycloak answers. Any other OIDC provider: Coder starts with
    password sign-in only and restarts itself cleanly once the provider answers.
  * The Keycloak Secrets (`keycloaking-coder-oidc`, `keycloaking-coder-ca`) are optional, so the Coder pod starts
    before they exist; `install.sh` says so instead of warning that Coder won't start.
* **The first owner is always the installer's, and an Argo CD install always gets it.**
  * Upstream makes whoever signs in first with Keycloak the owner. Under Argo CD the bootstrap Job ran as a
    PostSync hook, which waits for every resource to be healthy. Where metrics-server cannot reach the kubelets, its
    APIService never became ready, so the bootstrap never ran: no admin, no template, and the first person to sign
    in with Keycloak became the owner. Found by the air-gapped end-to-end test on 1.27.2.
  * Now the bootstrap and the template push are Sync hooks in waves 3 and 4, once Coder and its database are
    healthy. metrics-server is in wave 5, after them.
  * Coder refuses Keycloak sign-ins while it has no user at all (`CODER_PLATFORM_FIRST_OWNER=bootstrap`: "Coder is
    being set up, try again in a minute").
* **Workspaces need nothing from the internet.**
  * Workspace image 1.8.0 has code-server 4.139.1 and File Browser 2.63.23 preinstalled, pinned by SHA-256 and
    checked offline when the image is built. The template used to download both at every workspace start, which
    fails in an air gap, so those two apps stayed unhealthy.
  * The template now uses the image's copies and downloads only on an image without them. code-server runs with
    telemetry and its update check off.
* **No floating images:** the template push Job's CLI is Coder's own image, the same `coder` as the server. It used to
  be `ghcr.io/coder/coder:latest`, dropped from the bundle (244 MB smaller).
* **Image builder offline and on EKS:**
  * Builds start from the workspace image in the builder's own registry. `./make --deploy` seeds it on any cluster,
    and `./mirror-images.sh seed-builder` does it after an Argo CD install, through `kubectl port-forward`. Before,
    on EKS, BuildKit had to pull it from your registry, which needs credentials: ECR with node roles has none.
  * A GNOME build, or one with apt packages, and no apt mirror is refused before it starts, with the reason. It
    used to fail halfway.
  * With no reachable apt source, the package check answers in seconds: it waited over two minutes per source.
* **The image builder's registry starts on a fresh install:** its garbage-collect step failed on an empty volume
  ("Path not found"), so on every new install the registry crash-looped and the image builder could not build. Found
  by the air-gapped end-to-end test; the development cluster's registry already had data.
* **EKS volumes:** workspaces' home volumes and the image builder's take the chosen StorageClass. EKS clusters may
  have no default class, which left them Pending.
  * `coder-workspace.storageClass` sets it for workspaces; `./make --deploy` sets it everywhere off Minikube. The
    example values and the Argo CD file have it.
  * A volume's class never changes after it is made, so existing homes are never replaced.
* **Rollback image:** `coder-upstream:2.38.0-main.70bc2e554-airgap` is pure upstream Coder at the fork's base, in
  the bundle. No published upstream release can take the fork's database yet: v2.38.0 stops at migration 605, the
  fork is at 611. `development/coder-fork/ROLLBACK.md` has the procedure. Tested on a copy of the development
  database: upstream starts, sees everything, and the fork rolls forward.
* **A slow platform service no longer holds the dashboard up:** every page waits for its boot script
  (`/__coder-ui/boot.js`); Coder now gives it 3 s and then serves an empty one, so the dashboard starts with its
  defaults. Quota and schedule checks already let workspaces through when the service gives no answer.
* **Under load:** the platform service's session cache is least-recently-used with 20,000 entries. It used to be
  cleared whole past 2,000, which under a large team sent every request back to Coder's API.
* **A verification suite,** `development/tools/verify/` (`run.sh`):
  - static checks of the deliverable;
  - the fork's unit tests (Go, vitest, the platform service);
  - a live conformance suite of Coder's own capabilities and the fork's (`live.py`, with the web terminal end to
    end);
  - browser checks with an egress check and a memory soak (`ui.mjs`);
  - the rollback test (`rollback.sh`);
  - a load test (`load.py`).
* **Air-gap end-to-end test:**
  - `setup.sh` scripts its one-time setup;
  - step 8 fails on unhealthy workspace apps (it only printed them);
  - step 9 builds an image offline and runs it on the node;
  - etcd runs in memory, so a busy machine no longer fails the test.
* **Documents:** `docs/FEATURES.md` (everything the fork adds to Coder Community Edition), `docs/READINESS.md`,
  `development/coder-fork/UPSTREAM.md` (following upstream releases, with a trial merge), `ROLLBACK.md`.

## 1.27.2 – 2026-10-12

Coder `2.0.0-platform.23` (rebuilt: `0eb28965f`).

* **Admins' kubectl and k9s work for owners who sign in to Coder with a password.** The platform service kept the
  Keycloak group `coder-cluster-admins` equal to the Coder owners who sign in *with Keycloak* only. The built-in
  `admin` and any other password owner were never added. Their kubectl sign-in (Keycloak's device login) succeeded,
  but the cluster gave that identity no rights: kubectl and k9s showed the context and nothing else. Now every Coder
  owner counts, whichever way they sign in to Coder, as the Keycloak account with the same email, else the same
  username (e.g. Coder `admin` → Keycloak `admin`, `greg` → `greg@greg.com`). A token issued before the fix has no
  group: sign in again (or wait up to 10 minutes for the refresh).
* **A template renamed in the dashboard keeps getting the chart's updates.** The install pushed the template by its
  configured name (`ubuntu-vnc-desktop`). After a rename it found none, created a second, empty template, and the
  workspaces and their usage history stayed on the first. The push now looks first for the template that holds this
  release's deployed versions and pushes to it under its new name.
* **A template's Details are part of its Overview,** between the resources and the README, instead of a tab of
  their own: active users, latency by user, app & IDE usage, activity by user, parameter usage, with the interval and
  date range. Links to `…/insights` open the Overview at Details.

## 1.27.1 – 2026-10-12

Coder `2.0.0-platform.23` (rebuilt: `9185891af`).

* **Memory in GB:** the workspace's RAM Usage and the cluster's Memory Usage read in GB (10^9 bytes), like the disks,
  instead of `coder stat`'s GiB. The template takes the bytes from `coder stat mem -o json` (the workspace's cgroup;
  with `--host`, the node's), e.g. "0.51/2.15 GB (24%)".
* **Each metric's percentage sits in a chip to the right of its name,** above the gauge, tinted like the graph (green,
  yellow-green, yellow, orange, red). The value below the graph drops it: "CPU Usage [ 9% ]", then "2.24/24 cores".
* **The workspace's apps are in a squircle** (File Browser, code-server, marimo, the terminal, ...) like the metrics'
  Workspace and Cluster squircles. Its left and right edges line up with the metrics row below it: both sit in one
  centred block as wide as the metrics, and the apps wrap within it. Without metrics, it takes the card's width.
* **A smaller "+" tab** above the Logs/Terminal panels (an 18 px button in a 24 px tab), with more room above it, so
  it no longer crowds the metrics' squircles.
* **The running workspace's border pulse is more obvious and follows the theme:** a 3 px border that glows as it
  pulses and two rings spreading 18 px, the second half a beat behind. Its colour is the selected theme's success
  colour: green in Light and Dark, blue in the colour-blind themes.
* **The sign-in page's name is a traced outline:** "Coder" (or the name set in Appearance), faintly filled, with a
  dashed cyan stroke endlessly tracing its letters (after the "Wireframe" effect given), in the bundled JetBrains
  Mono. It is what signing out lands on too. The light themes get a darker cyan; with the Animations switch off or
  reduced motion, the outline is whole and still.
* **Shorter metric names:** CPU Usage → CPU, RAM Usage and Memory Usage → RAM, Load Average → Load Avg (in both the
  Workspace and Cluster groups).
* Running workspaces show the memory in GB and the new names after their next update (the template's metrics come
  with the build).

## 1.27.0 – 2026-10-12

Coder `2.0.0-platform.23` (rebuilt: `52a871d12`).

* **Security data that can be kept current in an air gap.** The image builder grades images with trivy's
  vulnerability database, its Java database and the FIPS rules. Until now these were fixed at the bundle's date.
  * **`development/tools/build-security-data.sh`**, run on a machine with internet access, makes a dated
    `coder-security-data-<date>.tar.gz`. It holds both databases, downloaded by the bundle's own trivy so the schema
    matches, the FIPS rules, and a manifest with every file's sha256. `--no-java` makes it about 100 MB instead of
    about 1.1 GB.
  * **Templates › Images › Settings › Security data** (admins): load the file, which is checked file by file against
    its manifest and against trivy's database schema before it becomes active. The previous set is kept, and the
    bundled data is one click away. It shows when the vulnerability database, the Java database and the FIPS rules
    were last updated, and how old each is (ageing after 14 days, out of date after 30).
  * **A "Security data" badge on the Images page** with the vulnerability database's date, green, amber or red.
  * **Rescan**: one image (its page) or all built images (Settings), scanned again with the data in force. Nothing
    is rebuilt; each image gets a new report for its current version.
  * **Java archives (.jar, .war, .ear) are scanned** whenever the Java database is loaded (the bundle skipped them).
  * **The FIPS rules are a versioned, dated file** (`files/ui-updates/fips-rules.json`: FIPS 140-3, the NIST SP
    800-140C / 800-131A / 800-52 guidance, Canonical's validated modules). The FIPS check grades against them, and
    FIPS-aligned crypto in new builds applies them (SSH algorithms, the TLS floor).
  * **Every report says what graded it:** the vulnerability database's date (and its age when scanned), the Java
    database, the FIPS rules' version and date, trivy's version. When newer data is loaded, the report says so and
    offers a rescan.
* **The running workspace's border pulses** instead of a comet of light running round it. The agent card gets a 2 px
  green border (#27c45e) with a soft ring that expands 12 px and fades every 2 s, as in the example given. It pauses
  while the pointer is on the card, and stays still with the Animations switch off or reduced motion.
* **The agent's Update pill shows whenever the workspace should be updated.** Before, it showed only for an agent of
  an older version (semver), so it never showed for an agent from another build of the same version (only the
  build metadata differs: Coder rebuilt under the same version). Now it shows for:
  * an older agent or API, as before;
  * an agent from another build of the server's version;
  * a workspace whose template has a newer version.

  Its popover says which, with "Update workspace".
* Fixes found along the way:
  * the platform service reads the databases' dates from their metadata instead of running trivy (which took it
    past its memory limit);
  * the scan Job's fetch of the data flushes to disk as it goes (it ran out of memory);
  * a scan pod that fails in its init container ends the scan at once with the reason, instead of after 30 minutes.

## 1.26.3 – 2026-10-12

Coder `2.0.0-platform.23` (rebuilt: `285a02453`).

* **Home Disk shows the workspace's own disk, in GB.** On a storage class whose volumes are directories of a bigger
  disk (local-path, hostPath: Minikube), `df` of the home showed that whole disk. A 25 GB workspace read "872/935
  GiB (93%)".
  * The template now passes the volume's size, as Kubernetes has it (so a grown disk counts), to the workspace as
    `CODER_HOME_DISK_SIZE`.
  * The metric compares the home's use with that size: `df` where the file system is the volume (EBS on EKS), else
    `du` of the home.
  * Shown in decimal GB, e.g. "0.4/26.8 GB (2%)".
* **New workspaces get the GB they ask for:** the home volume is `<size>G`, as the parameter says, no longer
  `<size>Gi`. Existing volumes keep their size; a 25Gi one shows as 26.8 GB.
* **Expand disk** works in GB too.
* **Load Average (Host) fixed:** the host's load (`/proc/loadavg`) was divided by `nproc`, which in the container is
  the workspace's CPU limit. A 24-core host with a load of 6 read 1.0, "fully loaded". It is now divided by the
  host's online cores and shown as "6.39 / 24 cores (27%)", so its graph and colour follow the percentage.
* **A gauge of the current reading above each metric's graph:** a pill filled to the reading and coloured by it (green
  to red). It follows the Metrics Interval (each second at 1 s, the newest bar otherwise) and slides from one reading
  to the next.
* **The metrics in two groups**, each in a rounded container:
  * **Workspace:** CPU Usage, RAM Usage, Disk ("Home Disk" before).
  * **Cluster:** the node the workspace runs on (CPU Usage, Memory Usage, Disk, Load Average). "(Host)" is dropped
    from their names; the group says it. Host metrics are told by their key (`_host`) or an old "(Host)" name.

  Both groups sit side by side on one centred line, with their headings centred. They don't wrap: the line fits
  windows from 1280 px, and scrolls sideways on narrower ones. A template without host metrics keeps the plain row.
* **New Cluster Disk metric:** the node's disk (where its images and containers live; on Minikube, the host's disk)
  in GB.
* Running workspaces show the new Disk names, the Cluster Disk and the fixed Load Average after their next update and
  restart (the template has a new version).

## 1.26.2 – 2026-10-12

Coder `2.0.0-platform.23` (rebuilt: `022e2cc56`).

* **Metrics Interval: 1 s by default** (until a browser has chosen another).
* **The choices are in order of length:** 1 s, 5 s, Live (at the agent's own interval, 10 s), 30 s, 1 min, 5 min,
  then Off.
* **A compact menu** (232 px wide, half its former height). Each choice is one line: the interval in its circle, its
  name, and on the right the span the graphs cover (40 s to 3.3 h). The longer explanations are on hover. A
  one-line colour scale (<50, 50, 65, 75, 90 %) and how often the agent reports sit above and below.

## 1.26.1 – 2026-10-12

Coder `2.0.0-platform.23` (rebuilt: `fbfb8f451`).

* **Workspace metric graphs, coloured by magnitude.** Each bar shows how much of what there is its reading uses:
  * green under 50 %;
  * yellow-green at 50–64 %;
  * yellow at 65–74 %;
  * orange at 75–89 %;
  * red from 90 % (critical).

  Load average counts per core (1.0 = every core busy). A metric without a scale stays green.
* **Metrics Interval menu**, in the agent card's header, directly left of Open ports and built like it: the interval
  in the circle (10s, 1s, 5s, 30s, 1m, 5m or off), then "Metrics Interval". Its menu offers:
  * Live (a bar per reading, as the agent sends it);
  * 1 s or 5 s: the graphs advance every second or five. Between the agent's readings (every 10 s, set in the
    template), the last reading holds, drawn dimmer;
  * 30 s, 1 min or 5 min (a bar per period, its highest reading, so spikes stay visible; 40 bars cover 20 min to
    3.3 h);
  * Off (no graphs and nothing recorded, for a browser short on processing power).

  It also says how often the agent reports each metric (Home Disk and Load Average every 60 s) and shows the colour
  legend. The choice is remembered in the browser.

## 1.26.0 – 2026-10-12

Coder `2.0.0-platform.23`.

* **HUD: live usage, and three graphs under the totals.**
  * **metrics-server is now part of the chart** (`metricsServer.enabled: auto`): it is installed only where the
    cluster has no metrics API yet, so an existing one (the EKS add-on) stays in charge. The HUD said "no live usage"
    because the cluster had none. On Minikube, `./make` sets `metricsServer.kubeletInsecureTLS`.
  * New totals: **CPU in use** and **Memory in use** by running workspaces, live, next to what they claimed.
  * **Graphs** of system latency (the median and 95th percentile of users' connections to their workspaces, from
    Coder's agent stats), total CPU used and total memory used (the cluster, and the workspaces' part of it). Ranges:
    15 minutes to 7 days, with hover details. The platform service samples them every 15 seconds whether or not
    anyone looks, and keeps 7 days (`/data/hud.sqlite`).
  * The "Live" mark turns amber when metrics-server does not answer. (Before, it went by whether any workspace pod
    was measured.)
* **Templates:**
  * **Overview** replaces Resources. It shows the resources, with the docs (README) below them; the Docs tab is gone.
  * **Source Code** holds the versions: a compact list under the file tree. Click one to see its code there; Promote
    sits on the right of each entry; small active / newest / failed marks.
  * **Squash** (template editors): pick the two ends of a range. The newest version of the range stays, with the
    others' messages added to its own, and the others are archived. The active version and any version a workspace
    still uses stay.
  * **Insights** is now **Details**.
  * **Embed** no longer shows the button preview or "Copy button Markdown". **⋮ › Share** copies the Open in Coder
    button (Markdown or HTML) or its link, with the Embed tab's settings. Share is in everyone's menu; the rest of
    the menu is still for editors.
  * Old links (`/docs`, `/resources`, `/versions`) redirect.
* **Workspaces:**
  * **Their own icon:** Settings › General › Icon (emoji, Coder icon or path). It shows in the workspaces list and
    next to the name on the workspace page. Empty: the template's icon again.
  * **⋮ › Back up home** (owners and admins): the home volume as a .tar.gz, to S3 (Images › Settings) or as a
    download kept 24 hours. A Job beside the workspace streams it; the workspace keeps running.
  * **⋮ › Expand disk** (owners and admins): a bigger home volume. Where the storage class grows volumes (EBS on
    EKS), in place, with one restart only if the file system needs it. Elsewhere (local-path), the workspace is
    stopped, its home copied onto a bigger volume that takes the old one's name, and started again; owners and modes
    are kept. Tested on Minikube: 1 → 3 GiB in 28 s, data intact.
  * The workspace template ignores the home volume's size after creation (`lifecycle { ignore_changes }`), so a
    later build never shrinks a grown disk.
* **Workspace metrics graphs** (workspace page, the agent's metrics): every metric (CPU Usage, RAM Usage, Home Disk,
  Load Average, the host's, …) has a live bar graph of its readings between its name and its value: the last 40
  readings (about 7 minutes), newest on the right, percentages on a 0–100 % scale, hover for each reading's time and
  value. Kept while the page is open.
* **Agent outdated indicator** (workspace page, next to the agent's name): the glowing green **Update** pill of
  `workspace-update.html` (rim, recessed refresh icon with a pulsing ring), built in HTML and CSS for both themes,
  instead of the badge images. Clicking it still opens the details and "Update workspace".
* **Images:** the New Image dialog fits without a horizontal scroll bar.
* New bundled image: `registry.k8s.io/metrics-server/metrics-server:v0.8.1`. The platform service's builder Role may
  now manage PVCs in the workspace namespace; workspace backups use the image builder's volume.

## 1.25.0 – 2026-10-12

Coder `2.0.0-platform.22`.

* **Templates › Images: an image builder in the cluster.** Workspace images for templates to run, built from the
  dashboard. The tab sits next to Templates (also in the Resources menu). The page shows a filtered table of images:
  status, contents, size, a security grade, FIPS readiness, when and by whom each was built, a download button and S3
  backup. Admins and template admins create, edit, build and delete images; everyone else can see them.
  * **The builder, step by step,** saved as you go:
    * **Basics:** the image starts from the workspace image or from another built image.
    * **Packages:** apt packages with suggestions as you type. Each is checked in the apt sources, about 150,000
      packages for Ubuntu 26.04, or your mirror. A package that isn't there is marked and stops the build until it is
      dealt with: upload its `.deb`, turn it into a manual installation, or remove it.
    * **Installations:** named, each a row that opens to its files (uploads up to 2 GB) and its bash script. The
      script editor highlights, lints with shellcheck as you type (squiggles plus a list), and formats with
      `shfmt -i 1`. A script with shellcheck errors stops the build.
    * **Remove & harden:** packages to purge (one the image doesn't have is skipped), plus 8 hardening switches:
      documentation, sudo, root password, setuid bits, compilers, umask, core dumps, SSH. Also FIPS-aligned crypto
      and your own hardening script.
    * **Desktop:** as the base has it, XFCE, GNOME (Flashback, made for VNC) or none.
    * **Configuration:** environment, aliases, functions and dotfiles (typed or imported).
    * **Review & build:** a summary, what stops the build, the build's steps, and the generated Dockerfile.
  * **Builds run as Kubernetes Jobs with BuildKit rootless.** They are pushed to a registry in the cluster
    (`coder-image-registry`). Every node pulls from `localhost:5000` through a small proxy DaemonSet, so no node
    needs configuring.
  * **The build view is the workspace start's panel:**
    * the stripes and bricks, "IMAGE BUILDING";
    * a bar that moves on the build's real steps;
    * the current and next step, the time taken, and a checklist;
    * the live log;
    * on failure, the step that failed and why (apt's own message).
  * **When an image is ready,** the build view shows its reference (`localhost:5000/coder-images/<name>:<version>`)
    and the Terraform for a template.
  * **A security health report for every build:**
    * vulnerabilities by severity (trivy, against the vulnerability database in the bundle), with the worst listed;
    * secrets found in files;
    * checks on users, passwords, root, sudo, setuid programs, world-writable files, SSH host keys, leftovers,
      packages and compilers;
    * a FIPS 140 check: the OpenSSL FIPS module and default, TLS, SSH, other crypto libraries, the kernel.
  * **Download** gives a `docker load` tarball. **S3 backup**, per image after every build or on demand, goes to AWS
    S3 or an S3-compatible store such as MinIO. The settings are in Images › Settings, and the secret key is never
    shown again.
  * Finished builds remove their Jobs (and BuildKit's scratch space) at once. A slow Kubernetes API is retried
    instead of failing the build. The registry garbage-collects deleted images' layers each time it starts.
  * **The workspace template follows the image:** its desktop session (GNOME), no desktop when it has none, and its
    dotfiles copied into home directories that lack them.
* **New images in the bundle:**
  * `ghcr.io/user187x/coder-image-tools:1.0.0` (`development/image-tools/`): Python with shellcheck, shfmt, trivy and
    its database, and regctl. It is now the platform service's image.
  * `moby/buildkit:v0.33.0-rootless`.
  * `registry:3.1.2`.
* **Platform service:**
  * memory limit 192 Mi → 512 Mi;
  * volume `coder-image-builder` (20 Gi);
  * registry volume (50 Gi).
  * Settings: `imageBuilder` in `values.yaml`. EKS notes: `DEPLOY.md` › *the image builder*.

## 1.24.1 – 2026-10-12

Coder `2.0.0-platform.21` (unchanged).

* **Cleanup: the platform service's old dashboard add-ons are gone.** These were 41 scripts, styles and pages in
  `files/ui-updates/` (`dashboard.js`, `views.js`, `chat.js`, …, about 570 KB). The fork's dashboard has had all of
  them built in, and nothing loaded them any more.
  * With them go the service's route for its static files, the `static` volume and `STATIC_DIR`. Only the service's
    own code remains: `ui-service.py`, `pgwire.py` and `certinfo.py`.
  * The Helm release is smaller, leaving more room under its 1 MiB limit.
* `example.html` is removed: it is the built-in Particles background now (1.24.0).

## 1.24.0 – 2026-10-12

Coder `2.0.0-platform.21`.

* **Animated and HTML backgrounds** (Customize › Background image), next to pictures.
  * **Particles, built in.** The animated background of `example.html`: glowing orbs circling slowly over a plain
    colour. Its own dials: the background colour, the three particle colours, how many particles (1–60), their size,
    how far each glow sits from its particle, and how soft it is. "Original colours and sizes" brings back
    `example.html` exactly.
  * **Your own HTML.** Paste a page (HTML with its CSS, and scripts if it needs them), or import an `.html` file (up
    to 256 KB). "Start from the Particles example" fills in the example to edit.
  * **Dials for every HTML background:**
    * **Speed** (0.1–4×) changes the playback rate of every CSS / Web animation on the page, so it works for any
      HTML;
    * **Hue shift, saturation, brightness and blur** are colour filters;
    * then the usual **strength** and **layer** (behind the page or over it).
  * A live preview shows the result before saving.
  * **Safe to show to everyone, on the sign-in page too.** The page runs in a sandboxed frame with an origin of its
    own. It cannot reach Coder's page, its cookies or the network: the platform service serves it with a sandbox
    Content-Security-Policy that blocks connections, and allows only inline styles and scripts and `data:` pictures.
  * The mouse passes through it, and it pauses while the Animations switch (user menu) is off.
  * **Behind the page,** the frame lies beneath every element. While it shows, the page colour is moved from `body`
    to `html` so the frame can show through; the page looks the same, and the change is undone when it goes.
  * Stored like the pictures (`coder_ui_updates.background`, new column `params` for the dials).
* The platform service loads the backgrounds as it starts, so the first pages after a restart have them too.

## 1.23.0 – 2026-10-12

Coder `2.0.0-platform.20`.

* **Chat: screenshots work again.** "No screenshot: Attempting to parse an unsupported color function "oklab"": html2canvas
  1.4.1 cannot read the `oklab()` / `oklch()` colours Tailwind 4 uses. The dashboard now uses html2canvas-pro 2.4.5 (a
  maintained fork that reads them). It is bundled into the dashboard, so nothing is fetched at run time and it works
  air-gapped.
* **Chat: no more double messages.** When a message opened a window, it was queued while the conversation's history
  loaded, and the history held it too: it showed twice (stored once). Every message is now shown once per id.
  * Each send also carries an id of its own (`clientId`), and the platform service stores a retried send once. The
    dashboard retries a send that got no answer or a proxy error (502 / 503 / 504), up to twice. A second Enter in
    the same instant no longer sends twice.
* **Chat: built for volume.**
  * The platform service's HTTP server now queues up to 1024 waiting connections, up from Python's default of 5, at
    which a burst of sends got 502 from the proxy. It closes the connections it says it will close
    (`Connection: close`). A tab's long poll ending mid-answer is no longer logged as an error. Sending is thread-safe.
  * Admins may send 120 messages a minute (others 30).
  * Measured on Minikube: 40 developers sending 120 messages at once were all accepted in about 0.6 s, each stored
    once.
  * Long conversations load 100 messages at a time: scroll to the top, or "Earlier messages".
* **Chat: the console, for admins.** The admin's Chats bar opens one command center instead of a pile of windows.
  * **Left, the card index ("Rolodex").** Every conversation in one list, in three views:
    * **Waiting:** the last message is theirs, longest wait first (triage order);
    * **Unread;**
    * **All.**

    Search by person or text. Each row shows how long they have waited, the unread count and "typing…". Only the
    rows on screen are drawn, so hundreds of conversations stay quick.
  * **Right, the card.** One conversation, with previous / next, "Next waiting", screenshot, pop out (into its own
    window) and delete. Moving through the index flips the card in, unless animations are off.
  * **Next after reply.** When on, sending an answer flips straight to the next conversation waiting.
  * **Keys:** Alt+↓ / Alt+↑ next / previous, Alt+N next waiting, / or Ctrl+K search, ↑ ↓ Enter in the list, Escape
    back to the list (from the message box) or closed.
  * **No more pop-up storms.** For admins, a new message opens a window only while the console is closed and the
    dock has room (up to three). Otherwise it waits, counted, in the console. Developers' chat is as before.
* **Customize: background images** for the sign-in page and the dashboard, each with its own image, strength (2–30 %,
  default 6 %: barely noticeable), fit (fill, fit inside, tile) and layer.
  * **Behind the page (default).** The picture lies beneath everything, mixed into the page's own background colour
    (under a veil of that colour). It shows only where the page has no background of its own, follows the theme, and
    leaves every other style as it is.
  * **Over the page.** A faint watermark the mouse passes through.
  * Upload any picture (made at most 1920 × 1200, WebP; an animated GIF is kept as it is) or pick one of the
    provided pictures. A preview shows the result.
  * The platform service keeps them in Coder's database (`coder_ui_updates.background`). `boot.js` hands them to
    every page, so they are there from the first paint, the sign-in page included.

## 1.22.1 – 2026-10-11

Coder `2.0.0-platform.19` (unchanged).

* **Cleanup.**
  * The route that sent `/workspaces-icon.png` to the platform service is gone, and so is the chart's copy of that
    icon. The dashboard now shows its own light and dark versions (1.22.0).
  * The platform service's old logo page (`logo.html`, `logo-view.js`, `logo.css`) is gone. **Admin settings ›
    Customize** has been the logo editor since the fork took it over.
  * The design source folders `alt-logos/` and `update-resources/` were moved into the chart (`defaults/gallery/`) and
    the fork (`site/static/`) in 1.22.0, and are removed.

## 1.22.0 – 2026-10-11

Coder `2.0.0-platform.19` (fork `2260748f8`).

* **The update gear and the Resources button follow the theme.** Each has its own image for the light theme (black)
  and the dark theme (white), and the dashboard shows the one for the selected theme (`agent-outdated-light/-dark.png`,
  `workspaces-icon-light/-dark.png`).
* **Provided pictures for the logo and the avatar.** Three pictures come with the platform (destructed cube, loading
  cube, pulsing cube) in `helm-chart/defaults/gallery/`.
  * **Customize › Logo** (*Choose a new logo*) and the **Avatar** dialog show them under "choose your own". A click
    uses one exactly like a chosen file: preview, then Save.
  * `install.sh` puts each picture in its own ConfigMap (`coder-ui-updates-gallery-1`, `-2`, …; a ConfigMap holds at
    most 1 MiB), outside the Helm release. The platform service serves them (`/__coder-ui/api/gallery`,
    `/__coder-ui/gallery/<file>`). Add or remove files there and redeploy. Up to 8 (`uiUpdates.defaults.gallerySlots`).
* **Post-it notes: from the workspace page's sidebar, and in the users table.**
  * Admins looking at another user's workspace get an amber sticky-note button in the left sidebar, under Resources
    and History. It starts a new note, with a count of the notes up there. It replaces the floating "Add a note"
    button. It does not show on an admin's own workspace.
  * **Admin settings › Users:** the Groups column is now **Notes**. A sticky-note icon (with a count) shows when admins
    have notes up on the user's workspaces that the user has not dismissed. A click shows them: the text, the
    workspace (a link) and who wrote it.
  * Notes now record their workspace's owner and name. Older notes get them the first time an admin opens the users
    table.
* **Announcement banner.**
  * The scroll-down view's prompt is root's: `root@platform:~#`.
  * The Confirm button's background is a grayer, slightly lighter shade of the banner's colour.
  * The Viewed box's tooltip reads `Announcement Viewed:` / `Date: October 11, 2026 @ 10:29 PM UTC-5` /
    `TLS/x509 Fingerprint: AB:CD:…`, in the viewer's time zone.
* **Certificates record their x509 fingerprint.** Settings › Certificates now saves the certificate's SHA-256
  fingerprint (of the certificate itself, as `openssl x509 -fingerprint -sha256` shows it) with its other details,
  when the password is given at upload. The password is still only used in the browser. Certificates uploaded
  before have no fingerprint on record, and the tooltip says so: upload them again, with the password, to add it.

## 1.21.0 – 2026-10-11

Coder `2.0.0-platform.18` (unchanged), workspace image `coder-workspace:1.7.0`.

* **Admins run kubectl and k9s on Coder's cluster from their workspaces, each signed in as themselves.**
  * Coder's Owners get `~/.kube/coder-cluster.yaml` (context `<owner>@coder-cluster`, first in `KUBECONFIG`; their own
    `~/.kube/config` is never touched). Other users' workspaces get nothing.
  * The first `kubectl` command prints a Keycloak link and code (device login). The admin opens it in their own
    browser and signs in as they do for Coder (e.g. with their certificate). The first time, they confirm the grant.
    No browser opens by itself.
  * The cluster sees the person: `keycloak:<username>`, in group `keycloak:coder-cluster-admins`, which the chart
    binds to `cluster-admin`. An API server audit log, where one is turned on, records that name. No account or token
    is shared.
  * The workspace keeps no long-lived credential. The tokens live 10 minutes and are kept in `/tmp`, so they are
    forgotten when the workspace restarts. The sign-in ends with the Keycloak session (development Keycloak: 30
    minutes idle, 8 hours at most).
  * The platform service keeps the Keycloak group equal to Coder's Owners who sign in with Keycloak. It checks every
    minute, matching by email, else username. The built-in password `admin` has no Keycloak account and so cannot
    sign in to the cluster.
  * `./make --deploy` on Minikube sets up the development Keycloak's public client `kubernetes` (device grant only,
    consent, a `groups` claim) and the group. It also makes the API server trust Keycloak's tokens with a structured
    authentication configuration; the API server restarts once, and the flag is kept across `minikube start`. EKS
    and other clusters: `DEPLOY.md` › *kubectl and k9s for admins*.
  * Settings: `global.clusterAccess` (off by default in the chart).
* **Workspace image 1.7.0:** adds kubelogin `v1.36.4` (`kubectl oidc-login`, pinned by its release checksum) to the
  `k8s-devtools` package (1.1.0, the same k9s and kubectl).

## 1.20.0 – 2026-10-11

Coder `2.0.0-platform.18` (fork `25b73e9ed`).

* **The outdated-agent gear pulses.** Its glow swells and fades now and then, at irregular intervals: two loops of
  different lengths (11 s and 17 s) overlap, so the rhythm never settles. It is off when animations are off (user
  menu) or the system asks for reduced motion.
* **Post-it notes on workspace pages.** Admins stick short notes on a user's workspace page: reminders, how-tos,
  "don't forget" messages.
  * **Add a note** (admins only, bottom left) opens a draft. Write up to 600 characters, pick a colour (yellow, pink,
    blue, green, orange), then **Stick it**.
  * The notes sit above everything on the page. Each hangs a little crooked (its own tilt, kept), with a strip of
    tape, a curled corner and a handwritten look.
  * Admins drag a note to move it (the place is kept, relative to the window), double-click or use the pencil to
    edit it, and use the bin to delete it.
  * The workspace's owner sees the notes and dismisses them with ×. Admins still see a dismissed note, faded and
    marked "dismissed by the owner", until they delete it.
  * The platform service stores the notes (`/__coder-ui/api/notes`). Only the workspace's owner and admins can read
    a workspace's notes; only admins can create, change or delete them.

## 1.19.0 – 2026-10-11

Coder `2.0.0-platform.17` (fork `73d2c8a54`).

* **App panels pop out into their own browser window, and come back.** This works like the Terminal panel.
  * **Pop out** moves the app (File Browser, Desktop, marimo, code-server) into a browser window of its own. The
    panel lets go of it: one copy of the app, not two (the desktop has a single screen).
  * **Bring back**, or closing that window, shows it in the panel again. The bin closes the window too.
* **Announcements: the Star Wars opening crawl.** The new effect "Star Wars crawl" makes the message rise through the
  banner, tilted away, and recede into the distance, fading at the top.
  * Its pace is steady: the duration follows the text's height and a **speed** setting (slow, normal, fast), so a
    long broadcast takes as long as it needs.
  * Without repeat it plays once and then the message stays.
* **Announcements: a font selector.** It applies to the banner and its scroll-down view. The options are the
  dashboard's bundled fonts (Geist, Geist Mono, IBM Plex Mono, JetBrains Mono, Fira Code, Source Code Pro) and
  generic system serif, sans and condensed stacks. Nothing is downloaded, as the network may be air-gapped.
* **Announcements: scroll mode.** A bordered down arrow at the banner's left rolls a terminal-like view of the whole
  message down over the page, so nobody has to wait for an effect.
  * It sits above everything, about a quarter of the page tall, and scrolls when the message is longer.
  * It renders headings, lists, links, code, emoji and images in the banner's font, on a dark, monospaced,
    faintly scan-lined screen with a prompt and a blinking cursor.
  * A click outside, Escape or the arrow rolls it back up.
* **Announcements can be longer and richer.**
  * Up to 4000 characters (was 400), in the dashboard and in the banner service, including its own admin page.
  * Markdown images: `![alt](https://… or /path)`, small inline in the banner and full width in the scroll-down view.
  * For the scroll-down view: `#` headings, `-` / `1.` lists, and blank lines between paragraphs.
  * The banner service stores `speed` and `font`. Announcements saved before keep their look (normal, the dashboard
    font).

## 1.18.1 – 2026-10-11

Coder `2.0.0-platform.16` (fork `6e0f2b39b`).

* **A workspace's apps also wait for their health checks.** marimo, code-server and File Browser start in the
  background and come up after the startup script ends. Before, the apps unlocked when the script finished, so
  marimo could still be starting.
  * Now the initializing panel stays until every app has answered its health check: "Starting the apps", how many
    are up, which are still starting.
  * The card's border stays "initializing" too.
  * An app that fails its checks (unhealthy) does not hold the others back.
* **The initializing panel's progress bar shows real progress.** It follows the whole start, by milestones: the agent
  connecting, each startup script finishing, each app answering its health check.
  * Between milestones it creeps toward the next one but never past it. It shows a percentage, and its striped,
    sheened fill moves smoothly; the sheen stops with Animations off or reduced motion.
  * Before, it showed only the current step's share, for example stuck at 50% for the whole main startup script.
* **The outdated-agent badge follows the theme.** The image holds both variants side by side, and each theme shows its
  half.
* **The Viewed box** in the announcement banner has a very faint background of thin diagonal zebra lines. It also
  shows the "seen and accounted for" badge where "at" was: the fork's `static/announcement-viewed.png`, trimmed from
  `development/coder-fork/design/acknowledge.png`.
* **The desktop app is "Desktop"**, with Coder's own desktop icon. It was "Desktop (noVNC)", and its noVNC logo was
  loaded from the internet, so it showed broken offline.

* **tkinter windows in marimo show in the notebook.** A cell that opens a tkinter window shows it in its own
  output, live and interactive (clicks and typing work there), not on the desktop. Before, it failed with
  `no display name and no $DISPLAY environment variable`.
  * How: each workspace has a second, private X display (`:2`: no desktop, no window manager) for notebook windows,
    sized to the window it shows. The cell's output is a minimal noVNC view of it, through the hidden app
    `marimo-windows` (websockify on 127.0.0.1:6902).
  * **Stop works at once and closes the window, like its close button.** The cell ends normally with
    "Window closed (Stop)." instead of an interrupt traceback.
    * Before, `mainloop()` waited in Tk's C event loop, where Python only notices marimo's interrupt at the next
      window event.
    * Before, an interrupted or failed cell also left its window open but dead.
    * Now, in a marimo kernel, `mainloop()` runs the window's events from Python. This is `coder_marimo_tk.py`,
      which the template puts in each user's `~/.marimo-venv`.
  * Other libraries' GUI windows (with `DISPLAY`) show on the workspace desktop (Desktop app).
  * The desktop's websockify is now checked by its port, because `pgrep -f` matched the startup script itself.
* `minikube-support trust-ca` also covers sandboxed browsers. The snap and flatpak builds of Chromium, Brave and
  Chrome don't use the machine's certificate store, and neither did `trust-ca`.
  * Why it matters: in a browser that doesn't trust the cluster's CA, pages load only past a warning, and the
    dashboard's live connections fail. That gives "Websocket connection for dynamic parameters unexpectedly closed"
    when creating a workspace, and "Unable to retrieve latest inbox notifications".
  * Flatpak browsers now get the CA (verified with flatpak Chromium 155).
  * Recent snap Chromium/Brave builds find the CA in their database but don't take its trust from there.
    `trust-ca` now says so and explains how to import the CA once in the browser's certificate manager.

## 1.18.0 – 2026-10-11

Coder `2.0.0-platform.15` (fork `0a8293071`). Workspace image `ghcr.io/user187x/coder-workspace:1.6.0`.

* **Announcement banner.**
  * The text is centred; the Confirm button stays at the right.
  * A **Viewed** box sits just left of the Confirm button, at the same size. It shows the date and time the user
    first saw the announcement, as the admins' report records it, in small text: "Viewed" and the date spread
    edge to edge, the time below at the right.
    A user who doesn't confirm still sees that the view is on record, and the admins see it too.
    * The platform service's `/api/me` now returns `viewedAt` and `ackedAt`.
* **The typewriter effect no longer flickers with repeat.**
  * Each letter's 1 ms CSS animation was repeated forever, so every letter blinked.
  * With repeat, a timer now types the message, holds it for 3 s, clears it and types it again.
  * Without repeat it still types once.
* **Navbar.**
  * The workspaces menu reads **Resources** next to its icon, and its "Workspace" item is now "Workspaces".
  * The **Admin** menu has an icon before its label, like the other navbar items. The image holds both variants
    side by side (the white gear on a black disc for the dark theme, the outlined gear for the light theme), and
    each theme shows its half.
  * The images are the fork's `site/static/admin-icon.svg` and `site/static/agent-outdated.png`.
* **The workspace card shows the workspace's name** instead of its agent's ("main"). When a workspace has several
  agents, each card adds its agent's name after it.
* **"Unable to retrieve latest inbox notifications" no longer appears for a passing hiccup.**
  * Before, one failed attempt of the inbox's live connection showed the message for good, even though the inbox
    still loaded. A sign-in redirect or a Coder restart cutting connections was enough, often right after a fresh
    sign-in.
  * Now the connection reconnects by itself, with backoff, and fetches what it missed.
  * The message appears only after three failures in a row, and goes away once the connection is back.
* **An outdated workspace agent** shows the update badge image instead of the word "Outdated". Its popover, with
  the versions and "Update workspace", is unchanged.
* **marimo stays in its window.** "Create a new notebook", notebook links and "open file" no longer open a new
  browser window.
  * They navigate the same window. Embedded in the workspace's app panel, that means the panel itself.
  * Ctrl/Cmd/Shift-click and middle-click still open a new tab.
  * The image adds `marimo/same-window.js` to marimo's page.

## 1.17.0 – 2026-10-11

Coder `2.0.0-platform.14` (fork `84b706a1f`). Workspace image `ghcr.io/user187x/coder-workspace:1.5.0`.

* **The desktop has a web browser: Firefox.** XFCE's "Web Browser" and the dock's globe launcher open it at once.
  * It is Mozilla's own `.deb`; Ubuntu's `firefox` package only installs a snap, which cannot run in a container.
  * Its policies suit an offline network (`desktop/firefox-policies.json` in the image): no updates, telemetry,
    studies, Pocket, sponsored content, welcome or terms-of-use pages, and no online content on the new-tab page.
    New tabs and the start page are blank, and a workspace restart does not bring up "Restore Session".
  * It trusts the system CA store through p11-kit, so the cluster's own CA works.
  * The pod gets a 1 GiB in-memory `/dev/shm`; with the default 64 MiB, Firefox tabs crash.
* **A faster desktop over VNC.**
  * XFCE's compositor is off. That is the image default; desktops set up earlier get it turned off once, and a
    later change in Window Manager Tweaks is kept.
  * The VNC server updates at 60 frames per second.
  * noVNC uses the cheapest compression (`compression=0`), which costs less CPU at both ends.
  * The pointer is drawn by your own browser, so its speed is your mouse's. What remains is the round trip through
    Coder's proxy for what happens on the desktop.
* **marimo starts in its dark theme.** It is set once per user; a later change in marimo's settings is kept.
* **App panels fit and resize.**
  * A File Browser panel first grows to fit its page, so it has no scroll bar.
  * Every app panel has a handle at its bottom right. Drag it, or use the up and down arrow keys, to set the height;
    the width always stays the card's.
  * The height is remembered.
* **The top bar can be rearranged.** Workspaces, the latency menu and HUD can sit on either side of the announcement
  banner.
  * Start it by right-clicking one of them, or with the user menu's "Rearrange top bar".
  * The banner shows as a dashed placeholder, and the buttons swap places around it: drag them, or use the left and
    right arrow keys.
  * Done (or Escape) ends it, and Reset restores the default order.
  * The order is remembered per browser.
* `minikube-support`: a rebuilt image under the same tag now reaches every node. `minikube image load` skipped a
  node that was running containers of the old build; such a node now gets the image loaded directly.
* **No Favorite.** The workspace page has no Favorite button, and the workspaces list no longer shows the star.
* **No links to Coder's online documentation.** The deployment is air-gapped, and Coder publishes no offline (PDF)
  edition of its docs, so these links would be dead.
  * Removed: docs links and "View docs" buttons, the filters' "Learn more" items, help-popover links, the agents'
    "Troubleshoot" and "View docs to troubleshoot" links, and "Install Coder Desktop".
  * Sentences that pointed to the docs are reworded.
  * A "Documentation" support link is never shown.
  * A CSS rule hides any docs link still produced elsewhere, such as in a template README.

## 1.16.0 – 2026-10-11

Coder `2.0.0-platform.13` (fork `237423e43`).

* **The terminal opens in tmux with btop.** The Terminal panel's custom command now defaults to
  `tmux new-session -A -s monitor "btop"`.
  * Terminals open at the same time share one `monitor` session; the first one starts it.
  * The bundled tmux configuration sets `destroy-unattached on`, so the session ends when its last terminal closes.
    The next terminal starts btop fresh.
  * Everyone gets the new default once, because it is stored under a new key. A user can change it afterwards.
* **"Animations" switch in the user menu** (on by default, remembered per browser). Off:
  * the agent cards go back to Coder's stock solid borders (green when ready);
  * the initializing title stops fading;
  * every animated GIF in the dashboard shows only its first frame (logo, avatars, the initializing animation).
    Cross-origin pictures are the exception, because they can't be copied.
* **The agent card's drop-down panels can be reordered.**
  * Drag a panel by the grip at the left of its header. With the keyboard: focus the grip, press Space, use the arrow
    keys, then Space again.
  * The order is remembered per workspace and agent, in this browser.
* **App panels.** A folder tab with a round **+** sits at the top right of the top panel, whichever panel that is. It
  adds a panel with one of the workspace's apps embedded, as the Terminal is: File Browser, Desktop (noVNC), marimo
  or code-server.
  * The app loads when its panel first opens. Collapsing the panel keeps the app as it is.
  * The bin removes the panel and closes the app.
  * The app's box can be resized from its bottom-right corner.
  * The + and the app panels wait until the workspace is ready.

## 1.15.0 – 2026-10-11

Coder `2.0.0-platform.12` (fork `2bd982755`).

* **A workspace's apps open only once the whole workspace is ready.** That means the agent is connected and its
  startup scripts are done, including the terminal's tmux, code-server and the desktop.
  * Until then, the workspace page shows none of the following, and the workspaces list shows no app buttons:
    * the app buttons, VS Code, Terminal, SSH and port forwarding;
    * the Terminal drop-down, which shows "Opens when the workspace is ready".
  * A start that failed or timed out also opens them, so one broken module never locks the user out. The card's
    border turns orange for that.
* **"WORKSPACE INITIALIZING" panel.** While a workspace starts, it takes the place of the apps and of Coder's
  "Workspace agent is connecting" message. The design is `development/coder-fork/design/workspace-initializing.html`,
  which was `example.html`.
  * Its look: warning stripes above and below, the brick animation tinted orange, and a title that slowly fades in
    and out. The animation is the fork's `site/static/loading-brix.gif`.
  * What it says:
    * the current step (agent connecting, preparing, running the startup scripts);
    * a progress bar with how many startup scripts have finished and which are still running;
    * the elapsed time.
* The workspace issue indicator no longer has **Troubleshooting** buttons (the template's docs link).

## 1.14.0 – 2026-10-11

Workspace image `ghcr.io/user187x/coder-workspace:1.4.0`.

* **marimo works with no network at all.** It used to be `pip install`ed from the internet at every workspace start
  (offline: no marimo), with only its bare core, so its features asked to install packages and failed.
  * The workspace image now has everything in `/opt/marimo`, pinned in
    `development/workspace-image/marimo/requirements.lock`:
    * marimo 0.24.2 with its extras: SQL cells (duckdb, polars, pyarrow, sqlglot), charts (altair, vegafusion,
      vl-convert), formatting (ruff), Jupyter import (nbformat), sandbox/`uv`, the AI assistant's client, and the
      language server (python-lsp-server, python-lsp-ruff);
    * a data stack: numpy, pandas, scipy, scikit-learn, statsmodels, sympy, networkx, matplotlib, seaborn, plotly,
      anywidget, openpyxl, xlsxwriter, pillow, lxml, beautifulsoup4, requests, httpx, sqlalchemy, tabulate, jinja2;
    * `tkinter` (`python3-tk`).
  * Each user gets `~/.marimo-venv`, which sees all of `/opt/marimo` and takes the packages they add. It replaces the
    old internet-installed venv on the first start. With no network, pip and uv give up at once instead of hanging.
  * A package manager marimo is set to that is not installed (pixi, rye, poetry) falls back to `uv`.
  * The image build checks all of it with networking switched off: it runs every cell of
    `marimo/smoke_test.py` and serves marimo. To add packages, list them in `marimo/requirements.in` and rebuild.
  * The image grows from 3.6 to 6.0 GB (the Python packages are 1.8 GB).
* Docs: the known air-gap gap is now only code-server and File Browser, which are still downloaded at workspace start.

## 1.13.1 – 2026-10-11

* **Default logo: the Minecraft creeper** (`helm-chart/defaults/logo.gif`, a 200x200 animated GIF). A new installation
  starts with it; an existing one keeps the logo it has (an uploaded one, or the previous default) until an admin
  changes it in Customize.

## 1.13.0 – 2026-10-11

Workspace image `ghcr.io/user187x/coder-workspace:1.3.0`.

* **Desktop (noVNC) background by default:** XFCE's dark "cp-dark" wallpaper, zoomed to fill the screen. It's a system
  default (`/etc/xdg/xfce4/xfconf/.../xfce4-desktop.xml`, for TigerVNC's monitor `VNC-0`), so a wallpaper a user
  picks in Desktop settings still wins. It used to be XFCE's built-in plain default. Takes effect after a workspace
  update.

## 1.12.2 – 2026-10-11

* **Desktop (noVNC) locked down;** the "you are exposing your VNC server to all users" warning is gone.
  * TigerVNC's X server now starts directly (not through `vncserver`) and listens on no TCP port, only on a Unix socket
    that only the workspace user can open (`/tmp/coder-vnc/rfb.sock`: directory 0700, socket 0600).
  * websockify serves noVNC on `127.0.0.1:6901` only (it listened on every interface, so the password-less desktop was
    reachable from the cluster network) and connects to that socket. The only way in is Coder's app proxy.
  * The X display has an authorization cookie (`~/.Xauthority`).
  * Takes effect when a workspace restarts.

## 1.12.1 – 2026-10-11

* **No gap when Coder rolls out:** the old Coder pod keeps serving for 15 s after it is taken out of the Service
  (`preStop` sleep), so Traefik stops sending it requests before Coder closes its server. Until now those requests got
  a 502, which showed as the health warning `EWS01` during a deploy. The new pod already started first and had to be
  ready before the old one stopped. Tested with a restart under a request every 0.2 s: all 766 returned 200.

## 1.12.0 – 2026-10-11

Coder image `2.0.0-platform.11-airgap` (fork `92daaa856`).

* **Agent terminal drop-down:**
  * When the terminal terminates (its shell exits, the connection drops, or End session), the drop-down rolls back up
    and starts over: the next open is a new session.
  * "End session when closed" is a slider toggle.
  * The custom command is on by default and runs btop.
  * Controls in three groups: the text size buttons and size in a small oval on the left, the custom command centred,
    the session controls on the right.
  * The terminal's columns x rows show as a very faint overlay pinned to its top-right corner.
  * The pop-out window has a button that opens the session in a separate browser window (Coder's terminal page, same
    session).
* **btop refreshes every 100 ms** instead of its default 2000. The workspace start sets it for users without a btop
  configuration, or whose configuration still has btop's default; a value someone chose is left alone.

## 1.11.0 – 2026-10-11

Workspace image `ghcr.io/user187x/coder-workspace:1.2.0` (Coder image unchanged: `2.0.0-platform.10-airgap`).

* **k9s and kubectl in every workspace:** a new self-contained package, `k8s-devtools` 1.0.0
  (`development/workspace-image/packages/`, 48 MB), built by `development/tools/build-k8s-devtools.sh` from the
  developer's own machine:
  * the exact custom k9s binary (v0.50.18, commit `6dbf571c…-patched`) and its configuration: settings, aliases, the
    copy-secret plugin (with `k9s-copy-secret` on PATH) and all skins. Per-machine state (`clusters/`,
    `screen-dumps/`, `benchmarks/`, backups) is left out. `k9s` gives users without a k9s configuration the bundled
    one on first run; an existing one is never touched;
  * the exact kubectl binary (v1.36.0);
  * bash completion for both, now enabled for every interactive shell (`/etc/bash.bashrc`; the default `~/.bashrc` is
    unchanged).
* kubectl and k9s need a cluster to talk to, via a kubeconfig in `~/.kube/config` or `KUBECONFIG`. Workspaces get no
  cluster access of their own (no extra permissions). minikube is not included: running it inside a workspace needs a
  privileged pod or Sysbox nodes.

## 1.10.2 – 2026-10-11

Coder image `2.0.0-platform.10-airgap` (fork `f6ebdb50e`).

* **Workspace card borders:** only just noticeable, and slower.
  * Every layer is at 45% strength.
  * The ready ring is 2 px wide and takes 9 s per turn (it was 4 px and 2 s).
  * The electric border runs at a third of its pace (18 s per cycle) with less than half the displacement, and a fainter
    sheen and glow.
  * Strength and ring speed are the CSS variables `--fx-strength` and `--fx-ring-turn` in `agentBorder.css`.

## 1.10.1 – 2026-10-11

* **Workspaces button icon:** green. The navbar's icon is now the chart's `files/ui-updates/workspaces-icon.png`, which
  Traefik serves at `/workspaces-icon.png` from the platform service, so changing it takes a chart upgrade, not a new
  Coder image. The fork's built-in copy is green too (fork `542e5e2b5`, in the next Coder image). The new icon was first
  committed in `3a89b21` (with a FORK.md note).

## 1.10.0 – 2026-10-11

Coder image `2.0.0-platform.9-airgap` (fork `019d9745b`) and workspace image `ghcr.io/user187x/coder-workspace:1.1.0`.

* **Workspace image 1.1.0:** btop, bat (`bat` links to Ubuntu's `batcat`), vim, eza, fzf, grc, jq and yq installed (tmux
  already was). yq is Ubuntu's package: the jq wrapper for YAML (kislyuk/yq, jq syntax), not the Go yq.
* **Default `~/.bashrc`** (`development/workspace-image/shell/bashrc`): every workspace start installs it for users who
  have no `~/.bashrc`, or still Ubuntu's stock one; an edited `~/.bashrc` is left alone. Also installed when missing:
  `~/.profile` (so login shells read `~/.bashrc`) and `~/.config/vim/vimrc`, which the new `.bashrc` points Vim at
  (`VIMINIT`): Vim's defaults, then `~/.vimrc` if there is one.
* **Agent terminal:** a "Custom command" toggle. It's off by default; turned on, its command (btop until changed) is
  editable, new sessions run it first and continue in the shell when it exits, and "Run" starts one at once. The text
  size buttons are Font Awesome's plus-circle / minus-circle.

## 1.9.0 – 2026-10-10

Coder image `2.0.0-platform.8-airgap` (fork `a68ffe61e`).

* **Workspace page:** the agent card's solid green border is replaced by an animated border that shows the workspace's
  state:
  * **Initializing** (starting, agent connecting, startup scripts running): the electric border of
    `update-todos/workspace-loadding.html`, in green.
  * **Pending or a problem** (build queued, a startup script or module failed or timed out, the agent timed out
    connecting, a dev container error): the same border in fiery orange.
  * **Failed** (failed build, or the agent of a running workspace disconnected): the same border in red.
  * **Ready**: the rotating green border of `update-todos/workspace-border.html`.

  Stopped, stopping and deleted workspaces keep Coder's border. Nothing in the layout moves between states, the card
  (its logs, its terminal) is never remounted, and with reduced motion nothing animates.

## 1.8.0 – 2026-10-10

Coder image `2.0.0-platform.7-airgap` (fork `d7a068929`).

* **Breadcrumb:** Admin Settings > *category* names the category open (Health, Authentication, Customize, ...) instead
  of a fixed "General", which stays for pages outside the categories.
* **Fixed: the end of long pages was hidden** behind the deployment stats bar and the Chats dock (e.g. "Source Code
  Pro", the last terminal font in Customize). Every page that scrolls ends with room to spare; full-height pages (the
  workspace page) are unchanged.
* **HUD:**
  * Fixed: Highest CPU / Highest memory showed "—" without metrics-server, even with workspaces running. They fall back
    to what the running workspaces were built with, then to what their pods request (the hint says which).
  * Fixed: a tie quietly showed one account. It now shows the first account and the number tied ("admin +1 tied").
  * Every figure opens what is behind it:
    * the top account's workspace (CPU, memory, GPUs, ping, time online)
    * that account's workspaces (most workspaces, most failures)
    * the failing workspace
    * the running workspaces, User Quota, or Workspace Health
  * Moving figures to the top is a **Sort** menu at the top right of the totals bar, with Reset order.
* **SSH key from the .p12:**
  * Settings > Certificates can make the certificate's private key your Git SSH key: at upload ("Also use its private
    key as my SSH key"), or with "Use as SSH key..." (Settings > SSH keys > "Use P12..." leads there).
  * The key is decrypted in the browser, both AES and the legacy 3DES of many CAs. The password is asked for only when
    the file has one, is never sent, stored or logged, and is cleared once the key is out.
  * Coder stores the key as it stores the keys it generates (new endpoint `PUT /api/v2/users/{user}/gitsshkey/import`:
    RSA 2048+, ECDSA P-256/384/521, Ed25519).

## 1.7.0 – 2026-10-10

Coder image `2.0.0-platform.6-airgap` (fork `a65bc39b7`) and a new workspace image `ghcr.io/user187x/coder-workspace:1.0.0`.

* **Fixed: `core.<pid>` files in every workspace home.** The template installed `xfce4-goodies` at every start, which
  pulls in light-locker; the screen locker needs a display manager, crashed at each desktop start, and with unlimited
  core dumps left a ~45 MB `core.<pid>` each time. The workspace image leaves light-locker (and LightDM) out and does not
  start the XFCE screensaver; the pod starts the agent with `ulimit -c 0`; the startup script removes the core dumps
  earlier workspaces left (only `core.<digits>` files that are ELF core dumps).
* **Workspace image** (`development/workspace-image`, `tools/build-workspace-image.sh`): enterprise-base with the desktop
  preinstalled (no `apt-get` at start, so it also works offline), JetBrains Mono Nerd Font as the desktop's and its
  terminal's font and the default monospace, and tmux 3.8 with the bundled configuration (`tmux-installation.deb`; set
  up for each user without one). `codercom/enterprise-base` is no longer shipped. The startup script starts the desktop
  first, and a failed marimo download (no internet) no longer stops the rest of it.
* **Web terminal:** JetBrains Mono Nerd Font is bundled and the default terminal font. The agent terminal drop-down has
  a Pop out button (a floating window with the same session; closing it leaves the drop-down collapsed) and text size
  buttons that start at the largest size fitting 80x24 (btop's minimum) and show the columns x rows.
* **Global Workspace Scheduler** (Health > User Quota): require start and stop times on every workspace (each user's, or
  one schedule for all), a maximum active time, ignore admins, exclude users. Enforced by Coder on create and on every
  schedule change; users fix existing workspaces in a dialog before going on; the create form asks for the schedule.
* **Monitoring:** a security posture panel - zero-trust checks (privileged and dormant accounts, password sign-in, MFA in
  Keycloak, API tokens, shared ports and apps, pod isolation, network policies, image provenance) and runtime signals
  (restarts and OOM kills, failed workspaces, disconnected or outdated agents, workspaces that never stop).
* **HUD** (navbar, `/hud`, admins): totals, top accounts and health figures updated in place every 10 s, with changes
  and sparklines; click a figure to move it to the top.
* `minikube-support`: every custom image is loaded (`minikube ssh` read the rest of the image list from stdin, so only
  the first one was), and a build is recognised by its creation time and layers rather than the image ID, which differs
  between Docker's containerd image store and the nodes' (images were reloaded, and their pods restarted, every time).

## 1.6.0 – 2026-10-10

* Coder image `2.0.0-platform.5-airgap` (fork commit `ea80521c2`). The Admin menu starts with Settings and an add row
  (+) only (no more fixed Accounts / Health links). The + opens General's categories not linked yet (Accounts, Super
  Intelligence, Announcement, Authentication, Classification, Customize, Health, Monitoring, Network, Notifications,
  OAuth2 Applications, Observability, Overview, Persistence, Security); each quick link shows its category on the left
  and a remove button and a drag handle on the right (drag, or Enter + arrow keys + Enter, to reorder). Saved per user
  at once; as many links as there are categories (server limit raised from 8 to 32).
* `minikube-support`: an image rebuilt under the same tag is reloaded (compared by image ID), and `./make --deploy`
  restarts the Deployments that run it.

## 1.5.0 – 2026-10-10

* No nginx: the workspace template's icons (`/__icons/<file>`) are served by the platform service
  (`coder-ui-updates`) from the icons ConfigMap, and Traefik's Gateway routes `/__icons/` to it
  (`coder-workspace.icons.backend`). The nginx Deployment and Service and the `nginxinc/nginx-unprivileged` image are
  gone (one pod and ~24 MB fewer). Responses: images only, plain file names, `Cache-Control: public, max-age=3600`,
  ETag, and SVGs sandboxed by a Content-Security-Policy. Upgrading removes the old Deployment and Service.

## 1.4.0 – 2026-10-10

* `./make --deploy`: guided install for Minikube or EKS. Asks the domain (derives `coder.`, `*.`, `keycloak.`),
  creates self-signed certificates or checks the ones you bring (pair, chain, hostnames, expiry; DER and
  encrypted keys converted), then installs the prerequisites, Secrets and chart. Answers are remembered.
* Minikube: the sudo steps (tunnel, `/etc/hosts`, trusting the CA) are planned and agreed to up front; sudo asks
  for the password once, then and there, and the steps run at the end unattended. Steps already done are skipped;
  without sudo the exact commands are printed.
* `./make --deploy` writes a log (`.deploy/deploy.log`, follow it with `tail -F`) and, when a step fails, names the
  failing command and the log instead of exiting silently. Fixed: the deploy exited silently (exit 1) before
  starting the tunnel when no tunnel was running yet.
* `minikube-support`: profile, `local-path` storage as default (minikube's hostpath class breaks CloudNativePG
  replicas on multi-node clusters), image loading, CoreDNS rewrite of `*.<domain>` to Traefik, a development
  Keycloak with client `coder`, `minikube-expose-services` / `minikube-sync-hosts` (profile-aware versions of the
  ~/devbox functions; own `/etc/hosts` block), `trust-ca`. Traefik keeps the in-cluster IP `coder.<domain>` already
  resolves to, so existing DNS keeps working.
* `x509-support`: CA (with keyUsage, accepted by strict TLS clients), wildcard server certificate, CA bundle,
  client certificates, and the checks above. Adapted from ~/devbox/data/util/x509/pki-toolkit.
* Python images default to `docker.io/library/python` (no longer the reference cluster's Harbor).
* `install.sh`: works with Helm 4 (no `--show-resources`), quieter output.

## 1.3.0 – 2026-10-10

* Default admin `admin` / `admin@admin.com` / password `admin` (`global.firstUser`), created on a fresh database. The
  bootstrap Job sets the password once (Coder's API rejects weak passwords, so it writes the hash directly); later
  syncs never reset it. Change it after the first sign-in.
* Password sign-in on by default (`global.disablePasswordAuth: "false"`): the admin uses its password, everyone else
  Keycloak. `"true"` keeps 1.2.0's Keycloak-only behaviour (admin = the Keycloak account with `firstUser.email`).
* The template-push token is minted on every sync, so pushes no longer depend on the admin's password.
* Banner: the unreleased coder-banner 0.4.3 (optional `gateway.sectionName`, `nodeSelector`), starting blank
  (hidden, no message) until an owner publishes one.
* Development baseline in git: `development/tools/build-bundle.sh`; private material kept outside the repository.

## 1.2.0 – 2026-10-10

Verified end to end in an air gap (DEPLOY.md on a kind cluster with egress blocked; 19/19 sign-in, add-on and
workspace checks).

* Coder image `2.0.0-platform.4-airgap`: the fork's image plus a Terraform provider mirror. Without it every template
  push and workspace build fails offline.
* With password sign-in disabled, the bootstrap Job links the first owner to the Keycloak account with
  `global.firstUser.email` and mints a short-lived token for the template push (Coder blocks every password login).
* `agent-audit.tf` fixed (`%{` escaped) and made optional (`coder-workspace.agentAudit`, off).
* Every `checksum/*` annotation quoted (an all-digit hash was rejected by Argo CD).
* `install.sh` uses server-side apply (the 1 MB default-logo ConfigMap exceeded the annotation limit).
* Python from `docker.io/library/python` instead of the private Harbor.
* Gateway API v1.5.1 CRDs added to `prereqs/`; Argo CD Application uses server-side diff (HTTPRoutes stayed OutOfSync).
* Every image bundled: `images/custom/` (the fork's image, on no public registry) and `images/public/{chart,prereqs,platform}/`,
  pinned by digest in `images.txt`; `mirror-images.sh push/save/verify/list`; a `-slim` tarball without the public images.

## 1.1.0 – 2026-10-09

* `global:` settings (domain, hosts, registry, pull secrets, Gateway, OIDC, first user, secret names) drive every
  component, so the Argo CD Application can set them; templated values in the vendored subcharts ("platform patch").
* Argo CD Application (`argocd/coder-airgapped-application.yaml`) installing the chart from an OCI registry.

## 1.0.0 – 2026-10-09

* First capture of the deployment running on minikube (Argo CD `coder` + `coder-banner`, Helm `coder-workspace`,
  `coder-ui-updates`) as one umbrella chart, render-verified against the live objects.
