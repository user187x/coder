#!/bin/sh
# This fixed shim is the only initial app process until the private controller is ready.
set -eu
while [ "$(cat /etc/platform/private-ready 2>/dev/null || true)" != true ]; do sleep 1; done
exec /bin/sh /run/coder-vm/agent-init.sh
