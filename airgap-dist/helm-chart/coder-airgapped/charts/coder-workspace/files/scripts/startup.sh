#!/usr/bin/env bash
# The workspace's startup script (coder_agent.main in ../main.tf): the shell defaults, the cluster sign-in for admins,
# the desktop and the apps (code-server, File Browser). A template made in Create new template may leave out the
# desktop or File Browser (its desktop and file_browser variables). Runs at every start; each step is safe to repeat.
# Scripts of their own run beside it (each its coder_script in main.tf, in the workspace's Logs under its name): the
# Cloud Drive (cloud-drive.sh: everything the workspace does with it), Lock Down and the certificate.
# The .tf file renders this with templatefile(), so Terraform template syntax applies here: a shell variable in
# braces is written with two dollar signs ($${HOME}), and a percent sign before a brace is doubled (%%{).
set -e

# The template's values (templatefile).
OWNER_NAME='${owner_name}'
WORKSPACE_NAME='${workspace_name}'
NAMESPACE='${namespace}'
CLUSTER_ADMIN='${cluster_admin}' # true: the owner is an admin and the cluster sign-in is on
CLUSTER_KUBECONFIG='${cluster_kubeconfig}'
CLUSTER_OIDC_ISSUER='${cluster_oidc_issuer}'
CLUSTER_OIDC_CLIENT_ID='${cluster_oidc_client_id}'
CODE_SERVER_APP='${code_server}' # true: the code-server app (main.tf's code_server)
DESKTOP='${desktop}'             # true: the desktop (noVNC's Desktop app)
DESKTOP_THEME='${desktop_theme}' # the Desktop theme parameter: serenade or classic (coder-desktop-theme)
FILE_BROWSER='${file_browser}'   # true: File Browser
START_DIR='${start_directory}'   # the Start folder parameter: where the terminal and File Browser open
# Path-based apps are proxied under this prefix ("main" = the agent's name).
APPS="/@$OWNER_NAME/$WORKSPACE_NAME.main/apps"
# One line per step, for the workspace page's Logs panel (the agent keeps this script's output, with the time).
log() { printf '%s\n' "$*"; }
log "Starting workspace $WORKSPACE_NAME of $OWNER_NAME"

# The Linux user is named after the owner - whoami, the prompt, file owners, the desktop - not "coder": uid 1000's
# account is renamed at every start (a new pod has the image's accounts again; the account's processes keep running,
# which usermod refuses, so its files are edited), its home still /home/coder. sudo allows the new name first (checked
# with visudo), so it keeps working (Lock Down's rule still comes last). Left as it is where sudo is not allowed (Lock
# Down's Sudo Command), or where the name is another account's or no Linux user name.
LINUX_USER=$(printf '%s' "$OWNER_NAME" | tr '[:upper:]' '[:lower:]')
CURRENT_USER=$(id -un)
if [ "$CURRENT_USER" = "$LINUX_USER" ]; then
 :
elif [ "$(id -u)" != 1000 ] || ! sudo -n true 2>/dev/null; then
 log "Linux user: $CURRENT_USER (sudo is not allowed, so not renamed $LINUX_USER)"
elif ! printf '%s' "$LINUX_USER" | grep -Eqx '[a-z_][a-z0-9_-]{0,31}'; then
 log "Linux user: $CURRENT_USER ($OWNER_NAME is no Linux user name)"
elif getent passwd "$LINUX_USER" >/dev/null || getent group "$LINUX_USER" >/dev/null; then
 log "Linux user: $CURRENT_USER ($LINUX_USER is another account's name)"
else
 rule=$(mktemp)
 printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$LINUX_USER" >"$rule"
 if sudo -n visudo -cqf "$rule" && sudo -n install -m 0440 -o root -g root "$rule" /etc/sudoers.d/coder-user; then
  sudo -n sed -i "s/^$CURRENT_USER:/$LINUX_USER:/" /etc/passwd /etc/shadow
  sudo -n sed -i -E "s/^$CURRENT_USER:/$LINUX_USER:/; s/([:,])$CURRENT_USER(,|\$)/\1$LINUX_USER\2/g" /etc/group /etc/gshadow
  log "Linux user: $LINUX_USER (was $CURRENT_USER)"
 else
  log "Linux user: $CURRENT_USER (its sudo rule for $LINUX_USER was refused)"
 fi
 rm -f "$rule"
fi
# The agent started as coder and keeps that name (Go caches it): it finds the shell of every terminal and SSH session
# by it in /etc/passwd, and without it those exit at once. So the old name stays, as a second name of the same
# account after the new one: uid 1000 still resolves to the new name (whoami, the prompt), and coder still resolves,
# for the agent and for anything that names it (sudo -u coder, chown coder).
if [ "$(id -u)" = 1000 ] && [ "$(id -un)" != coder ] && ! getent passwd coder >/dev/null && sudo -n true 2>/dev/null; then
 for f in /etc/passwd /etc/shadow /etc/group /etc/gshadow; do
  sudo -n sh -c "grep '^$(id -un):' $f | sed 's/^$(id -un):/coder:/' >>$f"
 done
fi
# What starts from here, and every shell (/etc/profile.d, /etc/bash.bashrc), carries the account's name: the agent
# set USER when it started, as coder.
export USER="$(id -un)" LOGNAME="$(id -un)"
if [ "$USER" != coder ] && [ ! -e /etc/profile.d/coder-user.sh ] && sudo -n true 2>/dev/null; then
 printf '%s\n' '# The workspace renames its Linux user after the owner at every start (the template'"'"'s startup.sh).' \
  'export USER="$(id -un)" LOGNAME="$(id -un)"' | sudo -n tee /etc/profile.d/coder-user.sh >/dev/null
 grep -q coder-user.sh /etc/bash.bashrc ||
  printf '. /etc/profile.d/coder-user.sh\n' | sudo -n tee -a /etc/bash.bashrc >/dev/null
fi

# The Start folder: made when it is missing under the home (the agent's sessions start there); a path that steps up
# (..) or one that cannot be made is the home.
case "/$START_DIR/" in
*/../* | */./*) START_DIR=/home/coder ;;
esac
if [ ! -d "$START_DIR" ]; then
 case "$START_DIR" in
 /home/coder/*) mkdir -p "$START_DIR" && log "Start folder: made $START_DIR" || START_DIR=/home/coder ;;
 *) log "Start folder $START_DIR does not exist: File Browser opens the home" && START_DIR=/home/coder ;;
 esac
fi

# No core dumps (the pod's command already sets this for the agent and all it starts), and remove the ones an
# earlier workspace image left in the home directory: light-locker crashed at every desktop start, writing
# core.<pid>. Only files named core.<digits> that are ELF core dumps are removed.
ulimit -c 0
for f in /home/coder/core.[0-9]*; do
 [ -f "$f" ] || continue
 if [ "$(head -c 4 "$f" | od -An -c | tr -d ' ')" = "177ELF" ] && [ "$(od -An -tu1 -j16 -N1 "$f" | tr -d ' ')" = "4" ]; then
  rm -f "$f"
 fi
done

# The default shell setup (in the workspace image): its ~/.bashrc for users who have none, or still Ubuntu's stock
# one (an edited ~/.bashrc is left alone); ~/.profile, so login shells read ~/.bashrc; the vimrc that ~/.bashrc
# points Vim at (VIMINIT).
if [ -f /usr/share/coder-workspace/bashrc ]; then
 if [ ! -e ~/.bashrc ] || cmp -s ~/.bashrc /usr/share/coder-workspace/ubuntu-bashrc; then
  cp /usr/share/coder-workspace/bashrc ~/.bashrc
 fi
 [ -e ~/.profile ] || cp /etc/skel/.profile ~/.profile
 if [ ! -e ~/.config/vim/vimrc ]; then
  mkdir -p ~/.config/vim && cp /usr/share/coder-workspace/vimrc ~/.config/vim/vimrc
 fi
fi

# Dotfiles of an image built in Templates > Images: copied into the home directory where it has none of its own.
if [ -d /usr/share/coder-image/home ]; then
 cp -an /usr/share/coder-image/home/. ~/ 2>/dev/null || true
fi

# btop refreshes every 100 ms instead of its default 2000, and its disks panel shows the home's disk - the workspace's
# own (the others are the node's): btop's default reads the disks from /etc/fstab, which a container leaves
# unconfigured (an empty panel), and counts "physical" filesystems only (not the overlay a node folder's volume is).
# For users without a btop configuration, or whose configuration still has btop's defaults (a value someone chose is
# left alone).
BTOP_CONF=~/.config/btop/btop.conf
if [ ! -e "$BTOP_CONF" ]; then
 mkdir -p ~/.config/btop
 printf '%s\n' "update_ms = 100" "use_fstab = false" "only_physical = false" "disks_filter = \"$HOME\"" >"$BTOP_CONF"
else
 sed -i -e 's/^update_ms = 2000$/update_ms = 100/' -e 's/^use_fstab = true$/use_fstab = false/' \
  -e 's/^only_physical = true$/only_physical = false/' -e "s|^disks_filter = \"\"\$|disks_filter = \"$HOME\"|" "$BTOP_CONF"
fi

# tmux (in the workspace image): the bundled configuration, for users who have none yet.
if command -v tmux-mirror-setup >/dev/null && [ ! -e ~/.config/tmux ] && [ ! -e ~/.tmux.conf ]; then
 tmux-mirror-setup >/tmp/tmux-mirror-setup.log 2>&1 || true
fi

# ~/.cert/<owner>.p12 is installed by the "Certificates" script (main.tf's platform section "certificates") from
# Settings > Certificates.

# Admins: kubectl and k9s on this cluster. ~/.kube/coder-cluster.yaml (this template's own file, rewritten at
# every start; KUBECONFIG lists it before ~/.kube/config, which is never touched) has the context
# <owner>@coder-cluster. The first kubectl command signs in: it prints a Keycloak link and code, which the admin
# opens in their own browser and signs in to as themselves. The tokens are kept in /tmp (gone when the workspace
# restarts) and last as long as that Keycloak session. Someone who is no longer an admin loses the file.
if [ "$CLUSTER_ADMIN" = "true" ]; then
 mkdir -p ~/.kube /tmp/coder-kube-signin && chmod 700 ~/.kube /tmp/coder-kube-signin
 cat >"$CLUSTER_KUBECONFIG.tmp" <<KUBECONFIG_FILE
# Written by the workspace template at every start (cluster sign-in for admins); edits here are replaced.
apiVersion: v1
kind: Config
clusters:
- name: coder-cluster
  cluster:
    server: https://kubernetes.default.svc
    certificate-authority: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
contexts:
- name: $OWNER_NAME@coder-cluster
  context:
    cluster: coder-cluster
    user: $OWNER_NAME@keycloak
    namespace: $NAMESPACE
current-context: $OWNER_NAME@coder-cluster
users:
- name: $OWNER_NAME@keycloak
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1
      command: kubectl
      args:
      - oidc-login
      - get-token
      - --oidc-issuer-url=$CLUSTER_OIDC_ISSUER
      - --oidc-client-id=$CLUSTER_OIDC_CLIENT_ID
      - --grant-type=device-code
      - --skip-open-browser
      - --token-cache-dir=/tmp/coder-kube-signin
      interactiveMode: IfAvailable
      provideClusterInfo: false
KUBECONFIG_FILE
 chmod 600 "$CLUSTER_KUBECONFIG.tmp" && mv "$CLUSTER_KUBECONFIG.tmp" "$CLUSTER_KUBECONFIG"
else
 rm -f "$CLUSTER_KUBECONFIG"
fi
[ "$CLUSTER_ADMIN" = "true" ] && log "kubectl and k9s: signed in to this cluster as you on first use (~/.kube/coder-cluster.yaml)"

# 1. Desktop Environment & noVNC, first: it needs no network. It is in the workspace image
# (ghcr.io/user187x/coder-workspace, without light-locker); installed here only on an image without it.
# code-server and File Browser below are downloaded when the image lacks them; offline they are skipped, the rest
# still starts. An image built in Templates > Images names its desktop in /etc/coder-image/desktop: xfce, gnome or
# none (no desktop: the Desktop app stays down); a template without the Desktop app starts none either.
IMAGE_DESKTOP=$(cat /etc/coder-image/desktop 2>/dev/null || echo xfce)
NO_DESKTOP="none in this image"
if [ "$DESKTOP" != true ]; then
 IMAGE_DESKTOP=none
 NO_DESKTOP="not in this template"
fi
if [ ! -f /usr/bin/vncserver ] && [ "$IMAGE_DESKTOP" != none ]; then
 sudo apt-get update
 sudo DEBIAN_FRONTEND=noninteractive apt-get install -y xfce4 xfce4-goodies dbus-x11 tigervnc-standalone-server novnc websockify light-locker- lightdm- lightdm-gtk-greeter-
 sudo rm -f /etc/xdg/autostart/light-locker.desktop /etc/xdg/autostart/xfce4-screensaver.desktop
fi

# Serve the noVNC client as the directory index so the bare app URL loads it.
# (Only when the image lacks it: the workspace image has it, and a Lock Down may have taken sudo away.)
[ "$(readlink /usr/share/novnc/index.html 2>/dev/null)" = /usr/share/novnc/vnc.html ] ||
 sudo ln -sf /usr/share/novnc/vnc.html /usr/share/novnc/index.html

# Configure XFCE (or the image's own desktop session, such as GNOME) to start on VNC launch
# TigerVNC >= 1.14 reads ~/.config/tigervnc (the legacy ~/.vnc fails to migrate),
# and the session ends when xstartup returns, so the desktop must be exec'd in the foreground.
mkdir -p ~/.config/tigervnc
cat <<'VNC_SCRIPT' >~/.config/tigervnc/xstartup
#!/bin/sh
xrdb $HOME/.Xresources 2>/dev/null
[ -x /usr/local/bin/coder-desktop-session ] && exec /usr/local/bin/coder-desktop-session
exec startxfce4
VNC_SCRIPT
chmod +x ~/.config/tigervnc/xstartup

# The desktop is faster over VNC without XFCE's compositor (every composited effect is extra drawing to encode
# and send). The workspace image turns it off by default; desktops set up before that get it off once (later
# changes in Settings > Window Manager Tweaks are kept).
XFWM4_XML=~/.config/xfce4/xfconf/xfce-perchannel-xml/xfwm4.xml
if [ ! -e ~/.config/coder-workspace/xfwm4-no-compositing ]; then
 if [ -f "$XFWM4_XML" ]; then
  sed -i 's|name="use_compositing" type="bool" value="true"|name="use_compositing" type="bool" value="false"|' "$XFWM4_XML"
 fi
 mkdir -p ~/.config/coder-workspace && touch ~/.config/coder-workspace/xfwm4-no-compositing
fi

# A terminal emulator never runs "in a terminal": XFCE's launcher editor (the dock's Edit Launcher) writes
# Terminal=true into the home's copy of a launcher when "Run in terminal" is ticked, and Terminator then opens inside
# xfce4-terminal, which shows Terminator's start-up warnings. The home's launchers of terminal emulators run on their own.
for f in ~/.local/share/applications/*.desktop; do
 { [ -f "$f" ] && grep -q '^Categories=.*TerminalEmulator' "$f" && grep -q '^Terminal=true$' "$f"; } || continue
 sed -i 's/^Terminal=true$/Terminal=false/' "$f" && log "Desktop: $(basename "$f") runs on its own again (not in a terminal)"
done

# TigerVNC's X server on display :1, started directly (not through vncserver, which warns that a password-less
# server is open to every user of the machine). It listens on no TCP port, only on a Unix socket that only this
# user can open (directory 0700, socket 0600): no other user and no other pod can reach it, so it needs no
# password. The X display itself has a cookie (~/.Xauthority).
VNC_SOCK=/tmp/coder-vnc/rfb.sock
mkdir -p /tmp/coder-vnc && chmod 700 /tmp/coder-vnc
if [ "$IMAGE_DESKTOP" != none ] && ! pgrep -f "^Xtigervnc :1 " >/dev/null; then
 # the Desktop theme, put in the home before XFCE reads it (a workspace image from before the themes has none)
 if [ "$IMAGE_DESKTOP" = xfce ] && [ -x /usr/local/bin/coder-desktop-theme ]; then
  log "$(/usr/local/bin/coder-desktop-theme apply "$DESKTOP_THEME" 2>&1 || true)"
 elif [ "$IMAGE_DESKTOP" = xfce ] && [ "$DESKTOP_THEME" != classic ]; then
  # said, not silent: the theme asked for cannot be applied (the desktop comes up Classic)
  log "Desktop: this image has no coder-desktop-theme, so the $DESKTOP_THEME theme cannot be applied: Classic instead (themes need workspace image 1.9.1 or later)"
 fi
 rm -f "$VNC_SOCK" /tmp/.X1-lock /tmp/.X11-unix/X1
 touch ~/.Xauthority && chmod 600 ~/.Xauthority
 xauth -f ~/.Xauthority add :1 MIT-MAGIC-COOKIE-1 "$(mcookie)"
 # -FrameRate 60: updates as often as noVNC can show them. -SendPrimary=0: only what is copied (the CLIPBOARD) goes to
 # the computer's clipboard (the image's noVNC shares it both ways), not every text selected (the PRIMARY).
 Xtigervnc :1 -auth ~/.Xauthority -geometry 1280x800 -depth 24 -rfbport -1 -rfbunixpath "$VNC_SOCK" \
  -SecurityTypes None -AlwaysShared -FrameRate 60 -SendPrimary=0 -desktop "$(hostname)" >/tmp/xvnc.log 2>&1 &
 for i in $(seq 1 50); do
  [ -S "$VNC_SOCK" ] && break
  sleep 0.2
 done
 DISPLAY=:1 XAUTHORITY=~/.Xauthority setsid ~/.config/tigervnc/xstartup >/tmp/xstartup.log 2>&1 </dev/null &
 log "Desktop: started ($IMAGE_DESKTOP on display :1)"
elif [ "$IMAGE_DESKTOP" = none ]; then
 log "Desktop: $NO_DESKTOP (the Desktop app stays down)"
else
 log "Desktop: running already"
fi

# websockify serves noVNC on 127.0.0.1 only and connects to the VNC socket: the only way in is Coder's app proxy,
# which signs users in. Coder strips the /@user/workspace.agent/apps/novnc prefix before proxying, so the stock web
# root works as-is.
# (By its port: pgrep -f would match this script, whose text contains the pattern.)
if [ "$IMAGE_DESKTOP" != none ] && ! curl -s -o /dev/null http://127.0.0.1:6901/; then
 websockify --web=/usr/share/novnc/ --unix-target="$VNC_SOCK" 127.0.0.1:6901 >/tmp/novnc.log 2>&1 &
 log "Desktop app (noVNC): started"
fi

# The Chromium app: Chromium alone on display :2 - its own VNC server (a socket beside the desktop's), xfwm4 so its
# window is maximized and follows the size noVNC asks for, and websockify on 6902. Its own profile in the home
# (~/.config/chromium-panel: the desktop's Chromium keeps its own, and two cannot share one). Closed, it comes back.
BROWSER_SOCK=/tmp/coder-vnc/browser.sock
if [ "$IMAGE_DESKTOP" = none ]; then
 :
elif ! command -v chromium >/dev/null || ! command -v xfwm4 >/dev/null || ! command -v dbus-run-session >/dev/null; then
 log "Chromium app: no Chromium, xfwm4 or dbus-run-session in this image (the Chromium app stays down)"
elif ! pgrep -f "^Xtigervnc :2 " >/dev/null; then
 rm -f "$BROWSER_SOCK" /tmp/.X2-lock /tmp/.X11-unix/X2
 xauth -f ~/.Xauthority add :2 MIT-MAGIC-COOKIE-1 "$(mcookie)"
 Xtigervnc :2 -auth ~/.Xauthority -geometry 1280x800 -depth 24 -rfbport -1 -rfbunixpath "$BROWSER_SOCK" \
  -SecurityTypes None -AlwaysShared -FrameRate 60 -SendPrimary=0 -desktop Chromium >/tmp/xvnc-browser.log 2>&1 &
 for i in $(seq 1 50); do
  [ -S "$BROWSER_SOCK" ] && break
  sleep 0.2
 done
 # xfwm4 settings of its own (on a bus of its own: the desktop's settings daemon would answer with the desktop's
 # theme): a maximized window has no title bar, so Chromium's own tab strip is the top of the panel
 WM_CONF=/tmp/coder-vnc/browser-wm
 mkdir -p "$WM_CONF/xfce4/xfconf/xfce-perchannel-xml"
 printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' '<channel name="xfwm4" version="1.0">' \
  ' <property name="general" type="empty">' '  <property name="titleless_maximize" type="bool" value="true"/>' \
  '  <property name="theme" type="string" value="Default"/>' ' </property>' '</channel>' \
  >"$WM_CONF/xfce4/xfconf/xfce-perchannel-xml/xfwm4.xml"
 DISPLAY=:2 XAUTHORITY=~/.Xauthority XDG_CONFIG_HOME="$WM_CONF" setsid dbus-run-session -- \
  xfwm4 --compositor=off --sm-client-disable >/tmp/browser-wm.log 2>&1 </dev/null &
 DISPLAY=:2 XAUTHORITY=~/.Xauthority setsid sh -c 'while [ -S "$1" ]; do
  chromium --start-maximized --user-data-dir="$HOME/.config/chromium-panel"; sleep 1; done' sh "$BROWSER_SOCK" \
  >/tmp/browser.log 2>&1 </dev/null &
 log "Chromium app: started (display :2)"
fi
if [ "$IMAGE_DESKTOP" != none ] && [ -S "$BROWSER_SOCK" ] && ! curl -s -o /dev/null http://127.0.0.1:6902/; then
 websockify --web=/usr/share/novnc/ --unix-target="$BROWSER_SOCK" 127.0.0.1:6902 >/tmp/novnc-browser.log 2>&1 &
 log "Chromium app (noVNC): started"
fi

# 2. code-server: the workspace image's (1.8.0 and later), so it works without internet. Downloaded only on an
# image without it, which needs internet (it is skipped, with a note in the log, when there is none). With code-server
# HA (CODER_CODE_SERVER_HA, the template's code_server_ha) it runs elsewhere: the relay in this pod answers instead.
if [ -n "$${CODER_CODE_SERVER_HA:-}" ]; then
 log "code-server: high availability - its instance runs apart from the workspace (the relay answers on 13337)"
elif [ "$CODE_SERVER_APP" = true ]; then
 CODE_SERVER="$(command -v code-server || true)"
 if [ -z "$CODE_SERVER" ]; then
  if [ ! -x /tmp/code-server/bin/code-server ]; then
   curl -fsSL --max-time 60 https://code-server.dev/install.sh | sh -s -- --method=standalone --prefix=/tmp/code-server ||
    echo "code-server is not in this image and could not be downloaded: skipped"
  fi
  CODE_SERVER=/tmp/code-server/bin/code-server
 fi
 # Probe the port rather than pgrep -f: the agent runs this script as `sh -c '<script>'`,
 # so `pgrep -f` matches the script's own command line and never starts anything.
 if [ -x "$CODE_SERVER" ] && ! curl -fs http://localhost:13337/healthz >/dev/null; then
  "$CODE_SERVER" --auth none --port 13337 --disable-telemetry --disable-update-check >/tmp/code-server.log 2>&1 &
  log "code-server: started (log: /tmp/code-server.log)"
 elif [ -x "$CODE_SERVER" ]; then
  log "code-server: running already"
 fi
fi

# 3. File Browser (when the template has it): FileBrowser Quantum, the workspace image's (an image without it gets
# none: there is nothing to download it from without internet), started by coder-filebrowser (scripts/filebrowser.sh):
# under the app's path, on 127.0.0.1 only, no sign-in of its own; the Start folder, and each Cloud Drive here as a
# source of its own (it asks the Cloud Drive's script which they are, and that script starts it again as they change).
# Its settings are written at every start (the Start folder may have changed); its database stays in the home. The
# helper is installed here and by the Cloud Drive's script, the newer one kept. An image built on an older workspace
# image still has the former File Browser: started with its own flags.
if [ "$FILE_BROWSER" != true ]; then
 log "File Browser: not in this template"
elif ! command -v filebrowser >/dev/null; then
 log "File Browser: not in this image: skipped"
elif filebrowser version 2>/dev/null | grep -q "FileBrowser Quantum"; then
 mkdir -p "$HOME/.config/filebrowser-quantum" "$HOME/.local/bin"
 printf 'APPS=%q\nSTART_DIR=%q\n' "$APPS" "$START_DIR" >"$HOME/.config/filebrowser-quantum/env"
 fb_helper="$(mktemp)" && echo '${filebrowser}' | base64 -d >"$fb_helper" && bash "$fb_helper" install
 rm -f "$fb_helper"
 log "$("$HOME/.local/bin/coder-filebrowser" start)"
elif pgrep -x filebrowser >/dev/null; then
 log "File Browser: running already"
else
 filebrowser --noauth --root "$START_DIR" --port 13339 \
  --baseurl "$APPS/filebrowser" \
  >/tmp/filebrowser.log 2>&1 &
 log "File Browser: started in $START_DIR (log: /tmp/filebrowser.log)"
fi

# btop's disk: where the cluster's volumes are folders of the node's disk (local-path, hostpath: minikube, kind), the
# home's statvfs() answers for the node's whole disk. A small library (scripts/home-statfs.c), built here once a
# version, answers for the home volume instead - its size and the home's usage, as the Disk metric measures them
# (metadata.sh) - preloaded by a btop wrapper in ~/.local/bin. On a real volume it changes nothing.
# The image's btop: the first on the PATH but the wrapper's folder.
btop_bin=$(PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -vxF "$HOME/.local/bin" | paste -sd: -) command -v btop)
if [ -n "$btop_bin" ] && command -v gcc >/dev/null; then
 statfs_dir="$HOME/.cache/coder"
 mkdir -p "$statfs_dir" "$HOME/.local/bin"
 echo '${home_statfs}' | base64 -d >"$statfs_dir/home-statfs.c.new"
 if ! cmp -s "$statfs_dir/home-statfs.c.new" "$statfs_dir/home-statfs.c" || [ ! -f "$statfs_dir/home-statfs.so" ]; then
  mv "$statfs_dir/home-statfs.c.new" "$statfs_dir/home-statfs.c"
  if gcc -shared -fPIC -O2 -o "$statfs_dir/home-statfs.so" "$statfs_dir/home-statfs.c" -ldl 2>/tmp/home-statfs.log; then
   log "btop: answers for the home volume (home-statfs built)"
  else
   rm -f "$statfs_dir/home-statfs.c"
   log "btop: home-statfs not built (/tmp/home-statfs.log)"
  fi
 else
  rm -f "$statfs_dir/home-statfs.c.new"
 fi
 # The home's size and use for the library, kept fresh here too (each minute, quietly): the Disk metric writes them
 # as it measures, but an agent can be without its metadata (a lost database row) - btop is right all the same.
 echo '${platform_metadata}' | base64 -d >"$statfs_dir/metadata.sh"
 (
  while :; do
   nice -n 19 bash -c "$(cat "$statfs_dir/metadata.sh")
disk" >/dev/null 2>&1
   sleep 60
  done
 ) </dev/null >/dev/null 2>&1 &
 printf '%s\n' '#!/bin/sh' '# btop answering for the home volume, not the whole node disk (startup.sh: home-statfs)' \
  'so="$HOME/.cache/coder/home-statfs.so"' \
  '[ -r "$so" ] && export LD_PRELOAD="$so$${LD_PRELOAD:+:$LD_PRELOAD}"' \
  "exec '$btop_bin' \"\$@\"" >"$HOME/.local/bin/btop"
 chmod +x "$HOME/.local/bin/btop"
fi

log "Startup done: the apps open once they answer their health checks"
