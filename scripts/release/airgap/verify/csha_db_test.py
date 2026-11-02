"""code-server HA (files/ui-updates/csha.py) against a real PostgreSQL: the schema and its functions (the relay role's
only way in), two clusters' operators (a fake Kubernetes each) keeping one instance of a workspace's code-server
between them - started, replaced when it fails, taken over by the other cluster when its own stops answering, the old
generation fenced off - and the relays (real TCP) taking a browser's connection from the workspace to the active
instance, a superseded station passing it on, code-server's state kept and restored.

  python3 csha_db_test.py          (needs docker: a throwaway postgres container)"""
import asyncio
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import uuid

SRC = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    "../../../helm-chart/coder-airgapped/files/ui-updates"))
sys.path.insert(0, SRC)
import csha  # noqa: E402
import pgwire  # noqa: E402

IMAGE = os.environ.get("CSHA_TEST_PG", "us-docker.pkg.dev/coder-v2-images-public/public/postgres:13")

CODER_TABLES = """
CREATE TABLE users (id uuid PRIMARY KEY, username text NOT NULL);
CREATE TABLE workspaces (id uuid PRIMARY KEY, owner_id uuid NOT NULL);
CREATE TABLE workspace_builds (id uuid PRIMARY KEY, workspace_id uuid NOT NULL, job_id uuid NOT NULL,
                               build_number int NOT NULL);
CREATE TABLE workspace_resources (id uuid PRIMARY KEY, job_id uuid NOT NULL);
CREATE TABLE workspace_agents (id uuid PRIMARY KEY, resource_id uuid NOT NULL, auth_token uuid NOT NULL);
"""


class FakeKube:
    """Pods and Services of one cluster's namespace."""

    def __init__(self, ns, workspace_pods=()):
        self.ns, self.pods, self.services = ns, {}, {}
        self.workspace_pods = list(workspace_pods)

    def call(self, method, path, body=None):
        parts = path.split("?")[0].strip("/").split("/")
        kind = parts[4] if len(parts) > 4 else ""
        store = self.pods if kind == "pods" else self.services
        if method == "POST":
            name = body["metadata"]["name"]
            if name in store:
                return 409, {}
            body = json.loads(json.dumps(body))
            body.setdefault("status", {"phase": "Pending"})
            store[name] = body
            return 201, body
        if method == "DELETE":
            return (200, store.pop(parts[5], None)) if len(parts) > 5 else (405, {})
        if method == "GET" and len(parts) > 5:
            return (200, store[parts[5]]) if parts[5] in store else (404, {})
        if method == "GET":
            q = path.split("labelSelector=")[-1] if "labelSelector=" in path else ""
            from urllib.parse import unquote
            q = unquote(q)
            if q.startswith("com.coder.workspace.id="):
                ws = q.split("=", 1)[1]
                return 200, {"items": [p for p in self.workspace_pods if p == ws and True] and
                             [{"metadata": {"name": "ws"}, "status": {"phase": "Running"}}] or []}
            key, _, val = q.partition("=")
            items = [p for p in self.pods.values() if key in p["metadata"]["labels"] and
                     (not val or p["metadata"]["labels"][key] == val)]
            return 200, {"items": items}
        return 405, {}

    def ready(self, name):
        self.pods[name]["status"] = {"phase": "Running", "conditions": [{"type": "Ready", "status": "True"}],
                                     "containerStatuses": [{"restartCount": 0}]}

    def fail(self, name):
        self.pods[name]["status"] = {"phase": "Failed"}


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class CodeServerHATest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = free_port()
        cls.cid = subprocess.run(["docker", "run", "-d", "--rm", "-e", "POSTGRES_PASSWORD=pw", "-p",
                                  "127.0.0.1:%d:5432" % cls.port, IMAGE], capture_output=True, text=True,
                                 check=True).stdout.strip()
        cls.url = "postgresql://postgres:pw@127.0.0.1:%d/postgres?sslmode=disable" % cls.port
        for _ in range(60):
            try:
                cls.db = pgwire.Pool(cls.url, None, size=2)
                cls.db.query("SELECT 1")
                break
            except Exception:  # noqa: BLE001 - starting
                time.sleep(1)
        for stmt in [x for x in CODER_TABLES.strip().split(";") if x.strip()]:
            cls.db.query(stmt)
        cls.db.query("CREATE ROLE code_server_relay LOGIN PASSWORD 'relay'")
        csha.ensure_schema(cls.db)
        csha.ensure_schema(cls.db)  # again: nothing changes
        cls.relay = pgwire.Pool("postgresql://code_server_relay:relay@127.0.0.1:%d/postgres?sslmode=disable"
                                % cls.port, None, size=2)

    @classmethod
    def tearDownClass(cls):
        subprocess.run(["docker", "rm", "-f", cls.cid], capture_output=True)

    def workspace(self):
        user, ws, job, res, agent, token = (str(uuid.uuid4()) for _ in range(6))
        self.db.query("INSERT INTO users VALUES ($1, 'dev')", [user])
        self.db.query("INSERT INTO workspaces VALUES ($1, $2)", [ws, user])
        self.db.query("INSERT INTO workspace_builds VALUES ($1, $2, $3, 1)", [str(uuid.uuid4()), ws, job])
        self.db.query("INSERT INTO workspace_resources VALUES ($1, $2)", [res, job])
        self.db.query("INSERT INTO workspace_agents VALUES ($1, $2, $3)", [agent, res, token])
        return ws, token

    def register(self, ws, token, cluster="primary"):
        return self.relay.query("SELECT active_cluster, endpoint_local, endpoint_external, token, generation, state, "
                                "message FROM code_server_ha.front_register($1::uuid, $2::uuid, $3, 'coder', "
                                "'node-1', 'img:1', '/home/coder')", [token, ws, cluster])[0]

    def test_the_relay_role_gets_only_its_workspace_and_nothing_else(self):
        ws, token = self.workspace()
        other, _ = self.workspace()
        with self.assertRaises(pgwire.PgError):  # another workspace's agent token
            self.register(other, token)
        with self.assertRaises(pgwire.PgError):  # Coder's own tables
            self.relay.query("SELECT * FROM workspace_agents")
        with self.assertRaises(pgwire.PgError):  # the schema's tables (tokens!)
            self.relay.query("SELECT * FROM code_server_ha.instances")
        r = self.register(ws, token)
        self.assertEqual((r[0], r[5]), (None, "pending"))
        self.assertEqual(self.register(ws, token), r)  # idempotent
        self.assertEqual(self.relay.query("SELECT * FROM code_server_ha.station_check($1::uuid, 'nope')", [ws]), [])

    def test_one_instance_failure_takeover_fencing_and_the_relays(self):
        ws, agent_token = self.workspace()
        a = FakeKube("coder", [ws])
        b = FakeKube("coder-dr")
        op_a = csha.Operator(self.db, a, cluster="primary", namespace="coder")
        op_b = csha.Operator(self.db, b, cluster="dr-site", namespace="coder-dr",
                             external="{service}.{namespace}.svc.clusterset.local:{port}")
        self.register(ws, agent_token)
        op_b.reconcile()  # a new workspace: its own cluster has the first word
        self.assertEqual(b.pods, {})
        op_a.heartbeat()
        self.db.query("UPDATE code_server_ha.instances SET registered_at = now() - interval '10 minutes' "
                      "WHERE workspace_id = $1", [ws])
        op_b.reconcile()  # the home cluster is healthy: the other takes nothing
        self.assertEqual(b.pods, {})
        op_a.reconcile()
        self.assertEqual(len(a.pods), 1)
        first = next(iter(a.pods))
        self.assertTrue(first.endswith("-g1"))
        pod = a.pods[first]
        self.assertEqual(pod["spec"]["volumes"][0]["persistentVolumeClaim"]["claimName"], "coder-%s-home" % ws)
        self.assertEqual(pod["spec"]["affinity"]["nodeAffinity"]["requiredDuringSchedulingIgnoredDuringExecution"]
                         ["nodeSelectorTerms"][0]["matchExpressions"][0]["values"], ["node-1"])
        self.assertIn("127.0.0.1:13337", pod["spec"]["containers"][0]["command"])  # code-server on loopback only
        a.ready(first)
        op_a.reconcile()
        r = self.register(ws, agent_token)
        self.assertEqual((r[0], r[5], int(r[4])), ("primary", "running", 1))
        # it fails: a new generation, in the same cluster
        a.fail(first)
        op_a.reconcile()
        self.assertEqual(sorted(a.pods), [first.replace("-g1", "-g2")])
        a.ready(first.replace("-g1", "-g2"))
        op_a.reconcile()
        # the primary cluster stops answering: its lease and heartbeat lapse; the other cluster takes over
        self.db.query("UPDATE code_server_ha.clusters SET heartbeat_at = now() - interval '10 minutes' "
                      "WHERE name = 'primary'")
        self.db.query("UPDATE code_server_ha.instances SET lease_expires = now() - interval '10 minutes' "
                      "WHERE workspace_id = $1", [ws])
        op_b.reconcile()
        self.assertEqual(sorted(b.pods), [first.replace("-g1", "-g3")])
        bpod = b.pods[first.replace("-g1", "-g3")]
        self.assertIn("emptyDir", bpod["spec"]["volumes"][0])  # not the home volume: it is in the other cluster
        r = self.register(ws, agent_token)
        self.assertEqual((r[0], int(r[4])), ("dr-site", 3))
        self.assertTrue(r[2].endswith(".coder-dr.svc.clusterset.local:8080"))
        # the primary comes back: it fences its old generation off, and does not take the workspace back while the
        # other cluster holds a valid lease
        b.ready(first.replace("-g1", "-g3"))
        op_b.reconcile()
        op_a.reconcile()
        self.assertEqual(a.pods, {})
        events = [e for (e,) in self.db.query("SELECT event FROM code_server_ha.events WHERE workspace_id = $1 "
                                              "ORDER BY id", [ws])]
        self.assertIn("fenced", events)
        self.assertEqual(events.count("lease"), 3)
        # once the primary has answered for a while again, the workspace goes back to it (its home volume)
        self.db.query("UPDATE code_server_ha.clusters SET since = now() - interval '5 minutes' WHERE name = 'primary'")
        op_b.reconcile()  # gives the lease back
        op_a.reconcile()  # takes it: generation 4, at home
        op_b.reconcile()  # fences its own
        self.assertEqual(sorted(a.pods), [first.replace("-g1", "-g4")])
        self.assertEqual(b.pods, {})
        self.assertIn("persistentVolumeClaim", a.pods[first.replace("-g1", "-g4")]["spec"]["volumes"][0])
        r = self.register(ws, agent_token)
        self.assertEqual((r[0], int(r[4])), ("primary", 4))
        # the workspace stops (its pod gone, no registration): its instance goes everywhere
        a.workspace_pods = []
        self.db.query("UPDATE code_server_ha.instances SET seen_at = now() - interval '10 minutes', "
                      "registered_at = now() - interval '10 minutes' WHERE workspace_id = $1", [ws])
        op_a.reconcile()
        self.assertEqual(self.db.query("SELECT count(*) FROM code_server_ha.instances WHERE workspace_id = $1",
                                       [ws])[0][0], "0")
        op_b.cleanup_orphans()
        self.assertEqual(b.pods, {})

    def test_the_relays_carry_a_browser_to_the_active_code_server(self):
        ws, agent_token = self.workspace()
        k = FakeKube("coder", [ws])
        op = csha.Operator(self.db, k, cluster="primary", namespace="coder")
        self.register(ws, agent_token)
        op.reconcile()
        name = next(iter(k.pods))
        k.ready(name)
        op.reconcile()
        tok1 = self.db.query("SELECT token FROM code_server_ha.instances WHERE workspace_id = $1", [ws])[0][0]
        user_data = tempfile.mkdtemp()
        os.makedirs(os.path.join(user_data, "User"))
        with open(os.path.join(user_data, "User", "settings.json"), "w") as f:
            f.write('{"workbench.colorTheme": "Default Dark Modern"}')

        async def scenario():
            # code-server (a stand-in): answers HTTP and echoes a WebSocket-ish stream
            async def code_server(reader, writer):
                data = await reader.read(65536)
                body = b"code-server says hi to " + data.split(b"\r\n")[0]
                writer.write(b"HTTP/1.1 200 OK\r\nContent-Length: %d\r\nConnection: close\r\n\r\n" % len(body) + body)
                await writer.drain()
                writer.close()
            cs = await asyncio.start_server(code_server, "127.0.0.1", 0)
            cs_port = cs.sockets[0].getsockname()[1]
            st1 = csha.Station(self.relay.query, ws=ws, token=tok1, cluster="primary", upstream=cs_port,
                               user_data=user_data)
            s1 = await asyncio.start_server(st1.handle, "127.0.0.1", 0)
            s1_port = s1.sockets[0].getsockname()[1]
            self.db.query("UPDATE code_server_ha.instances SET endpoint_local = $1 WHERE workspace_id = $2",
                          ["127.0.0.1:%d" % s1_port, ws])
            os.environ.update(CSHA_WORKSPACE=ws, CSHA_AGENT_TOKEN=agent_token)
            front = csha.Front(self.relay.query, cluster="primary")
            front.register()
            f = await asyncio.start_server(front.handle, "127.0.0.1", 0)
            f_port = f.sockets[0].getsockname()[1]

            async def get():
                r, w = await asyncio.open_connection("127.0.0.1", f_port)
                w.write(b"GET /healthz HTTP/1.1\r\nHost: x\r\n\r\n")
                await w.drain()
                out = await asyncio.wait_for(r.read(), 10)
                w.close()
                return out
            first = await get()
            # a token from somewhere else is refused by the station
            r, w = await asyncio.open_connection("127.0.0.1", s1_port)
            w.write(("CSHA1 %s forged\nGET / HTTP/1.1\r\n\r\n" % ws).encode())
            forged = await asyncio.wait_for(r.read(), 10)
            # state: saved by the active station
            await asyncio.get_running_loop().run_in_executor(None, st1.save_state, {})
            # a new generation (station 2); a client that still knows only station 1 is passed on to it
            k.fail(name)
            await asyncio.get_running_loop().run_in_executor(None, op.reconcile)
            tok2 = self.db.query("SELECT token FROM code_server_ha.instances WHERE workspace_id = $1", [ws])[0][0]
            st2 = csha.Station(self.relay.query, ws=ws, token=tok2, cluster="primary", upstream=cs_port,
                               user_data=user_data)
            s2 = await asyncio.start_server(st2.handle, "127.0.0.1", 0)
            self.db.query("UPDATE code_server_ha.instances SET endpoint_local = $1 WHERE workspace_id = $2",
                          ["127.0.0.1:%d" % s2.sockets[0].getsockname()[1], ws])
            st1.check["at"] = 0
            r, w = await asyncio.open_connection("127.0.0.1", s1_port)
            w.write(("CSHA1 %s %s\nGET /passed-on HTTP/1.1\r\n\r\n" % (ws, tok1)).encode())
            passed = await asyncio.wait_for(r.read(), 10)
            for s in (cs, s1, s2, f):
                s.close()
            return first, forged, passed, tok2
        first, forged, passed, tok2 = asyncio.run(scenario())
        self.assertIn(b"200 OK", first)
        self.assertIn(b"code-server says hi to GET /healthz", first)
        self.assertEqual(forged, b"")
        self.assertIn(b"code-server says hi to GET /passed-on", passed)
        # the new instance restores the user's state from Postgres into its own (empty) folder
        fresh = tempfile.mkdtemp()
        n = csha.restore(self.relay.query, ws, tok2, root=fresh)
        self.assertEqual(n, 1)
        with open(os.path.join(fresh, "User", "settings.json")) as f:
            self.assertIn("Default Dark Modern", f.read())
        with self.assertRaises(pgwire.PgError):  # state for a token the workspace never had
            csha.restore(self.relay.query, ws, "nope", root=fresh)


if __name__ == "__main__":
    unittest.main()
