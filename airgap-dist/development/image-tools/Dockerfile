# The platform service's image (coder-ui-updates) and the image builder's scan step: the bundled Python plus the tools
# the Images builder needs, all offline:
#   - shellcheck (lints installation scripts) and shfmt (formats them, `shfmt -i 1`);
#   - trivy with its vulnerability database preloaded (/opt/trivy-cache), so images are scanned without network;
#   - regctl, to read built images from the registry (size, layers, download as a tarball);
#   - copa (Copacetic 0.15.0), which patches an image's packages in place through BuildKit: the pit stops of
#     Images > Fix image (a rootless BuildKit runs beside it in the pit stop's Job).
# Build with ../tools/build-image-tools.sh, which downloads the pinned release binaries of shellcheck and trivy and
# copa's source (checked against their checksums) and the trivy database, and saves the image into the delivery bundle.
# shfmt, regctl and copa are built here from their release tags with a current Go: their release binaries were built
# with Go releases (and copa's with modules) that have had CVEs fixed since.
ARG BASE=docker.io/library/python:3.13-alpine@sha256:2d9aefe2fef018a7eb2c13064c89c71929800fd2e5dccdbf52ea5da5bb8d929a
ARG GO=docker.io/library/golang:1.27.3-alpine@sha256:f2c872bcee949b7be9c490efd02b48a8a2fbf947cdf533f1c58525ec9d8170fd

FROM ${GO} AS go
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOBIN=/out
# shfmt and regctl as released (the Go checksum database checks the modules); they print their tags as their versions.
RUN go install -trimpath -ldflags="-s -w" mvdan.cc/sh/v3/cmd/shfmt@v3.14.1 \
	&& go install -trimpath -ldflags="-s -w" github.com/regclient/regclient/cmd/regctl@v0.11.6 \
	&& go clean -cache -modcache
# copa 0.15.0 (the release's source, copacetic/) with the modules that had CVEs raised to their fixed releases: trivy
# (the report types copa reads), containerd, OpenTelemetry, x/crypto, x/mod, x/net, x/text and gRPC; its unit tests
# give the same results as with its own modules.
COPY copacetic/ /src/copacetic/
WORKDIR /src/copacetic
RUN go get github.com/aquasecurity/trivy@v0.72.0 github.com/containerd/containerd/v2@v2.3.7 \
		go.opentelemetry.io/otel/sdk@v1.45.0 go.opentelemetry.io/otel/exporters/otlp/otlptrace@v1.45.0 \
		golang.org/x/crypto@v0.57.0 golang.org/x/mod@v0.41.0 golang.org/x/net@v0.60.0 golang.org/x/text@v0.42.0 \
		google.golang.org/grpc@v1.83.2 \
	&& go mod tidy \
	&& go build -trimpath -ldflags="-s -w -X main.version=0.15.0" -o /out/copa . \
	&& go clean -cache -modcache

FROM ${BASE}
# The distribution's fixes since the base was made; and no pip: nothing here installs packages (Copa runs pip inside
# the images it patches), and pip vendors libraries with CVEs that no pip release has fixed yet
# (`python3 -m ensurepip` puts it back).
RUN apk upgrade --no-cache \
	&& PIP_ROOT_USER_ACTION=ignore python3 -m pip uninstall -y -q pip
COPY bin/ /usr/local/bin/
COPY --from=go /out/ /usr/local/bin/
COPY trivy-cache/ /opt/trivy-cache/
RUN chmod -R a+rX /opt/trivy-cache /usr/local/bin \
	&& shellcheck --version >/dev/null && shfmt --version >/dev/null && trivy --version >/dev/null \
	&& regctl version >/dev/null && copa --version >/dev/null
# trivy never updates its database here: the bundle's database is used (a newer one can be uploaded in the Images view).
ENV TRIVY_CACHE_DIR=/opt/trivy-cache TRIVY_SKIP_DB_UPDATE=true TRIVY_SKIP_JAVA_DB_UPDATE=true TRIVY_OFFLINE_SCAN=true \
	TRIVY_NO_PROGRESS=true
