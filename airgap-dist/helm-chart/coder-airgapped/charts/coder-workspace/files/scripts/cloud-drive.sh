#!/usr/bin/env bash
# The owner's Cloud Drive in this workspace: everything the workspace does with it is in this one script, and the
# `cloud-drive` command it installs (coder_script.cloud_drive in ../main.tf, a platform section; main.tf itself only
# mounts the volumes and sets the pod's annotation). Runs at every start.
#
# ~/cloud-drive links to it while the pod's annotation platform.coder/cloud-drive says so. The platform service sets the
# annotation and, by exec, tells this script at once (cloud-drive.sh push); the pod sees the annotation at
# /etc/platform/cloud-drive (the downward API) too, but the kubelet may take a minute or more to update that file. The
# watcher started here follows whichever of the two was written last, every second: no restart.
#   on              its volume, mounted out of the way (MOUNT), when this workspace started with one
#   off             none: disconnected by the owner (dragging its cable away), or shared with others (the Cloud
#                   Drive is the owner's alone)
#   source:<folder> a folder of this workspace is the owner's Cloud Drive (the platform service serves it from here
#                   to their other workspaces): linked as it is
# How it started (mode, from the platform service then): "mount" with the volume; "source"; "shared" or "offline"
# (the owner's source workspace was not running) without one - the drive comes with the next start.
# The Cloud Drives other users shared with the owner (Cloud Drive > Sharing) come mounted under PEERS, one folder per
# owner (read only unless shared read and write): linked at ~/cloud-drive-shared/<owner>, at every start. A folder or
# file of one shared with them comes mounted under ITEMS (/mnt/cloud-drive-items/<share id>; ITEMS_LIST names them):
# linked at ~/cloud-drive-shared/<owner>/<its name> - or ~/cloud-drive-shared/<owner> (shared items)/<its name> when
# that owner's entire drive is linked at ~/cloud-drive-shared/<owner> too.
# The `cloud-drive` command (~/.local/bin/cloud-drive, from scripts/cloud-drive-cli.py - the file the platform service
# runs in workspaces too): the Cloud Drive mounted into folders of the workspace (`cloud-drive mount ~/project/data`),
# files of the same name resolved as the owner chooses; the watcher brings those mounts up to date every 10 seconds
# (`cloud-drive sync`).
# File Browser shows each Cloud Drive here as a source of its own, and asks this script which they are. This installs
# its helper (scripts/filebrowser.sh, kept when the template's own startup.sh installed a newer one), starts it again
# as they change and, every 10 seconds, has it take over a File Browser an older startup.sh started (a template made in
# the template builder keeps its own startup.sh, while this section is the base template's current one at every build).
#
# At start it writes itself - this start's values and its functions - to /tmp/coder-cloud-drive/cloud-drive.sh (per
# container: a workspace started without a Cloud Drive has none), for the watcher and for File Browser:
#   cloud-drive.sh watch    the watcher, started here: the link every second; every 10 seconds the `cloud-drive
#                           mount`s and File Browser
#   cloud-drive.sh drives   the Cloud Drives here, a JSON object a line: {name, path, readOnly} (a drive whose storage
#                           does not answer is left out, not waited on)
#   cloud-drive.sh targets  the folders the drives' links lead to, a line each
#   cloud-drive.sh links    the drives' links in the home, a line each: the owner's drive's link, the folder of the
#                           shared ones (it holds only links)
#   cloud-drive.sh push S   the platform service's word as it changes the annotation (on, off, source:<folder>): the
#                           watcher follows it within a second; it waits for that (up to 5 seconds) and says status
#   cloud-drive.sh status   how the owner's drive is here, a word - the agent's metadata cloud_drive (main.tf), which
#                           the dashboard shows: attached (linked, its storage answers), unanswered (linked, its storage
#                           does not answer), waiting (it should be here and is not yet), offline (no volume: its
#                           source workspace was not running at this start), shared (none: the workspace is shared
#                           with others), detached (disconnected)
# main.tf renders this with templatefile(): link, mode, mount, cli, filebrowser and items are the template's values (a
# shell variable in braces is written with two dollar signs).
LINK='${link}'
MODE='${mode}'
MOUNT='${mount}'
ITEMS_LIST='${items}'
STATE=/etc/platform/cloud-drive
PUSHED=/tmp/coder-cloud-drive/pushed
PEERS=/mnt/cloud-drive-peers
ITEMS=/mnt/cloud-drive-items
SHARED="$HOME/cloud-drive-shared"
SELF=/tmp/coder-cloud-drive/cloud-drive.sh
PIDFILE=/tmp/cloud-drive-watch.pid
CLI="$HOME/.local/bin/cloud-drive"
MOUNTS="$HOME/.config/cloud-drive/mounts.json"
FB="$HOME/.local/bin/coder-filebrowser"

# The state now: the annotation's file, or what the platform service pushed (its time, the state) - whichever was
# written last (the kubelet writes the file only when the annotation changed). Nothing pushed yet: the file (the read in
# braces, so its redirection's error is silenced too).
state_now() {
 local at state file_at
 file_at="$(stat -L -c %Y "$STATE" 2>/dev/null || echo 0)"
 if { read -r at state <"$PUSHED"; } 2>/dev/null && [ "$${at:-0}" -ge "$file_at" ]; then
  echo "$state"
 else
  cat "$STATE" 2>/dev/null
 fi
}

# Where ~/cloud-drive should lead in a state: the volume, the source folder, or nowhere (off; no volume).
target_of() {
 case "$1" in
 off) echo "" ;;
 source:/*) echo "$${1#source:}" ;;
 *) echo "$MOUNT" ;;
 esac
}

# ~/cloud-drive as the state says: a link to the volume, to the source folder, or none.
sync_link() {
 local target aside
 target="$(target_of "$(state_now)")"
 if [ -z "$target" ]; then
  if [ -L "$LINK" ]; then
   rm -f "$LINK" && echo "Cloud Drive: not here ($LINK removed)"
   files_again
  fi
  return 0
 fi
 if [ -L "$LINK" ] && [ "$(readlink "$LINK")" = "$target" ]; then
  return 0
 fi
 mkdir -p "$target" 2>/dev/null || true
 if [ -L "$LINK" ]; then
  rm -f "$LINK"
 elif [ -d "$LINK" ] && ! rmdir "$LINK" 2>/dev/null; then
  # a folder made there while the drive was disconnected: kept beside it
  aside="$LINK.local"
  [ -e "$aside" ] && aside="$LINK.local-$(date +%Y%m%d-%H%M%S)"
  mv "$LINK" "$aside" && echo "Cloud Drive: the folder $LINK had files: moved to $aside"
 fi
 ln -s "$target" "$LINK" && echo "Cloud Drive: $LINK -> $target"
 files_again
}

# The shared Cloud Drives: a link for each one mounted now; links to ones no longer shared go (and the folders that
# held only links to shared folders and files).
link_shared() {
 local d name access
 if [ -d "$SHARED" ]; then
  find "$SHARED" -mindepth 1 -maxdepth 1 -type l -lname "$PEERS/*" -delete
  find "$SHARED" -mindepth 2 -maxdepth 2 -type l -lname "$ITEMS/*" -delete
  find "$SHARED" -mindepth 1 -maxdepth 1 -type d -empty -delete
 fi
 for d in "$PEERS"/*/; do
  [ -d "$d" ] || continue
  name="$(basename "$d")"
  mkdir -p "$SHARED" && ln -sfn "$PEERS/$name" "$SHARED/$name"
  if [ -w "$PEERS/$name" ]; then access="read and write"; else access="read only"; fi
  echo "Cloud Drive: $name's, shared with you ($access): $SHARED/$name"
 done
 # The shared folders and files: a link for each one mounted now, by its name (another number when two are named
 # alike).
 echo "$ITEMS_LIST" | base64 -d 2>/dev/null | jq -r '.[]? | [.id, .owner, .item] | @tsv' 2>/dev/null |
  while IFS=$'\t' read -r id owner item; do
   [ -e "$ITEMS/$id" ] || continue
   dir="$SHARED/$owner"
   if [ -L "$dir" ]; then dir="$SHARED/$owner (shared items)"; fi
   mkdir -p "$dir" || continue
   name="$item"
   n=2
   while [ -e "$dir/$name" ] || [ -L "$dir/$name" ]; do
    name="$item ($n)"
    n=$((n + 1))
   done
   ln -s "$ITEMS/$id" "$dir/$name"
   if [ -w "$ITEMS/$id" ]; then access="read and write"; else access="read only"; fi
   if [ -d "$ITEMS/$id" ]; then what="folder"; else what="file"; fi
   echo "Cloud Drive: $owner's $what $item, shared with you ($access): $dir/$name"
  done
 if [ -d "$SHARED" ] && [ -z "$(ls -A "$SHARED")" ]; then
  rmdir "$SHARED"
 fi
}

# File Browser started again with the drives as they are now (nothing if it does not run, or nothing changed for it).
files_again() {
 if [ -x "$FB" ]; then
  "$FB" restart || true
 fi
}

# The same, in the background and skipped while another call works (the watcher's, every 10 seconds).
files_check() {
 if [ -x "$FB" ]; then
  "$FB" check </dev/null &
 fi
}

watch() {
 local n=0
 while sleep 1; do
  sync_link
  n=$((n + 1))
  if [ $((n % 10)) -eq 0 ]; then
   if [ -s "$MOUNTS" ]; then
    "$CLI" sync >/dev/null || true
   fi
   files_check
  fi
 done
}

# a drive whose storage does not answer is left out, not waited on
probe() { timeout 10 test "$@"; }

# source_of LINK NAME [READONLY]: the folder LINK leads to as a drive (nothing for a file, or one that does not
# answer); read only as given, else unless it is writable.
source_of() {
 local target ro="$${3:-}"
 target="$(timeout 10 readlink -f "$1")" && probe -d "$target" || return 0
 if [ -z "$ro" ]; then
  ro=true
  if probe -w "$target"; then ro=false; fi
 fi
 jq -nc --arg name "$2" --arg path "$target" --argjson ro "$ro" '{name: $name, path: $path, readOnly: $ro}'
}

# The Cloud Drives here: the owner's, each one shared with them ("<owner>'s Cloud Drive"), and each folder of one
# shared with them ("<owner>'s <folder>"; a shared file is no drive of its own - it is in the Cloud Drive window, and in
# the workspace at its link).
drives() {
 local link item owner
 if [ -L "$LINK" ]; then
  source_of "$LINK" "Cloud Drive" false
 fi
 for link in "$SHARED"/*; do
  if [ -L "$link" ]; then
   source_of "$link" "$(basename "$link")'s Cloud Drive"
  elif [ -d "$link" ]; then
   owner="$(basename "$link")"
   owner="$${owner% (shared items)}"
   for item in "$link"/*; do
    if [ -L "$item" ]; then
     source_of "$item" "$owner's $(basename "$item")"
    fi
   done
  fi
 done
}

# Where the drives' links lead: the volumes' folders, and the folder the owner's drive is served from when it is one
# of this workspace's (source:<folder>).
targets() {
 local target
 printf '%s\n' /mnt/cloud-drive "$PEERS" "$ITEMS"
 if [ -L "$LINK" ] && target="$(timeout 10 readlink -f "$LINK")"; then
  echo "$target"
 fi
}

links() {
 if [ -L "$LINK" ]; then
  echo "$LINK"
 fi
 if [ -d "$SHARED" ]; then
  echo "$SHARED"
 fi
}

status() {
 local state target
 state="$(state_now)"
 target="$(target_of "$state")"
 if [ -z "$target" ]; then
  if [ -L "$LINK" ]; then
   echo waiting # on its way out
  elif [ "$state" = off ]; then
   echo detached
  elif [ "$MODE" = shared ] || [ "$MODE" = offline ]; then
   echo "$MODE"
  else
   echo waiting
  fi
 elif [ "$(readlink "$LINK" 2>/dev/null)" != "$target" ]; then
  echo waiting
 elif timeout 2 test -d "$LINK/"; then
  echo attached
 else
  echo unanswered
 fi
}

push() {
 case "$${1:-}" in
 on | off | source:/*) ;;
 *)
  echo "push: on, off or source:<folder>" >&2
  return 2
  ;;
 esac
 printf '%s %s\n' "$(date +%s)" "$1" >"$PUSHED.new" && mv "$PUSHED.new" "$PUSHED" || return 1
 local target
 target="$(target_of "$1")"
 for _ in $(seq 25); do
  if { [ -z "$target" ] && [ ! -L "$LINK" ]; } || [ "$(readlink "$LINK" 2>/dev/null)" = "$target" ]; then
   break
  fi
  sleep 0.2
 done
 status
}

# This script as this start has it (its values and functions), for the watcher and File Browser.
write_self() {
 mkdir -p "$(dirname "$SELF")" && chmod 700 "$(dirname "$SELF")" || return 1
 {
  echo '#!/usr/bin/env bash'
  echo "# The workspace's Cloud Drive (the template's scripts/cloud-drive.sh), as its start of $(date -u +%FT%TZ) wrote it."
  declare -p LINK MODE MOUNT STATE PUSHED PEERS ITEMS SHARED SELF CLI MOUNTS FB
  declare -f state_now target_of sync_link files_again files_check watch probe source_of drives targets links status \
   push
  echo 'case "$${1:-}" in'
  echo 'watch | drives | targets | links | status) "$1" ;;'
  echo 'push) push "$${2:-}" ;;'
  echo '*) echo "usage: $0 watch | drives | targets | links | status | push on|off|source:<folder>" >&2 && exit 2 ;;'
  echo 'esac'
 } >"$SELF.new" && chmod 0755 "$SELF.new" && mv "$SELF.new" "$SELF"
}

mkdir -p "$HOME/.local/bin" && echo '${cli}' | base64 -d >"$CLI.new" && chmod 0755 "$CLI.new" && mv "$CLI.new" "$CLI"
fb_helper="$(mktemp)" && echo '${filebrowser}' | base64 -d >"$fb_helper" && bash "$fb_helper" install
rm -f "$fb_helper"
write_self

case "$MODE" in
shared) echo "Cloud Drive: none here - this workspace is shared with others, and the Cloud Drive is its owner's alone" ;;
offline) echo "Cloud Drive: its source workspace was not running when this one started - restart this one once it runs" ;;
esac

sync_link
link_shared
files_again

# A watcher from an earlier start (the agent restarted) gives way to this one.
if [ -f "$PIDFILE" ]; then
 kill "$(cat "$PIDFILE")" 2>/dev/null || true
fi
setsid "$SELF" watch </dev/null >>/tmp/cloud-drive.log 2>&1 &
echo $! >"$PIDFILE"
