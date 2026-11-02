"""Lock Down, live: a throwaway workspace (deleted afterwards) locked while it runs and while it is stopped, checked
through an admin's web terminal (as an admin inspecting a runaway agent would) and kubectl exec (as the workspace's
own user trying to undo it); every mode comes back after a restart; Freeze pauses everything (the agent too), its
snapshot holds the disk as it was, and lifting it resumes what was paused. Needs kubectl on the deployment's cluster.

  python3 lockdown_live.py --url https://coder.example.com [--ca ca.crt] [--admin-email ... --admin-password ...]
      [--template default] [--registry-url http://coder-image-registry.coder.svc:5000/v2/]

The network probe is a service inside the cluster (the image builder's registry): Lock Down must cut that too.
Exit status 1 when a check fails."""
import argparse, json, os, re, ssl, subprocess, sys, time, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from live import pty_echo  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--url", required=True); ap.add_argument("--ca")
ap.add_argument("--admin-email", default="admin@admin.com"); ap.add_argument("--admin-password", default="admin")
ap.add_argument("--template", default="default"); ap.add_argument("--name", default="verify-lockdown")
ap.add_argument("--registry-url", default="http://coder-image-registry.coder.svc:5000/v2/")
ARGS = ap.parse_args()
U = ARGS.url.rstrip("/")
CTX = ssl.create_default_context(cafile=ARGS.ca) if ARGS.ca else ssl.create_default_context()
NAME = ARGS.name
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print("%s %s%s" % ("PASS" if ok else "FAIL", name, (" - " + str(detail)) if detail else ""), flush=True)


def call(path, body=None, method=None, tok=None):
    h = {"Content-Type": "application/json", "X-Requested-With": "coder-ui"}
    if tok:
        h["Coder-Session-Token"] = tok
    r = urllib.request.Request(U + path, data=json.dumps(body).encode() if body is not None else None, headers=h,
                               method=method)
    try:
        with urllib.request.urlopen(r, timeout=180, context=CTX) as x:
            return x.status, json.loads(x.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:300]


def pod():
    return subprocess.run(["kubectl", "-n", "coder", "get", "pods", "-l", "com.coder.workspace.id=" + WID, "-o",
                           "jsonpath={.items[0].metadata.name}"], capture_output=True, text=True).stdout.strip()


def as_user(script):
    """The workspace's own user, in it (as an agent there would)."""
    p = subprocess.run(["kubectl", "-n", "coder", "exec", "-i", pod(), "-c", "dev", "--", "bash", "-s"],
                       input=script, capture_output=True, text=True, timeout=120)
    return (p.stdout + p.stderr).strip()


def admin_terminal(cmd):
    """An admin's web terminal (Coder's reconnecting PTY, through the agent's connection to Coder): the values the
    command printed (the last of each: the typed command's echo comes first)."""
    out = pty_echo(U, CTX, A, agent_id(), cmd + "; echo verify-pty-$((6*7))", timeout=60).decode(errors="replace")
    found = {}
    for k, v in re.findall(r"\b(NET|CODER|SUDO|RUNAWAY)=([0-9A-Za-z]+)", out):
        found[k] = v
    return found or {"raw": out[-300:]}


def agent_id():
    w = call("/api/v2/workspaces/" + WID, tok=A)[1]
    return [a for r in w["latest_build"]["resources"] for a in (r.get("agents") or [])][0]["id"]


def agent_state():
    w = call("/api/v2/workspaces/" + WID, tok=A)[1]
    ag = [a for r in w["latest_build"]["resources"] for a in (r.get("agents") or [])]
    return (ag[0]["status"], ag[0]["lifecycle_state"]) if ag else (None, None)


def wait_ready(timeout=600):
    t0 = time.time()
    while time.time() - t0 < timeout:
        w = call("/api/v2/workspaces/" + WID, tok=A)[1]
        ag = [a for r in w["latest_build"]["resources"] for a in (r.get("agents") or [])]
        if w["latest_build"]["status"] == "running" and ag and ag[0]["lifecycle_state"] == "ready":
            return time.time() - t0
        time.sleep(5)
    raise RuntimeError("not ready")


PROBE = ("echo NET=$(curl -s -m 5 -o /dev/null -w %{http_code} " + ARGS.registry_url + " 2>/dev/null; true) "
         "CODER=$(curl -s -m 8 -o /dev/null -w %{http_code} " + U + "/healthz 2>/dev/null; true) "
         "SUDO=$(sudo -n id -u 2>/dev/null || echo refused) "
         "RUNAWAY=$(pgrep -c -f 'sleep 7777' || echo 0)")


def as_root(script):
    """Root in the workspace container (kubectl exec: a new process, so not paused by Freeze)."""
    p = subprocess.run(["kubectl", "-n", "coder", "exec", "-i", pod(), "-c", "dev", "--", "bash", "-s"],
                       input=script, capture_output=True, text=True, timeout=120)
    return (p.stdout + p.stderr).strip()


def kubectl(*args, input=None):
    p = subprocess.run(["kubectl", "-n", "coder", *args], input=input, capture_output=True, text=True, timeout=300)
    return p.returncode, (p.stdout + p.stderr).strip()


def paused():
    """{pid: state} of the workspace container's processes, but PID 1 and the probe itself (ps, bash, awk)."""
    out = as_user("ps -eo pid=,stat=,comm= | awk '$1 != 1 && $3 !~ /^(ps|bash|awk)$/ { print $1, substr($2, 1, 1), $3 }'")
    return [ln.split() for ln in out.splitlines() if len(ln.split()) == 3]


def restart():
    """Coder's Restart: a stop, then a start; back when the new pod's workspace container runs."""
    old = pod()
    call("/api/v2/workspaces/%s/builds" % WID, {"transition": "stop"}, "POST", tok=A)
    for _ in range(120):
        if call("/api/v2/workspaces/" + WID, tok=A)[1]["latest_build"]["status"] == "stopped":
            break
        time.sleep(3)
    call("/api/v2/workspaces/%s/builds" % WID, {"transition": "start"}, "POST", tok=A)
    for _ in range(200):
        if pod() and pod() != old and ld_pods():
            return
        time.sleep(3)
    raise RuntimeError("not started again")


def ld_pods():
    rc, out = kubectl("get", "pods", "-l", "com.coder.workspace.id=" + WID, "-o",
                      "jsonpath={.items[0].status.containerStatuses[?(@.name=='dev')].state.running.startedAt}")
    return bool(out) and rc == 0


def annotation():
    return kubectl("get", "pod", pod(), "-o", "jsonpath={.metadata.annotations.platform\\.coder/lockdown}")[1]


def wait_for(fn, timeout=180, every=3):
    t0 = time.time()
    while time.time() - t0 < timeout:
        v = fn()
        if v:
            return v
        time.sleep(every)
    return fn()


def lock(mode):
    t0 = time.time()
    s, res = call("/__coder-ui/api/lockdown/" + WID, {"mode": mode}, "POST", tok=A)
    return s, res, round(time.time() - t0, 1)


A = call("/api/v2/users/login", {"email": ARGS.admin_email, "password": ARGS.admin_password})[1]["session_token"]
tpl = [t for t in call("/api/v2/templates", tok=A)[1] if t["name"] == ARGS.template][0]
s, w = call("/api/v2/users/me/workspaces", {"template_id": tpl["id"], "name": NAME}, tok=A)
WID = w["id"]
print("workspace", NAME, WID, "ready after %ds" % wait_ready())
try:
    # the stand-in for a runaway agent: a process started before the lock
    as_user("nohup sleep 7777 >/dev/null 2>&1 &")
    base = dict(re.findall(r"(\w+)=(\S+)", as_user(PROBE)))
    check("before: network, Coder and sudo work", base.get("NET") == "200" and base.get("CODER") == "200"
          and base.get("SUDO") == "0", base)

    # --- running: Complete
    s, res, took = lock("complete")
    check("Complete on the running workspace, at once", s == 200 and res.get("applied") == "now" and res.get("inForce")
          and not res.get("error"), "%s in %ss: %s" % (s, took, {k: res.get(k) for k in ("modes", "applied", "inForce", "error")}))
    st = agent_state()
    check("its agent stays connected", st == ("connected", "ready"), st)
    t = admin_terminal(PROBE.replace("echo ", "printf '%s ' ", 0) if False else PROBE)
    check("admin's web terminal opens while locked", "raw" not in t, t)
    check("network cut (the cluster's other services too)", t.get("NET") == "000", t.get("NET"))
    check("Coder still reachable", t.get("CODER") == "200", t.get("CODER"))
    check("sudo refused", t.get("SUDO") == "refused", t.get("SUDO"))
    check("the runaway process still runs, for inspection", t.get("RUNAWAY") == "1", t.get("RUNAWAY"))
    undo = as_user("sudo -n iptables -F 2>&1 | head -1; iptables -F 2>&1 | head -1; curl -s -m 5 -o /dev/null -w 'NET=%{http_code}' " + ARGS.registry_url + " 2>/dev/null; true")
    check("the workspace's user cannot undo it", "NET=000" in undo, undo.replace("\n", " | "))

    # --- running: Network only (sudo back, but even root cannot lift the network)
    s, res, took = lock("network")
    t = dict(re.findall(r"(\w+)=(\S+)", as_user(PROBE)))
    check("Network only: sudo works again, network still cut", s == 200 and t.get("SUDO") == "0"
          and t.get("NET") == "000" and t.get("CODER") == "200", t)
    undo = as_user("sudo -n iptables -F 2>&1 | head -1; curl -s -m 5 -o /dev/null -w 'NET=%{http_code}' " + ARGS.registry_url + " 2>/dev/null; true")
    check("...and root (sudo) in the workspace cannot flush its rules", "NET=000" in undo,
          undo.replace("\n", " | "))

    # --- running: Sudo only
    s, res, took = lock("sudo")
    t = dict(re.findall(r"(\w+)=(\S+)", as_user(PROBE)))
    check("Sudo Command only: network back, sudo refused", t.get("NET") == "200" and t.get("SUDO") == "refused", t)

    # --- lifted
    s, res, took = lock("off")
    t = dict(re.findall(r"(\w+)=(\S+)", as_user(PROBE)))
    check("lifted: everything back, the process kept running throughout", s == 200 and not res.get("locked")
          and t.get("NET") == "200" and t.get("SUDO") == "0" and t.get("RUNAWAY") == "1", t)

    # --- stopped: locked off, enforced from the start
    call("/api/v2/workspaces/%s/builds" % WID, {"transition": "stop"}, "POST", tok=A)
    for _ in range(60):
        if call("/api/v2/workspaces/" + WID, tok=A)[1]["latest_build"]["status"] == "stopped":
            break
        time.sleep(5)
    s, res, took = lock("complete")
    check("Complete on the stopped workspace: from its next start", s == 200 and res.get("applied") == "next start",
          {k: res.get(k) for k in ("modes", "applied", "running")})
    call("/api/v2/workspaces/%s/builds" % WID, {"transition": "start"}, "POST", tok=A)
    print("started again, ready after %ds" % wait_ready())
    u = dict(re.findall(r"(\w+)=(\S+)", as_user(PROBE)))
    check("at start (as the workspace's user): network cut, sudo refused, Coder reachable",
          u.get("NET") == "000" and u.get("SUDO") == "refused" and u.get("CODER") == "200", u)
    t = admin_terminal(PROBE)
    check("at start: network cut and sudo refused before anyone signed in, admin's terminal works",
          t.get("NET") == "000" and t.get("SUDO") == "refused" and t.get("CODER") == "200", t)
    init = subprocess.run(["kubectl", "-n", "coder", "logs", pod(), "-c", "lockdown"], capture_output=True, text=True).stdout.strip()
    check("the pod's init container set Network", "network on" in init, init)
    s, res, took = lock("off")
    t = dict(re.findall(r"(\w+)=(\S+)", as_user(PROBE)))
    check("lifted again, live", t.get("NET") == "200" and t.get("SUDO") == "0", t)

    # --- every lock comes back after a restart of the running workspace (Coder's Restart: stop, then start)
    for mode, want in (("network", {"NET": "000", "SUDO": "0"}), ("sudo", {"NET": "200", "SUDO": "refused"})):
        lock(mode)
        restart()
        wait_ready()
        u = dict(re.findall(r"(\w+)=(\S+)", as_user(PROBE)))
        check("%s: back after a restart" % mode, all(u.get(k) == v for k, v in want.items()), u)
    lock("off")
    u = dict(re.findall(r"(\w+)=(\S+)", as_user(PROBE)))
    check("lifted after the restarts", u.get("NET") == "200" and u.get("SUDO") == "0", u)

    # --- Freeze, running: everything paused where it is, the disk snapshotted
    as_user("echo frozen-$((6*7)) > ~/freeze-marker.txt; nohup sleep 8888 >/dev/null 2>&1 &")
    s, res, took = lock("freeze")
    check("Freeze on the running workspace, at once", s == 200 and res.get("applied") == "now" and res.get("inForce")
          and not res.get("error"), "%s in %ss: %s" % (s, took, {k: res.get(k) for k in ("modes", "inForce", "error")}))
    procs = paused()
    running = [p for p in procs if p[1] != "T"]
    check("every process in it is paused (Coder's agent too), but PID 1", procs and not running,
          "%d paused, running: %s" % (len(procs) - len(running), running[:5]))
    check("...the runaway process too", any(p[2] == "sleep" and p[1] == "T" for p in procs), procs[:3])
    st = wait_for(lambda: agent_state()[0] != "connected" and agent_state(), timeout=240, every=10)
    check("its agent is unreachable: nobody opens a session in it", st and st[0] != "connected", st)
    u = dict(re.findall(r"(\w+)=(\S+)", as_user(PROBE)))
    check("frozen means Complete too: network cut, sudo refused", u.get("NET") == "000" and u.get("SUDO") == "refused", u)
    snap = (res.get("snapshot") or {})
    check("a snapshot of its disk is being taken", snap.get("name") and not snap.get("error") and snap.get("processes", 0) > 3,
          snap)
    done = wait_for(lambda: (call("/__coder-ui/api/lockdown/" + WID, tok=A)[1].get("snapshot") or {}).get("status")
                    in ("ready", "failed") and call("/__coder-ui/api/lockdown/" + WID, tok=A)[1]["snapshot"], timeout=600,
                    every=5)
    check("the snapshot is ready", (done or {}).get("status") == "ready", done)
    if snap.get("kind") == "PersistentVolumeClaim":
        reader = "verify-freeze-read"
        kubectl("delete", "pod", reader, "--ignore-not-found", "--wait=true")
        spec = {"apiVersion": "v1", "kind": "Pod", "metadata": {"name": reader}, "spec": {
            "restartPolicy": "Never",
            "containers": [{"name": "read", "image": kubectl("get", "pod", pod(), "-o",
                                                              "jsonpath={.spec.containers[?(@.name=='dev')].image}")[1],
                            "command": ["sh", "-c", "cat /s/freeze-marker.txt; cat /s/.coder-freeze/README"],
                            "volumeMounts": [{"name": "s", "mountPath": "/s", "readOnly": True}]}],
            "volumes": [{"name": "s", "persistentVolumeClaim": {"claimName": snap["name"], "readOnly": True}}]}}
        kubectl("apply", "-f", "-", input=json.dumps(spec))
        wait_for(lambda: kubectl("get", "pod", reader, "-o", "jsonpath={.status.phase}")[1] in ("Succeeded", "Failed"),
                 timeout=180)
        out = kubectl("logs", reader)[1]
        kubectl("delete", "pod", reader, "--ignore-not-found", "--wait=false")
        check("the snapshot holds the disk as it was frozen", "frozen-42" in out and "Frozen by Lock Down" in out,
              out[:200])

    # --- frozen through a restart
    restart()
    again = wait_for(lambda: "freeze" in annotation(), timeout=180)
    procs = paused() if again else []
    check("frozen again after a restart (the watcher), before anyone can work in it",
          again and procs and not [p for p in procs if p[1] != "T"], "%s %s" % (annotation(), procs[:4]))

    # --- lifted: what was paused resumes, the agent comes back, the snapshot stays
    s, res, took = lock("off")
    procs = paused()
    check("lifted: every paused process runs again", procs and not [p for p in procs if p[1] == "T"], procs[:5])
    st = wait_for(lambda: agent_state() == ("connected", "ready") and agent_state(), timeout=240, every=5)
    check("its agent reconnects", st == ("connected", "ready"), st)
    u = dict(re.findall(r"(\w+)=(\S+)", as_user(PROBE + "; cat ~/freeze-marker.txt")))
    check("network and sudo back, its files as they were", u.get("NET") == "200" and u.get("SUDO") == "0", u)
    check("the snapshot is kept after lifting", (res.get("snapshot") or {}).get("name") == snap.get("name"),
          res.get("snapshot"))
    s, res = call("/__coder-ui/api/lockdown/%s/snapshot/delete" % WID, {}, "POST", tok=A)
    gone = wait_for(lambda: "NotFound" in kubectl("get", "pvc", snap.get("name") or "-")[1] or
                    "not found" in kubectl("get", "pvc", snap.get("name") or "-")[1], timeout=120)
    check("an admin deletes the snapshot", s == 200 and res.get("snapshot") is None and gone, res.get("snapshot"))
finally:
    lock("off")
    print("delete:", call("/api/v2/workspaces/%s/builds" % WID, {"transition": "delete"}, "POST", tok=A)[0])
    call("/api/v2/users/logout", {}, "POST", tok=A)
print("%d/%d checks passed" % (sum(results), len(results)))
sys.exit(0 if all(results) else 1)
