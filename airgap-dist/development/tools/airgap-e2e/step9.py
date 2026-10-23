"""The image builder (Templates > Images) with no internet and no apt mirror, as an admin inside the air-gapped network
(runs in a pod, standard library only; step9.sh runs it and then starts the built image on the node).

Builds an image that uses everything that needs no package download: an uploaded .deb (made here), an installation
script, dotfiles and shell configuration, hardening, FIPS-aligned settings; then checks that its scan report graded
it offline. Also checks what cannot work offline is refused before a build starts (GNOME, apt packages).
Prints PULLREF=<ref> for step9.sh."""
import io, json, ssl, sys, tarfile, time, urllib.error, urllib.request

CODER = "https://coder.airgap.test"
CTX = ssl.create_default_context(cafile="/ca/ca.crt")
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (" - " + detail if detail else ""), flush=True)


def call(path, body=None, method=None, token=None, raw=None, timeout=180):
    h = {"X-Requested-With": "coder-ui"}
    data = raw
    if body is not None:
        data, h["Content-Type"] = json.dumps(body).encode(), "application/json"
    if token:
        h["Coder-Session-Token"] = token
    req = urllib.request.Request(CODER + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            s, b = r.status, r.read()
    except urllib.error.HTTPError as e:
        s, b = e.code, e.read()
    try:
        return s, json.loads(b or b"null")
    except ValueError:
        return s, b


def deb(name, version, files):
    """A minimal .deb (ar archive: debian-binary, control.tar.gz, data.tar.gz), no dependencies."""
    def tgz(entries):
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as t:
            for path, content, mode in entries:
                info = tarfile.TarInfo(path.rstrip("/") if content is None else path)
                info.mode, info.mtime = mode, int(time.time())
                if content is None:
                    info.type = tarfile.DIRTYPE
                    t.addfile(info)
                else:
                    info.size = len(content)
                    t.addfile(info, io.BytesIO(content))
        return buf.getvalue()
    # dpkg needs the directories as entries too (it does not create a file's parents).
    parents = sorted({"/".join(p.split("/")[:i]) for p, _ in files for i in range(1, p.count("/") + 1)})
    dirs = [("./" + d + "/", None, 0o755) for d in parents]
    control = ("Package: %s\nVersion: %s\nArchitecture: all\nMaintainer: e2e <e2e@airgap.test>\n"
               "Description: air-gap e2e test package\n" % (name, version)).encode()
    members = [(b"debian-binary", b"2.0\n"), (b"control.tar.gz", tgz([("./control", control, 0o644)])),
               (b"data.tar.gz", tgz(dirs + [("./" + p, c, 0o644) for p, c in files]))]
    out = io.BytesIO()
    out.write(b"!<arch>\n")
    for n, c in members:
        out.write(b"%-16s%-12d%-6d%-6d%-8s%-10d`\n" % (n, int(time.time()), 0, 0, b"100644", len(c)))
        out.write(c + (b"\n" if len(c) % 2 else b""))
    return out.getvalue()


s, login = call("/api/v2/users/login", {"email": "admin@admin.com", "password": "admin"})
admin = (login or {}).get("session_token")
check("admin signs in", s == 201 and bool(admin), str(s))

# What the builder has to work with: the default apt sources (the internet's), unreachable here.
t0 = time.time()
s, r = call("/__coder-ui/api/images/apt-check", {"packages": ["htop"]}, token=admin)
check("apt check answers offline (no mirror: nothing available) without hanging",
      s == 200 and not r["results"]["htop"]["available"] and time.time() - t0 < 150, "%s in %.0fs" % (s, time.time() - t0))

name = "e2e-offline-%d" % (int(time.time()) % 100000)
s, r = call("/__coder-ui/api/images", {"name": name, "description": "air-gap e2e", "base": {"kind": "workspace"}}, token=admin)
check("image created (base: the bundled workspace image)", s == 200, "%s %s" % (s, str(r)[:200]))

s, r = call("/__coder-ui/api/images/%s/files/deb/e2e-hello_1.0_all.deb" % name, method="PUT", token=admin,
            raw=deb("e2e-hello", "1.0", [("usr/share/e2e-hello/ok", b"deb ok\n")]))
check("a .deb uploaded", s == 200, "%s %s" % (s, str(r)[:200]))

spec = {"base": {"kind": "workspace"}, "debs": [{"name": "e2e-hello_1.0_all.deb"}],
        "installations": [{"id": "hello", "name": "Hello", "script": "echo installed > /etc/e2e-install-ok\n"}],
        "hardening": {"noCoreDumps": True, "strictUmask": True, "lockRoot": True, "script": ""},
        "desktop": "keep", "fips": True,
        "config": {"aliases": "alias ll='ls -l'\n", "functions": "", "profile": "export E2E=1\n",
                   "dotfiles": [{"path": ".e2e-dotfile", "content": "dotfile ok\n"}]}}
s, r = call("/__coder-ui/api/images/%s" % name, {"spec": spec}, token=admin)
check("spec saved", s == 200, "%s %s" % (s, str(r)[:300]))

s, r = call("/__coder-ui/api/images/%s/build" % name, {}, token=admin)
check("build started", s == 200, "%s %s" % (s, str(r)[:300]))
build_id, b, deadline = (r or {}).get("build"), {}, time.time() + 2700
while build_id and time.time() < deadline:
    s, r = call("/__coder-ui/api/images/%s/builds/%s?log=60" % (name, build_id), token=admin)
    b = (r or {}).get("build") or {}
    if b.get("status") in ("ready", "failed", "canceled", "error"):
        break
    time.sleep(15)
check("build finished: built, pushed, scanned, checked - all offline", b.get("status") == "ready",
      "%s %s %s" % (b.get("status"), b.get("message"), "\n".join(b.get("log", [])[-25:]) if b.get("status") != "ready" else ""))
print("INFO steps: " + ", ".join("%s=%s" % (x.get("key"), x.get("status")) for x in b.get("steps", [])))

s, img = call("/__coder-ui/api/images/%s" % name, token=admin)
img = (img or {}).get("image") or {}
rep = img.get("report") or {}
graded = rep.get("securityData") or rep.get("graded") or {}
check("scan report made offline (vulnerabilities graded with the bundled database)", bool(rep),
      json.dumps({k: rep.get(k) for k in ("summary", "vulnerabilities", "grade") if k in rep})[:300] + " " + json.dumps(graded)[:300])
pull = img.get("pullRef")
check("pull reference for templates", bool(pull) and pull.startswith("localhost:"), str(pull))

# Offline, GNOME's packages are not in any source: refused before the build starts, saying why.
g = name + "-g"
call("/__coder-ui/api/images", {"name": g, "base": {"kind": "workspace"}}, token=admin)
call("/__coder-ui/api/images/%s" % g, {"spec": dict(spec, debs=[], installations=[], desktop="gnome")}, token=admin)
s, r = call("/__coder-ui/api/images/%s/build" % g, {}, token=admin)
check("GNOME without an apt mirror is refused up front, with the reason", s == 400 and "GNOME" in json.dumps(r),
      "%s %s" % (s, str(r)[:300]))
s, r = call("/__coder-ui/api/images/%s" % g, {"spec": dict(spec, debs=[], installations=[], packages=["htop"])}, token=admin)
s, r = call("/__coder-ui/api/images/%s/build" % g, {}, token=admin)
check("an apt package without a mirror is refused up front", s == 400 and "htop" in json.dumps(r), "%s %s" % (s, str(r)[:200]))
call("/__coder-ui/api/images/%s/delete" % g, {}, token=admin)

print("PULLREF=%s" % (pull or ""))
print("\n%d/%d checks passed" % (sum(results), len(results)))
sys.exit(0 if all(results) else 1)
