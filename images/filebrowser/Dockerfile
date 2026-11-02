# syntax=docker/dockerfile:1.7
FROM docker.io/library/node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS frontend
WORKDIR /src/frontend
COPY source/frontend/package.json source/frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY source/frontend/ ./
RUN npm test && npm run build

FROM docker.io/library/golang:1.27.3-alpine@sha256:d200d2dd76b03a99b52651fd1325aff7dcd35422c35c01bac56571b0507f3deb AS backend
RUN apk add --no-cache gcc=15.2.0-r5 musl-dev=1.2.6-r3
WORKDIR /src/backend
ENV GOTOOLCHAIN=local GOFLAGS=-mod=readonly CGO_ENABLED=1 GOOS=linux GOARCH=amd64
COPY source/backend/go.mod source/backend/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY source/ /src/
COPY --from=frontend /src/backend/internal/web/embed/ ./internal/web/embed/
ARG VERSION
ARG REVISION
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go mod verify && go run ./scripts/setup-gofitz-cgo \
    && go test -race -timeout=120s ./... \
    && go build -trimpath -buildvcs=false -tags analytics,mupdf,musl \
      -ldflags "-s -w -linkmode external -extldflags -static \
        -X github.com/gtsteffaniak/filebrowser/backend/internal/version.Version=v${VERSION} \
        -X github.com/gtsteffaniak/filebrowser/backend/internal/version.CommitSHA=${REVISION}" \
      -o /out/filebrowser-quantum .

FROM scratch AS binary
COPY --from=backend /out/filebrowser-quantum /
