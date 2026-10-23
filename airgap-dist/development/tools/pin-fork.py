#!/usr/bin/env python3
"""Pins a new build of the fork in this repo: the chart runs ghcr.io/user187x/coder-platform:2.0.0-platform.<N>-airgap.

  development/tools/pin-fork.py N        (after build_platform_image.sh and build-airgap-image.sh 2.0.0-platform.N)

It reads the build's commit from the image (`coder version`), then updates helm-chart/images.txt (tag, image ID, commit),
values.yaml (coder.image.tag and its comment), Chart.yaml (appVersion) and development/coder-fork/FORK.md (the table's
Image / Built from / Air-gap / Previous rows, the pushed line, the build commands), and saves the air-gap image's
archive into the bundle (mirror-images.sh store, replacing the older build's).
"""
import datetime
import os
import re
import subprocess
import sys

top = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
n = int(sys.argv[1])
tag = "2.0.0-platform.%d" % n
img = "ghcr.io/user187x/coder-platform:%s-airgap" % tag


def sub(path, pattern, repl, count=1, flags=re.M):
    p = os.path.join(top, path)
    s = open(p).read()
    s2, k = re.subn(pattern, repl, s, count=count, flags=flags)
    if not k:
        sys.exit("%s: %r not found" % (path, pattern))
    open(p, "w").write(s2)
    return s


version = subprocess.run(["docker", "run", "--rm", "--entrypoint", "/opt/coder", img, "version"],
                         capture_output=True, text=True).stdout
m = re.search(r"v%s\+([0-9a-f]+)" % re.escape(tag), version)
if not m:
    sys.exit("%s: no version v%s+<commit> in `coder version`: %r" % (img, tag, version[:200]))
short = m.group(1)
fork = os.path.expanduser(os.environ.get("CODER_FORK", "~/workspace/coder"))
full = subprocess.run(["git", "-C", fork, "rev-parse", short], capture_output=True, text=True).stdout.strip()
commit9 = full[:9]
image_id = subprocess.run(["docker", "image", "inspect", "--format", "{{.Id}}", img], capture_output=True,
                          text=True, check=True).stdout.strip()

# images.txt
sub("helm-chart/images.txt",
    r"^ghcr\.io/user187x/coder-platform:\S+-airgap\s+sha256:[0-9a-f]+(\s+)coder \(server\); = the fork's platform\.\d+ \([0-9a-f]+\)",
    lambda mm: "%s  %s%scoder (server); = the fork's platform.%d (%s)" % (img, image_id, mm.group(1), n, commit9))
# values.yaml
sub("helm-chart/coder-airgapped/values.yaml", r"# The fork's 2\.0\.0-platform\.\d+ ", "# The fork's %s " % tag)
sub("helm-chart/coder-airgapped/values.yaml", r"^(\s+tag: )2\.0\.0-platform\.\d+-airgap$", r"\g<1>%s-airgap" % tag)
# Chart.yaml
sub("helm-chart/coder-airgapped/Chart.yaml", r'^appVersion: "2\.0\.0-platform\.\d+"$', 'appVersion: "%s"' % tag)
# FORK.md
fork_md = "development/coder-fork/FORK.md"
s = open(os.path.join(top, fork_md)).read()
old = re.search(r"\| Image \| `ghcr\.io/user187x/coder-platform:(2\.0\.0-platform\.\d+)` \(`coder version`: `v[^+]+\+([0-9a-f]+)`\) \|", s)
if old and old.group(1) != tag:
    built = re.search(r"\| Built from \| `([0-9a-f]+)`", s).group(1)[:9]
    sub(fork_md, r"^\| Previous \| ", "| Previous | `%s` (`%s`), " % (old.group(1), built))
sub(fork_md, r"^\| Image \| `ghcr\.io/user187x/coder-platform:[^`]+` \(`coder version`: `[^`]+`\) \|",
    "| Image | `ghcr.io/user187x/coder-platform:%s` (`coder version`: `v%s+%s`) |" % (tag, tag, short))
sub(fork_md, r"^\| Built from \| `[0-9a-f]+`, clean tree, [0-9-]+ \|",
    "| Built from | `%s`, clean tree, %s |" % (full, datetime.date.today().isoformat()))
sub(fork_md, r"^(\| Air-gap image \| `…:)2\.0\.0-platform\.\d+(-airgap`)", r"\g<1>%s\g<2>" % tag)
sub(fork_md, r"^(`main` is pushed up to `[0-9a-f]+` \(platform\.\d+\))(; `[0-9a-f]+` \(platform\.\d+\) is local)?\.",
    lambda mm: "%s; `%s` (platform.%d) is local." % (mm.group(1), commit9, n))
sub(fork_md, r"--tag 2\.0\.0-platform\.\d+ --arch", "--tag %s --arch" % tag)
sub(fork_md, r"build-airgap-image\.sh 2\.0\.0-platform\.\d+", "build-airgap-image.sh %s" % tag)

subprocess.run([os.path.join(top, "helm-chart", "mirror-images.sh"), "store", img], check=True)
print("pinned platform.%d = %s (%s)" % (n, commit9, image_id[:19]))
