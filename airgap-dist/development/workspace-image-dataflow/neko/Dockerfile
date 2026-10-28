ARG BASE=docker.io/user187x/coder-workspace-dataflow:1.1.4@sha256:8f9b632921c6b4ff85fcd522fa9226bc45807d18908e1c99710cad6e5aa484f1
ARG GO_IMAGE=golang:1.27.3-trixie@sha256:1896654cfc5c2b5ad74c07f29cb36f5d2d1cbed42e3054070fbfe444e521e83c
FROM ${GO_IMAGE} AS sdk
FROM ${BASE} AS builder
USER root
COPY install-packages.sh /tmp/install-neko-packages
RUN bash /tmp/install-neko-packages git gcc g++ make pkg-config autoconf automake libtool xorg-dev xutils-dev libx11-dev libxrandr-dev libxtst-dev libgtk-3-dev libxcvt-dev libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev
COPY --from=sdk /usr/local/go /usr/local/go
ENV PATH=/usr/local/go/bin:$PATH GOTOOLCHAIN=local CGO_ENABLED=1 GOMAXPROCS=2 GOFLAGS=-mod=readonly
COPY upstream/server /src/server
COPY security.patch /src/security.patch
WORKDIR /src
RUN patch -p1 < security.patch
WORKDIR /src/server
RUN sha256sum go.mod go.sum > /tmp/module-manifest.sha256 \
 && go mod download \
 && go build -p 2 -trimpath -buildvcs=false -ldflags '-s -w' -o /neko ./cmd/neko \
 && sha256sum -c /tmp/module-manifest.sha256
COPY upstream/utils/xorg-deps /src/xorg
RUN cd /src/xorg/xf86-video-dummy/v0.3.8 \
 && patch -p1 < ../01_v0.3.8_xdummy-randr.patch \
 && sed -i 's/Bool        (\*CreateWindow)() ;/CreateWindowProcPtr CreateWindow;/' src/dummy.h \
 && autoreconf -v --install && ./configure && make -j2 \
 && cd /src/xorg/xf86-input-neko \
 && ./autogen.sh --prefix=/usr && ./configure && make -j2

FROM ${BASE}
USER root
COPY install-packages.sh /tmp/install-neko-packages
RUN bash /tmp/install-neko-packages pulseaudio libxcvt0 libgstreamer1.0-0 gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-plugins-ugly gstreamer1.0-pulseaudio xserver-xorg-video-dummy \
 && rm /tmp/install-neko-packages
COPY --from=builder /neko /usr/local/bin/neko
COPY --from=builder /src/xorg/xf86-video-dummy/v0.3.8/src/.libs/dummy_drv.so /usr/lib/xorg/modules/drivers/dummy_drv.so
COPY --from=builder /src/xorg/xf86-input-neko/src/.libs/neko_drv.so /usr/lib/xorg/modules/input/neko_drv.so
COPY supervisor.py /usr/local/bin/coder-neko
COPY xorg.conf default.pa /usr/local/share/coder-neko/
COPY upstream/LICENSE /usr/local/share/coder-neko/LICENSE-neko
COPY provenance.json /usr/local/share/coder-neko/provenance.json
RUN chmod 0755 /usr/local/bin/coder-neko \
 && ! ldd /usr/local/bin/neko | grep 'not found' \
 && test -x /opt/airflow/bin/airflow && test -x /opt/nifi/bin/nifi.sh
LABEL org.opencontainers.image.source="https://github.com/m1k1o/neko" \
      org.opencontainers.image.revision="65fba485de2987998c7028b04240b21669d674e0" \
      com.coder.neko.dtls-version="v3.1.4"
USER 1000:1000
# The launch gate authenticates before any workspace entrypoint or healthcheck.
HEALTHCHECK NONE
