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
| `workspace-image/` | Dockerfile of the workspace image `docker.io/mrshll187/coder-workspace` (enterprise-base + desktop without light-locker, JetBrains Mono Nerd Font, tmux from `packages/tmux-installation.deb`, k9s/kubectl, Python venv); build with `tools/build-workspace-image.sh` |
| `airgap-image/` | Dockerfile + `terraformrc` of the `-airgap` Coder image (the fork's image + a Terraform provider mirror); `template/` is filled by the build |
| `tools/build-bundle.sh` | Lint + render the chart, package our charts into `charts/`, fetch missing public image archives, write `../dist/coder-airgapped-<version>[-slim].tar.gz`, the release in parts (`-charts`, `-images-<part>`, `-ASSETS.txt`) and `-layer` |
| `tools/build-workspace-image.sh` | Build the workspace image (FileBrowser Quantum from the `filebrowser-quantum` release binary at the repository's root, pinned by SHA-256), check it, and save it into the bundle (`mirror-images.sh store`: `../helm-chart/images/workspaces/`) |
| `tools/build-airgap-image.sh` | Build the `-airgap` image and save it into the bundle (`mirror-images.sh store`: `../helm-chart/images/ui/`, the rollback image `images/rollback/`) |
| `tools/build-minio-image.sh` | The Cloud Drive's MinIO image `docker.io/mrshll187/coder-minio:<MinIO release>` (Chainguard's build, pinned by digest, retagged) into `../helm-chart/images/custom/` |
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

### Native Sysbox baseline

This optional `native-sysbox` mode does not satisfy raw hardware-total privacy.
Use the VM boundary below for that requirement.

Native isolation requires a supported Ubuntu worker running native containerd,
Sysbox 0.7.1, LXCFS with `--enable-cfs`, Kubernetes user namespaces, and
static CPU Manager with CFS quotas and pod cgroups enabled.
On the qualified Kubernetes 1.35 worker, explicitly configure the kubelet feature
gate `DisableCPUQuotaWithExclusiveCPUs: false` (see the
[Kubernetes 1.35 feature-gate reference](https://v1-35.docs.kubernetes.io/docs/reference/command-line-tools-reference/feature-gates/#feature-gates-for-alpha-or-beta-features)).
Its default optimization otherwise
removes the pod's aggregate CPU quota, allowing an ephemeral container to escape
that aggregate CPU budget despite the regular container's pinned CPU set.
Recreate the proof pod and inspect the host parent cgroup: `cpu.max` must have a
finite quota and `memory.max` must match the effective authored memory limit.
The preflight rejects missing/true optimization settings and unqualified kubelet
minor versions; passing configuration checks alone never grants worker readiness.
 Sysbox alone does not virtualize CPU and memory totals.
LXCFS supplies the read-only `/proc` and `/sys/devices/system/cpu` views; cgroup
limits enforce the allocation. Every regular and init container must declare
positive whole CPU cores and finite memory limits. Admission makes CPU and memory
requests equal those authored limits for Guaranteed QoS; fractional CPU requests
are rejected, never rounded. CPU Manager assigns kernel CPU sets, preventing
affinity-based programs such as static btop builds from enumerating the worker's
full CPU set. Helpers each reserve at least one whole core, so this policy
intentionally reduces scheduling density. Insufficient capacity leaves workspaces
Pending rather than falling back to shared CPU affinity.

Kubernetes 1.35 static CPU Manager skips pods with `spec.resources`; admission
rejects that field. With that optimization explicitly disabled, the kubelet derives finite parent
pod cgroup limits from the regular/init container limits. Internal ephemeral containers inherit those parent
bounds; verify this on the worker with real CPU/memory probes. The derived budget
annotation is an audit value, not the enforcement mechanism.
`SYSBOX_HONOR_CAPS=TRUE` is mandatory, and
`SYS_ADMIN` is forbidden because it permits unmounting those views. Namespaced
cgroup delegation remains available within the outer resource budget. This does
not hide processor instructions such as CPUID or provide VM-level hardware secrecy.

The isolated Ubuntu 24.04 proof uses Kubernetes 1.35.9, containerd 2.2.1 and the
[official Sysbox installer](https://github.com/nestybox/sysbox/blob/b77c3716966a632b392601bbf8fa91b15f943c98/docs/user-guide/install-k8s.md).
The installer can write the obsolete containerd plugin path on config version 3.
Check the effective configuration, not just the installer's node label. Version 3
requires the following table; do not append a duplicate table:

```toml
[plugins."io.containerd.cri.v1.runtime".containerd.runtimes.sysbox-runc]
  runtime_type = "io.containerd.runc.v2"
  [plugins."io.containerd.cri.v1.runtime".containerd.runtimes.sysbox-runc.options]
    BinaryName = "/usr/bin/sysbox-runc"
    SystemdCgroup = true
```

Run `tools/runtime/sysbox-preflight.py` on the worker, then test an actual
`runtimeClassName: sysbox-runc`, `hostUsers: false` pod with LXCFS mounts.
Verify assigned CPU/memory totals, CPU throttling, memory OOM enforcement,
failed unmount attempts, actual CPU affinity and btop output, and an ephemeral
container within the ordinary finite parent pod cgroup. Do not use `spec.resources`
for this Kubernetes 1.35 proof. Label a worker `platform.coder/runtime-ready=true`
only after these checks; admission requires that scheduling selector and rejects
direct `nodeName` on workspace creation. Revoke that readiness label before
changing kubelet/runtime configuration or upgrading the worker, then repeat the
configuration and live probes before relabeling it.
The preflight never marks a node ready or changes its configuration.

For a separate deployment that explicitly selects native mode:

1. Keep the current control plane, Coder, Keycloak and databases on their existing
   node. Preserve tested database/configuration backups and Keycloak sign-in.
2. Provide a routable supported Ubuntu worker. An SSH-forwarded user-mode VM
   network alone is insufficient for joining the cluster.
3. Inventory every workspace and IDE pod, its authored CPU/memory limits and
   storage. Copy and verify local-path home PVC data before moving placement;
   local volumes do not follow a pod to another node automatically.
4. Rebuild templates and helper containers with explicit finite whole-core limits
   and Guaranteed CPU/memory requests. Audit the additional reserved capacity before
   restarting workspaces; local CPU affinity cannot be overcommitted. Test the
   namespace-wide runtime mutator and validator in isolation, including unlabeled
   pods, forged platform owners, substituted runtimes and ephemeral updates.
5. Stage the external admission backend with
   `platformWebhook.runtimeIsolation.prepareBackend=true`, keeping `enabled=false`.
   The chart retains the current backend and routing while starting another in
   `serviceNamespace` (default `coder-runtime-system`). Ensure any configured image
   pull secrets exist in that namespace. Wait for that Deployment to become ready
   and verify its TLS service before changing routing. Then set `enabled=true` and
   `prepareBackend=false`; this switches both legacy and runtime admission to the
   external service and retires the original backend. The external namespace must
   differ from the protected workspace namespace, so an admission outage cannot
   prevent its own recovery. Test recovery by scaling the external backend to zero
   and back: workspace creation must fail closed, while backend creation succeeds.
   Configure `trustedAdminGroups` explicitly for Kubernetes administrators only
   (defaults `system:masters` and `kubeadm:cluster-admins`).
   Enable `platformWebhook.runtimeIsolation.enabled` only after these checks.
   This uses failurePolicy Fail without a workspace-label selector. The explicit
   platform controller inventory is an administrator trust boundary; review it
   against the release before enabling admission.
6. Stop and restart all test workspaces onto the verified worker, preserving home
   storage. Audit existing pods afterward; admission does not retrofit running
   containers. Validate Keycloak sign-in and workspace metrics again.

For rollback, stop workspace builds, retain the previous node and verified PVC
copies, restore the prior template and placement, and restart the retained
workspaces. Do not silently substitute ordinary runc when Sysbox is unavailable.
Do not remove the original profile, Keycloak data, or storage until migration and
recovery validation are complete. Cluster administrators who can change platform
controllers or remove admission are outside this protection boundary.

### Workspace VM hardware boundary

For deployments that require raw kernel hardware totals to remain within each
workspace allocation, use `platformWebhook.runtimeIsolation.mode=vm-sysbox`
(the default mandatory mode). Native Sysbox shares the worker kernel and cannot
provide that boundary, even when `/proc`, CPU affinity and btop show scoped totals.
`native-sysbox` remains an explicit baseline option and is not a fallback for VM
mode. VM mode rejects ordinary tenant Pods, including native Sysbox Pods.

Each workspace uses an allocation-sized Ubuntu 24.04 VM with a supported generic
CPU model, fixed current/maximum topology and RAM, and an immutable approved gold
image. All agent, terminal, IDE, application and nested-container user processes
run inside a guest Sysbox container. The guest supervisor uses fixed Docker
arguments, no privileged mode, guest Docker socket, host namespaces or raw devices.
The guest OS reserve is included in assigned RAM; it is not added to the VM.
KubeVirt launcher overhead is a separate node reservation. Raw kernel totals in
the guest therefore describe that workspace VM, not the larger worker. This does
not promise protection from unknown hypervisor vulnerabilities or timing inference.

Build the gold image with `tools/runtime/build-vm-guest.sh`, supplying the verified
Ubuntu base path, independently verified SHA256 and a new output path. The builder
uses a disposable KVM VM, installs pinned Docker/Sysbox/LXCFS and the root-owned
supervisor, removes build users, SSH keys, logs and machine/network state, zeroes
released blocks, and emits a standalone QCOW2 with verification sidecars. Package
it with `tools/runtime/package-vm-guest.sh` into a private containerDisk registry.
Only allowlist the resulting digest after an actual KubeVirt qualification run.

Boot configuration is an immutable, content-addressed Secret with JSON-only
cloud-init. Admission permits one private runtime JSON file and one fixed service
start command. It rejects arbitrary guest commands, SSH keys, extra Docker flags,
host CPU passthrough, expanded memory/topology, user hooks and unapproved disks.
The retained prepared HOME claim must have matching workspace/user/organization
labels and `platform.coder/retained-vm-home=true` plus exact
`platform.coder/home-disk-bytes` annotations. The guest checks actual device size
and ext4 before mounting it; it never formats an unknown or legacy HOME volume.

Qualify KubeVirt 1.8.x on Kubernetes 1.35 with real KVM acceleration. Prove guest
raw sysinfo/CPUID, `/proc`, affinity and btop totals, actual CPU/memory stress,
Sysbox UID mapping and Docker inspection, agent/app sessions, persistent HOME,
revocation, and authenticated launcher admission. Native proof results do not
qualify VM mode. Cloud Drive and tunnel adapters fail closed until their guest
control and network paths are qualified. Keep privileged guest configuration and
credentials on the private platform/QGA path, never an agent-token endpoint.

Cloud Drive source clearing and quarantine retain source PVs and PVCs. Endpoint
cleanup uses captured Kubernetes UID/resource-version preconditions; a concurrent
source selection publishes a new generation. Operators must review remaining
mounts and claims before manually removing abandoned source storage.


The tested nested Docker configuration uses `/var/lib/docker`, the standard
storage path handled by [Sysbox's Docker integration](https://github.com/nestybox/sysbox/blob/master/docs/user-guide/configuration.md#sysbox-data-store-configuration--v030-).
Docker 29.1.3 ran inner BusyBox containers with both its default containerd image
store and the classic `overlay2` backend at this path.
[Docker documents backend selection](https://docs.docker.com/reference/cli/dockerd/#feature-options).
Custom data-root paths failed nested overlay mounts in qualification; do not
assume they are equivalent to the standard Sysbox-managed path.
Use an inner bridge subnet distinct from the guest's outer Docker bridge.
A workspace image must include its own Docker daemon to run nested containers;
a Docker CLI alone does not provide one. The privileged guest Docker socket is
never shared with the workspace.


### Exact HOME block volumes and recovery

VM HOME uses an independently retained local Block PV, not a filesystem PVC
containing `disk.img`. KubeVirt expands filesystem-backed disk images to a
filesystem-derived capacity even without the ExpandDisks feature gate. Block
mode preserves the exact authorized byte count visible in the guest.

`vmhome.py` runs only in a fixed privileged platform Job outside the protected
workspace namespace. It validates workspace/organization/owner, PVC/PV UIDs,
private provenance resource version, the selected Ready node, halted VM state,
absent VMI and consumers, and actual device file descriptors in the worker PID
namespace. The private external `coder-vm-home-provenance` registry authorizes
prepared volumes; tenant-controlled PVC annotations alone never authorize data.

Canonical templates keep native resources on `hashicorp/kubernetes` 3.4.0 and
manage only VMs through pinned `alekc/kubectl` 2.4.1. Both packages are included in
the offline provider mirror. The raw VM resource avoids the first-party provider's
preserved-field type error on KubeVirt. Existing experimental manifest state is
forgotten without destroying its VM, then the same owned VM is adopted; native
PVC and Deployment state stays on its existing provider.

The VM build waits for declared infrastructure status fields. Agent and app
initialization remains separate: the guest's trusted supervisor releases user
code only after current-build authorization, hardware, HOME and private
configuration checks. A successful infrastructure build does not attest that
all applications have started. Disk maintenance still requires a halted VM,
absent VMI and consumers, and the independent physical device checks.

Canonical template publication is opt-in through `coder-workspace.vmPublication`.
Specify the approved immutable `rootImage`, target `organizationId`, and optional
qualified `nodeName`. The push uses the existing mounted public Coder CA and
scopes template discovery and publication to that organization. Until guest
adapters qualify, publication rejects configured Cloud Drive or tunnel sidecars
and disables external code-server HA explicitly.

Dataflow publication also supplies `coder-workspace.appsWildcardHost`, matching
Coder's configured wildcard hostname. NiFi and Airflow use separate application
origins with their native root paths. The server replaces client proxy host,
scheme and port headers and removes dashboard context headers for these apps.
Deploy that server support before publishing the new Dataflow version. Keep
legacy path routing until existing Dataflow workspaces migrate and the isolated
origins pass UI, API and redirect validation; only then disable path apps globally.

A native workspace cannot update into VM mode while its original HOME claim
exists unless the prepared retained Block claim records
`platform.coder/migrated-from-pvc-uid` equal to the original PVC UID. Terraform
checks this before applying changes. Stop the workspace, fence all consumers,
retain its original PV, copy and verify its data offline, and verify the private
Block provenance before an operator writes this marker. The marker records
completed migration; it must never be added merely to bypass a failed plan.
It does not replace private provenance validation or authorize guest startup.
Keep the original retained data available for rollback until migration validation
is complete.

Preparation formats only a brand-new private raw file for an existing pending
Block claim. Growth requires an explicit larger sector-aligned capacity and
retains a verified sparse backup. It grows the raw file, loop capacity and ext4
offline, then rebinds the retained PV directly to the replacement claim UID without
making it Available to another pending claim. It never shrinks the filesystem.
Registry operation state blocks workspace starts while an operation is active.
A read-only guard replaces the public loop device during the operation, preventing
late admitted consumers from opening live data. Filesystem checks, resizing and
backup transfers operate on a private raw copy inside a fixed libguestfs
appliance. The node never mounts tenant ext4 or runs its filesystem tools against
tenant data. The appliance process runs without capabilities, network access or
service-account credentials, inside separate mount, PID, IPC, UTS and network
namespaces. Failure retains the guard, journal, safety copy and needs-review state.

Build the offline maintenance image with
`tools/runtime/build-maintenance-image.sh`. Its Ubuntu dependencies use a pinned
archive snapshot; the image contains the kernel, initrd, filesystem appliance and
their checksums. Configure `platformWebhook.runtimeIsolation.vm.growImage` with
the qualified image digest. There is no fallback to host filesystem parsing if
that appliance is missing. Long operations fence VM identity, generation,
specification and protected build intent; status-only resource-version updates
do not invalidate the operation. Individual registry and Kubernetes mutations still use short CAS
checks.

Install `tools/runtime/install-home-devices.sh` and its fixed source bundle on
the worker before relying on reboot recovery. Include `node-identity.json` with
exact `server` (HTTPS API origin) and `node_name` fields, plus the public cluster
CA as `node-api-ca.crt`. The host helper uses the existing root-private kubelet
client certificate at `/var/lib/kubelet/pki/kubelet-client-current.pem`; never
copy that private key into the bundle or a workspace. New HOME provenance pins
the original Node UID. Every operation and reboot binding compares it against a
fresh authenticated Node lookup. Missing UIDs and replacement Node objects fail
closed, even when the hostname matches. Existing HOME records need reviewed
cold enrollment; these checks never backfill a UID or format retained data.

The installer also disables host udev filesystem probing and automount handling for these exact managed raw-loop
paths. Loop control uses the worker's mount namespace and root, with fixed
binaries and a cleared environment. Helpers compare backing inode/device identity
and the full host path, and verify the required rule before publishing a device.
The device service runs before
kubelet, and kubelet requires it to succeed. It does not republish a raw image
with an unfinished operation journal or non-ready manifest. Worker SSH recovery
must remain available: inspect retained backups and private provenance before
clearing a failed operation. The original Coder/Keycloak control plane remains
separate from this worker recovery path.

The root-side allocator reserves unused logical HOME capacity, the fixed 16 GiB
gold root disk per VM and 16 GiB for node/system usage. Operations additionally
reserve raw work and safety copies, both archive copies where applicable, and
5 GiB for bounded appliance scratch space. These reservations do not consume the
node/system reserve. `VM_HOME_NODE_RESERVE_BYTES` and
`VM_GUEST_ROOT_RESERVE_BYTES` are privileged deployment settings; adapt them to
verified storage layout without exposing physical totals through tenant APIs.
Insufficient capacity fails before sparse allocation can overcommit the worker.

### Reproduce the qualified worker and KubeVirt installation

The cluster can use an existing compatible worker or add a dedicated VM-capable
worker pool. Coder services and Keycloak can remain on ordinary workers. On
non-metal EC2, select instances that expose nested virtualization, enable that
capability when provisioning the nodes, and verify `/dev/kvm` on the actual node.
Use the current [EC2 nested virtualization requirements](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/amazon-ec2-nested-virtualization.html)
and [EKS/Karpenter example](https://aws-samples.github.io/karpenter-blueprints/blueprints/nested-virtualization/)
for cloud provisioning. This repository does not create AWS instances or alter
an EKS node group automatically.

Render for a single dedicated worker with `--node WORKER_HOSTNAME`. For a
dedicated pool, label only compatible workers `platform.coder/vm-host=true` and
render with:

```shell
python3 tools/runtime/render-kubevirt-worker.py \
  --node-label platform.coder/vm-host=true \
  --node-label kubernetes.io/arch=amd64 \
  --output /tmp/coder-kubevirt-rendered
```

The qualified image bundle requires amd64 workers; the renderer always includes
that architecture selector and rejects an incompatible override.
The command writes verified manifests and reports that it rendered only; it
does not apply them. Neither placement option permits an empty selector that
silently installs the runtime across all nodes. Keep the dedicated
`platform.coder/workspace-vm-host` NoSchedule taint and the matching runtime
toleration. Apply `platform.coder/vm-ready=true` only after the guest, HOME
recovery, isolation and resource checks pass. Workspace VMs require this readiness
label and their retained HOME node affinity. When no qualified node is available,
provisioning remains pending or fails explicitly instead of using ordinary runc.
Only workers in the selected runtime pool may retain the VM-ready label. Remove
stale readiness labels through the stopped-workspace migration procedure before
changing pools; HOME allocation selects from the qualified workers.
Additional nodes do not automatically move a retained local HOME disk; storage
migration requires its separate stopped-workspace procedure. GPU qualification
is separate from CPU nested-virtualization support.

EKS worker qualification must also verify that a workspace guest cannot reach
EC2 metadata or node credentials through either IPv4 or IPv6. Enforce this
outside the guest using the node network or an enforcing CNI, including the Pod
Identity agent endpoints. Do not associate the workspace launcher service account
with an IAM role or project cloud tokens into the guest. Disabling the node's
IMDS endpoint is an option only when its bootstrap, image pulls and node credential
flows support that configuration. Guest firewall rules, an unenforced NetworkPolicy,
or an IMDSv2 setting alone are insufficient proof. These cloud checks require
validation on the selected EKS workers before granting their readiness label.

`tools/runtime/bootstrap-sysbox-worker.sh` records the verified Noble package URLs,
checksums and Kubernetes signing-key fingerprint. It has separate fresh-install
and after-join phases and contains no join credentials. Install durable HOME
device recovery separately, then qualify actual VM workloads before readiness.
`tools/runtime/configure-worker-registry.sh` configures only the trusted
`localhost:5000` image alias and requires a drained-worker acknowledgement.

`tools/runtime/render-kubevirt-worker.py` verifies pinned KubeVirt 1.8.4 release
asset SHA256 values and renders dedicated-worker placement without applying it.
The checked-in amd64 image lock pins operator/API/controller/handler/launcher
images by digest; these are the components used by the qualified profile. Its
exact dedicated-host toleration supports preparation and final scheduling while
requiring a separately qualified VM-ready selector for tenant VMs. The renderer
removes upstream control-plane-only operator affinity, which otherwise prevents
this worker placement. Use `tools/runtime/bundle-kubevirt-images.sh` to create a
verified offline OCI bundle, preserve digests when loading a private registry,
and render with its mirror prefix. Additional KubeVirt features require their
additional component images to be pinned and packaged before enabling them.

### Dedicated GPU preparation

GPU passthrough is disabled by default. The platform configuration is:

```yaml
platformWebhook:
  runtimeIsolation:
    vm:
      gpu:
        enabled: false
        profiles: []
```

This is preparation, not a qualified GPU runtime. Setting `enabled: true` records
an administrator's request, but admission still reports `unqualified` and refuses
GPU attachment. No hardware has been qualified. The switch cannot authorize native
container passthrough, shared GPUs, MIG, vGPU, or arbitrary host devices. Existing
CPU-only VM profiles keep their VM and Sysbox boundaries. The GPU gate lives
in the trusted admission wrapper; it does not change the sealed V6 guest profile
parser. Changing that parser requires a new qualified gold image.

A proposed profile has a unique DNS-label `name`, `mode: dedicated-pci`, an
extended `resourceName`, an exact hexadecimal `pciSelector` (`vendor:device`),
whole-device `count` from one to eight, and a digest-pinned `guestImage`. Its
`nodeSelector` must contain exactly `platform.coder/vm-ready: "true"` and
`platform.coder/gpu-profile: <name>`. These fields describe requested allocation;
they do not prove available devices. Unknown fields, fake qualification flags,
mutable images, and shared-device resource names are rejected. Device request
counting does not claim an actual allocation or introduce a GPU quota exemption.

Before implementing or enabling a qualified profile, retain evidence for:

1. Actual worker IOMMU/VFIO isolation of the entire assigned PCI function/group,
   with no host-critical devices in that group. Nested CPU virtualization alone
   does not prove GPU passthrough support.
2. Root-controlled KubeVirt permitted-device and device-plugin configuration,
   exclusive whole-device claims, and actual VM assignment matching the profile's
   resource and count. Follow the [KubeVirt host-device requirements](https://kubevirt.io/user-guide/compute/host-devices/).
3. A separately pinned GPU guest image, offline guest driver/CUDA packages, and
   successful CUDA execution as the workspace user inside Sysbox. Guest-root
   `nvidia-smi` alone does not qualify container access.
4. Exact guest device allowlists and UID mappings, with no privileged-container,
   direct node-device, host-network, or native-runc fallback. Existing CPU/RAM
   limits and hardware-total privacy must remain effective.
5. Concurrent tenants seeing only their assigned devices, device reset and VRAM
   isolation before reassignment, and correct stop/start, forced termination,
   quarantine, and failure recovery.
6. Explicit GPU quota/accounting policy and actual assigned-device reporting,
   followed by negative admission tests for unapproved resources, excess counts,
   device sharing, profile swaps, and capability bypasses.

Sysbox GPU behavior needs version-specific proof; upstream tracks limitations in
its [GPU passthrough work](https://github.com/nestybox/sysbox/issues/50). Do not
weaken the existing device validator to make an unqualified GPU appear ready.
