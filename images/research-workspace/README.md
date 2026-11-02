# Optional enclave research workspace

This is an opt-in testing image, not a platform deployment dependency. The normal
installer, Helm charts, required nine-image inventory, and release build do not
build, pull, or start it. Import it into Images only in an enclave selected for
accreditation testing, then select it for a dedicated research workspace.

The image extends the Coder workspace image, retaining its terminal, editor,
desktop, and file browser. It includes the supplied `sandbox_environement`
sources and a Debian guest with its own Linux kernel, matching kernel headers,
GCC, Clang, libbpf, bpftool, Python, pytest, GDB, and strace.

## Build and transfer

From the repository root:

```sh
RESEARCH_IMAGE=coder-research-sandbox:$(cat RELEASE_VERSION) \
RESEARCH_ARCHIVE=/tmp/coder-research-sandbox.tar.gz \
  bash airgap-dist/development/tools/build-research-workspace.sh
```

The script builds only `linux/amd64`, runs the guest checks, and optionally writes
a Docker archive and SHA-256 checksum. Nothing is pushed or deployed. The version
comes from `RELEASE_VERSION`, independently of the platform's required inventory.

Use **Images > Import** to import the archive or a separately published registry
reference. Select that image when creating the dedicated workspace. Allocate at
least 4 GiB RAM and 2 CPU cores. The default guest uses 2 GiB and 2 virtual CPUs;
software emulation is slower than hardware virtualization.

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
