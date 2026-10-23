"""Provisioner Daemons: stuck jobs, the terraform processes behind them, and a re-kick.

Coder's provisioners run in its own pods (the built-in daemons of `coder server`); each job is a terraform process
there. When a workspace is deleted while its build waits on a node that cannot take it (an over-allocated node), the
build's terraform can wait forever: the daemon stays busy with it, never failing it and never taking the next job.

  GET  /__coder-ui/api/provisioners          admins: the daemons, the jobs running or waiting (how long each has run,
                                             stuck when longer than STUCK_AFTER), and in each Coder pod its terraform
                                             processes (how old; defunct ones are zombies their daemon never reaped)
  POST /__coder-ui/api/provisioners/rekick   admins: {jobs: [id]} those jobs cancelled through Coder, then in every
                                             Coder pod the terraform processes that started before every job still
                                             running stopped (TERM, then KILL): the daemons fail them and take the
                                             next job
  POST /__coder-ui/api/provisioners/restart  admins: {pod} that Coder pod deleted, its Deployment starts another: the
                                             last resort for a daemon that a re-kick did not free

The processes are read and stopped through the Kubernetes exec API (kexec.py) in the Coder pods'
coder container, with the shell and busybox tools the Coder image has.
"""
import datetime
import os
import re
import time
import urllib.parse

import kexec

BASE = "/__coder-ui"
NAMESPACE = os.environ.get("CODER_NAMESPACE", "coder")
POD_SELECTOR = os.environ.get("CODER_POD_SELECTOR", "app.kubernetes.io/name=coder")
CONTAINER = "coder"
STUCK_AFTER = int(os.environ.get("PROVISIONER_STUCK_AFTER", "600"))  # seconds a job runs before it counts as stuck
CANCEL_WAIT = 15  # seconds a re-kick waits for cancelled jobs to stop before it stops their processes
TERM_WAIT = 3  # seconds between TERM and KILL

# Each terraform process in the pod: "<pid> <state> <age seconds> <arguments>"; state Z is a defunct (zombie) one.
SCAN = r"""hz=$(getconf CLK_TCK 2>/dev/null || echo 100)
up=$(cut -d. -f1 /proc/uptime)
for d in /proc/[0-9]*; do
  [ "$(cat $d/comm 2>/dev/null)" = terraform ] || continue
  set -- $(cat $d/stat 2>/dev/null)
  [ -n "$3" ] || continue
  echo "${d#/proc/} $3 $(( up - ${22} / hz )) $(tr '\0' ' ' < $d/cmdline 2>/dev/null | cut -c1-200)"
done
"""

LOG = KUBE = ADMIN_ROLES = CODER_GET = CODER_SEND = None


def setup(log, kube, admin_roles, coder_get, coder_send):
    """coder_get(token, path) and coder_send(token, method, path, body) call Coder's API as the admin."""
    global LOG, KUBE, ADMIN_ROLES, CODER_GET, CODER_SEND
    LOG, KUBE, ADMIN_ROLES, CODER_GET, CODER_SEND = log, kube, set(admin_roles), coder_get, coder_send


# --------------------------------------------------------------------------- exec in a pod (WebSocket)
_Frames = kexec.Frames


def exec_in(pod, command, timeout=30):
    """(exit code, stdout, stderr) of command (a list) in the pod's coder container."""
    return kexec.exec_in(KUBE, NAMESPACE, pod, CONTAINER, command, timeout=timeout)


# --------------------------------------------------------------------------- the report
def coder_pods():
    status, pods = KUBE.call("GET", "/api/v1/namespaces/%s/pods?labelSelector=%s"
                             % (NAMESPACE, urllib.parse.quote(POD_SELECTOR)))
    if status != 200:
        raise RuntimeError("could not list Coder's pods (HTTP %s)" % status)
    return [p["metadata"]["name"] for p in pods.get("items") or []
            if (p.get("status") or {}).get("phase") == "Running" and not p["metadata"].get("deletionTimestamp")]


def parse_processes(text):
    """[{pid, state, defunct, ageSeconds, command}] from SCAN's lines."""
    out = []
    for line in text.splitlines():
        m = re.match(r"^(\d+) (\S) (-?\d+) ?(.*)$", line.strip())
        if not m:
            continue
        args = m.group(4).strip()
        sub = next((a for a in args.split()[1:] if not a.startswith("-")), "")
        out.append({"pid": int(m.group(1)), "state": m.group(2), "defunct": m.group(2) == "Z",
                    "ageSeconds": max(0, int(m.group(3))), "command": sub, "args": args})
    return out


def processes():
    """{pod: [process]} or {pod: {"error": ...}}."""
    found = {}
    for pod in coder_pods():
        try:
            code, out, err = exec_in(pod, ["sh", "-c", SCAN])
            found[pod] = parse_processes(out) if code == 0 else {"error": (err or out).strip()[:300] or "exit %d" % code}
        except Exception as e:  # noqa: BLE001
            found[pod] = {"error": str(e)[:300]}
    return found


def parse_time(s):
    if not s:
        return None
    try:
        return datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def organizations(token):
    status, orgs = CODER_GET(token, "/api/v2/organizations")
    if status != 200 or not isinstance(orgs, list):
        raise RuntimeError("could not read Coder's organizations (HTTP %s)" % status)
    return orgs


def jobs(token, now=None):
    """The jobs waiting, running or being cancelled, every organization's, the oldest first."""
    now = now or time.time()
    out = []
    for org in organizations(token):
        status, listed = CODER_GET(token, "/api/v2/organizations/%s/provisionerjobs?status=pending,running,canceling&limit=100"
                                   % org["id"])
        if status != 200 or not isinstance(listed, list):
            continue
        for j in listed:
            started = parse_time(j.get("started_at"))
            created = parse_time(j.get("created_at"))
            meta = j.get("metadata") or {}
            # running, or cancelling without end (a cancelled build whose terraform never stops)
            running = j.get("status") in ("running", "canceling")
            age = int(now - (started or created or now))
            out.append({
                "id": j.get("id"), "organization": org.get("name"), "status": j.get("status"), "type": j.get("type"),
                "startedAt": j.get("started_at"), "createdAt": j.get("created_at"), "ageSeconds": max(0, age),
                "stuck": running and age > STUCK_AFTER, "workerId": j.get("worker_id"),
                "workspace": meta.get("workspace_name"), "template": meta.get("template_name"),
                "workspaceBuildId": (j.get("input") or {}).get("workspace_build_id"),
                "templateVersionId": (j.get("input") or {}).get("template_version_id"),
            })
    out.sort(key=lambda j: -j["ageSeconds"])
    return out


def daemons(token):
    out = []
    for org in organizations(token):
        status, listed = CODER_GET(token, "/api/v2/organizations/%s/provisionerdaemons" % org["id"])
        if status != 200 or not isinstance(listed, list):
            continue
        for d in listed:
            current = d.get("current_job") or {}
            out.append({"id": d.get("id"), "name": d.get("name"), "organization": org.get("name"),
                        "status": d.get("status"), "lastSeenAt": d.get("last_seen_at"),
                        "currentJob": current.get("id"), "version": d.get("version")})
    return out


def report(token):
    js = jobs(token)
    return {"stuckAfterSeconds": STUCK_AFTER, "jobs": js, "daemons": daemons(token), "pods": processes(),
            "stuck": sum(1 for j in js if j["stuck"])}


# --------------------------------------------------------------------------- the re-kick
def cancel(token, job):
    if job.get("workspaceBuildId"):
        path = "/api/v2/workspacebuilds/%s/cancel" % job["workspaceBuildId"]
    elif job.get("templateVersionId"):
        path = "/api/v2/templateversions/%s/cancel" % job["templateVersionId"]
    else:
        return "no build or template version to cancel"
    status, out = CODER_SEND(token, "PATCH", path, {})
    if status in (200, 204):
        return None
    msg = out.get("message") if isinstance(out, dict) else str(out)
    return "HTTP %s: %s" % (status, (msg or "")[:200])


def rekick(token, job_ids, user):
    before = {j["id"]: j for j in jobs(token)}
    chosen = [before[i] for i in job_ids if i in before]
    if not chosen:
        raise LookupError("None of those jobs is running or waiting any more.")
    cancelled = []
    for job in chosen:
        err = cancel(token, job)
        cancelled.append({"id": job["id"], "workspace": job.get("workspace"), "error": err})
    # the jobs that stop by themselves once cancelled need nothing more
    deadline = time.time() + CANCEL_WAIT
    left = {j["id"] for j in chosen}
    while left and time.time() < deadline:
        time.sleep(2)
        left &= {j["id"] for j in jobs(token)}
    # what is left: their terraform. A process that started before every job still running (and not chosen) can only
    # be one of the chosen ones'.
    now = time.time()
    others = [j for j in jobs(token, now) if j["id"] not in {c["id"] for c in chosen} and j["status"] != "pending"]
    newest_other = min((j["ageSeconds"] for j in others), default=None)
    stopped, errors = [], []
    if left:
        for pod, procs in processes().items():
            if isinstance(procs, dict):
                errors.append("%s: %s" % (pod, procs["error"]))
                continue
            victims = [p for p in procs if not p["defunct"] and (newest_other is None or p["ageSeconds"] > newest_other + 5)]
            if not victims:
                continue
            pids = " ".join(str(p["pid"]) for p in victims)
            code, out, err = exec_in(pod, ["sh", "-c", "kill -TERM %s 2>/dev/null; sleep %d; kill -KILL %s 2>/dev/null; true"
                                           % (pids, TERM_WAIT, pids)], timeout=TERM_WAIT + 30)
            if code != 0:
                errors.append("%s: %s" % (pod, (err or out).strip()[:200]))
            stopped += [dict(p, pod=pod) for p in victims]
    if LOG:
        LOG(event="provisioners-rekick", by=user, jobs=[c["id"] for c in chosen], stopped=len(stopped), errors=errors)
    time.sleep(2 if stopped else 0)
    still = {j["id"] for j in jobs(token)} & {c["id"] for c in chosen}
    return {"cancelled": cancelled, "stopped": stopped, "errors": errors, "stillRunning": sorted(still)}


def restart(pod, user):
    if pod not in coder_pods():
        raise LookupError("No running Coder pod %s." % pod)
    status, out = KUBE.call("DELETE", "/api/v1/namespaces/%s/pods/%s" % (NAMESPACE, pod))
    if status not in (200, 202):
        raise RuntimeError("could not delete %s (HTTP %s)" % (pod, status))
    if LOG:
        LOG(event="provisioners-restart", by=user, pod=pod)
    return {"restarted": pod}


# --------------------------------------------------------------------------- HTTP
def handle(h, method, path, query):
    """True when it answered."""
    if not path.startswith(BASE + "/api/provisioners"):
        return False
    if method == "POST" and not h.csrf_ok():
        h.send_json(403, {"error": "Request rejected (cross-site protection)."})
        return True
    user, err = h.user(admin=True)
    if err:
        return True
    try:
        if path == BASE + "/api/provisioners" and method == "GET":
            return h.send_json(200, report(h.token())) or True
        if method != "POST":
            return h.send_json(405, {"error": "method not allowed"}) or True
        payload = h.body()
        if not isinstance(payload, dict):
            raise ValueError("Expected a JSON object.")
        if path == BASE + "/api/provisioners/rekick":
            ids = payload.get("jobs")
            if not isinstance(ids, list) or not ids or not all(isinstance(i, str) for i in ids):
                raise ValueError("jobs: the ids of the jobs to re-kick.")
            return h.send_json(200, rekick(h.token(), ids, user["username"])) or True
        if path == BASE + "/api/provisioners/restart":
            return h.send_json(200, restart(str(payload.get("pod") or ""), user["username"])) or True
        return h.send_json(404, {"error": "not found"}) or True
    except ValueError as e:
        return h.send_json(400, {"error": str(e)}) or True
    except LookupError as e:
        return h.send_json(404, {"error": str(e)}) or True
    except Exception as e:  # noqa: BLE001
        if LOG:
            LOG(event="provisioners-failed", path=path, error=str(e)[:300])
        return h.send_json(503, {"error": str(e)[:300]}) or True
