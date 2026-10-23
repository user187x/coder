#!/usr/bin/env python3
"""cloud-drive: the owner's Cloud Drive mounted into a folder of this workspace (one of its folders, or a new one).

  cloud-drive mount PATH [--keep-both | --overwrite-all]   the Cloud Drive's files and folders in PATH (absolute, or
                                                           relative to your home); asks what to do with files of the
                                                           same name already there
  cloud-drive unmount PATH                                 takes them out again (your own files stay)
  cloud-drive list                                         where it is mounted
  cloud-drive sync                                         brings the mounts up to date (the workspace does this by
                                                           itself every few seconds)

How: each of the Cloud Drive's entries is linked into PATH (~/cloud-drive/<name>), so PATH keeps the files it has. A
folder of the same name on both sides is merged: its entries are linked one level down (GNU stow's tree folding). A
file (or a file and a folder) of the same name on both sides is a collision: nothing is changed until it is resolved -

  Keep both   the Cloud Drive's is linked under another name: data.csv -> data-(cloud_drive).csv
  Overwrite   the Cloud Drive's takes the name; the file it replaces is moved to ~/.local/share/cloud-drive/
              overwritten/<time>/ (nothing deleted). Then: Overwrite all, or Prompt for each occurrence ([Y/n]: Y
              overwrites, n keeps both).

Entries that appear on the Cloud Drive later are linked by `sync`; a collision then is resolved as the mount was
(overwrite all, or keep both - "prompt for each" keeps both: nobody is there to ask). Entries gone from the Cloud Drive
lose their links. The mounts are kept in ~/.config/cloud-drive/mounts.json.

For the dashboard (the platform service runs it through exec, with --json): plan PATH, apply PATH --decisions JSON
(mode keep-both | overwrite-all | ask, decisions {relative path: overwrite | keep}), unmount PATH, list.
"""
import argparse
import json
import os
import shutil
import sys
import time

HOME = os.environ.get("HOME") if os.environ.get("HOME", "/") not in ("", "/") else "/home/coder"
CLOUD = os.path.join(HOME, "cloud-drive")
STATE = os.path.join(HOME, ".config", "cloud-drive", "mounts.json")
OVERWRITTEN = os.path.join(HOME, ".local", "share", "cloud-drive", "overwritten")
TAG = "(cloud_drive)"
DOUBLE_EXT = (".tar.gz", ".tar.bz2", ".tar.xz", ".tar.zst", ".tar.lz4")
REFUSED = ("/", "/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc", "/root", "/run", "/sbin", "/sys", "/usr",
           "/var", "/mnt", "/mnt/cloud-drive")
MODES = ("keep-both", "overwrite-all", "ask")


class Halt(Exception):
    """Collisions to resolve before anything is changed."""


def fail(msg, code=2):
    print("cloud-drive: " + msg, file=sys.stderr)
    raise SystemExit(code)


# ------------------------------------------------------------------------------------------------ paths
def resolve(path):
    """The target folder: absolute, or relative to the home folder; never the Cloud Drive itself, inside it, or a
    system folder."""
    path = (path or "").strip()
    if not path:
        raise ValueError("a folder to mount into")
    if path == "~" or path.startswith("~/"):
        path = HOME + path[1:]
    full = os.path.normpath(path if os.path.isabs(path) else os.path.join(HOME, path))
    real = os.path.realpath(full)
    cloud = os.path.realpath(CLOUD) if os.path.exists(CLOUD) else None
    for p in {full, real}:
        if p in REFUSED or any(p.startswith(r + "/") for r in ("/proc", "/sys", "/dev", "/etc", "/usr", "/boot")):
            raise ValueError("%s is a system folder" % p)
        if p == CLOUD or p.startswith(CLOUD + "/") or (cloud and (p == cloud or p.startswith(cloud + "/"))):
            raise ValueError("%s is the Cloud Drive itself" % p)
    if os.path.lexists(full) and not os.path.isdir(full):
        raise ValueError("%s is a file, not a folder" % full)
    return full


def renamed(name, n=1):
    """data.csv -> data-(cloud_drive).csv; archive.tar.gz -> archive-(cloud_drive).tar.gz; .bashrc ->
    .bashrc-(cloud_drive); a second one -> data-(cloud_drive)-2.csv."""
    suffix = TAG if n == 1 else "%s-%d" % (TAG, n)
    low = name.lower()
    ext = next((e for e in DOUBLE_EXT if low.endswith(e) and len(name) > len(e)), None)
    if ext is None:
        stem, ext = os.path.splitext(name)  # .bashrc: no extension
    else:
        stem = name[:-len(ext)]
        ext = name[-len(ext):]
    return "%s-%s%s" % (stem, suffix, ext)


def kind(path):
    if os.path.islink(path):
        return "link"
    return "folder" if os.path.isdir(path) else "file"


def size(path):
    try:
        return os.lstat(path).st_size if not os.path.isdir(path) or os.path.islink(path) else None
    except OSError:
        return None


# ------------------------------------------------------------------------------------------------ state
def load():
    try:
        with open(STATE) as f:
            data = json.load(f)
        return data if isinstance(data, dict) and isinstance(data.get("mounts"), list) else {"mounts": []}
    except (OSError, ValueError):
        return {"mounts": []}


def save(data):
    os.makedirs(os.path.dirname(STATE), mode=0o700, exist_ok=True)
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=1)
    os.replace(tmp, STATE)


def find(data, target):
    return next((m for m in data["mounts"] if m["target"] == target), None)


# ------------------------------------------------------------------------------------------------ planning
def cloud_ready():
    return os.path.isdir(CLOUD)


def plan(target, mount=None):
    """What mounting does: the links to make, and the collisions (nothing changed). Walks the Cloud Drive only where
    a folder of the same name is on both sides."""
    links, collisions, merged, have = [], [], [], 0
    taken = set((mount or {}).get("links", {}).values())

    def walk(rel):
        nonlocal have
        src_dir = os.path.join(CLOUD, rel) if rel else CLOUD
        try:
            names = sorted(os.listdir(src_dir))
        except OSError:
            return
        for name in names:
            crel = os.path.join(rel, name) if rel else name
            if crel in taken:
                have += 1
                continue
            src = os.path.join(CLOUD, crel)
            dst = os.path.join(target, crel)
            if not os.path.lexists(dst):
                links.append({"path": crel, "to": crel})
            elif os.path.islink(dst) and os.readlink(dst) == src:
                have += 1  # linked already (by hand, or a mount recorded elsewhere)
            elif os.path.isdir(dst) and not os.path.islink(dst) and os.path.isdir(src):
                merged.append(crel)
                walk(crel)
            else:
                collisions.append({"path": crel, "local": kind(dst), "cloud": kind(src) if not os.path.islink(src)
                                   else ("folder" if os.path.isdir(src) else "file"),
                                   "localSize": size(dst), "cloudSize": size(src),
                                   "keepBothAs": os.path.join(os.path.dirname(crel), free_name(target, crel))})
    walk("")
    return {"target": target, "exists": os.path.isdir(target), "cloud": cloud_ready(), "links": links,
            "collisions": collisions, "merged": merged, "linked": have}


def free_name(target, crel):
    d, name = os.path.split(crel)
    n = 1
    while True:
        cand = renamed(name, n)
        if not os.path.lexists(os.path.join(target, d, cand)):
            return cand
        n += 1


# ------------------------------------------------------------------------------------------------ applying
def apply(target, mode, decisions=None, record=True):
    """Mounts (or brings up to date): links made, collisions resolved by decisions ({path: overwrite | keep}) else by
    the mode. A collision with no answer under "ask" halts before anything is changed."""
    if mode not in MODES:
        raise ValueError("mode: one of " + ", ".join(MODES))
    if not cloud_ready():
        raise ValueError("the Cloud Drive is not in this workspace now (~/cloud-drive)")
    data = load()
    mount = find(data, target)
    p = plan(target, mount)
    decisions = dict(decisions or {})
    if mode == "ask":
        missing = [c["path"] for c in p["collisions"] if decisions.get(c["path"]) not in ("overwrite", "keep")]
        if missing:
            raise Halt(missing)
    os.makedirs(target, exist_ok=True)
    mount = mount or {"target": target, "mode": mode, "created": time.time(), "links": {}, "overwritten": {}}
    if record:  # a sync resolves new collisions without changing how the mount was made
        mount["mode"] = mode
    done = {"linked": 0, "keptBoth": [], "overwritten": [], "movedTo": None}
    for item in p["links"]:
        dst = os.path.join(target, item["path"])
        os.symlink(os.path.join(CLOUD, item["path"]), dst)
        mount["links"][item["path"]] = item["path"]
        done["linked"] += 1
    stamp = time.strftime("%Y%m%d-%H%M%S")
    for c in p["collisions"]:
        how = decisions.get(c["path"]) or ("overwrite" if mode == "overwrite-all" else "keep")
        src = os.path.join(CLOUD, c["path"])
        if how == "overwrite":
            dst = os.path.join(target, c["path"])
            inside = dst.startswith(HOME + "/")
            aside = os.path.join(OVERWRITTEN, stamp, os.path.relpath(dst, HOME if inside else "/"))
            os.makedirs(os.path.dirname(aside), exist_ok=True)
            shutil.move(dst, aside)
            os.symlink(src, dst)
            mount["links"][c["path"]] = c["path"]
            mount.setdefault("overwritten", {})[c["path"]] = aside
            done["overwritten"].append(c["path"])
            done["movedTo"] = os.path.join(OVERWRITTEN, stamp)
        else:
            name = free_name(target, c["path"])
            rel = os.path.join(os.path.dirname(c["path"]), name)
            os.symlink(src, os.path.join(target, rel))
            mount["links"][rel] = c["path"]
            done["keptBoth"].append({"path": c["path"], "as": rel})
    if not find(data, target):
        data["mounts"].append(mount)
    save(data)
    return dict(done, target=target, mode=mode, total=len(mount["links"]))


def unmount(target):
    """Its links removed; the files it overwrote put back where they were (when nothing else took the name)."""
    data = load()
    mount = find(data, target)
    if not mount:
        raise ValueError("the Cloud Drive is not mounted at %s" % target)
    removed, restored, left = 0, 0, []
    for rel in sorted(mount["links"], key=len, reverse=True):
        dst = os.path.join(target, rel)
        if os.path.islink(dst) and os.readlink(dst).startswith(CLOUD + "/"):
            os.unlink(dst)
            removed += 1
    for rel, aside in (mount.get("overwritten") or {}).items():
        dst = os.path.join(target, rel)
        if os.path.lexists(aside) and not os.path.lexists(dst):
            shutil.move(aside, dst)
            restored += 1
        elif os.path.lexists(aside):
            left.append(aside)
    data["mounts"].remove(mount)
    save(data)
    return {"target": target, "removed": removed, "restored": restored, "left": left}


def sync(quiet=True):
    """Every mount brought up to date: new Cloud Drive entries linked (a collision resolved as the mount was: overwrite
    all, else keep both), links to entries gone removed. Nothing is done while the Cloud Drive is not here."""
    if not cloud_ready():
        return []
    out = []
    for target in [m["target"] for m in load()["mounts"]]:
        if not os.path.isdir(target):
            continue
        data = load()
        mount = find(data, target)
        gone = [rel for rel, crel in mount["links"].items() if not os.path.lexists(os.path.join(CLOUD, crel))]
        for rel in gone:
            dst = os.path.join(target, rel)
            if os.path.islink(dst):
                os.unlink(dst)
            mount["links"].pop(rel, None)
        if gone:
            save(data)
        p = plan(target, mount)
        if p["links"] or p["collisions"]:
            out.append(apply(target, "overwrite-all" if mount.get("mode") == "overwrite-all" else "keep-both",
                             record=False))
        elif gone:
            out.append({"target": target, "removed": len(gone)})
    if not quiet:
        for r in out:
            print("cloud-drive: %s brought up to date" % r["target"])
    return out


def listing():
    data = load()
    return {"cloud": cloud_ready(), "mounts": [{"target": m["target"], "mode": m.get("mode"), "created": m.get("created"),
                                                "links": len(m.get("links", {}))} for m in data["mounts"]]}


# ------------------------------------------------------------------------------------------------ the terminal
def ask(question, options):
    """One of options (their first letters; the capitalised one is the default)."""
    default = next((o for o in options if o[0].isupper()), None)
    while True:
        try:
            a = input(question).strip().lower()
        except EOFError:
            a = ""
        if not a and default:
            return default.lower()
        for o in options:
            if a and o.lower().startswith(a[0]):
                return o.lower()
        print("  answer %s" % " or ".join(o[0].upper() for o in options))


def interactive(target, preset):
    p = plan(target, find(load(), target))
    if not p["cloud"]:
        fail("the Cloud Drive is not in this workspace now (~/cloud-drive)")
    decisions, mode = {}, preset or "keep-both"
    if p["collisions"] and not preset:
        if not sys.stdin.isatty():
            print("cloud-drive: halted - %d of the Cloud Drive's names are in %s already:" % (
                len(p["collisions"]), target), file=sys.stderr)
            for c in p["collisions"]:
                print("  " + c["path"], file=sys.stderr)
            fail("run it in a terminal to choose, or add --keep-both or --overwrite-all", 3)
        print("%d of the Cloud Drive's names are in %s already:" % (len(p["collisions"]), target))
        for c in p["collisions"]:
            print("  %s  (yours: %s, the Cloud Drive's: %s)" % (c["path"], c["local"], c["cloud"]))
        if ask("[K]eep both or [O]verwrite? ", ["Keep both", "overwrite"]) == "keep both":
            mode = "keep-both"
        elif ask("Overwrite [A]ll or [P]rompt for each occurrence? ", ["All", "prompt"]) == "all":
            mode = "overwrite-all"
        else:
            mode = "ask"
            for c in p["collisions"]:
                yes = ask("Overwrite %s? [Y/n] " % c["path"], ["Yes", "no"]) == "yes"
                decisions[c["path"]] = "overwrite" if yes else "keep"
    r = apply(target, mode, decisions)
    parts = ["%d linked" % r["linked"]]
    if r["keptBoth"]:
        parts.append("%d kept both (%s)" % (len(r["keptBoth"]), ", ".join(k["as"] for k in r["keptBoth"][:5])))
    if r["overwritten"]:
        parts.append("%d overwritten (yours moved to %s)" % (len(r["overwritten"]), r["movedTo"]))
    print("The Cloud Drive is mounted at %s: %s." % (target, "; ".join(parts)))


def read_decisions(arg):
    """--decisions: JSON as given; "-" read from stdin to its end; "-:N" exactly N bytes of stdin (the platform service
    runs this through exec, whose stdin never ends)."""
    if arg == "-":
        return json.load(sys.stdin)
    if arg.startswith("-:"):
        n = int(arg[2:])
        data = b""
        while len(data) < n:
            chunk = sys.stdin.buffer.read(n - len(data))
            if not chunk:
                break
            data += chunk
        return json.loads(data.decode() or "{}")
    return json.loads(arg)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="cloud-drive", description="The Cloud Drive in a folder of this workspace.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("mount", help="mount it into a folder")
    m.add_argument("path")
    g = m.add_mutually_exclusive_group()
    g.add_argument("--keep-both", action="store_true", help="keep both on a collision (data-(cloud_drive).csv)")
    g.add_argument("--overwrite-all", action="store_true", help="overwrite on every collision (yours moved aside)")
    u = sub.add_parser("unmount", help="take it out of a folder")
    u.add_argument("path")
    for name in ("list", "sync"):
        sub.add_parser(name)
    pl = sub.add_parser("plan")
    pl.add_argument("path")
    a = sub.add_parser("apply")
    a.add_argument("path")
    a.add_argument("--mode", default="ask", choices=MODES)
    a.add_argument("--decisions", default="{}")
    for p_ in sub.choices.values():
        p_.add_argument("--json", action="store_true", help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    try:
        if args.cmd == "list":
            r = listing()
            if not args.json:
                for x in r["mounts"]:
                    print("%s  (%s, %d links)" % (x["target"], x["mode"], x["links"]))
                if not r["mounts"]:
                    print("cloud-drive: mounted nowhere")
                return 0
        elif args.cmd == "sync":
            r = sync(quiet=not args.json)
        elif args.cmd == "plan":
            r = plan(resolve(args.path), find(load(), resolve(args.path)))
        elif args.cmd == "apply":
            r = apply(resolve(args.path), args.mode, read_decisions(args.decisions))
        elif args.cmd == "unmount":
            r = unmount(resolve(args.path))
            if not args.json:
                print("The Cloud Drive is out of %s: %d links removed%s; your files stay." % (
                    r["target"], r["removed"], ", %d overwritten files put back" % r["restored"] if r["restored"]
                    else ""))
                for aside in r["left"]:
                    print("  kept aside (its name is taken again): %s" % aside)
        else:
            target = resolve(args.path)
            if args.json:
                r = apply(target, "overwrite-all" if args.overwrite_all else "keep-both")
            else:
                interactive(target, "overwrite-all" if args.overwrite_all else "keep-both" if args.keep_both
                            else None)
                return 0
        if args.json:
            print(json.dumps(r))
        return 0
    except Halt as h:
        if args.json:
            print(json.dumps({"halted": True, "unresolved": h.args[0]}))
            return 3
        fail("halted: resolve %s first" % ", ".join(h.args[0]), 3)
    except ValueError as e:
        if args.json:
            print(json.dumps({"error": str(e)}))
            return 2
        fail(str(e))
    except OSError as e:
        if args.json:
            print(json.dumps({"error": "%s: %s" % (e.filename or "", e.strerror or e)}))
            return 1
        fail("%s: %s" % (e.filename or "", e.strerror or e), 1)


if __name__ == "__main__":
    sys.exit(main())
