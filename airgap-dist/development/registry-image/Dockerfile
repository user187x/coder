# syntax=docker/dockerfile:1
# ghcr.io/user187x/coder-registry:<distribution version>-<build> (../tools/build-registry-image.sh): the Images view's
# registry (coder-image-registry, where built images are kept). Docker's registry, distribution, built from its
# release's source with the Go release and the Go modules that fix what the release's own binary carries, on Alpine
# with its fixes - otherwise the official image (registry:<version>): the same config, entrypoint, volume and port -
# but running as a regular user (1000, as the chart runs it).
ARG GO_IMAGE
ARG ALPINE_IMAGE

FROM ${GO_IMAGE} AS build
# the Go of the image, never one go.mod would download
ENV GOTOOLCHAIN=local CGO_ENABLED=0
WORKDIR /src
# the release's source (its checksum checked by the build script)
COPY source.tar.gz /source.tar.gz
RUN tar -xzf /source.tar.gz --strip-components=1 && rm /source.tar.gz
# the modules with fixes the release predates (path@version ...); its vendored copies made again
ARG MODULES
RUN go get ${MODULES} && go mod tidy && go mod vendor && go mod verify
ARG VERSION
ARG REVISION
RUN go build -trimpath -mod=vendor \
      -ldflags "-s -w -X github.com/distribution/distribution/v3/version.version=${VERSION} \
                -X github.com/distribution/distribution/v3/version.revision=${REVISION} \
                -X github.com/distribution/distribution/v3/version.mainpkg=github.com/distribution/distribution/v3" \
      -o /registry ./cmd/registry \
 && /registry --version

FROM ${ALPINE_IMAGE}
RUN apk upgrade --no-cache && apk add --no-cache ca-certificates \
 && mkdir -p /var/lib/registry && chown 1000:1000 /var/lib/registry
COPY --from=build /registry /bin/registry
COPY config.yml /etc/distribution/config.yml
COPY --chmod=755 entrypoint.sh /entrypoint.sh
ENV OTEL_TRACES_EXPORTER=none
VOLUME ["/var/lib/registry"]
EXPOSE 5000
USER 1000:1000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["/etc/distribution/config.yml"]
