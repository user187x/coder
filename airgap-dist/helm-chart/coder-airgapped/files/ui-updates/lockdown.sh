#!/bin/sh
# Lock Down: jails a workspace, as an admin set it (Workspace page > Lock Down; the platform service's lockdown.py).
#   lockdown.sh MODES CODER_HOST [ROOT]
#   lockdown.sh start file:PATH       at the workspace's start, as its user (the template's coder_script "lockdown",
#                                     which login waits for): Sudo, when PATH (the admins' setting) has it, with sudo
#                                     -n. Network is the pod's init container's (the first form, before the workspace
#                                     runs); a running workspace gets both from the platform service at once.
#
# MODES     a comma list of network, sudo and freeze, or off; or file:PATH, to read it from that file (missing: off).
#           It sets exactly MODES: what is not in it is lifted, so running it again changes nothing.
# CODER_HOST  the host the workspace's agent reaches Coder on (the access URL's): Network keeps it, so the agent stays
#           connected and admins can still open the workspace's terminal and apps, and inspect what runs there.
# ROOT      where the workspace container's / is, for Sudo (/proc/1/root from a container sharing its processes);
#           empty: sudo is left alone.
#
# Run as root in the workspace pod's network namespace with NET_ADMIN: the template's init container (at start) or an
# ephemeral container the platform service adds to the running pod (no restart: the workspace's processes keep
# running, for the admins to look at). The workspace container has no NET_ADMIN, so not even root in it can undo
# Network; Sudo is a last sudoers rule that denies every command, so nobody in it can become root any more (a
# process that is root already stays root).
#
# Network: everything in or out is refused but loopback, DNS (the pod's name servers) and Coder (CODER_HOST's
# addresses), IPv6 entirely. Connections that are open already, to anything else, stop at once.
#
# Freeze (needs ROOT, so only from a container sharing the workspace container's processes): every process of the
# workspace container is paused where it is (SIGSTOP), Coder's agent too, so nothing in it runs and nobody can open
# a session in it any more; its PID 1 cannot be paused from inside and only waits for its children. The paused ones
# are listed in ROOT/run/coder-lockdown-frozen, so lifting Freeze resumes exactly those (SIGCONT) and nothing a user
# had stopped on purpose. The platform service copies the workspace's disk while it is frozen (the snapshot).
set -eu
if [ "$1" = start ]; then
 modes=$(cat "${2#file:}" 2>/dev/null || echo off)
 case ",$modes," in
 *,sudo,*) ;;
 *)
  echo "Lock Down: sudo works as usual (not locked)"
  exit 0
  ;;
 esac
 printf '%s\n' "# Lock Down: an admin took sudo away in this workspace (Workspace page > Lock Down)." \
  'ALL ALL=(ALL:ALL) !ALL' | sudo -n tee /etc/sudoers.d/zz-coder-lockdown.new >/dev/null &&
  sudo -n chmod 0440 /etc/sudoers.d/zz-coder-lockdown.new &&
  sudo -n mv -f /etc/sudoers.d/zz-coder-lockdown.new /etc/sudoers.d/zz-coder-lockdown &&
  echo "Lock Down: sudo is off in this workspace (an admin locked it)."
 exit $?
fi
modes=$1
host=$2
root=${3-}

case $modes in file:*) modes=$(cat "${modes#file:}" 2>/dev/null || echo off) ;; esac
net=
sudo_=
freeze=
case ",$modes," in *,network,*) net=1 ;; esac
case ",$modes," in *,sudo,*) sudo_=1 ;; esac
case ",$modes," in *,freeze,*) freeze=1 ;; esac

out=CODER-LOCKDOWN
in=CODER-LOCKDOWN-IN

# Network: the rules go first in OUTPUT and INPUT, in chains of their own (lifted by removing them).
for t in iptables ip6tables; do
 while $t -D OUTPUT -j "$out" 2>/dev/null; do :; done
 while $t -D INPUT -j "$in" 2>/dev/null; do :; done
 for c in "$out" "$in"; do
  $t -F "$c" 2>/dev/null || true
  $t -X "$c" 2>/dev/null || true
 done
done
if [ -n "$net" ]; then
 servers=$(awk '/^nameserver/ { print $2 }' /etc/resolv.conf | grep -v ':' || true)
 coder=
 for i in 1 2 3 4 5 6 7 8 9 10; do
  coder=$(getent ahostsv4 "$host" 2>/dev/null | awk '{ print $1 }' | sort -u | tr '\n' ' ')
  [ -n "$coder" ] && break
  sleep 1
 done
 [ -n "$coder" ] || echo "lockdown: $host does not resolve: the workspace is cut off from Coder too" >&2
 iptables -N "$out"
 iptables -N "$in"
 iptables -A "$out" -o lo -j ACCEPT
 iptables -A "$in" -i lo -j ACCEPT
 for s in $servers; do
  for p in udp tcp; do
   iptables -A "$out" -d "$s" -p "$p" --dport 53 -j ACCEPT
   iptables -A "$in" -s "$s" -p "$p" --sport 53 -j ACCEPT
  done
 done
 for c in $coder; do
  iptables -A "$out" -d "$c" -p tcp -j ACCEPT
  iptables -A "$in" -s "$c" -p tcp -j ACCEPT
 done
 iptables -A "$out" -p tcp -j REJECT --reject-with tcp-reset
 iptables -A "$out" -j REJECT
 iptables -A "$in" -j DROP
 iptables -I OUTPUT 1 -j "$out"
 iptables -I INPUT 1 -j "$in"
 ip6tables -N "$out"
 ip6tables -N "$in"
 ip6tables -A "$out" -o lo -j ACCEPT
 ip6tables -A "$in" -i lo -j ACCEPT
 ip6tables -A "$out" -j REJECT
 ip6tables -A "$in" -j DROP
 ip6tables -I OUTPUT 1 -j "$out"
 ip6tables -I INPUT 1 -j "$in"
fi

# Sudo: a last rule in sudoers.d that denies every command to everyone (sudo uses the last rule that matches).
if [ -n "$root" ]; then
 f="$root/etc/sudoers.d/zz-coder-lockdown"
 if [ -n "$sudo_" ]; then
  printf '%s\n' "# Lock Down: an admin took sudo away in this workspace (Workspace page > Lock Down)." \
   'ALL ALL=(ALL:ALL) !ALL' >"$f.new"
  chown 0:0 "$f.new"
  chmod 0440 "$f.new"
  mv -f "$f.new" "$f"
 else
  rm -f "$f"
 fi
fi

# Freeze: every process but PID 1 and this container's own (theirs is this root): the workspace container's, and
# the sandboxes its programs start (bubblewrap's have a root of their own).
frozen=
if [ -n "$root" ]; then
 list="$root/run/coder-lockdown-frozen"
 if [ -n "$freeze" ]; then
  # a few rounds: a process may start a child while the others are being paused
  for round in 1 2 3; do
   for d in /proc/[0-9]*; do
    pid=${d#/proc/}
    [ "$pid" = 1 ] && continue
    [ "$d/root" -ef /proc/self/root ] 2>/dev/null && continue
    state=$(awk '{ print $3 }' "$d/stat" 2>/dev/null || true)
    case $state in T | t | Z | "") continue ;; esac
    kill -STOP "$pid" 2>/dev/null && echo "$pid" >>"$list.new" || true
   done
  done
  if [ -f "$list.new" ]; then
   cat "$list.new" "$list" 2>/dev/null | sort -un >"$list.all"
   mv -f "$list.all" "$list"
   rm -f "$list.new"
  fi
  frozen=$(wc -l <"$list" 2>/dev/null || echo 0)
  # what was running at that moment, for the admins (the platform service keeps it with the snapshot)
  echo "lockdown: frozen processes:"
  for pid in $(cat "$list" 2>/dev/null); do
   [ -r "/proc/$pid/cmdline" ] || continue
   printf 'lockdown:   %s %s %s\n' "$pid" "$(stat -c %U "/proc/$pid" 2>/dev/null || echo ?)" \
    "$(tr '\0' ' ' <"/proc/$pid/cmdline" | cut -c1-200)"
  done
 elif [ -f "$list" ]; then
  for pid in $(cat "$list"); do kill -CONT "$pid" 2>/dev/null || true; done
  rm -f "$list"
 fi
fi

# what was asked, for the platform service (a pod's lock at start: the init container's log)
echo "lockdown: modes ${modes:-off}"
state() { if [ -n "$1" ]; then echo on; else echo off; fi; }
if [ -n "$root" ]; then
 echo "lockdown: network $(state "$net"), sudo $(state "$sudo_"), freeze $(state "$freeze")${frozen:+ ($frozen processes paused)}"
else
 echo "lockdown: network $(state "$net") (sudo is set by the workspace's start script, freeze by the platform service)"
fi
