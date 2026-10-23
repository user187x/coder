#!/usr/bin/env bash
# The workspace's metrics (the metadata of coder_agent.main in ../main.tf): one function per metric, each printing the
# line the dashboard shows. main.tf runs this file with the function's name appended, e.g. `ram`; to try one by hand:
#   bash metadata.sh ram
# Read with file(): plain bash (no Terraform template syntax).

# Memory in GB (10^9 bytes) like the disks, not coder stat's GiB: its JSON (indented, so joined into one line for
# awk) gives the bytes.
_mem() {
 coder stat mem "$@" -o json | tr -d " \n" | awk '{ u = $0; sub(/.*"used":/, "", u); t = $0; sub(/.*"total":/, "", t); u += 0; t += 0; if (t > 0) printf "%.2f/%.2f GB (%.0f%%)", u / 1e9, t / 1e9, u * 100 / t; else printf "%.2f GB", u / 1e9 }'
}

# Used and total bytes as "used/total GB (percent)".
_gb() {
 awk -v u="$1" -v t="$2" 'BEGIN { printf "%.1f/%.1f GB (%.0f%%)", u / 1e9, t / 1e9, (t > 0 ? u * 100 / t : 0) }'
}

# A load over a number of cores as "load / cores (percent)".
_load() {
 awk -v l="$1" -v n="$2" 'BEGIN { printf "%.2f / %g cores (%.0f%%)", l, n, (n > 0 ? l * 100 / n : 0) }'
}

# The workspace's CPU limit in cores (its cgroup's quota), else the CPUs it may run on.
_cpu_limit() {
 local quota period
 if { read -r quota period </sys/fs/cgroup/cpu.max; } 2>/dev/null && [ "$quota" != max ]; then
  awk -v q="$quota" -v p="$period" 'BEGIN { printf "%g", q / p }'
 elif { read -r quota </sys/fs/cgroup/cpu/cpu.cfs_quota_us && read -r period </sys/fs/cgroup/cpu/cpu.cfs_period_us; } 2>/dev/null && [ "$quota" -gt 0 ]; then
  awk -v q="$quota" -v p="$period" 'BEGIN { printf "%g", q / p }'
 else
  nproc
 fi
}

# The workspace's RAM: its cgroup's usage and limit.
ram() {
 _mem
}

# The node's RAM.
ram_host() {
 _mem --host
}

# The home volume, in GB: what it holds of its own size (CODER_HOME_DISK_SIZE, the volume's size as Kubernetes has
# it). Where the file system is the volume (EBS...), df says both; where the volume is a directory of a bigger disk
# (local-path, hostPath), df would show that disk, so du counts the home instead.
disk() {
 local vol total used
 vol=$(echo "${CODER_HOME_DISK_SIZE:-}" | awk '{ n = $0 + 0; u = $0; sub(/^[0-9.]+/, "", u); m = 1; if (u == "Ki") m = 1024; else if (u == "Mi") m = 1024^2; else if (u == "Gi") m = 1024^3; else if (u == "Ti") m = 1024^4; else if (u == "k" || u == "K") m = 1e3; else if (u == "M") m = 1e6; else if (u == "G") m = 1e9; else if (u == "T") m = 1e12; printf "%.0f", n * m }')
 read -r total used < <(df -B1 --output=size,used "$HOME" | tail -1)
 if [ -n "$vol" ] && [ "$vol" -gt 0 ] && awk -v t="$total" -v v="$vol" 'BEGIN { exit !(t > v * 1.1) }'; then
  used=$(nice -n 19 du -sxB1 "$HOME" 2>/dev/null | awk '{ print $1 }')
  total=$vol
  # for btop (startup.sh's home-statfs): the volume as this measures it
  printf '%s %s\n' "$total" "$used" >/tmp/coder-home-disk.$$ && mv -f /tmp/coder-home-disk.$$ /tmp/coder-home-disk
 else
  rm -f /tmp/coder-home-disk
 fi
 _gb "$used" "$total"
}

# The disk of the node the workspace runs on (where its images and containers live; on Minikube, the host's disk).
disk_host() {
 local total used
 read -r total used < <(df -B1 --output=size,used / | tail -1)
 _gb "$used" "$total"
}

# Whether process $1 belongs to the metrics: it is one of these scripts (run by the agent as `bash -c` with this file's
# text) or was started by one (coder stat, awk, du, date...), seen in its ancestors' command lines.
_metric_process() {
 local p=$1 s i
 local -a args
 for i in 1 2 3 4 5 6 7 8; do
  [ "$p" -gt 1 ] 2>/dev/null || return 1
  # (in braces: a process that ended meanwhile fails the redirection itself, which a trailing 2>/dev/null would not
  # silence - its error became the metric's value)
  { mapfile -d '' -t args <"/proc/$p/cmdline"; } 2>/dev/null || return 1
  [[ ${args[*]:1} == *"The workspace's metrics (the metadata of coder_agent.main"* ]] && return 0
  { read -r s <"/proc/$p/stat"; } 2>/dev/null || return 1
  s=${s##*) } # after the command's name: the state, then the parent's PID
  set -- $s
  p=$2
 done
 return 1
}

# The workspace's own 1-minute load average, over its CPU limit. /proc/loadavg is the node's (load_host), so this
# counts the way the kernel does, from the workspace's processes alone (the container has its own process list): the
# threads running or waiting for a CPU (state R) or in uninterruptible sleep (D), five samples a tenth of a second
# apart, folded into an exponentially decaying average with the kernel's 1-minute weight (e^(-seconds/60)), kept
# between runs in /tmp. The first run, or one after a long gap, starts from the sample. The metrics themselves are left
# out (_metric_process): the agent starts all of them at the same moment, so this one's samples always met the others
# starting (about two threads), which read as 100% of an idle 2-core workspace.
load() {
 local f s n=0 i pid state=/tmp/.coder-metadata-load prev_time="" prev_avg=""
 for i in 1 2 3 4 5; do
  for f in /proc/[0-9]*/task/[0-9]*/stat; do
   [[ $f == "/proc/$BASHPID/"* ]] && continue # this shell, busy counting
   { read -r s <"$f"; } 2>/dev/null || continue
   s=${s##*) } # the fields after the command's name: the state first
   case $s in
   R* | D*)
    pid=${f#/proc/}
    _metric_process "${pid%%/*}" || n=$((n + 1))
    ;;
   esac
  done
  [ "$i" -lt 5 ] && sleep 0.1
 done
 { read -r prev_time prev_avg <"$state"; } 2>/dev/null
 awk -v n="$n" -v now="$(date +%s.%N)" -v t="$prev_time" -v a="$prev_avg" -v state="$state" 'BEGIN {
  x = n / 5
  if (t == "" || a == "" || now < t || now - t > 600) avg = x
  else { e = exp(-(now - t) / 60); avg = a * e + x * (1 - e) }
  printf "%.6f %.6f\n", now, avg > state
  print avg
 }' | {
  read -r avg
  _load "$avg" "$(_cpu_limit)"
 }
}

# The node's 1-minute load over its cores: /proc/loadavg is the node's, so it is divided by the node's online cores
# (getconf), not by nproc (in the container: the workspace's CPU limit, which made 6 / 6 cores read as fully loaded on
# a 24-core node).
load_host() {
 local avg
 read -r avg _ </proc/loadavg
 _load "$avg" "$(getconf _NPROCESSORS_ONLN 2>/dev/null || grep -c ^processor /proc/cpuinfo)"
}

# The workspace's network traffic so far, as "received sent" bytes: every interface of its own network namespace (the
# pod's) but loopback. Not a metric display: the dashboard's network lights (RX / TX, by the workspace's name) compare
# one reading with the next and light up when bytes went in or out.
net() {
 awk 'NR > 2 { sub(/:/, " "); if ($1 != "lo") { rx += $2; tx += $10 } } END { printf "%.0f %.0f", rx, tx }' /proc/net/dev
}

# As a command: bash metadata.sh <metric>.
if [ "$#" -gt 0 ]; then
 "$@"
fi
