# The workspace image of the default template (DEFAULT): Coder's enterprise-base with, preinstalled,
#   - the desktop the template starts (XFCE, TigerVNC, noVNC, websockify) - no apt-get at workspace start, so it
#     also works without internet; noVNC shares the clipboard with the computer both ways, and only the viewer in use
#     resizes the desktop (novnc/: two viewers no longer fight over its size).
#     light-locker and LightDM are left out: the screen locker needs a display manager,
#     crashes in a container at every session start and leaves core.<pid> files in the user's home directory.
#     The XFCE screensaver is not started either (it would lock the VNC desktop behind a password the user lacks);
#   - Chromium (xtradeb's build, desktop/chromium-policies.json), XFCE's default web browser, and Terminator its
#     default terminal (desktop/); Firefox (Mozilla's .deb, desktop/firefox-policies.json) stays beside it.
#     XFCE's compositor is off by default (desktop/xfwm4.xml), which makes the desktop faster over VNC;
#   - two desktop themes, the workspace's Desktop theme parameter (desktop/coder-desktop-theme puts one in the home):
#     Classic, this image's own XFCE (/etc/xdg), the lightest over a slow connection; and Serenade, Miserable_Xfce's
#     (github.com/mehedirm6244/Miserable_Xfce, pinned): Tokyo Night colours, its GTK, window and icon themes, fonts
#     and background, a floating dock (rofi, docklike, eww's sidebar and System stats) and picom's animations
#     (fdev31's animation-pr fork) - built and assembled in the picom, eww and serenade stages below;
#   - JetBrains Mono Nerd Font (fonts/), the default monospace and desktop font, and every terminal's: fontconfig's
#     monospace, XFCE, its terminal, Terminator (terminals/), GNOME's monospace setting, and code-server's terminal
#     (code-server/: code-server serves the font to the browser); Noto Color Emoji after it for emoji;
#   - tmux 3.8 with the bundled configuration (packages/tmux-installation.deb, package tmux-mirror); the template
#     runs tmux-mirror-setup for users who have no tmux configuration yet;
#   - command-line tools: btop, bat (Ubuntu's binary is batcat; bat links to it), vim, eza, fzf, grc, jq, yq (Ubuntu's:
#     the jq wrapper for YAML, kislyuk/yq);
#   - k9s (the developer's own build and configuration), kubectl and kubelogin (kubectl oidc-login, the admins'
#     Keycloak sign-in to the cluster): packages/k8s-devtools_*.deb, made by
#     ../tools/build-k8s-devtools.sh (pinned by packages/SHA256SUMS), with bash completion
#     (enabled for every interactive shell in /etc/bash.bashrc);
#   - Python's virtual environments (python3 -m venv), for the users' own projects;
#   - the default shell setup (shell/): ~/.bashrc (/etc/skel and /usr/share/coder-workspace/bashrc) and the vimrc it
#     points Vim at; the template copies them into homes that have none (or still Ubuntu's stock .bashrc);
#   - code-server and File Browser, the template's two web apps (pinned below, checked by SHA-256): the template used
#     to download them at every workspace start, which fails without internet. File Browser is FileBrowser Quantum
#     (gtsteffaniak/filebrowser), a binary for linux-amd64 (filebrowser-quantum at the repository's root, put into
#     the build by ../tools/build-workspace-image.sh) - since 1.9.2 the workspace's own build of 2.1.2 with a
#     FileBrowser update for symlinked folders (symlinkTargets) - unpacked from UPX when packed, so the Images view's
#     scanner reads its Go modules; installed as /usr/local/bin/filebrowser, the command the template starts;
#   - security: every package upgraded at build time; Docker's engine and plugins (dockerd, containerd, buildx,
#     compose) removed - a workspace pod has no privileges to run them, and their Go builds carried known
#     vulnerabilities - as is the base's stray /usr/bin/pebble (no package owns it, nothing uses it); the docker CLI
#     stays, for a remote daemon; packages a workspace pod has no use for, whose known vulnerabilities have no fix
#     yet, removed last (PulseAudio with ffmpeg's libraries, libsoup, the weather plugin, ...), and GNU coreutils
#     instead of Rust coreutils (see the step before addons.json);
#   - /usr/share/coder-workspace/addons.json: what it adds over the base, with every version (addons/addons.py), for
#     the Images view, which lists it next to the image's security report.
# Build with ../tools/build-workspace-image.sh, which saves it into the delivery bundle.
ARG BASE=codercom/enterprise-base:ubuntu
ARG FILEBROWSER_QUANTUM_VERSION=2.1.2-coder.1
ARG FILEBROWSER_QUANTUM_SHA256=ebbcd406bc4f966c2fc47823402100fff2045b55bc4cc6c4c03e4bce3ba07df8

# FileBrowser Quantum: its binary (the build context "quantum", from build-workspace-image.sh), checked, and unpacked
# from UPX when it is packed (the same program; a scanner cannot read a packed one). Since 1.9.2 the workspace's own
# build of 2.1.2 (version 2.1.2-coder.1), with a FileBrowser update for symlinked folders: a source may follow links
# into folders it is told (symlinkTargets, opt-in), and a symlinked folder is listed as a folder - the Cloud Drives'
# links open in place (scripts/filebrowser.sh in the template sets it). Since 1.9.4 the same source, version and
# build flags built with Go 1.27.3 and golang.org/x/net 0.60.0 (0.59.0 had five HTTP/2 denial-of-service findings,
# CVE-2026-78669 and others); the check below reads both from the binary's Go build information.
FROM docker.io/library/golang:1.27.3-trixie@sha256:1896654cfc5c2b5ad74c07f29cb36f5d2d1cbed42e3054070fbfe444e521e83c AS filebrowser
ARG FILEBROWSER_QUANTUM_VERSION
ARG FILEBROWSER_QUANTUM_SHA256
COPY --from=quantum filebrowser-quantum /tmp/filebrowser-quantum
RUN echo "${FILEBROWSER_QUANTUM_SHA256}  /tmp/filebrowser-quantum" | sha256sum -c - \
	&& apt-get update && apt-get install -y --no-install-recommends upx-ucl \
	&& mkdir -p /out \
	&& if upx -t -q /tmp/filebrowser-quantum >/dev/null 2>&1; then upx -d -q -o /out/filebrowser /tmp/filebrowser-quantum; \
		else cp /tmp/filebrowser-quantum /out/filebrowser; fi \
	&& /out/filebrowser version | grep -q "v${FILEBROWSER_QUANTUM_VERSION}" \
	&& go version -m /out/filebrowser >/tmp/buildinfo \
	&& grep -q '^/out/filebrowser: go1\.27\.3$' /tmp/buildinfo \
	&& grep -Eq '^[[:space:]]dep[[:space:]]golang\.org/x/net[[:space:]]v0\.60\.0[[:space:]]' /tmp/buildinfo

# picom with animations (Serenade): fdev31's animation-pr fork at its pinned commit, checked, built on the same Ubuntu.
FROM docker.io/library/ubuntu:26.04@sha256:c098726dd9b9733f3e885f8de0ef375206a311b0a317eadc40d347b1115fb944 AS picom
ARG PICOM_COMMIT=cee36cd8724952563dbf84fb6bb87a5a61e9e3d4
ARG PICOM_SHA256=411f5c1c9dcfc1bf79862bd40df4d84abaace6d39735bc5b443d71e84131d029
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl build-essential meson ninja-build \
		pkg-config libconfig-dev libdbus-1-dev libegl-dev libev-dev libgl-dev libpcre2-dev libpixman-1-dev \
		libx11-xcb-dev libxcb1-dev libxcb-composite0-dev libxcb-damage0-dev libxcb-dpms0-dev libxcb-glx0-dev \
		libxcb-image0-dev libxcb-present-dev libxcb-randr0-dev libxcb-render0-dev libxcb-render-util0-dev \
		libxcb-shape0-dev libxcb-util-dev libxcb-xfixes0-dev libxext-dev uthash-dev \
	&& curl -fsSL -o /tmp/picom.tgz "https://github.com/fdev31/picom/archive/${PICOM_COMMIT}.tar.gz" \
	&& echo "${PICOM_SHA256}  /tmp/picom.tgz" | sha256sum -c - \
	&& mkdir /src && tar -xzf /tmp/picom.tgz -C /src --strip-components=1 && cd /src \
	&& meson setup --buildtype=release -Dwith_docs=false build . && ninja -C build \
	&& install -D build/src/picom /out/usr/local/bin/picom && /out/usr/local/bin/picom --version

# eww (Serenade's sidebar and System stats): its 0.6.0 release at its commit (its binary says 0.5.0: the release did
# not bump it), checked, for X11; its time crate moved to 0.3.36 (0.3.34 does not build with today's Rust).
FROM docker.io/library/ubuntu:26.04@sha256:c098726dd9b9733f3e885f8de0ef375206a311b0a317eadc40d347b1115fb944 AS eww
ARG EWW_COMMIT=d87c2fdbfdc012e76d229e4e9ea3325bc0f23e89
ARG EWW_SHA256=8a7cc1406c88fc354940fb28ec99b9dc6530799393b15fcac9c27920d25950d4
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl build-essential cargo rustc \
		pkg-config libgtk-3-dev libdbusmenu-gtk3-dev libglib2.0-dev libcairo2-dev libpango1.0-dev \
	&& curl -fsSL -o /tmp/eww.tgz "https://github.com/elkowar/eww/archive/${EWW_COMMIT}.tar.gz" \
	&& echo "${EWW_SHA256}  /tmp/eww.tgz" | sha256sum -c - \
	&& mkdir /src && tar -xzf /tmp/eww.tgz -C /src --strip-components=1 && cd /src \
	&& cargo update -p time@0.3.34 --precise 0.3.36 \
	&& cargo build --release --locked --no-default-features --features x11 \
	&& install -D target/release/eww /out/usr/local/bin/eww && /out/usr/local/bin/eww --version

# Serenade's files: Miserable_Xfce at its pinned commit, checked - its GTK theme (Lavanda, Tokyo Night) and window
# theme (cirkles), the icon themes it uses (Zafiro and those it inherits from: Numix-Apps, Fluent-dark), its fonts
# (Overpass, Feather), its background (No Man's Sky, as a JPEG), the dock's icons, and its settings for GTK, picom,
# rofi and eww - adapted for a workspace: picom drawing without a GPU (xrender, no vsync), rofi in Overpass, eww's
# windows on the one monitor, its profile picture a plain one (the user's); with this image's own files over them (desktop/serenade: XFCE's settings, the panel,
# the sidebar without what needs the internet, Terminator). The home's part goes to /usr/share/coder-desktop/
# serenade/home, which coder-desktop-theme copies into a home that chooses it.
FROM docker.io/library/ubuntu:26.04@sha256:c098726dd9b9733f3e885f8de0ef375206a311b0a317eadc40d347b1115fb944 AS serenade
ARG MISERABLE_COMMIT=e8c107cf46fcc271413abc006daad40e9fbcd5dc
ARG MISERABLE_SHA256=0cbda84f8e56c0a53b7d921b79606da954ae6f03a0fa982b2cd0e5a0a1441c6c
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl python3-pil \
	&& curl -fsSL -o /tmp/miserable.tgz "https://github.com/mehedirm6244/Miserable_Xfce/archive/${MISERABLE_COMMIT}.tar.gz" \
	&& echo "${MISERABLE_SHA256}  /tmp/miserable.tgz" | sha256sum -c - \
	&& mkdir /src && tar -xzf /tmp/miserable.tgz -C /src --strip-components=1
COPY desktop/serenade/ /tmp/serenade/
RUN set -e; m=/src/home; h=/out/usr/share/coder-desktop/serenade/home; \
	install -d /out/usr/share/themes /out/usr/share/icons /out/usr/share/fonts/truetype/miserable-xfce \
		/out/usr/share/backgrounds/coder-desktop /out/usr/share/coder-desktop/serenade/assets; \
	cp -a "$m/.themes/Lavanda-Dark-Compact-Tokyonight" "$m/.themes/cirkles" /out/usr/share/themes/; \
	for t in Zafiro Numix-Apps Fluent-dark; do cp -a "$m/.local/share/icons/$t" /out/usr/share/icons/; done; \
	cp "$m"/.local/share/fonts/*.ttf /out/usr/share/fonts/truetype/miserable-xfce/; \
	python3 -c 'import sys; from PIL import Image; Image.open(sys.argv[1]).convert("RGB").save(sys.argv[2], quality=88)' \
		"$m/.local/share/backgrounds/nomanssky.png" /out/usr/share/backgrounds/coder-desktop/serenade.jpg; \
	cp "$m"/.assets/*.svg /out/usr/share/coder-desktop/serenade/assets/; \
	install -d "$h/.config/gtk-3.0" "$h/.config/gtk-4.0" "$h/.config/rofi" "$h/.config/terminator" \
		"$h/.config/xfce4/xfconf/xfce-perchannel-xml"; \
	cat "$m/.config/gtk-3.0/gtk.css" /tmp/serenade/gtk-panel.css >"$h/.config/gtk-3.0/gtk.css"; \
	cp "$m/.config/gtk-4.0/gtk.css" "$h/.config/gtk-4.0/"; \
	cp "$m/.Xresources" "$h/"; \
	sed -e 's/^backend = "glx";/backend = "xrender";/' -e 's/^vsync = true;/vsync = false;/' \
		"$m/.config/picom.conf" >"$h/.config/picom.conf"; \
	grep -q '^backend = "xrender";' "$h/.config/picom.conf" && grep -q '^vsync = false;' "$h/.config/picom.conf"; \
	sed -i "s/^animation-dampening = 20;/&\n# Not the dock: it opens at 0 pixels high, and picom (this fork) then crashed on its rounded corners and shadow\n# about every other start (coder-desktop-theme starts it again if it does).\nanimation-exclude = [ \"window_type = 'dock'\" ];/" \
		"$h/.config/picom.conf"; \
	grep -q "^animation-exclude = \[ \"window_type = 'dock'\" \];" "$h/.config/picom.conf"; \
	sed 's/"Roboto 16"/"Overpass 14"/' "$m/.config/rofi/config.rasi" >"$h/.config/rofi/config.rasi"; \
	cp -a "$m/.config/eww" "$h/.config/eww"; \
	rm -f "$h/.config/eww/sidebar/weather.yuck" "$h/.config/eww/sidebar/spotify.yuck" "$h"/.config/eww/scripts/weather* \
		"$h"/.config/eww/scripts/spotify_helper "$h"/.config/eww/scripts/playerctl.py "$h"/.config/eww/scripts/gmail.sh \
		"$h"/.config/eww/scripts/updates "$h"/.config/eww/scripts/battery "$h"/.config/eww/scripts/wifi; \
	sed -i 's/:screen 1/:monitor 0/' "$h/.config/eww/sysstat/sysstat.yuck" "$h/.config/eww/calendarevents/calendarevents.yuck"; \
	cp /tmp/serenade/eww/variables.yuck "$h/.config/eww/variables.yuck"; \
	cp /tmp/serenade/eww/sidebar.yuck "$h/.config/eww/sidebar/sidebar.yuck"; \
	install -m 0755 /tmp/serenade/eww/launch.sh "$h/.config/eww/scripts/launch.sh"; \
	! grep -rq ':screen 1' "$h/.config/eww"; \
	python3 -c 'import sys; from PIL import Image, ImageDraw, ImageFont; im = Image.new("RGBA", (112, 112)); \
d = ImageDraw.Draw(im); d.ellipse((0, 0, 111, 111), fill="#24283b", outline="#7aa2f7", width=4); \
f = ImageFont.truetype(sys.argv[1], 56); d.text((56, 58), chr(0xea00), font=f, fill="#7aa2f7", anchor="mm"); \
im.save(sys.argv[2])' "$m/.local/share/fonts/feather.ttf" "$h/.config/eww/images/avatar.png"; \
	cp /tmp/serenade/xfconf/*.xml "$h/.config/xfce4/xfconf/xfce-perchannel-xml/"; \
	cp -a /tmp/serenade/panel "$h/.config/xfce4/panel"; \
	cp /tmp/serenade/terminator.conf "$h/.config/terminator/config"; \
	chmod -R a+rX /out

FROM ${BASE}

USER root
ARG DEBIAN_FRONTEND=noninteractive
ARG BASE

# The base's packages, before anything is added (addons/addons.py, the last step, tells what this image adds).
RUN install -d /usr/share/coder-workspace \
	&& dpkg-query -W -f='${Package}\t${Version}\n' >/usr/share/coder-workspace/.base-packages \
	&& apt-mark showmanual >/usr/share/coder-workspace/.base-manual

# Security: the base's packages to their newest (Ubuntu's and Docker's fixes since the base was built); Docker's engine
# and plugins out (no privileges to run them in a workspace pod; their Go builds carried known vulnerabilities; the
# docker CLI stays, for a remote daemon); the base's /usr/bin/pebble out (no package owns it, nothing uses it).
# iptables stays (Docker had pulled it in): Lock Down's Network mode runs it from this image (lockdown.sh).
# The build takes Ubuntu's phased updates too (an apt setting removed again in the last step): apt holds a phased
# update back from an upgrade, and then leaves out what needs it - in October 2026 systemd 259.9's phasing made apt
# drop xfce4-power-manager, udev and upower from the desktop's install.
RUN echo 'APT::Get::Always-Include-Phased-Updates "true";' >/etc/apt/apt.conf.d/99-coder-workspace-build \
	&& apt-get update \
	&& apt-get -y full-upgrade \
	&& apt-mark manual iptables >/dev/null \
	&& apt-get purge -y docker-ce docker-ce-rootless-extras containerd.io docker-buildx-plugin docker-compose-plugin \
	&& apt-get autoremove -y --purge \
	&& rm -f /usr/bin/pebble \
	&& rm -rf /var/lib/apt/lists/* \
	&& docker --version && ! command -v dockerd && ! test -e /usr/libexec/docker/cli-plugins/docker-buildx \
	&& iptables --version && ip6tables --version

RUN apt-get update \
	&& apt-get install -y xfce4 xfce4-goodies xfce4-terminal dbus-x11 tigervnc-standalone-server novnc websockify \
		fontconfig fonts-noto-color-emoji light-locker- lightdm- lightdm-gtk-greeter- \
	&& ln -sf /usr/share/novnc/vnc.html /usr/share/novnc/index.html \
	&& rm -f /etc/xdg/autostart/light-locker.desktop /etc/xdg/autostart/xfce4-screensaver.desktop \
	&& rm -rf /var/lib/apt/lists/*

# Command-line tools.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends btop bat vim eza fzf grc jq yq \
	&& ln -sf /usr/bin/batcat /usr/local/bin/bat \
	&& rm -rf /var/lib/apt/lists/*

# Default shell setup. Ubuntu's stock .bashrc is kept, so the template can tell an untouched one from the user's own.
COPY shell/bashrc shell/vimrc /usr/share/coder-workspace/
RUN cp /etc/skel/.bashrc /usr/share/coder-workspace/ubuntu-bashrc \
	&& cp /usr/share/coder-workspace/bashrc /etc/skel/.bashrc \
	&& chmod 0644 /usr/share/coder-workspace/* /etc/skel/.bashrc

# JetBrains Mono Nerd Font: installed, and preferred for "monospace", with Noto Color Emoji right after it for what
# it lacks (a terminal shows a box for a character no font has: the prompt's 💥 did).
COPY fonts/ /usr/share/fonts/truetype/jetbrains-mono-nerd/
COPY fontconfig/60-jetbrains-mono-nerd.conf /etc/fonts/conf.d/60-jetbrains-mono-nerd.conf
RUN fc-cache -f >/dev/null && fc-match monospace | grep -q 'JetBrainsMono' \
	&& fc-match 'monospace:charset=1f4a5' | grep -q 'Noto Color Emoji'

# XFCE defaults (users without their own settings): the desktop and terminal fonts, and the desktop background
# (XFCE's dark cp-dark wallpaper).
COPY xfce/ /etc/xdg/xfce4/

# tmux 3.8 + configuration (self-contained package; Recommends are not needed).
COPY packages/tmux-installation.deb /tmp/tmux-installation.deb
RUN apt-get update \
	&& apt-get install -y --no-install-recommends /tmp/tmux-installation.deb \
	&& rm -rf /tmp/tmux-installation.deb /var/lib/apt/lists/* \
	&& /usr/local/bin/tmux -V

# k9s, kubectl, kubelogin (k8s-devtools) and bash completion for every interactive shell.
COPY packages/k8s-devtools_*.deb /tmp/
RUN apt-get update \
	&& apt-get install -y --no-install-recommends bash-completion /tmp/k8s-devtools_*.deb \
	&& rm -rf /tmp/k8s-devtools_*.deb /var/lib/apt/lists/* \
	&& printf '%s\n' '' '# Bash completion (workspace image).' \
		'if ! shopt -oq posix && [ -f /usr/share/bash-completion/bash_completion ]; then' \
		'  . /usr/share/bash-completion/bash_completion' 'fi' >>/etc/bash.bashrc \
	&& k9s version -s && kubectl version --client && kubectl oidc-login --version

# Python's virtual environments (python3 -m venv), for the users' own projects.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3-venv \
	&& rm -rf /var/lib/apt/lists/* \
	&& python3 -m venv /tmp/venv-check && rm -rf /tmp/venv-check

# Firefox, the desktop's web browser (XFCE's "Web Browser" and the dock's launcher open it): Mozilla's own .deb
# (Ubuntu's firefox package only installs the snap, which cannot run in a container), with policies for an offline
# network (no updates, telemetry, studies, Pocket, first-run pages or online new-tab content: new tabs and the start
# page are blank) that trust the system CA store (p11-kit) - the
# template's bundle, which includes the cluster's own CA. Also XFCE's compositor off by default (desktop/xfwm4.xml):
# over VNC every composited effect is extra drawing to encode and send.
COPY desktop/firefox-policies.json /etc/firefox/policies/policies.json
COPY desktop/mimeapps.list /etc/xdg/mimeapps.list
COPY desktop/helpers.rc /etc/xdg/xfce4/helpers.rc
COPY desktop/xfwm4.xml /etc/xdg/xfce4/xfconf/xfce-perchannel-xml/xfwm4.xml
RUN install -d -m 0755 /etc/apt/keyrings \
	&& curl -fsSL https://packages.mozilla.org/apt/repo-signing-key.gpg -o /etc/apt/keyrings/packages.mozilla.org.asc \
	&& GNUPGHOME="$(mktemp -d)" gpg -n -q --import --import-options import-show /etc/apt/keyrings/packages.mozilla.org.asc \
		| grep -q 35BAA0B33E9EB396F59CA838C0BA5CE6DC6315A3 \
	&& echo 'deb [signed-by=/etc/apt/keyrings/packages.mozilla.org.asc] https://packages.mozilla.org/apt mozilla main' \
		>/etc/apt/sources.list.d/mozilla.list \
	&& printf '%s\n' 'Package: *' 'Pin: origin packages.mozilla.org' 'Pin-Priority: 1000' >/etc/apt/preferences.d/mozilla \
	&& apt-get update \
	&& apt-get install -y --no-install-recommends firefox p11-kit-modules \
	&& rm -rf /var/lib/apt/lists/* \
	&& { update-alternatives --set x-www-browser /usr/bin/firefox 2>/dev/null || true; }
RUN firefox --version && test -f /usr/lib/x86_64-linux-gnu/pkcs11/p11-kit-trust.so

# Chromium, the desktop's web browser (XFCE's "Web Browser", web links: desktop/helpers.rc and mimeapps.list):
# xtradeb's build for this Ubuntu (Ubuntu's chromium package only installs the snap), its archive key checked by its
# fingerprint and pinned to Chromium alone; policies for an offline network as Firefox's (desktop/chromium-policies.
# json) and its flags (desktop/chromium-flags: without its sandbox where the pod allows no user namespaces). It
# trusts the system's certificates through p11-kit in the user's NSS database (coder-desktop-theme: libnss3-tools).
# Terminator, the desktop's terminal (XFCE's "Terminal Emulator"). With them what Serenade runs: rofi, the docklike
# panel plugin, and picom's and eww's libraries (each checked: nothing missing).
COPY desktop/chromium-policies.json /etc/chromium/policies/managed/coder-workspace.json
COPY desktop/chromium-flags /etc/chromium.d/coder-workspace
RUN curl -fsSL "https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x5301FA4FD93244FBC6F6149982BB6851C64F6880" \
		-o /tmp/xtradeb.asc \
	&& gpg --show-keys --with-colons /tmp/xtradeb.asc | grep -q '^fpr:::::::::5301FA4FD93244FBC6F6149982BB6851C64F6880:' \
	&& gpg --dearmor </tmp/xtradeb.asc >/etc/apt/keyrings/xtradeb-apps.gpg && rm -f /tmp/xtradeb.asc \
	&& . /etc/os-release \
	&& echo "deb [signed-by=/etc/apt/keyrings/xtradeb-apps.gpg] https://ppa.launchpadcontent.net/xtradeb/apps/ubuntu ${VERSION_CODENAME} main" \
		>/etc/apt/sources.list.d/xtradeb-apps.list \
	&& printf '%s\n' 'Package: *' 'Pin: release o=LP-PPA-xtradeb-apps' 'Pin-Priority: 1' '' \
		'Package: chromium chromium-common chromium-sandbox chromium-l10n' 'Pin: release o=LP-PPA-xtradeb-apps' \
		'Pin-Priority: 700' >/etc/apt/preferences.d/xtradeb-apps \
	&& apt-get update \
	&& apt-get install -y --no-install-recommends chromium terminator rofi xfce4-docklike-plugin libnss3-tools \
		libconfig11 libev4t64 libpixman-1-0 libxcb-render-util0 libxcb-image0 libxcb-composite0 libxcb-damage0 \
		libxcb-present0 libxcb-xfixes0 libxcb-dpms0 libxcb-glx0 libgl1 libegl1 libdbusmenu-gtk3-4 \
	&& rm -rf /var/lib/apt/lists/* \
	&& update-alternatives --set x-www-browser /usr/bin/chromium \
	&& update-alternatives --set x-terminal-emulator /usr/bin/terminator
COPY --from=picom /out/usr/local/bin/picom /usr/local/bin/picom
COPY --from=eww /out/usr/local/bin/eww /usr/local/bin/eww
COPY --from=serenade /out/ /
COPY desktop/coder-desktop-theme /usr/local/bin/coder-desktop-theme
COPY desktop/classic/ /usr/share/coder-desktop/classic/
COPY desktop/coder-compositor.desktop /etc/xdg/autostart/coder-compositor.desktop
# Every terminal's font, the Nerd Font: Terminator in a home without its own config, and GNOME's monospace setting
# (Terminator's "system font", and any program that asks for it); XFCE's terminal has it already (xfce/).
COPY terminals/terminator-config /etc/xdg/terminator/config
COPY terminals/90_coder-workspace.gschema.override /usr/share/glib-2.0/schemas/
# noVNC: the clipboard shared with the computer both ways, and only the viewer in use resizing the desktop - modules
# its page loads after its own.
COPY novnc/coder-clipboard.js novnc/coder-resize.js /usr/share/novnc/app/
RUN glib-compile-schemas /usr/share/glib-2.0/schemas \
	&& GSETTINGS_BACKEND=memory gsettings get org.gnome.desktop.interface monospace-font-name | grep -q 'JetBrainsMono Nerd Font' \
	&& sed -i 's|</head>|    <script type="module" crossorigin="anonymous" src="app/coder-clipboard.js"></script>\n    <script type="module" crossorigin="anonymous" src="app/coder-resize.js"></script>\n</head>|' \
		/usr/share/novnc/vnc.html \
	&& test "$(grep -c -e 'app/coder-clipboard.js' -e 'app/coder-resize.js' /usr/share/novnc/vnc.html)" = 2
RUN chmod 0755 /usr/local/bin/coder-desktop-theme /usr/local/bin/picom /usr/local/bin/eww \
	&& fc-cache -f >/dev/null && fc-list | grep -qi overpass \
	&& for t in Zafiro Numix-Apps Fluent-dark; do gtk-update-icon-cache -q -f "/usr/share/icons/$t"; done \
	&& ! ldd /usr/local/bin/picom /usr/local/bin/eww | grep 'not found' \
	&& picom --version && eww --version && chromium --version && dpkg-query -W terminator && rofi -v \
	&& h="$(mktemp -d)" && chmod 0777 "$h" \
	&& runuser -u coder -- env HOME="$h" sh -c 'coder-desktop-theme apply serenade >/dev/null && test "$(coder-desktop-theme current)" = serenade \
		&& test -f "$HOME/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-panel.xml" && test -x "$HOME/.config/eww/scripts/launch.sh" \
		&& grep -q "^WebBrowser=chromium" "$HOME/.config/xfce4/helpers.rc" \
		&& coder-desktop-theme apply classic >/dev/null && test ! -e "$HOME/.config/picom.conf"' && rm -rf "$h"

# code-server (VS Code in the browser) and File Browser: downloaded here, at build time only, and checked. The
# template starts these; it downloads them itself only on an image without them (and only with internet).
ARG CODE_SERVER_VERSION=4.141.0
ARG CODE_SERVER_SHA256=65bcd20b524d03eb1b5adb7f360244599ef0e5b74089a46a982d32c074b97a29
RUN curl -fsSL -o /tmp/code-server.tgz \
		"https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server-${CODE_SERVER_VERSION}-linux-amd64.tar.gz" \
	&& echo "${CODE_SERVER_SHA256}  /tmp/code-server.tgz" | sha256sum -c - \
	&& install -d /usr/lib/code-server \
	&& tar -xzf /tmp/code-server.tgz -C /usr/lib/code-server --strip-components=1 \
	&& ln -sf /usr/lib/code-server/bin/code-server /usr/bin/code-server \
	&& rm -f /tmp/code-server.tgz \
	&& code-server --version
# CVE-2026-102422 (critical, arbitrary command execution): code-server 4.141.0, the newest, ships shell-quote 1.10.0
# among VS Code's modules. Replaced by 1.12.0 (the newest; 1.11.0 fixed it), checked by its npm SHA-512; same API
# (quote and parse give the same results). Drop this step once a code-server release carries a fixed shell-quote.
ARG SHELL_QUOTE_VERSION=1.12.0
ARG SHELL_QUOTE_SHA512=3dc072a8dc93ff7f05da40cd8b4d3a1c031125a50bb81ceafc53acc37a9d66f5ff180f56fe36a60da46c9201e3b9b1e27ed5cae6c205c4b364beb5d4c1ca1fe9
RUN curl -fsSL -o /tmp/shell-quote.tgz "https://registry.npmjs.org/shell-quote/-/shell-quote-${SHELL_QUOTE_VERSION}.tgz" \
	&& echo "${SHELL_QUOTE_SHA512}  /tmp/shell-quote.tgz" | sha512sum -c - \
	&& d=/usr/lib/code-server/lib/vscode/node_modules/shell-quote \
	&& test -d "$d" && rm -rf "$d" && install -d "$d" \
	&& tar -xzf /tmp/shell-quote.tgz -C "$d" --strip-components=1 --no-same-owner \
	&& rm -f /tmp/shell-quote.tgz \
	&& /usr/lib/code-server/lib/node -e 'const q = require(process.argv[1]); if (require(process.argv[1] + "/package.json").version !== process.argv[2] || q.quote(["a b"]) !== "'"'"'a b'"'"'") process.exit(1)' "$d" "${SHELL_QUOTE_VERSION}"
# GHSA-c475-qrg2-pj4r and others (high: excessive CPU, an uncaught exception): code-server ships basic-ftp 5.3.1 (for
# get-uri, its proxy agent's ftp:// support). Replaced by 6.2.3, the newest, checked by its npm SHA-512. 6.0's one
# breaking change refuses separate FTP transfer hosts by default (bounce attacks), which get-uri does not use.
ARG BASIC_FTP_VERSION=6.2.3
ARG BASIC_FTP_SHA512=4fb198b50d9e28950de583911bb03cbb659f07d24c3746b8ff0977308eb8aaadaa4d17dadc55f3a0dab40c3a23643903c92b5c2fe4e47cab33e091c4671e6419
RUN curl -fsSL -o /tmp/basic-ftp.tgz "https://registry.npmjs.org/basic-ftp/-/basic-ftp-${BASIC_FTP_VERSION}.tgz" \
	&& echo "${BASIC_FTP_SHA512}  /tmp/basic-ftp.tgz" | sha512sum -c - \
	&& d=/usr/lib/code-server/node_modules/basic-ftp \
	&& test -d "$d" && rm -rf "$d" && install -d "$d" \
	&& tar -xzf /tmp/basic-ftp.tgz -C "$d" --strip-components=1 --no-same-owner \
	&& rm -f /tmp/basic-ftp.tgz \
	&& /usr/lib/code-server/lib/node -e 'const f = require(process.argv[1]); if (require(process.argv[1] + "/package.json").version !== process.argv[2] || typeof f.Client !== "function") process.exit(1); require("/usr/lib/code-server/node_modules/get-uri")' "$d" "${BASIC_FTP_VERSION}"
# CVE-2026-103923 (low, GHSA-238p-pmpm-9mq7: an existing prototype pollution can bypass KaTeX's trust restrictions):
# code-server 4.141.0, the newest, ships katex 0.16.22 among VS Code's modules (the workbench loads its
# dist/katex.min.js and katex.min.css to render math in chat and other markdown). Replaced by 0.18.2, the fixed
# release, checked by its npm SHA-512. 0.18's one breaking change prefixes KaTeX's internal CSS classes, which its own
# stylesheet (replaced with it) matches; VS Code styles only .katex and .katex-display, and its sanitizer keeps any
# class. The markdown preview's math (the markdown-math extension) bundles its own KaTeX. Drop this step once a
# code-server release carries katex 0.18.2 or newer.
ARG KATEX_VERSION=0.18.2
ARG KATEX_SHA512=dec9ef7b8cb44974cc7aab8b8a6d453223ef2c6125c926a6d1b94de7141906a118de5389cf54e7b9a6a2ba09c1641a87ce54801a615360becc09090e46e2ca08
RUN curl -fsSL -o /tmp/katex.tgz "https://registry.npmjs.org/katex/-/katex-${KATEX_VERSION}.tgz" \
	&& echo "${KATEX_SHA512}  /tmp/katex.tgz" | sha512sum -c - \
	&& d=/usr/lib/code-server/lib/vscode/node_modules/katex \
	&& test -d "$d" && rm -rf "$d" && install -d "$d" \
	&& tar -xzf /tmp/katex.tgz -C "$d" --strip-components=1 --no-same-owner \
	&& rm -f /tmp/katex.tgz \
	&& test -f "$d/dist/katex.min.js" && test -f "$d/dist/katex.min.css" \
	&& /usr/lib/code-server/lib/node -e 'const k = require(process.argv[1]); if (require(process.argv[1] + "/package.json").version !== process.argv[2] || !k.renderToString("x^2", {throwOnError: true}).includes("katex")) process.exit(1)' "$d" "${KATEX_VERSION}"
# code-server's terminal in the Nerd Font: the browser draws it, so code-server serves the font itself (its /_static
# route: code-server/nerd-font.css and the font) and its page loads it; a built-in extension makes it the terminal's
# default font (code-server/coder-workspace-defaults: only defaults, a user's own setting wins).
COPY fonts/JetBrainsMonoNerdFont-Light.ttf code-server/nerd-font.css /usr/lib/code-server/src/browser/media/fonts/
COPY code-server/coder-workspace-defaults/ /usr/lib/code-server/lib/vscode/extensions/coder-workspace-defaults/
RUN f=/usr/lib/code-server/lib/vscode/out/vs/code/browser/workbench/workbench.html \
	&& sed -i 's|^\(\t*\)\(<link rel="stylesheet" href="{{WORKBENCH_WEB_BASE_URL}}/out/vs/code/browser/workbench/workbench.css">\)|\1<link rel="stylesheet" href="{{BASE}}/_static/src/browser/media/fonts/nerd-font.css">\n\1\2|' "$f" \
	&& test "$(grep -c 'fonts/nerd-font.css' "$f")" = 1
COPY --from=filebrowser /out/filebrowser /usr/local/bin/filebrowser
RUN chmod 0755 /usr/local/bin/filebrowser && filebrowser version | grep -q "FileBrowser Quantum"

# Security, last (no later step may pull these back): medium findings with no fix released, in packages a workspace
# pod has no use for.
#   - PulseAudio and its ALSA plugins: no sound reaches the browser over VNC. With them go ffmpeg's libraries (96
#     findings) and snapd's GLib library with libsoup (18), which the weather panel plugin also needs (it needs the
#     internet). Firefox still plays WebM, VP9, AV1 and Opus with its own decoders; H.264 and AAC (MP4) need ffmpeg.
#   - GNU coreutils in place of Ubuntu 26.04's Rust coreutils (uutils, 20): Ubuntu's own switch, coreutils-from-gnu.
#     build-essential goes (a metapackage that requires the Rust ones); the compilers and tools it names stay.
#   - ipp-usb and avahi-daemon (USB printers), dmsetup (device mapper), nodejs-doc, gstreamer's GL plugin.
# Kept: XFCE's goodies (xfce4-goodies is a metapackage: every plugin it names but the weather one stays) and
# glib-networking (TLS for GLib programs). The checks after it: none of them back, the rest still there.
RUN apt-get update \
	&& apt-mark manual glib-networking $(apt-cache depends --installed xfce4-goodies build-essential \
		| awk '/(Depends|Recommends):/ && $2 !~ /^</ {print $2}' | grep -vxE 'xfce4-weather-plugin|coreutils-from-uutils') >/dev/null \
	&& apt-get install -y --allow-remove-essential coreutils-from-gnu coreutils-from-uutils- \
	&& apt-get purge -y pulseaudio pulseaudio-utils libasound2-plugins libsnapd-glib-2-1 libsoup-3.0-0 libsoup-3.0-common \
		xfce4-weather-plugin xfce4-goodies ipp-usb avahi-daemon dmsetup nodejs-doc gstreamer1.0-gl rust-coreutils \
	&& apt-get autoremove -y --purge \
	&& rm -rf /var/lib/apt/lists/* \
	&& ls --version | grep -q 'GNU coreutils' && test ! -e /usr/lib/cargo/bin/coreutils \
	&& for p in pulseaudio libavcodec62 libavutil60 libswresample6 libsoup-3.0-0 rust-coreutils avahi-daemon; do \
		! dpkg -s "$p" >/dev/null 2>&1 || { echo "still installed: $p"; exit 1; }; done \
	&& for p in xfce4-power-manager xfce4-whiskermenu-plugin xfce4-pulseaudio-plugin glib-networking libpulse0 gcc g++ make dpkg-dev \
		libc6-dev linux-libc-dev; do dpkg -s "$p" >/dev/null 2>&1 || { echo "removed: $p"; exit 1; }; done \
	&& gcc --version >/dev/null && g++ --version >/dev/null && make --version >/dev/null \
	&& iptables --version && ip6tables --version && getent hosts localhost >/dev/null

# What it adds over the base, every version as the installed programs say it: /usr/share/coder-workspace/addons.json.
COPY addons/addons.py /tmp/addons.py
RUN python3 /tmp/addons.py "${BASE}" >/usr/share/coder-workspace/addons.json \
	&& python3 -m json.tool /usr/share/coder-workspace/addons.json >/dev/null \
	&& rm -f /tmp/addons.py /usr/share/coder-workspace/.base-packages /usr/share/coder-workspace/.base-manual \
		/etc/apt/apt.conf.d/99-coder-workspace-build

USER coder
