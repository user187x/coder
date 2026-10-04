#!/usr/bin/env bash

# Usage: ./scripts/platform-preview.sh [develop.sh flags...]
#
# Runs Coder in development mode (./scripts/develop.sh: coderd, the dashboard
# with hot reload, a first admin user) together with a local stand-in for the
# platform services the dashboard add-ons talk to (scripts/platform-mock.py),
# so every add-on page has data to show. Sign in with the admin user the
# develop script prints (admin@coder.com / SomeSecurePassword! by default).
#
# PLATFORM_MOCK_PORT picks the mock's port (default 3099).

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

mock_port="${PLATFORM_MOCK_PORT:-3099}"

# The develop script needs pnpm; corepack provides the version site/package.json pins.
if ! command -v pnpm >/dev/null; then
	mkdir -p "${HOME}/.local/bin"
	corepack enable --install-directory "${HOME}/.local/bin" pnpm
	export PATH="${HOME}/.local/bin:${PATH}"
fi
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# Linking the coder binary needs several GB of scratch space. Keep it off /tmp,
# which is often a small tmpfs.
export GOTMPDIR="${GOTMPDIR:-${HOME}/.cache/coder-go-tmp}"
mkdir -p "${GOTMPDIR}"

# The generated files (protobuf, mocks, ...) are committed. Mark them up to date
# so make doesn't try to regenerate them, which needs protoc and other tools.
# Install packages first: a fresh install touches the node_modules markers that
# several generated files depend on, which would make them look stale again.
make node_modules/.installed site/node_modules/.installed >/dev/null
make gen/mark-fresh >/dev/null

python3 scripts/platform-mock.py "${mock_port}" &
mock_pid=$!
trap 'kill "${mock_pid}" 2>/dev/null || true' EXIT INT TERM

# The dashboard's dev server proxies /__coder-ui and /__banner here (site/vite.config.mts).
export CODER_PLATFORM_HOST="http://127.0.0.1:${mock_port}"

./scripts/develop.sh "$@"
