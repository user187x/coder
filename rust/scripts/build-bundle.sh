#!/usr/bin/env bash
set -euo pipefail
if [[ $# != 4 ]]; then
  echo "Usage: bash scripts/build-bundle.sh terraform|opentofu /absolute/engine verified-executable-sha256 /absolute/license" >&2
  exit 1
fi
case "$1" in terraform|opentofu) ;; *) echo "Unsupported engine" >&2; exit 1 ;; esac
rust_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$rust_root"
export CODER_EMBEDDED_ENGINE_KIND="$1"
export CODER_EMBEDDED_ENGINE_PATH="$2"
export CODER_EMBEDDED_ENGINE_SHA256="$3"
export CODER_EMBEDDED_ENGINE_LICENSE_PATH="$4"
cargo build --release --locked -p coder
bundle="$rust_root/dist/$CODER_EMBEDDED_ENGINE_KIND"
mkdir -p "$bundle/provisioner/examples"
install -m 755 "${CARGO_TARGET_DIR:-target}/release/coder" "$bundle/coder"
install -m 644 "$4" "$bundle/ENGINE-LICENSE.txt"
install -m 644 ../LICENSE "$bundle/LICENSE"
install -m 644 ui/assets/xterm.LICENSE "$bundle/XTERM-LICENSE.txt"
install -m 644 NETWORK-AUTH-NOTICES.txt "$bundle/NETWORK-AUTH-NOTICES.txt"
install -m 644 SCHEDULER-NOTICES.txt "$bundle/SCHEDULER-NOTICES.txt"
install -m 644 compatibility.json "$bundle/compatibility.json"
install -m 644 README.md "$bundle/README.md"
install -m 644 provisioner/examples/terraform-template.json "$bundle/provisioner/examples/terraform-template.json"
"$bundle/coder" engine version
(cd "$bundle" && sha256sum coder > SHA256SUMS)
# Paths are controlled by the engine choice above; no credentials are packaged.
tar -czf "dist/coder-$CODER_EMBEDDED_ENGINE_KIND.tar.gz" -C "$bundle" coder SHA256SUMS ENGINE-LICENSE.txt XTERM-LICENSE.txt NETWORK-AUTH-NOTICES.txt SCHEDULER-NOTICES.txt compatibility.json LICENSE README.md provisioner/examples/terraform-template.json
