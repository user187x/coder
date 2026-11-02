FROM docker.io/library/python:3.13-alpine@sha256:bf12ecc0bea3f171d55145dd02c78b5eeb09f30ee2ac9cc2b4c9e4e8f5e30741 AS certificates

FROM docker.io/library/ubuntu:24.04@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac AS dependencies
ARG UBUNTU_SNAPSHOT=20261024T000000Z
COPY --from=certificates /etc/ssl/cert.pem /etc/ssl/certs/ca-certificates.crt
RUN printf 'APT::Snapshot "%s";\n' "$UBUNTU_SNAPSHOT" > /etc/apt/apt.conf.d/50snapshot \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates coreutils e2fsprogs libguestfs-tools linux-image-virtual \
        python3 python3-guestfs qemu-system-x86 util-linux \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

FROM dependencies
COPY --from=dependencies / /opt/coder-vmfs/rootfs/
RUN mkdir -p /opt/coder-vmfs/rootfs/work /opt/coder-vmfs/rootfs/tmp \
        /opt/coder-vmfs/rootfs/run /opt/coder-vmfs/rootfs/dev \
        /opt/coder-vmfs/rootfs/proc /opt/coder-vmfs/rootfs/app \
    && libguestfs-make-fixed-appliance /opt/coder-vmfs/rootfs/opt/coder-vmfs/appliance \
    && dpkg-query -W -f='${binary:Package}\t${Version}\n' \
        > /opt/coder-vmfs/rootfs/opt/coder-vmfs/appliance/PACKAGES.txt \
    && cd /opt/coder-vmfs/rootfs/opt/coder-vmfs/appliance \
    && sha256sum kernel initrd root README.fixed PACKAGES.txt > SHA256SUMS \
    && chmod -R a-w /opt/coder-vmfs/rootfs \
    && rm -rf /boot /usr/lib/modules /lib/modules \
        /opt/coder-vmfs/rootfs/boot /opt/coder-vmfs/rootfs/usr/lib/modules
RUN chmod a+r /opt/coder-vmfs/rootfs/opt/coder-vmfs/appliance/*
COPY app/ /app/
COPY app/ /opt/coder-vmfs/rootfs/app/
RUN chmod -R a-w /opt/coder-vmfs/rootfs/app
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
LABEL org.opencontainers.image.title="Coder isolated VM disk maintenance"
