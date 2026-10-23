#!/bin/sh
# Installs the owner's certificate as ~/.cert/<owner>.p12 (coder_script.user_certificates in ../certificates.tf,
# which explains it).
# The .tf file renders this with templatefile(), so Terraform template syntax applies here: a shell variable in
# braces is written with two dollar signs ($${HOME}), and a percent sign before a brace is doubled (%%{).
set -eu
umask 077
owner='${owner_name}'
case "$owner" in
"" | */* | .* | *[!A-Za-z0-9._@+-]*)
 echo "Unexpected workspace owner name: $owner" >&2
 exit 1
 ;;
esac
dir="$HOME/.cert"
target="$dir/$owner.p12"
state="$${XDG_STATE_HOME:-$HOME/.local/state}/coder-certificates"
mkdir -p "$dir" "$state"
chmod 700 "$dir" "$state"
installed="$state/installed"               # names this script installed on earlier starts (kept out of ~/.cert)
if [ -f "$dir/.installed-by-coder" ]; then # the earlier version kept that list in ~/.cert itself
 cat "$dir/.installed-by-coder" >>"$installed"
 rm -f "$dir/.installed-by-coder"
fi

# The owner's upload, or failing that the first one saved under another name. Only one is installed.
source=""
if [ -f "$dir/.$owner.p12.b64" ]; then source="$dir/.$owner.p12.b64"; fi
for encoded in "$dir"/.*.p12.b64; do
 [ -f "$encoded" ] || continue
 if [ -z "$source" ]; then
  source="$encoded"
 elif [ "$encoded" != "$source" ]; then
  echo "Ignoring $(basename "$encoded"): only one certificate is installed, as ~/.cert/$owner.p12" >&2
  rm -f "$encoded"
 fi
done

ok=""
if [ -z "$source" ]; then echo "No certificate uploaded (Settings > Certificates): ~/.cert has none from Coder"; fi
if [ -n "$source" ]; then
 tmp=$(mktemp "$dir/.install.XXXXXX")
 if base64 -d <"$source" >"$tmp" 2>/dev/null && [ -s "$tmp" ]; then
  chmod 600 "$tmp"
  mv -f "$tmp" "$target"
  ok=1
  echo "Installed ~/.cert/$owner.p12"
 else
  rm -f "$tmp"
  echo "Skipping $(basename "$source"): not a valid upload" >&2
 fi
 rm -f "$source" # the agent writes it again on the next start; the installed .p12 is the only copy kept
fi

# Files installed on earlier starts under other names, and this one if the owner has deleted it in Coder.
if [ -f "$installed" ]; then
 while IFS= read -r old; do
  case "$old" in "" | */* | .*) continue ;; esac
  if [ "$old" = "$owner" ] && [ -n "$ok" ]; then continue; fi
  if [ -f "$dir/$old.p12" ]; then rm -f "$dir/$old.p12" && echo "Removed ~/.cert/$old.p12"; fi
 done <"$installed"
fi
# An empty ~/.cert/<owner>.p12 left behind by the template's former paste-a-certificate parameter.
if [ -f "$target" ] && [ ! -s "$target" ]; then rm -f "$target"; fi

if [ -n "$ok" ]; then echo "$owner" >"$installed"; else rm -f "$installed"; fi
