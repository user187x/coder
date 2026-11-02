#!/usr/bin/env bash
# Assemble air-gapped releases from the repository's maintained source locations.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
exec python3 "$root/scripts/release/airgap/assemble.py" "$@"
