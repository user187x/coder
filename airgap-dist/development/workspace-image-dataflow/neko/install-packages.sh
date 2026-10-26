#!/usr/bin/env bash
# Keep the base's configured repositories while using only signed Ubuntu snapshot packages here.
set -Eeuo pipefail
source /etc/os-release
[[ $VERSION_ID == 26.04 && $VERSION_CODENAME == resolute ]]
backup=$(mktemp -d)
mkdir -p "$backup/sources"
shopt -s nullglob
files=(/etc/apt/sources.list.d/*)
((${#files[@]} == 0)) || mv "${files[@]}" "$backup/sources/"
if [[ -f /etc/apt/sources.list ]]; then mv /etc/apt/sources.list "$backup/list"; fi
restore() {
 rm -f /etc/apt/sources.list.d/coder-neko.sources
 saved=("$backup"/sources/*)
 ((${#saved[@]} == 0)) || mv "${saved[@]}" /etc/apt/sources.list.d/
 if [[ -f $backup/list ]]; then mv "$backup/list" /etc/apt/sources.list; fi
 rm -rf "$backup"
}
trap restore EXIT
cat > /etc/apt/sources.list.d/coder-neko.sources <<'SOURCES'
Types: deb
URIs: https://snapshot.ubuntu.com/ubuntu/20261024T000000Z/
Suites: resolute resolute-updates resolute-security
Components: main universe multiverse restricted
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
Check-Valid-Until: no
SOURCES
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
rm -rf /var/lib/apt/lists/*
