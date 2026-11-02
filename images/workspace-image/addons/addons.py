"""What the workspace image adds over its base, as JSON: the last step of the build (Dockerfile), written to
/usr/share/coder-workspace/addons.json. The Images view's scan reads it, so the workspace image's entry there lists
its add-ons next to its security report.

    python3 addons.py BASE_IMAGE > /usr/share/coder-workspace/addons.json

Every version is the installed program's own answer (or its Debian package's). The apt packages are those added over
the base: the base's package list is saved before anything is installed (/usr/share/coder-workspace/.base-*), and the
packages someone asked for (apt-mark showmanual) are told from the ones that came as their dependencies. Fails (exit
1) when a program does not say its version, so the list cannot go stale unnoticed.
"""

import datetime
import json
import re
import subprocess
import sys

STATE = "/usr/share/coder-workspace"

# (name, what it is for, group, command, pattern of the version in its output)
SOFTWARE = [
    ("XFCE", "The desktop of the Desktop app", "Apps", ["dpkg-query", "-W", "-f=${Version}", "xfce4"], r"^(\S+)"),
    ("TigerVNC", "The Desktop app's display server", "Apps",
     ["dpkg-query", "-W", "-f=${Version}", "tigervnc-standalone-server"], r"^(\S+)"),
    ("noVNC + websockify", "The Desktop app in the browser", "Apps", ["dpkg-query", "-W", "-f=${Version}", "novnc"],
     r"^(\S+)"),
    ("code-server", "VS Code in the browser (the code-server app)", "Apps", ["code-server", "--version"],
     r"^(\d[\w.]*)"),
    ("FileBrowser Quantum", "Files in the browser (the File Browser app)", "Apps", ["filebrowser", "version"],
     r"Version\s*:\s*v?(\S+)"),
    ("Chromium", "The desktop's web browser (xtradeb's build)", "Apps", ["chromium", "--version"],
     r"Chromium (\d[\w.]*)"),
    ("Firefox", "A second web browser (Mozilla's build)", "Apps", ["firefox", "--version"], r"Firefox (\d[\w.]*)"),
    ("Terminator", "The desktop's terminal", "Apps", ["dpkg-query", "-W", "-f=${Version}", "terminator"], r"^(\S+)"),
    ("picom (animation fork)", "The Serenade desktop theme's compositor: animations, rounded corners, shadows",
     "Desktop", ["picom", "--version"], r"(v?\S+)"),
    ("eww", "The Serenade desktop theme's sidebar and System stats (release 0.6.0: its binary says 0.5.0)", "Desktop",
     ["eww", "--version"],
     r"eww (\S+)"),
    ("rofi", "The Serenade desktop theme's application finder", "Desktop", ["rofi", "-v"], r"Version: (\S+)"),
    ("k9s", "Kubernetes in the terminal", "Kubernetes", ["k9s", "version", "-s"], r"Version\s+v?(\d[\w.]*)"),
    ("kubectl", "The Kubernetes command line", "Kubernetes", ["kubectl", "version", "--client"],
     r"Client Version: v?(\d[\w.]*)"),
    ("kubelogin", "kubectl oidc-login: admins' Keycloak sign-in to the cluster", "Kubernetes",
     ["kubectl", "oidc-login", "--version"], r"v?(\d+\.\d+\.\d+)"),
    ("tmux", "Terminal multiplexer, with the bundled configuration", "Tools", ["/usr/local/bin/tmux", "-V"],
     r"tmux (\S+)"),
    ("btop", "Resource monitor", "Tools", ["btop", "--version"], r"(\d+\.\d+\.\d+)"),
    ("bat", "cat with syntax highlighting", "Tools", ["batcat", "--version"], r"bat (\S+)"),
    ("eza", "ls with colours and icons", "Tools", ["eza", "--version"], r"v(\d[\w.]*)"),
    ("fzf", "Fuzzy finder", "Tools", ["fzf", "--version"], r"^(\d[\w.]*)"),
    ("grc", "Colourises command output", "Tools", ["dpkg-query", "-W", "-f=${Version}", "grc"], r"^(\S+)"),
    ("jq", "JSON processor", "Tools", ["jq", "--version"], r"jq-(\S+)"),
    ("yq", "jq for YAML", "Tools", ["yq", "--version"], r"yq (\S+)"),
    ("Vim", "Editor", "Tools", ["vim", "--version"], r"Vi IMproved (\S+)"),
    ("Python", "python3, with venv and tkinter", "Tools", ["python3", "--version"], r"Python (\S+)"),
    ("JetBrains Mono Nerd Font", "The default monospace and desktop font", "Fonts",
     ["fc-list", ":family=JetBrainsMono Nerd Font", "family"], r"(JetBrainsMono)"),
]


def run(cmd):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        return (p.stdout or "") + (p.stderr or "")
    except (OSError, subprocess.TimeoutExpired):
        return ""


def packages(path=None):
    """{name: version} of the installed packages (or of a saved list)."""
    text = open(path).read() if path else run(["dpkg-query", "-W", "-f=${Package}\t${Version}\n"])
    return dict(line.split("\t", 1) for line in text.splitlines() if "\t" in line)


def main():
    base_image = sys.argv[1] if len(sys.argv) > 1 else ""
    software, missing = [], []
    for name, what, group, cmd, pattern in SOFTWARE:
        m = re.search(pattern, run(cmd), re.M)
        if not m:
            missing.append(name)
            continue
        version = None if group == "Fonts" else m.group(1)
        software.append({"name": name, "what": what, "group": group, "version": version})
    if missing:
        sys.exit("addons.py: no version from %s" % ", ".join(missing))

    base, now = packages(STATE + "/.base-packages"), packages()
    base_manual = set(open(STATE + "/.base-manual").read().split())
    manual = set(run(["apt-mark", "showmanual"]).split())
    added = sorted(n for n in now if n not in base)
    asked = [n for n in added if n in manual and n not in base_manual]
    json.dump({
        "schema": 1,
        "base": base_image,
        "builtAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "software": software,
        "packages": {
            "added": [{"name": n, "version": now[n]} for n in asked],
            "dependencies": len(added) - len(asked),
            "upgraded": sum(1 for n in now if n in base and base[n] != now[n]),
            "installed": len(now),
        },
    }, sys.stdout, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
