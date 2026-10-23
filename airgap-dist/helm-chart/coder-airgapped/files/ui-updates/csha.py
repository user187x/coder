"""code-server high availability (a template's code_server_ha): each workspace's code-server is a global singleton -
one active instance across every connected cluster - kept by an operator, reached through relays, and every piece of
its state in the central PostgreSQL (Coder's own database, schema code_server_ha).

  python3 csha.py operator   the code-server-replicator, one per cluster (the chart's codeServerHA): registers its
                             cluster (a heartbeat), and for each workspace that wants code-server keeps exactly one
                             instance - a pod running code-server beside a station relay - holding the workspace's
                             lease in Postgres. A failed instance is replaced (a new generation); when the cluster that
                             holds a lease stops renewing it, another connected, healthy cluster takes the workspace
                             over and starts its instance there. Old generations are fenced off: deleted, and refused
                             by every relay.
  python3 csha.py front      the relay in a workspace's pod (a sidecar; code-server never runs in the workspace itself):
                             listens where code-server would (127.0.0.1:13337, the template's code-server app),
                             registers the workspace (idempotently: the same call again changes nothing) with the
                             workspace agent's token as proof, and pipes every connection to the active instance -
                             in this cluster by its Service, in another by the endpoint its cluster published.
  python3 csha.py station    the relay beside code-server in an instance's pod (0.0.0.0:8080): takes connections that
                             carry its instance's token, pipes them to code-server on 127.0.0.1, or - once its instance
                             is superseded - on to the active one; and keeps code-server's user state (settings,
                             keybindings, snippets, the extensions list) in Postgres.
  python3 csha.py restore    (the instance's init container) that state, back into code-server's user data folder.

Postgres is the only source of truth: the operators read and write the schema directly (as the database's owner); the
relays log in as the role code_server_relay, which may only call the schema's functions - and those check the caller:
a front its workspace agent's token (Coder's workspace_agents), a station its instance's token.

Relays speak plain TCP with one line first ("CSHA1 <workspace> <token>\\n"), so HTTP and code-server's WebSockets pass
through untouched.
"""
import asyncio
import hmac
import json
import os
import re
import secrets
import socket
import sys
import time
import urllib.parse

import pgwire

NAMESPACE = os.environ.get("CSHA_NAMESPACE", "coder")
CLUSTER = os.environ.get("CSHA_CLUSTER") or "primary"
DB_URI = os.environ.get("CSHA_DB", "")
DB_CA = os.environ.get("CSHA_DB_CA") or None
LEASE_SECONDS = int(os.environ.get("CSHA_LEASE_SECONDS", "30") or 30)
# another cluster waits this much past a lease's end before it takes the workspace over (the home cluster: none)
TAKEOVER_GRACE = int(os.environ.get("CSHA_TAKEOVER_GRACE", "30") or 30)
HEARTBEAT_TTL = int(os.environ.get("CSHA_HEARTBEAT_TTL", "45") or 45)
# a workspace taken over by another cluster goes back to its own once that has answered again for this long (its
# home volume is there; the other cluster's instance had a folder of its own)
FAILBACK_AFTER = int(os.environ.get("CSHA_FAILBACK_SECONDS", "60") or 60)
ROUND_SECONDS = float(os.environ.get("CSHA_ROUND_SECONDS", "5") or 5)
# how another cluster reaches this one's instances: "" (none: this cluster takes no workspace of another), or a
# pattern of {service}, {namespace}, {workspace} and {port} - a cross-cluster Service name, a gateway's TCP route
ENDPOINT_EXTERNAL = os.environ.get("CSHA_ENDPOINT_EXTERNAL", "")
RELAY_IMAGE = os.environ.get("CSHA_RELAY_IMAGE", "")
STATION_PORT = 8080
CODE_SERVER_PORT = 13337
FRONT_LISTEN = os.environ.get("CSHA_FRONT_LISTEN", "127.0.0.1:%d" % CODE_SERVER_PORT)
PREAMBLE = "CSHA1"
STATE_FILES = re.compile(r"^(User/(settings|keybindings)\.json|User/snippets/[\w.-]+\.(json|code-snippets)|"
                         r"extensions/extensions\.json)$")
STATE_MAX = 1024 * 1024
USER_DATA = os.environ.get("CSHA_USER_DATA", "/home/coder/.local/share/code-server")
POD_PREFIX = "coder-cs-"
LABEL = "coder.code-server/workspace"
GEN_LABEL = "coder.code-server/generation"
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def log(**kw):
    print(json.dumps(dict({"time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "cluster": CLUSTER}, **kw)),
          flush=True)


# ---------------------------------------------------------------------------------------------------- the schema
SCHEMA = r"""
CREATE SCHEMA IF NOT EXISTS code_server_ha;
CREATE TABLE IF NOT EXISTS code_server_ha.clusters (
  name text PRIMARY KEY,
  heartbeat_at timestamptz NOT NULL,
  external boolean NOT NULL DEFAULT false,
  version text
);
ALTER TABLE code_server_ha.clusters ADD COLUMN IF NOT EXISTS since timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS code_server_ha.instances (
  workspace_id uuid PRIMARY KEY,
  owner text,
  home_cluster text NOT NULL,
  home_namespace text NOT NULL,
  home_node text,
  home_pvc text,
  image text NOT NULL,
  folder text,
  registered_at timestamptz NOT NULL DEFAULT now(),
  seen_at timestamptz NOT NULL DEFAULT now(),
  active_cluster text,
  pod text,
  endpoint_local text,
  endpoint_external text,
  generation bigint NOT NULL DEFAULT 0,
  token text,
  state text NOT NULL DEFAULT 'pending',
  lease_expires timestamptz,
  message text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS code_server_ha.state (
  workspace_id uuid NOT NULL,
  path text NOT NULL,
  content bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, path)
);
CREATE TABLE IF NOT EXISTS code_server_ha.events (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  workspace_id uuid,
  cluster text,
  event text NOT NULL,
  detail text
);

-- A front relay: its workspace, proven by the workspace agent's token (Coder's own registry of agents); registered
-- again at every call (the same values: nothing changes), and where the active instance is.
CREATE OR REPLACE FUNCTION code_server_ha.front_register(p_agent_token uuid, p_workspace uuid, p_cluster text,
    p_namespace text, p_node text, p_image text, p_folder text)
  RETURNS TABLE(active_cluster text, endpoint_local text, endpoint_external text, token text, generation bigint,
                state text, message text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $f$
DECLARE ws uuid;
BEGIN
  SELECT wb.workspace_id INTO ws
    FROM public.workspace_agents a
    JOIN public.workspace_resources r ON r.id = a.resource_id
    JOIN public.workspace_builds wb ON wb.job_id = r.job_id
   WHERE a.auth_token = p_agent_token
   ORDER BY wb.build_number DESC LIMIT 1;
  IF ws IS NULL OR ws <> p_workspace THEN
    RAISE EXCEPTION 'not this workspace''s agent' USING ERRCODE = '42501';
  END IF;
  INSERT INTO code_server_ha.instances AS i (workspace_id, owner, home_cluster, home_namespace, home_node, home_pvc,
      image, folder)
    SELECT p_workspace, u.username, p_cluster, p_namespace, p_node, 'coder-' || p_workspace || '-home', p_image,
           p_folder
      FROM public.workspaces w JOIN public.users u ON u.id = w.owner_id WHERE w.id = p_workspace
  ON CONFLICT (workspace_id) DO UPDATE SET home_cluster = EXCLUDED.home_cluster,
      home_namespace = EXCLUDED.home_namespace, home_node = EXCLUDED.home_node, image = EXCLUDED.image,
      folder = EXCLUDED.folder, seen_at = now(),
      registered_at = CASE WHEN i.home_node IS DISTINCT FROM EXCLUDED.home_node THEN now() ELSE i.registered_at END;
  RETURN QUERY SELECT i.active_cluster, i.endpoint_local, i.endpoint_external, i.token, i.generation, i.state,
                      i.message
                 FROM code_server_ha.instances i WHERE i.workspace_id = p_workspace;
END $f$;

-- Every token an instance of the workspace ever had (a superseded station may still pass connections on).
CREATE TABLE IF NOT EXISTS code_server_ha.tokens (
  workspace_id uuid NOT NULL,
  token text NOT NULL,
  generation bigint NOT NULL,
  PRIMARY KEY (workspace_id, token)
);

-- A station (with a token of one of the workspace's instances): whether its instance is the active one, else
-- where that is and its token (to pass connections on). Nothing for a token the workspace never had.
CREATE OR REPLACE FUNCTION code_server_ha.station_check(p_workspace uuid, p_token text)
  RETURNS TABLE(is_current boolean, active_cluster text, endpoint_local text, endpoint_external text,
                active_token text, generation bigint)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $f$
BEGIN
  RETURN QUERY SELECT i.token = p_token, i.active_cluster, i.endpoint_local, i.endpoint_external, i.token,
                      i.generation
                 FROM code_server_ha.instances i
                WHERE i.workspace_id = p_workspace
                  AND EXISTS (SELECT 1 FROM code_server_ha.tokens t
                               WHERE t.workspace_id = p_workspace AND t.token = p_token);
END $f$;

-- A station keeps code-server's user state; a new instance reads it back.
CREATE OR REPLACE FUNCTION code_server_ha.state_put(p_workspace uuid, p_token text, p_path text, p_content bytea)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $f$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM code_server_ha.instances i WHERE i.workspace_id = p_workspace AND i.token = p_token)
  THEN
    RAISE EXCEPTION 'not the active instance' USING ERRCODE = '42501';
  END IF;
  IF length(p_content) > 1048576 OR p_path !~ '^(User/|extensions/)' OR p_path ~ '\.\.' THEN
    RAISE EXCEPTION 'not code-server state' USING ERRCODE = '22023';
  END IF;
  INSERT INTO code_server_ha.state (workspace_id, path, content, updated_at)
    VALUES (p_workspace, p_path, p_content, now())
  ON CONFLICT (workspace_id, path) DO UPDATE SET content = EXCLUDED.content, updated_at = now()
    WHERE code_server_ha.state.content IS DISTINCT FROM EXCLUDED.content;
END $f$;

CREATE OR REPLACE FUNCTION code_server_ha.state_get(p_workspace uuid, p_token text)
  RETURNS TABLE(path text, content bytea, updated_at timestamptz)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $f$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM code_server_ha.tokens t WHERE t.workspace_id = p_workspace AND t.token = p_token) THEN
    RAISE EXCEPTION 'not an instance of this workspace' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT s.path, s.content, s.updated_at FROM code_server_ha.state s WHERE s.workspace_id = p_workspace;
END $f$;
"""

GRANTS = r"""
REVOKE ALL ON SCHEMA code_server_ha FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA code_server_ha FROM PUBLIC;
DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'code_server_relay') THEN
    GRANT USAGE ON SCHEMA code_server_ha TO code_server_relay;
    GRANT EXECUTE ON FUNCTION code_server_ha.front_register(uuid, uuid, text, text, text, text, text),
                              code_server_ha.station_check(uuid, text),
                              code_server_ha.state_put(uuid, text, text, bytea),
                              code_server_ha.state_get(uuid, text) TO code_server_relay;
  END IF;
END $g$;
"""


def statements(sql):
    """The schema's statements one by one (pgwire's extended protocol takes one at a time); $f$ bodies kept whole."""
    out, cur, in_body = [], [], False
    for line in sql.strip().split("\n"):
        if line.strip().startswith("--") and not in_body:
            continue
        cur.append(line)
        if line.count("$f$") % 2 == 1 or line.count("$g$") % 2 == 1:
            in_body = not in_body
        if not in_body and line.rstrip().endswith(";"):
            out.append("\n".join(cur).strip())
            cur = []
    if "".join(cur).strip():
        out.append("\n".join(cur).strip())
    return out


def ensure_schema(db):
    for stmt in statements(SCHEMA) + statements(GRANTS):
        db.query(stmt)


def wait_for_schema(db, timeout=900, sleep=time.sleep):
    """ensure_schema once the database takes connections: on a fresh install this starts before CloudNativePG's
    primary does (refused, or "starting up"), and waiting here beats a crash loop's growing back-off."""
    delay, waited = 2, 0
    while True:
        try:
            return ensure_schema(db)
        except (OSError, pgwire.PgError) as e:  # ConnectionError is an OSError
            # not up yet (refused, SQLSTATE 57P03 cannot_connect_now, class 08), or the other replica creating
            # the same objects this instant (CREATE ... IF NOT EXISTS races: 23505, 42P06, 42P07, 42710 - the
            # statements are idempotent, so another round finds them); any other error is real
            code = e.fields.get("C", "") if isinstance(e, pgwire.PgError) else ""
            starting = not code or code[:3] in ("57P", "08") or code in ("23505", "42P06", "42P07", "42710")
            if waited >= timeout or not starting:
                raise
            log(event="waiting for the database", error=str(e)[:200], waited=waited)
            sleep(delay)
            waited += delay
            delay = min(delay * 2, 15)


# ---------------------------------------------------------------------------------------------------- Kubernetes
class Kube:
    """The in-cluster API (the pod's service account)."""

    def __init__(self):
        import ssl
        import http.client
        self.http = http.client
        self.host = os.environ.get("KUBERNETES_SERVICE_HOST", "kubernetes.default.svc")
        self.port = int(os.environ.get("KUBERNETES_SERVICE_PORT", "443"))
        sa = "/var/run/secrets/kubernetes.io/serviceaccount"
        self.token_file = sa + "/token"
        self.ctx = ssl.create_default_context(cafile=sa + "/ca.crt") if os.path.exists(sa + "/ca.crt") else None

    def call(self, method, path, body=None):
        with open(self.token_file) as f:
            token = f.read().strip()
        conn = self.http.HTTPSConnection(self.host, self.port, context=self.ctx, timeout=30)
        try:
            data = json.dumps(body).encode() if body is not None else None
            headers = {"Authorization": "Bearer " + token, "Accept": "application/json"}
            if data is not None:
                headers["Content-Type"] = "application/json"
            conn.request(method, path, body=data, headers=headers)
            r = conn.getresponse()
            raw = r.read()
            try:
                return r.status, json.loads(raw) if raw else None
            except ValueError:
                return r.status, raw.decode(errors="replace")
        finally:
            conn.close()


# ---------------------------------------------------------------------------------------------------- the operator
def short(workspace_id):
    return workspace_id.replace("-", "")[:12]


def service_name(workspace_id):
    return POD_PREFIX + short(workspace_id)


def pod_name(workspace_id, generation):
    return "%s%s-g%d" % (POD_PREFIX, short(workspace_id), generation)


def local_endpoint(workspace_id, namespace=NAMESPACE):
    return "%s.%s.svc:%d" % (service_name(workspace_id), namespace, STATION_PORT)


def external_endpoint(workspace_id, namespace=NAMESPACE, pattern=ENDPOINT_EXTERNAL):
    if not pattern:
        return None
    return pattern.format(service=service_name(workspace_id), namespace=namespace, workspace=workspace_id,
                          port=STATION_PORT)


def instance_pod(inst, generation, token, home, cluster=CLUSTER, namespace=NAMESPACE):
    """An instance: code-server (the workspace's image) on 127.0.0.1 beside its station relay, the workspace's own
    home volume where this is its cluster (on its node: the volume is ReadWriteOnce), else a folder of its own - the
    user's state from Postgres either way."""
    ws = inst["workspace_id"]
    labels = {"app.kubernetes.io/name": "coder-code-server", "app.kubernetes.io/part-of": "coder",
              LABEL: ws, GEN_LABEL: str(generation)}
    env = [{"name": "CSHA_WORKSPACE", "value": ws}, {"name": "CSHA_CLUSTER", "value": cluster},
           {"name": "CSHA_NAMESPACE", "value": namespace}, {"name": "CSHA_TOKEN", "value": token},
           {"name": "CSHA_DB", "valueFrom": {"secretKeyRef": {"name": "coder-code-server-ha-relay", "key": "uri"}}},
           {"name": "HOME", "value": "/home/coder"}]
    secure = {"allowPrivilegeEscalation": False, "capabilities": {"drop": ["ALL"]}}
    folder = inst.get("folder") or "/home/coder"
    if not home:
        folder = "/home/coder"
    spec = {
        "restartPolicy": "Always", "automountServiceAccountToken": False, "enableServiceLinks": False,
        "securityContext": {"runAsNonRoot": True, "runAsUser": 1000, "runAsGroup": 1000, "fsGroup": 1000,
                            "seccompProfile": {"type": "RuntimeDefault"}},
        "initContainers": [{"name": "restore", "image": RELAY_IMAGE, "imagePullPolicy": "IfNotPresent",
                            "command": ["python3", "/app/csha.py", "restore"], "env": env, "securityContext": secure,
                            "volumeMounts": [{"name": "home", "mountPath": "/home/coder"}]}],
        "containers": [
            {"name": "code-server", "image": inst["image"], "imagePullPolicy": "IfNotPresent",
             "command": ["code-server", "--auth", "none", "--bind-addr", "127.0.0.1:%d" % CODE_SERVER_PORT,
                         "--disable-telemetry", "--disable-update-check", folder],
             "env": [{"name": "HOME", "value": "/home/coder"}], "securityContext": secure,
             "resources": {"requests": {"cpu": "100m", "memory": "256Mi"}, "limits": {"memory": "2Gi"}},
             "volumeMounts": [{"name": "home", "mountPath": "/home/coder"}]},
            {"name": "station", "image": RELAY_IMAGE, "imagePullPolicy": "IfNotPresent",
             "command": ["python3", "/app/csha.py", "station"], "env": env, "securityContext": secure,
             "ports": [{"name": "station", "containerPort": STATION_PORT}],
             "readinessProbe": {"tcpSocket": {"port": STATION_PORT}, "periodSeconds": 5},
             "resources": {"requests": {"cpu": "10m", "memory": "32Mi"}, "limits": {"memory": "128Mi"}},
             "volumeMounts": [{"name": "home", "mountPath": "/home/coder"}]},
        ],
        "volumes": [{"name": "home", "persistentVolumeClaim": {"claimName": inst["home_pvc"]}} if home
                    else {"name": "home", "emptyDir": {"sizeLimit": "5Gi"}}],
    }
    if home and inst.get("home_node"):
        spec["affinity"] = {"nodeAffinity": {"requiredDuringSchedulingIgnoredDuringExecution": {"nodeSelectorTerms": [
            {"matchExpressions": [{"key": "kubernetes.io/hostname", "operator": "In",
                                   "values": [inst["home_node"]]}]}]}}}
    return {"apiVersion": "v1", "kind": "Pod",
            "metadata": {"name": pod_name(ws, generation), "namespace": namespace, "labels": labels,
                         "annotations": {"coder.code-server/owner": inst.get("owner") or ""}},
            "spec": spec}


def instance_service(workspace_id, namespace=NAMESPACE):
    labels = {"app.kubernetes.io/name": "coder-code-server", "app.kubernetes.io/part-of": "coder", LABEL: workspace_id}
    return {"apiVersion": "v1", "kind": "Service",
            "metadata": {"name": service_name(workspace_id), "namespace": namespace, "labels": labels},
            "spec": {"selector": {LABEL: workspace_id},
                     "ports": [{"name": "station", "port": STATION_PORT, "targetPort": STATION_PORT}]}}


class Operator:
    """The code-server-replicator of this cluster. Each round: the heartbeat, then every workspace that wants
    code-server - its instance here kept (or replaced), a lease renewed, a lease another cluster let lapse taken
    over, pods of old generations deleted, and the instances of workspaces gone removed."""

    def __init__(self, db, kube, cluster=CLUSTER, namespace=NAMESPACE, external=ENDPOINT_EXTERNAL):
        self.db, self.kube = db, kube
        self.cluster, self.ns, self.external = cluster, namespace, external

    def heartbeat(self):
        # since: when it began answering again (after a gap longer than the heartbeat's life)
        self.db.query("INSERT INTO code_server_ha.clusters AS c (name, heartbeat_at, external, version, since) "
                      "VALUES ($1, now(), $2, 'csha-1', now()) ON CONFLICT (name) DO UPDATE SET heartbeat_at = now(), "
                      "external = EXCLUDED.external, since = CASE WHEN c.heartbeat_at < now() - "
                      "make_interval(secs => $3) THEN now() ELSE c.since END",
                      [self.cluster, bool(self.external), HEARTBEAT_TTL])

    def event(self, ws, event, detail=""):
        self.db.query("INSERT INTO code_server_ha.events (workspace_id, cluster, event, detail) VALUES ($1,$2,$3,$4)",
                      [ws, self.cluster, event, detail[:500]])
        log(event="code-server-" + event, workspace=ws, detail=detail[:300], at=self.cluster)

    def instances(self):
        cols = ["workspace_id", "owner", "home_cluster", "home_namespace", "home_node", "home_pvc", "image", "folder",
                "active_cluster", "pod", "generation", "token", "state", "lease_left", "seen_ago", "registered_ago"]
        rows = self.db.query(
            "SELECT workspace_id::text, owner, home_cluster, home_namespace, home_node, home_pvc, image, folder, "
            "active_cluster, pod, generation, token, state, "
            "COALESCE(EXTRACT(EPOCH FROM lease_expires - now()), -1e9)::float8, "
            "EXTRACT(EPOCH FROM now() - seen_at)::float8, EXTRACT(EPOCH FROM now() - registered_at)::float8 "
            "FROM code_server_ha.instances ORDER BY workspace_id")
        out = []
        for r in rows:
            d = dict(zip(cols, r))
            d["generation"] = int(d["generation"])
            for k in ("lease_left", "seen_ago", "registered_ago"):
                d[k] = float(d[k])
            out.append(d)
        return out

    def healthy_clusters(self):
        """{name: seconds it has answered without a gap} of the clusters answering now."""
        rows = self.db.query("SELECT name, EXTRACT(EPOCH FROM now() - since)::float8 FROM code_server_ha.clusters "
                             "WHERE heartbeat_at > now() - make_interval(secs => $1)", [HEARTBEAT_TTL])
        return {r[0]: float(r[1]) for r in rows}

    def pods(self, ws):
        status, out = self.kube.call("GET", "/api/v1/namespaces/%s/pods?labelSelector=%s" % (
            self.ns, urllib.parse.quote("%s=%s" % (LABEL, ws))))
        if status != 200 or not isinstance(out, dict):
            raise RuntimeError("pods: HTTP %s" % status)
        return out.get("items") or []

    def workspace_pod_exists(self, inst):
        status, out = self.kube.call("GET", "/api/v1/namespaces/%s/pods?labelSelector=%s" % (
            inst["home_namespace"], urllib.parse.quote("com.coder.workspace.id=" + inst["workspace_id"])))
        if status != 200 or not isinstance(out, dict):
            return True  # not known: assume it runs
        return any(not (p["metadata"].get("deletionTimestamp")) and
                   (p.get("status") or {}).get("phase") in ("Pending", "Running") for p in out.get("items") or [])

    def reconcile(self):
        self.heartbeat()
        healthy = self.healthy_clusters()
        for inst in self.instances():
            try:
                self.reconcile_one(inst, healthy)
            except Exception as e:  # noqa: BLE001 - one workspace's trouble must not hold the others up
                log(event="code-server-reconcile-failed", workspace=inst["workspace_id"], error=str(e)[:300])

    def home_volume_going(self, inst):
        """The workspace's home volume is gone or being deleted: the workspace is being deleted, not restarted."""
        if not inst.get("home_pvc"):
            return False
        status, out = self.kube.call("GET", "/api/v1/namespaces/%s/persistentvolumeclaims/%s" % (
            inst["home_namespace"], inst["home_pvc"]))
        if status == 404:
            return True
        return status == 200 and isinstance(out, dict) and bool(out["metadata"].get("deletionTimestamp"))

    def reconcile_one(self, inst, healthy):
        ws = inst["workspace_id"]
        home = inst["home_cluster"] == self.cluster
        # the workspace is being deleted (its home volume going): its instance goes now - it holds that volume, and
        # the deletion waits for it (it took two minutes: the stop's wait below, then the pod's 30 s to end)
        if home and not self.workspace_pod_exists(inst) and self.home_volume_going(inst):
            self.remove(ws, everywhere=True, grace=5)
            return
        # the workspace stopped (its own cluster says so): its instance goes, wherever it runs
        if home and inst["registered_ago"] > LEASE_SECONDS and inst["seen_ago"] > 2 * LEASE_SECONDS \
                and not self.workspace_pod_exists(inst):
            self.remove(ws, everywhere=True)
            return
        if inst["active_cluster"] == self.cluster:
            if not home and healthy.get(inst["home_cluster"], 0) > FAILBACK_AFTER:
                self.give_back(inst)
            else:
                self.keep(inst, home)
        elif inst["active_cluster"] is None or inst["lease_left"] < -(0 if home else TAKEOVER_GRACE):
            # The home cluster takes its workspace (back) as soon as the lease ends. Another cluster takes it over
            # only when the home cluster is not answering (no heartbeat) and the holder let the lease lapse; and
            # only a cluster the workspace's can reach (an external endpoint).
            if home or (inst["home_cluster"] not in healthy and self.external
                        and (inst["active_cluster"] is not None or inst["registered_ago"] > TAKEOVER_GRACE)):
                self.take_over(inst, home)
        self.fence(ws, inst)

    def take_over(self, inst, home):
        """The lease, by a compare-and-set on the generation: only one cluster can win it."""
        ws = inst["workspace_id"]
        gen = inst["generation"] + 1
        token = secrets.token_urlsafe(32)
        rows = self.db.query(
            "UPDATE code_server_ha.instances SET active_cluster = $1, generation = $2, token = $3, pod = $4, "
            "endpoint_local = $5, endpoint_external = $6, state = 'starting', message = $7, "
            "lease_expires = now() + make_interval(secs => $8), updated_at = now() "
            "WHERE workspace_id = $9 AND generation = $10 RETURNING generation",
            [self.cluster, gen, token, pod_name(ws, gen), local_endpoint(ws, self.ns), external_endpoint(ws, self.ns, self.external),
             "starting in %s%s" % (self.cluster, "" if home else " (the workspace's own cluster is not answering)"),
             LEASE_SECONDS, ws, inst["generation"]])
        if not rows:
            return  # another cluster won it
        self.db.query("INSERT INTO code_server_ha.tokens (workspace_id, token, generation) VALUES ($1, $2, $3) "
                      "ON CONFLICT DO NOTHING", [ws, token, gen])
        inst.update(active_cluster=self.cluster, generation=gen, token=token, pod=pod_name(ws, gen))
        self.event(ws, "lease", "generation %d in %s%s" % (gen, self.cluster, "" if home else " (takeover)"))
        self.start(inst, home)

    def give_back(self, inst):
        """The workspace's own cluster answers again: the lease ends now, so it takes its workspace back (with its
        home volume) at its next round; this cluster's instance is fenced off then."""
        ws = inst["workspace_id"]
        rows = self.db.query("UPDATE code_server_ha.instances SET lease_expires = now() - interval '1 second', "
                             "message = $1, updated_at = now() WHERE workspace_id = $2 AND generation = $3 "
                             "AND active_cluster = $4 RETURNING generation",
                             ["going back to %s" % inst["home_cluster"], ws, inst["generation"], self.cluster])
        if rows:
            self.event(ws, "failback", "generation %d leaves %s for %s" % (inst["generation"], self.cluster,
                                                                           inst["home_cluster"]))

    def start(self, inst, home):
        ws = inst["workspace_id"]
        status, out = self.kube.call("GET", "/api/v1/namespaces/%s/services/%s" % (self.ns, service_name(ws)))
        if status == 404:
            self.kube.call("POST", "/api/v1/namespaces/%s/services" % self.ns, instance_service(ws, self.ns))
        status, out = self.kube.call("POST", "/api/v1/namespaces/%s/pods" % self.ns,
                                     instance_pod(inst, inst["generation"], inst["token"], home, self.cluster, self.ns))
        if status not in (200, 201, 409):
            raise RuntimeError("the instance's pod was refused: HTTP %s %s" % (status, str(out)[:200]))
        self.event(ws, "start", "%s (%s)" % (pod_name(ws, inst["generation"]),
                                             "the workspace's home" if home else "a folder of its own"))

    def keep(self, inst, home):
        """This cluster holds the lease: its pod running and ready renews it; a pod that failed or vanished is
        replaced by a new generation."""
        ws = inst["workspace_id"]
        name = pod_name(ws, inst["generation"])
        status, pod = self.kube.call("GET", "/api/v1/namespaces/%s/pods/%s" % (self.ns, name))
        st = (pod or {}).get("status") or {} if isinstance(pod, dict) else {}
        failed = status == 404 or st.get("phase") in ("Failed", "Succeeded") or (
            isinstance(pod, dict) and pod["metadata"].get("deletionTimestamp"))
        restarts = sum(c.get("restartCount", 0) for c in st.get("containerStatuses") or [])
        if failed or restarts >= 3:
            self.event(ws, "failed", "%s: %s" % (name, "gone" if status == 404 else st.get("phase") or
                                                 "%d restarts" % restarts))
            # a new generation here: give the lease up and take it again at once (the same compare-and-set)
            self.take_over(inst, home)
            return
        ready = any(c.get("type") == "Ready" and c.get("status") == "True" for c in st.get("conditions") or [])
        self.db.query("UPDATE code_server_ha.instances SET lease_expires = now() + make_interval(secs => $1), "
                      "state = $2, message = $3, updated_at = now() WHERE workspace_id = $4 AND generation = $5",
                      [LEASE_SECONDS, "running" if ready else "starting",
                       "running in %s" % self.cluster if ready else "starting in %s" % self.cluster, ws, inst["generation"]])

    def fence(self, ws, inst):
        """Only the active generation runs here: any other pod of the workspace in this cluster is deleted."""
        for p in self.pods(ws):
            gen = int(p["metadata"]["labels"].get(GEN_LABEL, "-1"))
            if inst["active_cluster"] == self.cluster and gen == inst["generation"]:
                continue
            if p["metadata"].get("deletionTimestamp"):
                continue
            self.kube.call("DELETE", "/api/v1/namespaces/%s/pods/%s?gracePeriodSeconds=5" % (
                self.ns, p["metadata"]["name"]))
            self.event(ws, "fenced", "%s (generation %d; the active one is %d in %s)" % (
                p["metadata"]["name"], gen, inst["generation"], inst["active_cluster"]))

    def remove(self, ws, everywhere=False, grace=None):
        for p in self.pods(ws):
            self.kube.call("DELETE", "/api/v1/namespaces/%s/pods/%s%s" % (
                self.ns, p["metadata"]["name"], "" if grace is None else "?gracePeriodSeconds=%d" % grace))
        self.kube.call("DELETE", "/api/v1/namespaces/%s/services/%s" % (self.ns, service_name(ws)))
        if everywhere:
            self.db.query("DELETE FROM code_server_ha.instances WHERE workspace_id = $1", [ws])
            self.db.query("DELETE FROM code_server_ha.tokens WHERE workspace_id = $1", [ws])
            self.event(ws, "removed", "the workspace stopped")

    def cleanup_orphans(self):
        """Pods and Services here whose workspace has no instance any more (or another cluster holds it)."""
        known = {i["workspace_id"]: i for i in self.instances()}
        status, out = self.kube.call("GET", "/api/v1/namespaces/%s/pods?labelSelector=%s" % (
            self.ns, urllib.parse.quote(LABEL)))
        for p in (out or {}).get("items") or [] if status == 200 and isinstance(out, dict) else []:
            ws = p["metadata"]["labels"].get(LABEL)
            if ws not in known:
                self.remove(ws)


def run_operator():
    db = pgwire.Pool(DB_URI, DB_CA, size=2)
    wait_for_schema(db)
    lock = pgwire.Connection(DB_URI, cafile=DB_CA, application_name="code-server-replicator")
    # one operator of this cluster works at a time (a replica waits for the lock)
    while not lock.query("SELECT pg_try_advisory_lock(hashtext($1))", ["code-server-replicator:" + CLUSTER])[0][0] in (
            "t", True):
        time.sleep(5)
    log(event="code-server-replicator-started", lease=LEASE_SECONDS, external=ENDPOINT_EXTERNAL or None)
    op = Operator(db, Kube())
    n = 0
    while True:
        try:
            op.reconcile()
            n += 1
            if n % 12 == 0:
                op.cleanup_orphans()
                lock.query("SELECT 1")  # keeps the lock's connection alive
                # the relay role (CloudNativePG makes it from its Secret) may come after this operator started
                for stmt in statements(GRANTS):
                    db.query(stmt)
        except Exception as e:  # noqa: BLE001 - the next round tries again
            log(event="code-server-replicator-round-failed", error=str(e)[:300])
        time.sleep(ROUND_SECONDS)


# ---------------------------------------------------------------------------------------------------- the relays
async def pipe(reader, writer):
    try:
        while True:
            data = await reader.read(65536)
            if not data:
                break
            writer.write(data)
            await writer.drain()
    except (ConnectionError, asyncio.CancelledError, OSError):
        pass
    finally:
        try:
            writer.close()
        except Exception:  # noqa: BLE001
            pass


async def splice(client_r, client_w, up_r, up_w):
    await asyncio.gather(pipe(client_r, up_w), pipe(up_r, client_w))


def split_endpoint(ep):
    host, _, port = ep.rpartition(":")
    return host, int(port)


async def answer(writer, status, message):
    body = ("<!doctype html><meta charset=utf-8><meta http-equiv=refresh content=5>"
            "<title>code-server</title><p style='font:14px sans-serif'>%s</p>" % message).encode()
    writer.write(("HTTP/1.1 %s\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: %d\r\n"
                  "Retry-After: 5\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n" % (status, len(body))
                  ).encode() + body)
    try:
        await writer.drain()
    finally:
        writer.close()


class Front:
    """The workspace pod's relay: the workspace registered (again and again: idempotent), its route kept, and
    every connection to 127.0.0.1:13337 passed to the active instance."""

    def __init__(self, db_query, cluster=CLUSTER):
        self.q = db_query
        self.cluster = cluster
        self.ws = os.environ["CSHA_WORKSPACE"]
        self.route = None
        self.error = "registering"

    def register(self):
        rows = self.q("SELECT active_cluster, endpoint_local, endpoint_external, token, generation, state, message "
                      "FROM code_server_ha.front_register($1::uuid, $2::uuid, $3, $4, $5, $6, $7)",
                      [os.environ["CSHA_AGENT_TOKEN"], self.ws, self.cluster, NAMESPACE,
                       os.environ.get("CSHA_NODE", ""), os.environ.get("CSHA_IMAGE", ""),
                       os.environ.get("CSHA_FOLDER", "/home/coder")])
        r = rows[0] if rows else None
        self.route = dict(zip(["cluster", "local", "external", "token", "generation", "state", "message"], r)) \
            if r else None
        self.error = None

    def target(self):
        r = self.route
        if not r or not r["token"] or r["state"] not in ("running", "starting"):
            return None
        ep = r["local"] if r["cluster"] == self.cluster else r["external"]
        return (ep, r["token"]) if ep else None

    async def handle(self, reader, writer):
        t = self.target()
        if not t:
            msg = (self.route or {}).get("message") or self.error or "code-server is starting"
            return await answer(writer, "503 Service Unavailable", "code-server: %s. This page reloads." % msg)
        ep, token = t
        try:
            host, port = split_endpoint(ep)
            up_r, up_w = await asyncio.wait_for(asyncio.open_connection(host, port), 10)
        except (OSError, asyncio.TimeoutError, ValueError) as e:
            return await answer(writer, "502 Bad Gateway", "code-server is not reachable (%s): it is being moved. "
                                "This page reloads." % str(e)[:100])
        up_w.write(("%s %s %s\n" % (PREAMBLE, self.ws, token)).encode())
        await splice(reader, writer, up_r, up_w)

    async def keep_registered(self):
        while True:
            try:
                await asyncio.get_running_loop().run_in_executor(None, self.register)
            except Exception as e:  # noqa: BLE001 - shown on the page until it works again
                self.error = "not registered yet (%s)" % str(e)[:120]
                log(event="code-server-front-register-failed", error=str(e)[:300])
            await asyncio.sleep(2 if not self.target() else 10)


class Station:
    """The instance's relay: connections that carry its token (or an older instance's of the workspace, passed on)
    to code-server on 127.0.0.1, or - superseded - to the active instance; code-server's user state into Postgres."""

    def __init__(self, db_query, ws=None, token=None, cluster=CLUSTER, upstream=CODE_SERVER_PORT, user_data=None):
        self.q = db_query
        self.ws = ws or os.environ["CSHA_WORKSPACE"]
        self.token = token or os.environ["CSHA_TOKEN"]
        self.cluster, self.upstream, self.user_data = cluster, upstream, user_data or USER_DATA
        self.check = {"at": 0, "current": True, "next": None}

    def status(self):
        if time.time() - self.check["at"] > 3:
            rows = self.q("SELECT is_current, active_cluster, endpoint_local, endpoint_external, active_token, "
                          "generation FROM code_server_ha.station_check($1::uuid, $2)", [self.ws, self.token])
            r = rows[0] if rows else None
            current = bool(r) and r[0] in ("t", True)
            nxt = None
            if r and not current and r[4]:
                ep = r[2] if r[1] == self.cluster else r[3]
                nxt = (ep, r[4]) if ep else None
            self.check = {"at": time.time(), "current": current, "next": nxt}
        return self.check

    async def handle(self, reader, writer):
        try:
            line = await asyncio.wait_for(reader.readline(), 10)
        except (asyncio.TimeoutError, OSError):
            writer.close()
            return
        parts = line.decode(errors="replace").split()
        if len(parts) != 3 or parts[0] != PREAMBLE or parts[1] != self.ws:
            writer.close()
            return
        st = await asyncio.get_running_loop().run_in_executor(None, self.status)
        ok = hmac.compare_digest(parts[2], self.token) or (st["next"] and hmac.compare_digest(parts[2], st["next"][1]))
        if not ok:
            writer.close()
            return
        if st["current"]:
            try:
                up_r, up_w = await asyncio.open_connection("127.0.0.1", self.upstream)
            except OSError:
                return await answer(writer, "503 Service Unavailable", "code-server is starting. This page reloads.")
            return await splice(reader, writer, up_r, up_w)
        if not st["next"]:
            return await answer(writer, "503 Service Unavailable", "code-server is moving. This page reloads.")
        ep, token = st["next"]
        try:
            host, port = split_endpoint(ep)
            up_r, up_w = await asyncio.wait_for(asyncio.open_connection(host, port), 10)
        except (OSError, asyncio.TimeoutError, ValueError):
            return await answer(writer, "502 Bad Gateway", "code-server is moving. This page reloads.")
        up_w.write(("%s %s %s\n" % (PREAMBLE, self.ws, token)).encode())
        await splice(reader, writer, up_r, up_w)

    def save_state(self, seen):
        """code-server's user state into Postgres: what changed since the last round."""
        for path, data in state_files(self.user_data):
            if seen.get(path) == data:
                continue
            self.q("SELECT code_server_ha.state_put($1::uuid, $2, $3, $4)", [self.ws, self.token, path, data])
            seen[path] = data

    async def keep_state(self):
        seen = {}
        while True:
            await asyncio.sleep(30)
            try:
                if self.status()["current"]:
                    await asyncio.get_running_loop().run_in_executor(None, self.save_state, seen)
            except Exception as e:  # noqa: BLE001 - the next round tries again
                log(event="code-server-state-save-failed", error=str(e)[:300])


def state_files(root):
    out = []
    for base, _dirs, files in os.walk(root):
        for f in files:
            full = os.path.join(base, f)
            rel = os.path.relpath(full, root)
            if not STATE_FILES.match(rel) or os.path.islink(full):
                continue
            try:
                if os.path.getsize(full) > STATE_MAX:
                    continue
                with open(full, "rb") as fh:
                    out.append((rel, fh.read()))
            except OSError:
                pass
    return sorted(out)


def restore(db_query, ws, token, root=USER_DATA):
    """The user's state back where code-server reads it: a file the folder lacks, or one older than Postgres's."""
    rows = db_query("SELECT path, content, EXTRACT(EPOCH FROM updated_at)::float8 FROM code_server_ha.state_get("
                    "$1::uuid, $2)", [ws, token])
    n = 0
    for path, content, updated in rows:
        if not STATE_FILES.match(path) or ".." in path.split("/"):
            continue
        full = os.path.join(root, path)
        if os.path.exists(full) and os.path.getmtime(full) >= float(updated):
            continue
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full + ".tmp", "wb") as f:
            f.write(content if isinstance(content, bytes) else bytes(content))
        os.replace(full + ".tmp", full)
        n += 1
    return n


def db_caller():
    pool = pgwire.Pool(DB_URI, DB_CA, size=2)
    return pool.query


async def serve(handler, listen, *tasks):
    host, port = split_endpoint(listen)
    server = await asyncio.start_server(handler, host, port, reuse_address=True)
    log(event="code-server-relay-listening", listen=listen)
    async with server:
        await asyncio.gather(server.serve_forever(), *tasks)


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "operator":
        return run_operator()
    if mode == "front":
        f = Front(db_caller())
        return asyncio.run(serve(f.handle, FRONT_LISTEN, f.keep_registered()))
    if mode == "station":
        s = Station(db_caller())
        return asyncio.run(serve(s.handle, "0.0.0.0:%d" % STATION_PORT, s.keep_state()))
    if mode == "restore":
        n = restore(db_caller(), os.environ["CSHA_WORKSPACE"], os.environ["CSHA_TOKEN"])
        log(event="code-server-state-restored", files=n)
        return 0
    sys.exit(__doc__)


if __name__ == "__main__":
    sys.exit(main() or 0)
