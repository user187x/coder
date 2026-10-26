"""Policy lifecycle and authorization tests without a Kubernetes cluster."""
import base64
from concurrent.futures import ThreadPoolExecutor
import io
import json
import os
import sys
import tempfile
import unittest
import uuid
from unittest import mock

SRC = os.path.normpath(os.path.join(os.path.dirname(__file__),
                                    "../../../helm-chart/coder-airgapped/files/ui-updates"))
sys.path.insert(0, SRC)
import workspacetunnels as tunnels


class WorkspaceTunnelsTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.file = mock.patch.object(tunnels, "STATE_FILE", os.path.join(self.directory.name, "tunnels.json"))
        self.file.start()
        self.addCleanup(self.file.stop)
        self.org, self.other_org, self.a, self.b, self.c = [str(uuid.uuid4()) for _ in range(5)]
        self.user = {"id": "owner", "roles": []}
        self.ws = {wid: {"id": wid, "owner_id": "owner", "organization_id": self.org}
                   for wid in (self.a, self.b, self.c)}
        tunnels.setup(lambda token, wid: self.ws.get(wid), mock.Mock(return_value=(200, {"update": True})), mock.Mock(), "http://coder", {"owner"})
        self.identity = mock.patch.object(tunnels, "agent_identity", side_effect=lambda token, endpoint:
                                          (token, self.org, token))
        self.identity.start()
        self.addCleanup(self.identity.stop)

    def sync(self, wid, revision=-1, error=None, key=None, stats=None):
        if stats is not None and revision == -1:
            with tunnels.state(write=False) as data:
                revision = data["revision"]
        return tunnels.sync(wid, {"public_key": key or base64.b64encode(wid.encode()[:32]).decode(),
                                 "endpoint": "192.168.1.%d:51871" % (1 if wid == self.a else 2),
                                 "applied_revision": revision, "error": error,
                                 "established_peers": [self.b if wid == self.a else self.a],
                                 "peer_stats": stats})

    def create(self, a=None, b=None):
        return tunnels.create("session", self.user, self.org,
                              {"source_workspace_id": a or self.a, "target_workspace_id": b or self.b})

    def ready(self):
        link = self.create()
        self.sync(self.a)
        policy = self.sync(self.b)
        self.sync(self.a, policy["revision"])
        self.sync(self.b, policy["revision"])
        self.assertEqual(tunnels.listing("session", self.user, self.org)[0]["status"], "ready")
        return link, policy

    def test_both_helpers_must_ack_current_policy(self):
        self.create()
        self.sync(self.a)
        policy = self.sync(self.b)
        self.assertEqual(policy["peers"][0]["workspace_id"], self.a)
        self.assertTrue(policy["peers"][0]["allowed_ip"].endswith("/32"))
        self.sync(self.a, policy["revision"])
        self.assertEqual(tunnels.listing("session", self.user, self.org)[0]["status"], "pending")
        self.sync(self.b, policy["revision"] - 1)
        self.assertEqual(tunnels.listing("session", self.user, self.org)[0]["status"], "pending")
        self.sync(self.b, policy["revision"])
        self.assertEqual(tunnels.listing("session", self.user, self.org)[0]["status"], "ready")

    def test_disconnect_waits_for_both_peer_removals(self):
        link, _ = self.ready()
        result = tunnels.remove("session", self.user, self.org, link["id"])
        self.assertEqual(result["status"], "disconnecting")
        policy = self.sync(self.a)
        self.assertEqual(policy["peers"], [])
        self.sync(self.a, policy["revision"])
        self.assertEqual(tunnels.listing("session", self.user, self.org)[0]["status"], "disconnecting")
        self.sync(self.b, policy["revision"])
        self.assertEqual(tunnels.listing("session", self.user, self.org), [])
        recreated = self.create()
        self.assertEqual(recreated["source_address"], link["source_address"])

    def test_key_rotation_requires_new_ack_from_both(self):
        _, old = self.ready()
        key = base64.b64encode(b"z" * 32).decode()
        policy = self.sync(self.a, old["revision"], key=key)
        self.assertGreater(policy["revision"], old["revision"])
        self.assertEqual(tunnels.listing("session", self.user, self.org)[0]["status"], "pending")

    def test_expired_helper_and_apply_errors_are_not_ready(self):
        self.ready()
        with mock.patch.object(tunnels.time, "time", return_value=99999999999):
            self.assertEqual(tunnels.listing("session", self.user, self.org)[0]["status"], "pending")
        self.sync(self.a, error="could not create interface")
        self.assertEqual(tunnels.listing("session", self.user, self.org)[0]["status"], "error")

    def test_authorizes_both_endpoints_and_organization(self):
        self.ws[self.b]["owner_id"] = "someone else"
        with self.assertRaises(PermissionError):
            self.create()
        self.ws[self.b]["owner_id"] = "owner"
        self.ws[self.b]["organization_id"] = self.other_org
        with self.assertRaises(LookupError):
            self.create()
        with self.assertRaises(ValueError):
            self.create(self.a, self.a)

    def test_admin_can_manage_both_endpoints_but_not_cross_organization(self):
        self.user["roles"] = ["owner"]
        self.ws[self.b]["owner_id"] = "someone else"
        self.assertEqual(self.create()["status"], "pending")
        self.assertEqual(tunnels.listing("session", self.user, self.other_org), [])
        self.ws[self.b]["organization_id"] = self.other_org
        with self.assertRaises(LookupError):
            self.create()

    def test_duplicates_are_idempotent_and_addresses_survive_reload(self):
        link = self.create()
        self.assertEqual(self.create(self.b, self.a)["id"], link["id"])
        with open(tunnels.STATE_FILE) as source:
            data = json.load(source)
        self.assertEqual(data["tunnels"][link["id"]]["organization_id"], self.org)
        self.assertNotEqual(link["source_address"], link["target_address"])
        self.assertEqual(self.create()["source_address"], link["source_address"])

    def test_invalid_or_duplicate_public_keys_are_rejected(self):
        for key in ("bad", base64.b64encode(bytes(32)).decode()):
            with self.assertRaises(ValueError):
                self.sync(self.a, key=key)
        key = base64.b64encode(b"x" * 32).decode()
        self.sync(self.a, key=key)
        with self.assertRaises(ValueError):
            self.sync(self.b, key=key)

    def test_agent_endpoint_matches_current_workspace_pod(self):
        self.identity.stop()
        tunnels.HTTP_JSON.return_value = (200, {"workspace_id": self.a, "organization_id": self.org,
                                               "agent_id": self.b})
        tunnels.KUBE.call.return_value = (200, {"items": [{"metadata": {}, "status": {
            "podIP": "192.168.1.1", "phase": "Running"}}]})
        self.assertEqual(tunnels.agent_identity("agent", "192.168.1.1:51871")[0], self.a)
        with self.assertRaises(PermissionError):
            tunnels.agent_identity("agent", "192.168.1.2:51871")
        with self.assertRaises(ValueError):
            tunnels.agent_identity("agent", "192.168.1.1:80")
        tunnels.HTTP_JSON.return_value = (401, {})
        with self.assertRaises(PermissionError):
            tunnels.agent_identity("browser-token", "192.168.1.1:51871")

    def test_missing_handshake_stays_pending(self):
        self.ready()
        with tunnels.state() as data:
            data["workspaces"][self.a]["established_peers"] = []
        self.assertEqual(tunnels.listing("session", self.user, self.org)[0]["status"], "pending")

    def test_deleted_workspace_or_disabled_owner_revokes_policy(self):
        link, _ = self.ready()
        with mock.patch.object(tunnels, "LIVE_WORKSPACES", return_value=[self.a]):
            policy = self.sync(self.a)
            self.assertEqual(policy["peers"], [])
            self.assertEqual(tunnels.listing("session", self.user, self.org)[0]["status"], "disconnecting")

    def test_read_only_or_resource_restricted_tokens_cannot_change_links(self):
        tunnels.HTTP_JSON.return_value = (200, {"update": False})
        with self.assertRaises(PermissionError):
            self.create()
        tunnels.HTTP_JSON.return_value = (200, {"update": True})
        link = self.create()
        tunnels.HTTP_JSON.side_effect = [(200, {"update": True}), (200, {"update": False})]
        with self.assertRaises(PermissionError):
            tunnels.remove("restricted", self.user, self.org, link["id"])
        self.assertEqual(tunnels.listing("restricted", self.user, self.org)[0]["status"], "pending")

    def test_port_sides_are_validated_and_persisted(self):
        body = {"source_workspace_id": self.a, "target_workspace_id": self.b,
                "source_side": "left", "target_side": "right"}
        link = tunnels.create("session", self.user, self.org, body)
        self.assertEqual((link["source_side"], link["target_side"]), ("left", "right"))
        self.assertEqual(tunnels.listing("session", self.user, self.org)[0]["source_side"], "left")
        body["source_side"] = "top"
        with self.assertRaises(ValueError):
            tunnels.create("session", self.user, self.org, body)

    def test_telemetry_rates_missing_data_counter_resets_and_names(self):
        self.ws[self.a]["name"] = "alpha"
        self.ws[self.b]["name"] = "beta"
        self.ready()
        report = {"workspace_id": self.b, "rx_bytes": 100, "tx_bytes": 200,
                  "ports": [{"protocol": "tcp", "local_port": 8080, "remote_port": 50000}],
                  "ports_available": True}
        with mock.patch.object(tunnels.time, "time", return_value=100):
            self.sync(self.a, stats=[report])
            view = tunnels.listing("session", self.user, self.org)[0]
            self.assertEqual(view["source_workspace_name"], "alpha")
            self.assertEqual(view["target_workspace_name"], "beta")
            self.assertEqual(view["source_stats"]["series"], [])
            self.assertIsNone(view["target_stats"])
        report.update(rx_bytes=120, tx_bytes=260)
        with mock.patch.object(tunnels.time, "time", return_value=102):
            self.sync(self.a, stats=[report])
            stats = tunnels.listing("session", self.user, self.org)[0]["source_stats"]
            self.assertFalse(stats["stale"])
            self.assertTrue(stats["ports_available"])
            self.assertEqual(stats["series"][-1], {"timestamp": 102, "rx_bytes_per_second": 10,
                                                 "tx_bytes_per_second": 30})
        report.update(rx_bytes=1, tx_bytes=2)
        with mock.patch.object(tunnels.time, "time", return_value=104):
            self.sync(self.a, stats=[report])
            stats = tunnels.listing("session", self.user, self.org)[0]["source_stats"]
            self.assertEqual(stats["series"][-1]["rx_bytes_per_second"], 0)
            self.assertEqual(stats["series"][-1]["tx_bytes_per_second"], 0)
        with mock.patch.object(tunnels.time, "time", return_value=120):
            self.sync(self.a)
            self.assertTrue(tunnels.listing("session", self.user, self.org)[0]["source_stats"]["stale"])

    def test_telemetry_keeps_only_authorized_link_and_sixty_samples(self):
        self.ready()
        for index in range(70):
            with mock.patch.object(tunnels.time, "time", return_value=100 + index):
                self.sync(self.a, stats=[{"workspace_id": wid, "rx_bytes": index, "tx_bytes": index * 2,
                                         "ports": []} for wid in (self.b, self.c)])
        with tunnels.state() as data:
            stats = data["workspaces"][self.a]["stats"]
            self.assertEqual(set(stats), {self.b})
            self.assertEqual(len(stats[self.b]["series"]), 60)
            self.assertEqual(tunnels.public_stats(data["workspaces"][self.a], self.b)["rx_bytes"], 69)
        link = tunnels.listing("session", self.user, self.org)[0]
        tunnels.remove("session", self.user, self.org, link["id"])
        self.sync(self.a, stats=[{"workspace_id": self.b, "rx_bytes": 100, "tx_bytes": 200}])
        with tunnels.state() as data:
            self.assertEqual(data["workspaces"][self.a]["stats"], {})

    def test_telemetry_rejects_invalid_counters_ports_and_bounds(self):
        valid = {"workspace_id": self.b, "rx_bytes": 0, "tx_bytes": 1, "ports": []}
        for value in (-1, True, 1.5, float("inf"), 2**63):
            with self.assertRaises(ValueError):
                tunnels.peer_stats({"peer_stats": [{**valid, "rx_bytes": value}]})
        for port in ({"protocol": "sctp", "local_port": 1, "remote_port": 2},
                     {"protocol": "tcp", "local_port": 0, "remote_port": 2},
                     {"protocol": "udp", "local_port": 1, "remote_port": 65536}):
            with self.assertRaises(ValueError):
                tunnels.peer_stats({"peer_stats": [{**valid, "ports": [port]}]})
        with self.assertRaises(ValueError):
            tunnels.peer_stats({"peer_stats": [valid] * 65})
        with self.assertRaises(ValueError):
            tunnels.peer_stats({"peer_stats": [{**valid, "ports": [{}] * 65}]})
        with self.assertRaises(ValueError):
            tunnels.peer_stats({"peer_stats": [valid, valid]})

    def test_listing_and_disconnect_authorization_do_not_block_helper_sync(self):
        link, _ = self.ready()
        with ThreadPoolExecutor(max_workers=1) as executor:
            def lookup(token, wid):
                executor.submit(self.sync, self.a).result(timeout=2)
                return self.ws.get(wid)
            with mock.patch.object(tunnels, "WORKSPACE_INFO", side_effect=lookup):
                self.assertEqual(len(tunnels.listing("session", self.user, self.org)), 1)
                self.assertEqual(tunnels.remove("session", self.user, self.org, link["id"])["status"],
                                 "disconnecting")

    def test_listing_checks_each_distinct_workspace_once(self):
        self.create()
        self.create(self.a, self.c)
        with mock.patch.object(tunnels, "WORKSPACE_INFO", side_effect=lambda token, wid: self.ws.get(wid)) as lookup:
            self.assertEqual(len(tunnels.listing("session", self.user, self.org)), 2)
            self.assertEqual(lookup.call_count, 3)

    def test_disconnect_rechecks_endpoint_snapshot_after_authorization(self):
        link = self.create()
        def lookup(token, wid):
            with tunnels.state() as data:
                data["tunnels"][link["id"]]["target_workspace_id"] = self.c
            return self.ws.get(wid)
        with mock.patch.object(tunnels, "WORKSPACE_INFO", side_effect=lookup):
            with self.assertRaises(LookupError):
                tunnels.remove("session", self.user, self.org, link["id"])

    def test_key_rotation_with_larger_new_counters_starts_a_new_baseline(self):
        self.ready()
        old = {"workspace_id": self.b, "rx_bytes": 100, "tx_bytes": 200}
        self.sync(self.a, stats=[old])
        key = base64.b64encode(b"k" * 32).decode()
        newer = {"workspace_id": self.b, "rx_bytes": 9000, "tx_bytes": 10000}
        self.sync(self.a, key=key, stats=[newer])
        self.sync(self.a, key=key, stats=[newer])
        view = tunnels.listing("session", self.user, self.org)[0]
        self.assertEqual(view["source_stats"]["series"], [])
        self.assertIsNone(view["target_stats"])

    def test_state_file_is_private(self):
        self.create()
        self.assertEqual(os.stat(tunnels.STATE_FILE).st_mode & 0o777, 0o600)

    def test_corrupt_state_fails_closed(self):
        self.create()
        with open(tunnels.STATE_FILE, "w") as dest:
            dest.write("broken")
        with self.assertRaises(ValueError):
            self.create()


if __name__ == "__main__":
    unittest.main()
