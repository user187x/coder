# Optional enclave research workspace

This is an opt-in testing image, not a platform deployment dependency. The normal
installer, Helm charts, required nine-image inventory, and release build do not
build, pull, or start it. Use it for a dedicated research workspace in an enclave
selected for accreditation testing.

The image extends the Coder workspace image, retaining its terminal, editor,
desktop, and file browser. It includes the research projects maintained in
[`source/`](source/) and a Debian guest with its own Linux kernel, matching kernel headers,
GCC, Clang, libbpf, bpftool, Python, pytest, GDB, and strace.

## Build and transfer

From the repository root:

```sh
RESEARCH_IMAGE=coder-research-sandbox:$(cat RELEASE_VERSION) \
RESEARCH_ARCHIVE=/tmp/coder-research-sandbox.tar.gz \
  ./scripts/build_airgap_release.sh --tool build-research-workspace.sh
```

The script uses the workspace base at `RELEASE_VERSION` and builds only `linux/amd64`.
It runs the guest checks and optionally writes a Docker archive and SHA-256 checksum.
Nothing is pushed or deployed. The version
comes from `RELEASE_VERSION`, independently of the platform's required inventory.

Use **Images > Import** to import the archive or a separately published registry
reference. Select that image when creating the dedicated workspace. Allocate at
least 4 GiB RAM and 2 CPU cores. The default guest uses 2 GiB and 2 virtual CPUs;
software emulation is slower than hardware virtualization.

To enable the deployment shortcut, publish the image to a registry reachable by
the workspace nodes and set `imageBuilder.researchImage` in the Helm values to
its full registry reference. Prefer an immutable `@sha256` digest. In **Images**,
select **Deploy research sandbox**, then **Continue to workspace setup**.
The form selects the research image on the default workspace template and starts
with 2 CPU cores and 4 GiB of memory. Review the name and schedule before creating
the workspace. This shortcut does not change existing workspaces or start guest
modules automatically.

## Run experiments

Open the workspace terminal and run:

```sh
sandbox-guest
```

This opens a root console inside a disposable guest. Sources and compiled modules
are in `/opt/coder-research/source`. Exit the console to stop and discard the
guest. No supplied monitor or blocker starts automatically.

For agent-driven tests, write a Bash script in the workspace and pass its path:

```sh
sandbox-guest /opt/coder-research/smoke.sh --timeout 900
sandbox-guest ./experiment.sh --memory 2048 --cpus 2 --timeout 600
```

The runner prints the guest's serial output and returns the script's exit code.
Timeout returns 124; a guest boot failure or missing completion result returns
125. Each invocation starts from a fresh overlay. Save output in the workspace
to retain it; guest disk changes are discarded. The script is delivered on a
read-only virtual CD, without sharing the workspace filesystem.

## Testing boundaries

Kernel modules affect a whole kernel. Run these experimental modules inside the
guest, not in the workspace container or on a cluster node. The guest uses QEMU
software emulation with no KVM device, host devices, host filesystem mounts, or
network adapter. It needs no privileged pod, host PID namespace, or additional
Linux capabilities. The workspace's existing network policy still governs its
normal tools and Coder agent; this image does not change enclave network policy.

The process network blocker can be evaluated against guest-local services.
The input monitor observes guest Linux virtual-console keyboard events, not
Coder dashboard input or serial-console text. Source samples remain experimental;
successful compilation and smoke tests are not a security accreditation.

The eBPF monitor is compiled against the guest's own BTF at test time. Build-time
module compilation uses the packaged guest headers, never `uname -r` from the
Docker build host. `/opt/coder-research/guest-packages.tsv` records the guest's
installed package versions.
