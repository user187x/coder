#!/usr/bin/env bash
# Builds the workspace image ghcr.io/user187x/coder-workspace:<TAG> (../workspace-image: enterprise-base + desktop
# with its two themes (Classic, Serenade), noVNC's clipboard shared with the computer and one viewer at a time
# resizing it, Chromium, Terminator,
# Firefox, JetBrains Mono Nerd Font in every terminal (code-server's too) and Noto Color Emoji, tmux, command-line
# tools, k9s/kubectl/kubelogin, Python venv, default ~/.bashrc, code-server, FileBrowser Quantum) and saves it into the delivery bundle (helm-chart/images/workspaces/, its images.txt section's folder), replacing the
# previous one (needs internet). FileBrowser Quantum is a binary for linux-amd64, kept untracked at the repository's
# root as filebrowser-quantum (or FILEBROWSER_QUANTUM=<file>); the Dockerfile checks its SHA-256 and version. Since
# 1.9.2 it is the workspace's own build of 2.1.2 (version 2.1.2-coder.1, a FileBrowser update for symlinked folders:
# gtsteffaniak/filebrowser v2.1.2 with its patches, built as its release is - static, frontend embedded, not packed);
# since 1.9.4 built with Go 1.27.3 and golang.org/x/net 0.60.0 (same source, version and flags; the Dockerfile checks
# both in the binary). code-server's katex is replaced by the fixed 0.18.2, as basic-ftp and shell-quote are.
# Then update its [workspaces] line (tag, digest) in helm-chart/images.txt and
# coder-workspace.workspaceImage in helm-chart/coder-airgapped/values.yaml.
#   ./build-workspace-image.sh [TAG]       default 1.9.4
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; dev="$(dirname "$here")"; top="$(dirname "$dev")"
tag="${1:-1.9.4}"; img="ghcr.io/user187x/coder-workspace:${tag}"
quantum="${FILEBROWSER_QUANTUM:-${top}/filebrowser-quantum}"
[ -f "$quantum" ] || { echo "FileBrowser Quantum's binary is missing: $quantum (see the top of this script)" >&2; exit 1; }
# the binary alone as a build context of its own (not the repository)
qctx="$(mktemp -d)"; trap 'rm -rf "$qctx"' EXIT
cp "$quantum" "$qctx/filebrowser-quantum"
docker build --platform linux/amd64 --build-context quantum="$qctx" -t "$img" "${dev}/workspace-image"
# What the image must provide (the template relies on it):
docker run --rm --entrypoint sh "$img" -c '
	set -e
	test -x /usr/bin/vncserver && test -x /usr/bin/websockify && test -f /usr/share/novnc/index.html
	! dpkg -s light-locker >/dev/null 2>&1
	fc-match monospace | grep -q JetBrainsMono
	# every terminal in the Nerd Font, emoji from Noto Color Emoji
	fc-match "monospace:charset=1f4a5" | grep -q "Noto Color Emoji"
	grep -q "^    font = JetBrainsMono Nerd Font" /etc/xdg/terminator/config
	GSETTINGS_BACKEND=memory gsettings get org.gnome.desktop.interface monospace-font-name | grep -q "JetBrainsMono Nerd Font"
	grep -q "^FontName=JetBrainsMono Nerd Font" /etc/xdg/xfce4/terminal/terminalrc
	cs=/usr/lib/code-server; test -f $cs/src/browser/media/fonts/JetBrainsMonoNerdFont-Light.ttf
	grep -q "fonts/nerd-font.css" $cs/lib/vscode/out/vs/code/browser/workbench/workbench.html
	grep -q "JetBrainsMono Nerd Font" $cs/lib/vscode/extensions/coder-workspace-defaults/package.json
	# noVNC: the clipboard shared with the computer, and only the viewer in use resizing the desktop
	for m in coder-clipboard coder-resize; do test -f /usr/share/novnc/app/$m.js && grep -q "app/$m.js" /usr/share/novnc/vnc.html || { echo "missing: noVNC $m"; exit 1; }; done
	/usr/local/bin/tmux -V && command -v tmux-mirror-setup >/dev/null
	for t in btop bat batcat vim eza fzf grc jq yq k9s kubectl kubectl-oidc_login kubelogin k9s-copy-secret code-server filebrowser; do command -v $t >/dev/null || { echo "missing: $t"; exit 1; }; done
	# Lock Down runs these from the image (lockdown.sh: Network, Freeze), as root in the pod
	for t in iptables ip6tables getent awk kill stat; do command -v $t >/dev/null || { echo "missing (Lock Down): $t"; exit 1; }; done
	# GNU coreutils (not Rust coreutils), and the compilers still there without build-essential
	ls --version | grep -q "GNU coreutils" && gcc --version >/dev/null && g++ --version >/dev/null && make --version >/dev/null
	test -f /usr/share/coder-workspace/bashrc && test -f /usr/share/coder-workspace/vimrc && cmp -s /etc/skel/.bashrc /usr/share/coder-workspace/bashrc
	HOME=$(mktemp -d) bash -ic "type ls; echo ok" 2>&1 | grep -q "^ok$"
	HOME=$(mktemp -d) bash -ic "complete -p kubectl >/dev/null || _completion_loader kubectl; complete -p kubectl" 2>/dev/null | grep -q kubectl
	HOME=$(mktemp -d) sh -c "k9s version -s >/dev/null && test -f \$HOME/.config/k9s/config.yaml"
	grep -q xfce-cp-dark.svg /etc/xdg/xfce4/xfconf/xfce-perchannel-xml/xfce4-desktop.xml && test -f /usr/share/backgrounds/xfce/xfce-cp-dark.svg
	dpkg-query -W -f "\${Version}\n" firefox | grep -qv snap && firefox --version
	grep -qx WebBrowser=chromium /etc/xdg/xfce4/helpers.rc && grep -qx TerminalEmulator=terminator /etc/xdg/xfce4/helpers.rc
	grep -q "use_compositing\" type=\"bool\" value=\"false" /etc/xdg/xfce4/xfconf/xfce-perchannel-xml/xfwm4.xml
	# Chromium (not the snap), Terminator, and the Serenade theme: its programs, themes, icons, fonts and background
	dpkg-query -W -f "\${Version}\n" chromium | grep -q xtradeb && chromium --version && dpkg-query -W terminator >/dev/null
	for t in picom eww rofi coder-desktop-theme modutil; do command -v $t >/dev/null || { echo "missing: $t"; exit 1; }; done
	test -d /usr/share/themes/Lavanda-Dark-Compact-Tokyonight && test -f /usr/share/themes/cirkles/xfwm4/themerc
	test -f /usr/share/icons/Zafiro/index.theme && test -f /usr/share/backgrounds/coder-desktop/serenade.jpg && fc-list | grep -qi overpass
	test -f /etc/xdg/autostart/coder-compositor.desktop && test -f /etc/chromium/policies/managed/coder-workspace.json
	HOME=$(mktemp -d) sh -c "coder-desktop-theme apply serenade >/dev/null && test \"\$(coder-desktop-theme current)\" = serenade && test -f \$HOME/.config/picom.conf && grep -q xrender \$HOME/.config/picom.conf && grep -q \"^animation-exclude\" \$HOME/.config/picom.conf"
	python3 -c "import json; d = json.load(open(\"/usr/share/coder-workspace/addons.json\")); assert d[\"software\"] and d[\"packages\"][\"added\"]"
	python3 -m venv "$(mktemp -d)/v"
	echo "image checks passed"'
# Firefox runs in a container with no network: it renders a local page headless.
docker run --rm --network none --shm-size 256m --entrypoint bash "$img" -c '
	set -e; export HOME="$(mktemp -d)"; echo "<h1>ok</h1>" >"$HOME/t.html"
	timeout 120 firefox --headless --screenshot "$HOME/s.png" "file://$HOME/t.html" >"$HOME/ff.log" 2>&1 || { cat "$HOME/ff.log"; exit 1; }
	test -s "$HOME/s.png" && echo "firefox offline check passed"'
# Chromium too (its sandbox off where the container allows no user namespaces, as in a workspace pod that does not).
docker run --rm --network none --shm-size 256m --entrypoint bash "$img" -c '
	set -e; export HOME="$(mktemp -d)"; echo "<h1>ok</h1>" >"$HOME/t.html"
	timeout 120 chromium --headless --disable-gpu --screenshot="$HOME/s.png" "file://$HOME/t.html" >"$HOME/cr.log" 2>&1 || { cat "$HOME/cr.log"; exit 1; }
	test -s "$HOME/s.png" && echo "chromium offline check passed"'
# code-server and File Browser (Quantum, set up as the template does: under an app path, no sign-in) start and answer
# with no network at all (the template's two web apps).
docker run --rm --network none --entrypoint bash "$img" -c '
	set -e; export HOME="$(mktemp -d)"; cd "$HOME"; mkdir -p files/sub && echo hi >files/sub/a.txt
	code-server --auth none --bind-addr 127.0.0.1:13337 --disable-telemetry --disable-update-check >cs.log 2>&1 &
	printf "http:\n  listen: 127.0.0.1\n  port: 13339\n  baseURL: /@u/w.main/apps/filebrowser/\nserver:\n  disableUpdateCheck: true\n  database:\n    path: %s/fb.sqlite\n  sources:\n    - path: %s/files\n      name: files\n      config:\n        defaultEnabled: true\nauth:\n  methods:\n    noauth: true\n" "$HOME" "$HOME" >fb.yaml
	filebrowser -c fb.yaml --no-input >fb.log 2>&1 &
	fb=http://127.0.0.1:13339/@u/w.main/apps/filebrowser
	for i in $(seq 1 60); do curl -fs http://127.0.0.1:13337/healthz >/dev/null && curl -fs $fb/health >/dev/null && break; sleep 0.5; done
	curl -fs http://127.0.0.1:13337/healthz >/dev/null || { cat cs.log; exit 1; }
	curl -fs $fb/health >/dev/null || { cat fb.log; exit 1; }
	curl -fs "$fb/api/resources?path=/sub&source=files" | grep -q a.txt || { cat fb.log; exit 1; }
	echo "code-server and File Browser offline checks passed"'
# File Browser follows a link out of its source into a folder it is told (symlinkTargets: the Cloud Drives open in
# place), and only there: a link elsewhere stays refused.
docker run --rm --network none --entrypoint bash "$img" -c '
	set -e; export HOME="$(mktemp -d)"; cd "$HOME"; mkdir -p files drive/docs other && echo d >drive/docs/d.txt && echo o >other/o.txt
	ln -s "$HOME/drive" files/cloud-drive && ln -s "$HOME/other" files/other
	printf "{\"http\": {\"listen\": \"127.0.0.1\", \"port\": 13339, \"baseURL\": \"/\"}, \"server\": {\"disableUpdateCheck\": true, \"database\": {\"path\": \"%s/fb.sqlite\"}, \"sources\": [{\"path\": \"%s/files\", \"name\": \"files\", \"config\": {\"defaultEnabled\": true, \"symlinkTargets\": [\"%s/drive\"]}}]}, \"auth\": {\"methods\": {\"noauth\": true}}}\n" "$HOME" "$HOME" "$HOME" >fb.yaml
	filebrowser -c fb.yaml --no-input >fb.log 2>&1 &
	for i in $(seq 1 60); do curl -fs http://127.0.0.1:13339/health >/dev/null && break; sleep 0.5; done
	curl -fs "http://127.0.0.1:13339/api/resources?path=/cloud-drive/docs&source=files" | grep -q d.txt || { cat fb.log; exit 1; }
	test "$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:13339/api/resources?path=/other&source=files")" = 403
	echo "File Browser symlinked folders check passed"'
# its archive in the bundle, in its section's folder of images.txt (replacing the previous tag's)
"${top}/helm-chart/mirror-images.sh" store "$img"
echo "built $img; image ID $(docker image inspect --format '{{.Id}}' "$img")"
