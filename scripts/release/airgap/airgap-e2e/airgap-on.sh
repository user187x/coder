#!/usr/bin/env bash
# Blocks all non-private egress of the kind node airgap-test-control-plane (idempotent). Rules live in the node's
# network namespace, so a restart of the node (or of docker) drops them: e2e.sh runs this before every test.
set -euo pipefail
docker exec -i airgap-test-control-plane sh -s <<'EOF'
set -e
for t in iptables ip6tables; do
  for c in OUTPUT FORWARD; do $t -N AIRGAP-$c 2>/dev/null || $t -F AIRGAP-$c; $t -C $c -j AIRGAP-$c 2>/dev/null || $t -I $c 1 -j AIRGAP-$c; done
done
for c in OUTPUT FORWARD; do
  for n in 127.0.0.0/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do iptables -A AIRGAP-$c -d $n -j RETURN; done
  iptables -A AIRGAP-$c -j REJECT
  ip6tables -A AIRGAP-$c -d ::1/128 -j RETURN; ip6tables -A AIRGAP-$c -d fe80::/10 -j RETURN; ip6tables -A AIRGAP-$c -d fd00::/8 -j RETURN; ip6tables -A AIRGAP-$c -j REJECT
done
EOF
echo "egress blocked"
