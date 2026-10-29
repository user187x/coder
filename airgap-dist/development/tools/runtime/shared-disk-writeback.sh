#!/usr/bin/env bash
# Bound image-unpack writeback on single-host labs where container images,
# Kubernetes state and PostgreSQL share a disk. Percentage-based defaults on
# large-memory hosts can queue seconds of writes ahead of database fsyncs.
# Run on the Docker host, not inside a workspace. This does not relax fsync,
# synchronous replication, or HA lease fencing.
set -euo pipefail

case "${1:---check}" in
  --check) apply=0 ;;
  --apply) apply=1 ;;
  *) echo "Usage: $0 [--check|--apply]" >&2; exit 2 ;;
esac

background=$(cat /proc/sys/vm/dirty_background_bytes)
foreground=$(cat /proc/sys/vm/dirty_bytes)
background_limit=8388608
foreground_limit=33554432
# Preserve limits already stricter than these bounds.
if ((background > 0 && background < background_limit)); then
  background_limit=$background
fi
if ((foreground > 0 && foreground < foreground_limit)); then
  foreground_limit=$foreground
fi
if ((background_limit >= foreground_limit)); then
  background_limit=$((foreground_limit / 2))
fi

if ((apply)); then
  ((EUID == 0)) || { echo '--apply must run as root on the Docker host.' >&2; exit 1; }
  config=/etc/sysctl.d/90-coder-shared-disk-writeback.conf
  printf '# Bound shared-disk writeback for Coder local clusters.\nvm.dirty_background_bytes = %s\nvm.dirty_bytes = %s\n' \
    "$background_limit" "$foreground_limit" > "$config"
  chmod 0644 "$config"
  sysctl -p "$config"
elif ((background == 0 || foreground == 0 || background > background_limit || foreground > foreground_limit)); then
  echo 'Unbounded shared-disk writeback: image extraction may stall database and HA lease writes.' >&2
  echo "Review and run as root: $0 --apply" >&2
  exit 1
else
  echo 'Shared-disk writeback is bounded.'
fi
