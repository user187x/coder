# syntax=docker/dockerfile:1.7
ARG GUEST_BASE=debian:bookworm-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3
ARG WORKSPACE_BASE=docker.io/mrshll187/coder-workspace:1.5.1@sha256:72a82891e0a8705995ef2c5c761a7b4be130b2f641e6c246b9c2a5dcf5dc7ba0
FROM ${GUEST_BASE} AS guest
ARG TARGETARCH
RUN test "$TARGETARCH" = amd64
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    linux-image-amd64 linux-headers-amd64 initramfs-tools \
    build-essential clang llvm libbpf-dev libelf-dev zlib1g-dev bpftool \
    python3 python3-venv python3-pytest git jq curl wget ca-certificates \
    iproute2 iputils-ping procps strace gdb kmod sudo util-linux busybox \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*
COPY source/ /opt/coder-research/source/
COPY guest/ /usr/local/lib/coder-research/
RUN chmod 0755 /usr/local/lib/coder-research/* \
    && /bin/busybox --list | grep -qx poweroff \
    && useradd --create-home --uid 1000 researcher \
    && printf 'researcher ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/researcher \
    && chmod 0440 /etc/sudoers.d/researcher \
    && /usr/local/lib/coder-research/build-modules \
    && dpkg-query -W -f='${Package}\t${Version}\n' > /opt/coder-research/guest-packages.tsv \
    && mkdir -p /run /tmp /media/job

FROM ${GUEST_BASE} AS disk
RUN apt-get update && apt-get install -y --no-install-recommends e2fsprogs qemu-utils \
    && rm -rf /var/lib/apt/lists/*
COPY --from=guest / /rootfs/
RUN mkdir /out && cp /rootfs/boot/vmlinuz-* /out/vmlinuz \
    && cp /rootfs/boot/initrd.img-* /out/initrd \
    && truncate -s 5G /out/guest.raw \
    && mkfs.ext4 -q -F -d /rootfs /out/guest.raw \
    && qemu-img convert -f raw -O qcow2 -c /out/guest.raw /out/guest.qcow2 \
    && rm /out/guest.raw

FROM ${WORKSPACE_BASE}
USER root
ARG TARGETARCH
ARG VERSION
RUN test "$TARGETARCH" = amd64 && test -n "$VERSION" \
    && apt-get update && apt-get install -y --no-install-recommends qemu-system-x86 qemu-utils genisoimage \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*
COPY --chmod=0755 --from=disk /out/ /opt/coder-research/guest/
COPY --from=guest /opt/coder-research/ /opt/coder-research/
COPY smoke.sh /opt/coder-research/smoke.sh
COPY --chmod=0755 sandbox-guest.py /usr/local/bin/sandbox-guest
LABEL org.opencontainers.image.title="Coder Research Sandbox" \
    org.opencontainers.image.description="Workspace research tools with a disposable x86-64 guest kernel" \
    org.opencontainers.image.version="${VERSION}"
USER coder
