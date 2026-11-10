"""Traffic Control's connectivity tests run by the platform: a workspace emits "ACK" every second on a port to the
other ends of its tunnels, or listens on a port and counts each "ACK" that arrives. A test runs in the workspace pod's
workspace-tunnel container (the tunnel helper's, on the pod's own network) through the Kubernetes exec API, so it works
in workspaces whose agent blocks terminal access (browser workspaces), where the page cannot run it itself.

    GET    /__coder-ui/api/organizations/<org>/workspace-traffic-tests?workspace_id=<id>&...  each one's tests
    POST   /__coder-ui/api/organizations/<org>/workspace-traffic-tests/<workspace>/<emit|listen>  {port, addresses}
    DELETE /__coder-ui/api/organizations/<org>/workspace-traffic-tests/<workspace>/<emit|listen>

Only the workspace's owner and admins start, stop or read its tests. A test stops itself after MAX_SECONDS.
"""
import ipaddress
import re
import threading
import time
import urllib.parse

import kexec
import workspacetunnels

BASE = "/__coder-ui/api"
ROUTE = re.compile(r"^" + BASE + r"/organizations/([0-9a-f-]{36})/workspace-traffic-tests"
                   r"(?:/([0-9a-f-]{36})/(emit|listen))?$")
CONTAINER = "workspace-tunnel"
MAX_SECONDS = 900
MAX_ADDRESSES = 16
KUBE = None
NAMESPACE = "coder"
LOG = None
_LOCK = threading.Lock()
# (workspace id, kind) -> its test: port, sent, failed, received, running, error, pod, started.
TESTS = {}

EMIT = """import socket,sys,time
p=int(sys.argv[1])
while True:
  for a in sys.argv[2:]:
    try:
      s=socket.create_connection((a,p),timeout=1);s.sendall(b"ACK");s.close();print("SENT",a,flush=True)
    except Exception as e:
      print("FAIL",a,e,flush=True)
  time.sleep(1)"""

LISTEN = """import socket,sys
p=int(sys.argv[1]);s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.bind(("0.0.0.0",p));s.listen(16);print("LISTEN",p,flush=True)
while True:
  c,a=s.accept();c.settimeout(2)
  try:
    d=c.recv(4096)
  except Exception:
    d=b""
  c.close()
  if b"ACK" in d: print("RECV",a[0],flush=True)"""


def setup(kube, namespace, log=None):
    global KUBE, NAMESPACE, LOG
    KUBE, NAMESPACE, LOG = kube, namespace, log


def _pidfile(kind):
    return "/tmp/coder-traffic-%s.pid" % kind


def helper_pod(workspace_id):
    """The workspace's running pod that has the tunnel helper's container, or None."""
    label = urllib.parse.quote("com.coder.workspace.id=" + workspace_id)
    status, pods = KUBE.call("GET", "/api/v1/namespaces/%s/pods?labelSelector=%s" % (NAMESPACE, label))
    for pod in (pods.get("items") or []) if status == 200 and isinstance(pods, dict) else []:
        statuses = (pod.get("status") or {}).get("containerStatuses") or []
        helper = next((c for c in statuses if c.get("name") == CONTAINER), None)
        if (pod.get("status") or {}).get("phase") == "Running" and helper and (helper.get("state") or {}).get(
                "running") and not (pod.get("metadata") or {}).get("deletionTimestamp"):
            return pod["metadata"]["name"]
    return None


def _port(value):
    if type(value) is not int or not 1 <= value <= 65535:
        raise ValueError("Expected a port from 1 to 65535.")
    return value


def _addresses(value):
    """The tunnel addresses an emitter sends to: overlay addresses only, so a test reaches nothing else."""
    if not isinstance(value, list) or not 1 <= len(value) <= MAX_ADDRESSES:
        raise ValueError("Expected 1 to %d tunnel addresses." % MAX_ADDRESSES)
    out = []
    for item in value:
        try:
            address = ipaddress.ip_address(item)
        except (ValueError, TypeError):
            raise ValueError("Expected tunnel addresses.") from None
        if address not in workspacetunnels.NETWORK:
            raise ValueError("%s is not a workspace tunnel address." % address)
        out.append(str(address))
    return out


def _run(key, pod, started, kind, port, addresses):
    script = EMIT if kind == "emit" else LISTEN
    pidfile = _pidfile(kind)
    command = ["sh", "-c", 'kill "$(cat %s 2>/dev/null)" 2>/dev/null; echo $$ > %s; exec timeout %d python3 -u -c "$0" "$@"'
               % (pidfile, pidfile, MAX_SECONDS), script, str(port)] + addresses
    pending = [b""]

    def lines(data):
        pending[0] += data
        *complete, pending[0] = pending[0].split(b"\n")
        with _LOCK:
            test = TESTS.get(key)
            if not test or test["started"] != started:
                return
            for raw in complete:
                line = raw.decode(errors="replace").strip()
                if line.startswith("SENT"):
                    test["sent"] += 1
                elif line.startswith("FAIL"):
                    test["failed"] += 1
                elif line.startswith("RECV"):
                    test["received"] += 1
                elif line.startswith("LISTEN"):
                    test["listening"] = True

    error = None
    try:
        # Each wait for output may last the whole test: a listener prints nothing until an ACK arrives.
        code, err = kexec.exec_stream(KUBE, NAMESPACE, pod, CONTAINER, command, lines, timeout=MAX_SECONDS + 30)
        if code not in (0, 124, 143) and err.strip():
            error = err.strip().splitlines()[-1][:300]
    except Exception as exc:  # the exec stream failed: the test is over
        error = str(exc)[:300]
    with _LOCK:
        test = TESTS.get(key)
        if test and test["started"] == started:
            test["running"] = False
            test["error"] = test.get("error") or error


def start(workspace_id, kind, port, addresses):
    pod = helper_pod(workspace_id)
    if not pod:
        raise LookupError("This workspace has no running tunnel helper to run the test in.")
    stop(workspace_id, kind)
    key = (workspace_id, kind)
    test = {"kind": kind, "port": port, "sent": 0, "failed": 0, "received": 0, "listening": False,
            "running": True, "error": None, "pod": pod, "started": time.time()}
    with _LOCK:
        TESTS[key] = test
    threading.Thread(target=_run, args=(key, pod, test["started"], kind, port, addresses), daemon=True,
                     name="traffic-test-%s-%s" % (kind, workspace_id[:8])).start()
    return public(test)


def stop(workspace_id, kind):
    key = (workspace_id, kind)
    with _LOCK:
        test = TESTS.pop(key, None)
    if not test:
        return None
    pidfile = _pidfile(kind)
    try:
        kexec.exec_in(KUBE, NAMESPACE, test["pod"], CONTAINER,
                      ["sh", "-c", 'kill "$(cat %s 2>/dev/null)" 2>/dev/null; rm -f %s' % (pidfile, pidfile)], timeout=10)
    except Exception as exc:
        if LOG:
            LOG("traffic test stop in %s failed: %s" % (test["pod"], exc))
    test["running"] = False
    return public(test)


def public(test):
    return {k: test[k] for k in ("kind", "port", "sent", "failed", "received", "listening", "running", "error")}


def listing(workspace_ids):
    with _LOCK:
        return {wid: {kind: public(t) for (w, kind), t in TESTS.items() if w == wid} for wid in workspace_ids}


def handle(h, method, path, query=""):
    match = ROUTE.fullmatch(path)
    if not match:
        return False
    try:
        if method != "GET" and not h.csrf_ok():
            raise PermissionError("Request rejected (cross-site protection).")
        user, err = h.user()
        if err:
            return True
        oid = workspacetunnels.identifier(match.group(1))
        wid, kind = match.group(2), match.group(3)
        if method == "GET" and not wid:
            ids = [workspacetunnels.identifier(v) for v in urllib.parse.parse_qs(query).get("workspace_id", [])][:64]
            for each in ids:
                workspacetunnels.authorize(h.token(), user, oid, each, update=False)
            h.send_json(200, {"tests": listing(ids)})
        elif method == "POST" and wid:
            wid = workspacetunnels.identifier(wid)
            workspacetunnels.authorize(h.token(), user, oid, wid)
            body = workspacetunnels.read_json(h)
            port = _port(body.get("port"))
            addresses = _addresses(body.get("addresses")) if kind == "emit" else []
            h.send_json(200, {"test": start(wid, kind, port, addresses)})
        elif method == "DELETE" and wid:
            wid = workspacetunnels.identifier(wid)
            workspacetunnels.authorize(h.token(), user, oid, wid)
            h.send_json(200, {"test": stop(wid, kind)})
        else:
            h.send_json(405, {"error": "Method not allowed."})
    except PermissionError as error:
        h.send_json(403, {"error": str(error)})
    except LookupError as error:
        h.send_json(404, {"error": str(error)})
    except (ValueError, TypeError) as error:
        h.send_json(400, {"error": str(error)})
    except Exception:
        h.send_json(503, {"error": "The connectivity test could not be run."})
    return True
