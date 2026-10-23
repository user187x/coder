#!/usr/bin/env bash
# (Re)creates the test realm content in the e2e Keycloak (start-dev keeps it in memory, so a pod restart loses it):
# confidential client "coder" with the secret in pki/oidc-client-secret.txt, and user tester / tester@airgap.test.
set -euo pipefail
W="$(cd "$(dirname "$0")" && pwd)"; export KUBECONFIG=$W/kubeconfig
SECRET=$(tr -d '\n' < "$W/pki/oidc-client-secret.txt")
kubectl -n keycloak exec -i deploy/keycloak -- env HOME=/tmp SECRET="$SECRET" sh -s <<'EOF'
set -e
K=/opt/keycloak/bin/kcadm.sh
$K config credentials --server http://localhost:8080 --realm master --user admin --password admin-test-pw
if [ -z "$($K get clients -r master -q clientId=coder --fields id --format csv --noquotes)" ]; then
  $K create clients -r master -s clientId=coder -s enabled=true -s publicClient=false -s standardFlowEnabled=true \
    -s 'redirectUris=["https://coder.airgap.test/api/v2/users/oidc/callback"]' -s secret="$SECRET"
fi
if [ -z "$($K get users -r master -q username=tester --fields id --format csv --noquotes)" ]; then
  $K create users -r master -s username=tester -s email=tester@airgap.test -s emailVerified=true -s enabled=true \
    -s firstName=Test -s lastName=User
  $K set-password -r master --username tester --new-password Tester-pw-123
fi
echo "keycloak test realm ready"
EOF
