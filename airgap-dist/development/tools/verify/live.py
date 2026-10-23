"""Live conformance suite: Coder's own capabilities and the fork's, against a running deployment (standard library
only, so it also runs in a pod inside an air-gapped cluster).

  python3 live.py --url https://coder.example --ca ca.crt [--admin-email E --admin-password P]
                  [--template default] [--keep] [--jsonl out.jsonl]

Creates a throwaway user (verify-user-<n>) and workspace (verify-<n>), checks them end to end, and deletes them
(--keep leaves them). Each check is one JSON line in --jsonl ({suite, name, ok, detail, seconds}); report.py turns
them into a report. Exit status 1 when a check fails.

Suites: upstream (what Coder Community Edition does: sign-in, users, tokens, organizations, templates, workspace
lifecycle, agent, apps, web terminal, audit, insights, health) and fork (the platform service, the dashboard's
add-ons, the template's additions)."""
import argparse, base64, json, os, random, socket, ssl, struct, sys, time, urllib.error, urllib.parse, urllib.request, uuid

RESULTS = []
OUT = None


def check(suite, name, ok, detail="", t0=None):
    rec = {"suite": suite, "name": name, "ok": bool(ok), "detail": str(detail)[:600],
           "seconds": round(time.time() - t0, 2) if t0 else None}
    RESULTS.append(rec)
    if OUT:
        OUT.write(json.dumps(rec) + "\n"); OUT.flush()
    print("%s [%s] %s%s" % ("PASS" if ok else "FAIL", suite, name, (" - " + rec["detail"]) if rec["detail"] else ""), flush=True)
    return ok


class API:
    def __init__(self, url, ctx):
        self.url, self.ctx = url.rstrip("/"), ctx

    def call(self, path, body=None, method=None, token=None, raw=None, timeout=60, headers=None):
        h = {"X-Requested-With": "coder-ui"}
        h.update(headers or {})
        data = raw
        if body is not None:
            data, h["Content-Type"] = json.dumps(body).encode(), "application/json"
        if token:
            h["Coder-Session-Token"] = token
        req = urllib.request.Request(self.url + path, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=self.ctx) as r:
                s, b = r.status, r.read()
        except urllib.error.HTTPError as e:
            s, b = e.code, e.read()
        except Exception as e:  # noqa: BLE001 - unreachable, timeouts: the check fails with the reason
            return 0, str(e)
        try:
            return s, json.loads(b or b"null")
        except ValueError:
            return s, b


def pty_echo(base, ctx, token, agent_id, text, timeout=90):
    """Coder's web terminal end to end: a reconnecting PTY over a websocket, through Coder to the agent. Waits for
    the shell's first output, sends a command and waits for what it prints (computed, so the echo of the typed
    command does not count)."""
    u = urllib.parse.urlparse(base)
    port = u.port or (443 if u.scheme == "https" else 80)
    sock = socket.create_connection((u.hostname, port), timeout=timeout)
    if u.scheme == "https":
        sock = ctx.wrap_socket(sock, server_hostname=u.hostname)
    key = base64.b64encode(os.urandom(16)).decode()
    path = "/api/v2/workspaceagents/%s/pty?reconnect=%s&width=120&height=30" % (agent_id, uuid.uuid4())
    sock.sendall(("GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                  "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\nCoder-Session-Token: %s\r\n\r\n"
                  % (path, u.netloc, key, token)).encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = sock.recv(65536)
        if not chunk:
            raise RuntimeError("closed during the handshake")
        buf += chunk
    head, buf = buf.split(b"\r\n\r\n", 1)
    if b" 101 " not in head.split(b"\r\n", 1)[0]:
        raise RuntimeError(head.split(b"\r\n", 1)[0].decode(errors="replace"))
    sock.settimeout(2)

    def frames():
        """Payloads of the complete frames in buf (reading more when needed); None on close."""
        nonlocal buf
        out = []
        while True:
            if len(buf) >= 2:
                n, off = buf[1] & 0x7F, 2
                if n == 126 and len(buf) >= 4:
                    n, off = struct.unpack("!H", buf[2:4])[0], 4
                elif n == 127 and len(buf) >= 10:
                    n, off = struct.unpack("!Q", buf[2:10])[0], 10
                if n < 126 or off > 2:
                    if len(buf) >= off + n:
                        op, payload, buf = buf[0] & 0x0F, buf[off:off + n], buf[off + n:]
                        if op == 8:
                            return out, True
                        out.append(payload)
                        continue
            try:
                chunk = sock.recv(65536)
            except socket.timeout:
                return out, False
            if not chunk:
                return out, True
            buf += chunk

    def send(obj):
        payload = json.dumps(obj).encode()
        mask = os.urandom(4)
        n = len(payload)
        # A binary frame: Coder reads the terminal's input as binary messages (the dashboard sends them so).
        hdr = bytes([0x82]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack("!H", n))
        sock.sendall(hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    # The shell must be ready to read (its prompt drawn, the terminal quiet) or what is typed is lost: type then,
    # and again if nothing comes back.
    out, deadline, quiet_since, tries, last_try = b"", time.time() + timeout, None, 0, 0.0
    while time.time() < deadline:
        got, closed = frames()
        if got:
            out += b"".join(got)
            quiet_since = None
        elif quiet_since is None:
            quiet_since = time.time()
        if closed:
            break
        if b"verify-pty-" + b"%d" % (6 * 7) in out:
            sock.close()
            return out
        if out and quiet_since and time.time() - quiet_since >= 1.5 and time.time() - last_try > 8 and tries < 4:
            send({"data": text + "\r"})
            tries, last_try = tries + 1, time.time()
    sock.close()
    raise RuntimeError("no output from the command (got %d bytes: %r)" % (len(out), out[-160:]))


def main():
    global OUT
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True); ap.add_argument("--ca")
    ap.add_argument("--admin-email", default="admin@admin.com"); ap.add_argument("--admin-password", default="admin")
    ap.add_argument("--template", default="default"); ap.add_argument("--keep", action="store_true")
    ap.add_argument("--jsonl"); ap.add_argument("--build-timeout", type=int, default=900)
    a = ap.parse_args()
    OUT = open(a.jsonl, "a") if a.jsonl else None
    ctx = ssl.create_default_context(cafile=a.ca) if a.ca else ssl.create_default_context()
    c = API(a.url, ctx)
    n = random.randint(1000, 9999)
    U, F = "upstream", "fork"

    # ---- sign-in, users, tokens, organizations (upstream) ------------------------------------------------------
    t0 = time.time(); s, b = c.call("/api/v2/buildinfo")
    check(U, "build info", s == 200 and b.get("version"), b.get("version") if s == 200 else s, t0)
    s, am = c.call("/api/v2/users/authmethods")
    check(U, "sign-in methods: password", s == 200 and am["password"]["enabled"], json.dumps(am)[:200])
    s, b = c.call("/api/v2/users/login", {"email": a.admin_email, "password": a.admin_password + "x"})
    check(U, "a wrong password is refused", s == 401, s)
    s, b = c.call("/api/v2/users/login", {"email": a.admin_email, "password": a.admin_password})
    if not check(U, "owner signs in with a password", s == 201, s):
        sys.exit(1)
    admin = b["session_token"]
    s, me = c.call("/api/v2/users/me", token=admin)
    check(U, "the owner has the owner role", "owner" in [r["name"] for r in me.get("roles", [])], me.get("roles"))
    s, orgs = c.call("/api/v2/organizations", token=admin)
    org = orgs[0]["id"] if s == 200 and orgs else None
    check(U, "organizations", s == 200 and org, s)
    uname, upw = "verify-user-%d" % n, "Verify-pw-%d!x" % n
    s, user = c.call("/api/v2/users", {"email": uname + "@verify.test", "username": uname, "password": upw,
                                       "login_type": "password", "organization_ids": [org]}, token=admin)
    check(U, "an owner creates a user", s == 201, s)
    s, b = c.call("/api/v2/users/login", {"email": uname + "@verify.test", "password": upw})
    utoken = b.get("session_token") if s == 201 else None
    check(U, "the new user signs in", s == 201, s)
    s, _ = c.call("/api/v2/users/%s/status/suspend" % uname, method="PUT", token=admin)
    s2, _ = c.call("/api/v2/users/me", token=utoken)
    check(U, "a suspended user is locked out", s == 200 and s2 in (401, 403), "%s %s" % (s, s2))
    c.call("/api/v2/users/%s/status/activate" % uname, method="PUT", token=admin)
    s, b = c.call("/api/v2/users/login", {"email": uname + "@verify.test", "password": upw})
    utoken = b.get("session_token") if s == 201 else None
    check(U, "a reactivated user signs in again", s == 201, s)
    s, tok = c.call("/api/v2/users/me/keys/tokens", {"token_name": "verify-%d" % n, "lifetime": 3600 * 10 ** 9}, token=admin)
    key = (tok or {}).get("key") if s == 201 else None
    s2, _ = c.call("/api/v2/users/me", token=key) if key else (0, None)
    check(U, "API token: created and used", s == 201 and s2 == 200, "%s %s" % (s, s2))
    if key:
        s, toks = c.call("/api/v2/users/me/keys/tokens", token=admin)
        tid = next((t["id"] for t in toks if t.get("token_name") == "verify-%d" % n), None)
        s, _ = c.call("/api/v2/users/me/keys/%s" % tid, method="DELETE", token=admin) if tid else (0, None)
        s2, _ = c.call("/api/v2/users/me", token=key)
        check(U, "API token: deleted and refused", s == 204 and s2 == 401, "%s %s" % (s, s2))

    # ---- templates (upstream) ------------------------------------------------------------------------------------
    s, tpls = c.call("/api/v2/templates", token=admin)
    tpl = next((t for t in tpls or [] if t["name"] == a.template), None) if s == 200 else None
    check(U, "template %s present" % a.template, tpl, [t["name"] for t in tpls or []] if s == 200 else s)
    if not tpl:
        finish(c, admin, uname, None, a.keep)
    s, ver = c.call("/api/v2/templateversions/%s" % tpl["active_version_id"], token=admin)
    check(U, "the active template version built", s == 200 and ver["job"]["status"] == "succeeded", ver.get("job", {}).get("status"))
    s, res = c.call("/api/v2/templateversions/%s/resources" % ver["id"], token=admin)
    check(U, "template version resources", s == 200 and len(res) > 0, len(res) if s == 200 else s)
    s, params = c.call("/api/v2/templateversions/%s/rich-parameters" % ver["id"], token=admin)
    check(U, "template parameters", s == 200, [p["name"] for p in params] if s == 200 else s)
    s, raw = c.call("/api/v2/files/%s" % ver["job"]["file_id"], token=admin)
    check(U, "template source archive downloads", s == 200 and isinstance(raw, bytes) and len(raw) > 100, s)
    # A new version from the same source (what `coder templates push` does), not promoted.
    t0 = time.time()
    s, nv = c.call("/api/v2/organizations/%s/templateversions" % org,
                   {"template_id": tpl["id"], "file_id": ver["job"]["file_id"], "storage_method": "file",
                    "provisioner": "terraform", "message": "verify %d" % n,
                    "user_variable_values": [{"name": v["name"], "value": v["value"]} for v in
                                             (c.call("/api/v2/templateversions/%s/variables" % ver["id"], token=admin)[1] or [])]},
                   token=admin)
    st = ""
    for _ in range(120):
        if s != 201:
            break
        st = c.call("/api/v2/templateversions/%s" % nv["id"], token=admin)[1]["job"]["status"]
        if st in ("succeeded", "failed", "canceled"):
            break
        time.sleep(3)
    check(U, "a new template version builds (terraform init offline: provider mirror)", st == "succeeded", st or s, t0)

    # ---- workspace lifecycle, agent, apps, terminal (upstream) ---------------------------------------------------
    wsname, ws = "verify-%d" % n, None
    vals = [{"name": "home_disk_size", "value": "5"}, {"name": "cpu", "value": "2"}, {"name": "memory", "value": "2"}]
    known = {p["name"] for p in params} if isinstance(params, list) else set()
    t0 = time.time()
    s, ws = c.call("/api/v2/users/me/workspaces", {"template_id": tpl["id"], "name": wsname,
                   "rich_parameter_values": [v for v in vals if v["name"] in known],
                   "autostart_schedule": "CRON_TZ=UTC 0 9 * * 1-5", "ttl_ms": 8 * 3600000}, token=admin)
    check(U, "workspace created", s == 201, "%s %s" % (s, str(ws)[:300]))
    if s != 201:
        finish(c, admin, uname, None, a.keep)
    agent, status, deadline = {}, "", time.time() + a.build_timeout
    while time.time() < deadline:
        s, w = c.call("/api/v2/workspaces/%s" % ws["id"], token=admin)
        status = w["latest_build"]["job"]["status"]
        agents = [x for r in w["latest_build"]["resources"] for x in r.get("agents") or []]
        agent = agents[0] if agents else {}
        if status in ("failed", "canceled") or (status == "succeeded" and agent.get("status") == "connected"
                                                and agent.get("lifecycle_state") in ("ready", "start_error", "start_timeout")):
            break
        time.sleep(10)
    check(U, "workspace build succeeded", status == "succeeded", status, t0)
    check(U, "agent connected", agent.get("status") == "connected", agent.get("status"))
    check(U, "startup finished (lifecycle ready)", agent.get("lifecycle_state") == "ready", agent.get("lifecycle_state"), t0)
    s, logs = c.call("/api/v2/workspacebuilds/%s/logs" % w["latest_build"]["id"], token=admin)
    check(U, "build logs", s == 200 and len(logs) > 0, len(logs) if s == 200 else s)
    deadline, apps = time.time() + 600, {}
    while time.time() < deadline:
        s, w = c.call("/api/v2/workspaces/%s" % ws["id"], token=admin)
        agent = [x for r in w["latest_build"]["resources"] for x in r.get("agents") or []][0]
        apps = {x["slug"]: x for x in agent.get("apps") or []}
        if apps and all(x.get("health") in ("healthy", "disabled") for x in apps.values()):
            break
        time.sleep(15)
    for slug, app in sorted(apps.items()):
        check(U, "app %s healthy" % slug, app.get("health") in ("healthy", "disabled"), app.get("health"))
        if app.get("url") and not app.get("external"):
            s, _ = c.call("/@%s/%s.%s/apps/%s/" % (me["username"], wsname, agent["name"], slug), token=admin,
                          headers={"Accept": "text/html"})
            check(U, "app %s answers through Coder's proxy" % slug, s in (200, 302, 307), s)
    try:
        t0 = time.time(); pty_echo(a.url, ctx, admin, agent["id"], "echo verify-pty-$((6*7))")
        check(U, "web terminal: a command runs in the workspace (reconnecting PTY over websocket)", True, "", t0)
    except Exception as e:  # noqa: BLE001
        check(U, "web terminal: a command runs in the workspace (reconnecting PTY over websocket)", False, e)
    s, cons = c.call("/api/v2/workspaceagents/%s/listening-ports" % agent["id"], token=admin)
    check(U, "listening ports (port forwarding API)", s == 200 and "ports" in cons,
          [p.get("port") for p in cons.get("ports", [])][:10] if s == 200 else s)
    s, md = c.call("/api/v2/workspaceagents/%s/watch-metadata" % agent["id"], token=admin, timeout=5) if False else (0, None)

    # ---- the fork's additions on this workspace ----------------------------------------------------------------
    names = {m["description"]["display_name"]: m for m in agent.get("metadata") or []} if agent.get("metadata") else {}
    if not names:
        s, w = c.call("/api/v2/workspaces/%s" % ws["id"], token=admin)
    s, nd = c.call("/__coder-ui/api/notes?workspace=%s" % ws["id"], token=admin)
    check(F, "post-it notes: the workspace's notes", s == 200, s)
    s, note = c.call("/__coder-ui/api/notes", {"workspace": ws["id"], "text": "verify %d" % n, "color": "yellow", "x": 0.5, "y": 0.5}, token=admin)
    check(F, "post-it notes: an admin adds one", s in (200, 201), "%s %s" % (s, str(note)[:200]))
    s, vol = c.call("/__coder-ui/api/workspace-volumes/%s" % ws["id"], token=admin)
    check(F, "workspace volume: size and state", s == 200 and (vol or {}).get("volume"), str(vol)[:200])
    t0 = time.time()
    s, bk = c.call("/__coder-ui/api/workspace-volumes/%s/backup" % ws["id"], {"target": "download"}, token=admin)
    ok, last = False, None
    for _ in range(80):
        if s != 200:
            break
        s2, vol = c.call("/__coder-ui/api/workspace-volumes/%s" % ws["id"], token=admin)
        last = next((b for b in (vol or {}).get("backups", []) if b.get("id") == bk.get("backup")), None)
        if last and last.get("status") in ("done", "ready", "failed", "error"):
            ok = last.get("status") in ("done", "ready")
            break
        time.sleep(5)
    check(F, "home backup (download)", ok, str(last)[:300], t0)
    if ok:
        s, data = c.call("/__coder-ui/api/workspace-volumes/%s/backups/%s/download" % (ws["id"], bk["backup"]), token=admin, timeout=300)
        check(F, "home backup downloads (a gzip archive)", s == 200 and isinstance(data, bytes) and data[:2] == b"\x1f\x8b", s)
    s, icons = c.call("/__coder-ui/api/workspace-icons", token=admin)
    check(F, "workspace icons", s == 200, s)

    # ---- stop, start, audit, insights, health (upstream) ---------------------------------------------------------
    for transition, want in (("stop", "stopped"), ("start", "running")):
        t0 = time.time()
        s, b = c.call("/api/v2/workspaces/%s/builds" % ws["id"], {"transition": transition}, token=admin)
        st = ""
        for _ in range(int(a.build_timeout / 5)):
            st = c.call("/api/v2/workspaces/%s" % ws["id"], token=admin)[1]["latest_build"]["status"]
            if st in (want, "failed", "canceled"):
                break
            time.sleep(5)
        check(U, "workspace %s" % transition, st == want, st, t0)
    s, audit = c.call("/api/v2/audit?limit=50&q=" + urllib.parse.quote("resource_type:workspace"), token=admin)
    check(U, "audit log records the workspace", s == 200 and any(wsname in json.dumps(x) for x in audit.get("audit_logs", [])), s)
    now = time.strftime("%Y-%m-%dT%H:00:00Z", time.gmtime(time.time() + 3600))
    start = time.strftime("%Y-%m-%dT00:00:00Z", time.gmtime(time.time() - 6 * 86400))
    for p in ("templates?template_ids=%s&interval=day" % tpl["id"], "user-activity?template_ids=%s" % tpl["id"],
              "user-latency?template_ids=%s" % tpl["id"]):
        s, _ = c.call("/api/v2/insights/%s&start_time=%s&end_time=%s" % (p, start, now), token=admin)
        check(U, "insights: %s" % p.split("?")[0], s == 200, s)
    s, h = c.call("/api/v2/debug/health", token=admin, timeout=120)
    check(U, "deployment health report", s == 200, (h or {}).get("severity") if s == 200 else s)
    s, pd = c.call("/api/v2/organizations/%s/provisionerdaemons" % org, token=admin)
    check(U, "provisioner daemons", s == 200 and len(pd) > 0, len(pd) if s == 200 else s)
    s, nt = c.call("/api/v2/notifications/templates/system", token=admin)
    check(U, "notification templates", s == 200 and len(nt) > 0, len(nt) if s == 200 else s)

    # ---- the platform service (fork) ---------------------------------------------------------------------------
    for path, who, want in (("/__coder-ui/api/classification", utoken, 200), ("/__banner/banner.json", utoken, 200), ("/__banner/api/state", admin, 200), ("/__banner/api/state", utoken, 403),
                            ("/__coder-ui/api/hud", admin, 200), ("/__coder-ui/api/hud", utoken, 403),
                            ("/__coder-ui/api/hud/history?range=1h", admin, 200), ("/__coder-ui/api/cluster/usage", admin, 200),
                            ("/__coder-ui/api/monitoring/posture", admin, 200), ("/__coder-ui/api/scheduler", admin, 200),
                            ("/__coder-ui/api/scheduler/me", utoken, 200), ("/__coder-ui/api/quota", admin, 200),
                            ("/__coder-ui/api/certificates", admin, 200), ("/__coder-ui/api/certificates", utoken, 403), ("/__coder-ui/api/logo", utoken, 200),
                            ("/__coder-ui/api/avatar/defaults", utoken, 200), ("/__coder-ui/api/keycloak/status", admin, 200),
                            ("/__coder-ui/api/images", utoken, 200), ("/__coder-ui/api/images/settings", admin, 200),
                            ("/__coder-ui/api/images/security-data", admin, 200), ("/__coder-ui/api/acks", admin, 200),
                            ("/__coder-ui/api/notes/users", admin, 200), ("/__coder-ui/api/persistence", admin, 200)):
        s, b = c.call(path, token=who)
        check(F, "%s as %s -> %d" % (path.split("?")[0], "owner" if who == admin else "member", want), s == want, s)
    s, b = c.call("/__coder-ui/healthz")
    check(F, "platform service health", s == 200, s)

    finish(c, admin, uname, ws, a.keep)


def finish(c, admin, uname, ws, keep):
    if ws and not keep:
        t0 = time.time()
        s, _ = c.call("/api/v2/workspaces/%s/builds" % ws["id"], {"transition": "delete"}, token=admin)
        st = ""
        for _ in range(180):
            s2, w = c.call("/api/v2/workspaces/%s?include_deleted=true" % ws["id"], token=admin)
            st = (w or {}).get("latest_build", {}).get("status") if s2 == 200 else s2
            if st in ("deleted", "failed", 410, 404):
                break
            time.sleep(5)
        check("upstream", "workspace deleted", st in ("deleted", 410, 404), st, t0)
    if uname and not keep:
        s, _ = c.call("/api/v2/users/%s" % uname, method="DELETE", token=admin)
        check("upstream", "user deleted", s == 200, s)
    passed = sum(r["ok"] for r in RESULTS)
    print("\n%d/%d checks passed" % (passed, len(RESULTS)))
    sys.exit(0 if passed == len(RESULTS) else 1)


if __name__ == "__main__":
    main()
