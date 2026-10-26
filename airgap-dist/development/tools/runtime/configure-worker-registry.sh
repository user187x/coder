#!/usr/bin/env bash
# Configure only the qualified worker's exact localhost registry alias.
# Usage: sudo ACK_WORKER_DRAINED=yes configure-worker-registry.sh REGISTRY_SERVICE_IPV4
set -Eeuo pipefail
[[ $EUID == 0 && ${ACK_WORKER_DRAINED:-} == yes ]]
address=${1:?trusted coder-image-registry Service IPv4 required}
python3 - "$address" <<'PY'
import ipaddress,sys
address=ipaddress.IPv4Address(sys.argv[1])
assert address.is_private and not address.is_loopback and not address.is_link_local
PY
mkdir -p /etc/containerd/certs.d/localhost:5000
printf '%s\n' "server = \"http://$address:5000\"" "[host.\"http://$address:5000\"]" '  capabilities = ["pull", "resolve"]' > /etc/containerd/certs.d/localhost:5000/hosts.toml
python3 - <<'PY'
import pathlib,re,tomllib
path=pathlib.Path('/etc/containerd/config.toml')
source=path.read_text()
config=tomllib.loads(source)
assert config['version']==3, 'qualified native containerd config v3 required'
section=r'(\[plugins\.[\"\x27]io\.containerd\.cri\.v1\.images[\"\x27]\.registry\][^\[]*)'
match=re.search(section,source)
assert match, 'containerd registry table missing'
body=match[1]
updated=re.sub(r'(?m)^(\s*config_path\s*=).*$', r'\1 "/etc/containerd/certs.d"', body)
if updated==body and 'config_path' not in body:
    updated=body+'  config_path = "/etc/containerd/certs.d"\n'
path.with_suffix('.before-registry.toml').write_text(source)
path.write_text(source[:match.start()]+updated+source[match.end():])
PY
systemctl restart containerd
echo 'Exact private registry alias configured. Repeat worker qualification before readiness labeling.'
