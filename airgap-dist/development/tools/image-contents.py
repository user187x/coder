#!/usr/bin/env python3
"""What each image of ours holds (helm-chart/images.txt's ghcr.io/user187x/ images: we build them, so we can say
precisely), as JSON for the Images view (Templates > Images: their "Coder fork" tag and contents tree):
helm-chart/coder-airgapped/files/ui-updates/image-contents.json, served by the platform service.

For each image, from this docker (the image as built, its ID the digest images.txt pins):
  - where it comes from: its folder and build script in this repository, and images.txt's description;
  - its configuration: user, entrypoint, command, working directory, ports, environment, labels, size, when built;
  - every build step (docker history), with what it added;
  - the programs we put in it, each with the version it reports itself (run in the image, no network);
  - the workspace images' add-ons (addons.json: every program, the apt packages someone asked for, Python's);
  - every OS package (dpkg or apk) and every Python package of each environment in it.

    development/tools/image-contents.py            all of ours (each must be in this docker: build or pull it)
    development/tools/image-contents.py --check    exits 1 when the file is not the images images.txt pins

Run it after building an image of ours and pinning it (images.txt), then build-ui-image.sh; chart_checks.py checks the
file is current.
"""
import json
import os
import re
import subprocess
import sys

TOP = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
IMAGES_TXT = os.path.join(TOP, "helm-chart", "images.txt")
OUT = os.path.join(TOP, "helm-chart", "coder-airgapped", "files", "ui-updates", "image-contents.json")
OURS = "ghcr.io/user187x/"

# Where each of ours is made: (folder, build script) in this repository.
SOURCES = {
    "coder-platform": ("development/coder-fork (the fork: ~/workspace/coder), development/airgap-image",
                       "scripts/build_platform_image.sh (fork), development/tools/build-airgap-image.sh"),
    "coder-upstream": ("development/airgap-image", "development/tools/build-airgap-image.sh"),
    "coder-ui-updates": ("helm-chart/coder-airgapped/files/ui-updates", "development/tools/build-ui-image.sh"),
    "coder-image-tools": ("development/image-tools", "development/tools/build-image-tools.sh"),
    "coder-workspace": ("development/workspace-image", "development/tools/build-workspace-image.sh"),
    "coder-workspace-dataflow": ("development/workspace-image-dataflow", "development/tools/build-dataflow-image.sh"),
    "coder-registry": ("development/registry-image", "development/tools/build-registry-image.sh"),
    "coder-minio": ("development/tools/build-minio-image.sh", "development/tools/build-minio-image.sh"),
}

# The programs we put in each (beyond the workspace images' add-ons): (name, what it does, command, version pattern).
PROGRAMS = {
    "coder-platform": [
        ("Coder (the fork)", "The dashboard and its server", ["coder", "--version"], r"Coder (v\S+)"),
        ("Terraform", "Builds workspaces; providers mirrored for offline use", ["terraform", "version"],
         r"Terraform (v\S+)"),
    ],
    "coder-upstream": [
        ("Coder (upstream)", "Coder as released, for a plain install", ["coder", "--version"], r"Coder (v\S+)"),
        ("Terraform", "Builds workspaces; providers mirrored for offline use", ["terraform", "version"],
         r"Terraform (v\S+)"),
    ],
    "coder-ui-updates": [
        ("Python", "The platform service", ["python3", "--version"], r"Python (\S+)"),
        ("trivy", "The Images view's vulnerability scans", ["trivy", "--version"], r"Version: (\S+)"),
        ("regctl", "Registry copies and manifests", ["regctl", "version", "--format", "{{.VCSTag}}"], r"(\S+)"),
        ("ShellCheck", "The image builder's script checks", ["shellcheck", "--version"], r"version: (\S+)"),
        ("shfmt", "The image builder's script formatting", ["shfmt", "--version"], r"(v?\S+)"),
    ],
    "coder-registry": [
        ("Docker registry", "Where built and imported images are kept", ["registry", "--version"],
         r"distribution/v\d+ (\S+)"),
    ],
}

# Python environments: the system's, and every one under /opt and /usr/local (a venv's bin/python3, a few levels down)
PY_ENVS = "for p in /usr/bin/python3 /usr/local/bin/python3; do [ -x \"$p\" ] && echo \"$p\"; done; " \
          "find /opt /usr/local -maxdepth 7 -path '*/bin/python3' 2>/dev/null; true"


def sh(cmd, check=True):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if check and r.returncode != 0:
        raise RuntimeError("%s: %s" % (" ".join(cmd[:4]), (r.stderr or r.stdout)[-300:]))
    return r


def ours():
    """images.txt's images of ours: [(ref, digest, section, description)]."""
    out, section = [], ""
    for line in open(IMAGES_TXT):
        if line.startswith("["):
            section = line.split("]", 1)[0].strip("[")
            continue
        parts = line.split(None, 2)
        if len(parts) == 3 and parts[0].startswith(OURS) and parts[1].startswith("sha256:"):
            out.append((parts[0], parts[1], section, parts[2].strip()))
    return out


def run_in(ref, args, timeout=180):
    """A command in the image, no network; its output ("" when it has no shell or the command fails)."""
    try:
        r = subprocess.run(["docker", "run", "--rm", "--network", "none", "--user", "0", "--entrypoint", args[0], ref,
                            *args[1:]], capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return ""
    return r.stdout if r.returncode == 0 else ""


def packages(ref):
    """Every OS package ([name, version]) and its manager; every Python environment's packages."""
    os_pkgs, manager = [], None
    dpkg = run_in(ref, ["sh", "-c", "dpkg-query -W -f '${Package}\\t${Version}\\n' 2>/dev/null"])
    if dpkg.strip():
        manager = "dpkg"
        os_pkgs = [line.split("\t", 1) for line in dpkg.splitlines() if "\t" in line]
    else:
        apk = run_in(ref, ["sh", "-c", "apk info -v 2>/dev/null"])
        if apk.strip():
            manager = "apk"
            for line in apk.splitlines():
                m = re.match(r"^(.+?)-(\d[^-]*-r\d+)$", line.strip())
                if m:
                    os_pkgs.append([m.group(1), m.group(2)])
    python = []
    for exe in run_in(ref, ["sh", "-c", PY_ENVS]).split():
        listed = run_in(ref, [exe, "-m", "pip", "list", "--format", "json", "--disable-pip-version-check"])
        try:
            items = sorted([p["name"], p["version"]] for p in json.loads(listed or "[]"))
        except ValueError:
            items = []
        env = exe.rsplit("/bin/", 1)[0]
        if items and not any(e["env"] == env or e["items"] == items for e in python):
            python.append({"env": env, "count": len(items), "items": items})
    return {"os": {"manager": manager, "count": len(os_pkgs), "items": sorted(os_pkgs)} if manager else None,
            "python": python}


def programs(repo, ref):
    out = []
    for name, what, cmd, pattern in PROGRAMS.get(repo, []):
        m = re.search(pattern, run_in(ref, cmd), re.M)
        out.append({"name": name, "what": what, "version": m.group(1) if m else None})
    return out


def describe(ref, digest, section, description):
    repo = ref.split("/")[-1].split(":")[0]
    inspect = json.loads(sh(["docker", "image", "inspect", ref]).stdout)[0]
    # images.txt pins our builds by their image ID; an image we retag (coder-minio) by its source's digest
    if inspect["Id"] != digest and not any(d.endswith("@" + digest) for d in inspect.get("RepoDigests") or []):
        print("note: %s in this docker is %s; images.txt pins %s (a retagged image's source digest?)" % (
            ref, inspect["Id"][:19], digest[:19]), file=sys.stderr)
    cfg = inspect.get("Config") or {}
    history = [json.loads(line) for line in sh(["docker", "history", "--no-trunc", "--format", "{{json .}}", ref])
               .stdout.splitlines() if line.strip()]
    steps = []
    for h in reversed(history):  # oldest first, as the Dockerfile reads
        step = re.sub(r"^/bin/sh -c (#\(nop\) )?", "", h.get("CreatedBy") or "").strip()
        step = re.sub(r"\s+", " ", step)
        steps.append({"step": step[:600], "size": h.get("Size") or "0B", "comment": (h.get("Comment") or "")[:200]})
    addons = None
    raw = run_in(ref, ["sh", "-c", "cat /usr/share/coder-workspace/addons.json 2>/dev/null"])
    if raw.strip():
        try:
            addons = json.loads(raw)
        except ValueError:
            addons = None
    src = SOURCES.get(repo, ("", ""))
    return {
        "ref": ref, "repository": repo, "digest": digest, "imageId": inspect["Id"], "section": section,
        "description": description,
        "source": {"folder": src[0], "build": src[1]},
        "created": inspect.get("Created"), "size": inspect.get("Size"),
        "platform": "%s/%s" % (inspect.get("Os"), inspect.get("Architecture")),
        "config": {"user": cfg.get("User") or "root", "entrypoint": cfg.get("Entrypoint"), "cmd": cfg.get("Cmd"),
                   "workdir": cfg.get("WorkingDir") or "/", "ports": sorted((cfg.get("ExposedPorts") or {}).keys()),
                   "env": cfg.get("Env") or [], "labels": cfg.get("Labels") or {}},
        "layers": len((inspect.get("RootFS") or {}).get("Layers") or []),
        "steps": steps,
        "programs": programs(repo, ref),
        "addons": addons,
        "packages": packages(ref),
    }


def main():
    check = "--check" in sys.argv[1:]
    wanted = ours()
    if check:
        try:
            have = json.load(open(OUT))
        except (OSError, ValueError):
            sys.exit("image-contents.json is missing: run development/tools/image-contents.py")
        # the platform service's own image carries this file: it is described as built before (only its name checked)
        own = lambda ref: "/coder-ui-updates:" in ref  # noqa: E731
        pinned = {ref.split(":")[0] if own(ref) else ref: None if own(ref) else digest for ref, digest, _, _ in wanted}
        listed = {ref.split(":")[0] if own(ref) else ref: None if own(ref) else i["digest"]
                  for ref, i in have["images"].items()}
        if pinned != listed:
            stale = sorted(set(pinned.items()) ^ set(listed.items()))
            sys.exit("image-contents.json is not the images images.txt pins (%s): run image-contents.py" % stale[:4])
        print("image-contents.json: %d images, current" % len(listed))
        return
    images = {}
    for ref, digest, section, description in wanted:
        print("reading", ref, file=sys.stderr)
        images[ref] = describe(ref, digest, section, description)
    with open(OUT + ".tmp", "w") as f:
        json.dump({"images": images}, f, separators=(",", ":"), sort_keys=True)
    os.replace(OUT + ".tmp", OUT)
    print("wrote %s: %d images, %d KB" % (os.path.relpath(OUT, TOP), len(images), os.path.getsize(OUT) // 1024))


if __name__ == "__main__":
    main()
