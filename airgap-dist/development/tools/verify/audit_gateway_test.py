"""The audit gateway against the existing filesystem-backed S3 server."""
import importlib.util
import json
import os
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest
import uuid
import xml.etree.ElementTree as ET
from unittest import mock

SRC = os.path.normpath(os.path.join(os.path.dirname(__file__),
                                  "../../../helm-chart/coder-airgapped/files/ui-updates"))
sys.path.insert(0, SRC)
import driveaudit
import s3client

OWNER = "11111111-1111-4111-8111-111111111111"
ALICE = "22222222-2222-4222-8222-222222222222"
BOB = "33333333-3333-4333-8333-333333333333"


class AuditGatewayTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        spec = importlib.util.spec_from_file_location("audit_backend", os.path.join(SRC, "drivesource.py"))
        self.backend_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.backend_module)
        root = os.path.join(self.directory.name, "files")
        os.mkdir(root)
        config = os.path.join(self.directory.name, "config.json")
        with open(config, "w") as file:
            json.dump({"root": root, "bucket": "drive", "prefix": "", "accessKey": "BACKEND",
                       "secretKey": "backend-secret", "region": "us-east-1", "port": 0}, file)
        self.backend_module.load(config)
        server = self.backend_module.Server(("127.0.0.1", 0), self.backend_module.Handler)
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.backend = s3client.S3("http://127.0.0.1:%s" % server.server_port, "us-east-1", "BACKEND", "backend-secret")
        self.store = driveaudit.Store(os.path.join(self.directory.name, "events.sqlite"))
        self.shares = {ALICE: ("", "write"), BOB: ("", "write")}

        def permission(actor, owner, path, write):
            if owner != OWNER or actor not in self.shares:
                return False
            top, access = self.shares[actor]
            covers = not top or path == top or path.startswith(top + "/")
            ancestor = not path or top.startswith(path + "/")
            return covers and (not write or access == "write") or not write and ancestor

        self.gateway = driveaudit.Gateway(self.store, lambda owner: (self.backend, "drive", owner + "/", None),
                                         permission, lambda owner: False, 1024 * 1024, lambda **kw: None)
        server = driveaudit.serve(self.gateway, "127.0.0.1", 0)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.endpoint = "http://127.0.0.1:%s" % server.server_port
        self.bucket = driveaudit.BUCKET_PREFIX + OWNER
        self.alice, self.bob = self.client(ALICE), self.client(BOB)

    def client(self, actor):
        keys = self.store.credentials(actor)
        return s3client.S3(self.endpoint, "us-east-1", keys["accessKey"], keys["secretKey"])

    def test_account_identity_add_overwrite_delete_and_prior_size(self):
        self.alice.put(self.bucket, ALICE + "/hello.txt", b"hello")
        self.bob.put(self.bucket, BOB + "/hello.txt", b"a longer replacement")
        self.bob.delete(self.bucket, BOB + "/hello.txt")
        events = self.store.pending()
        self.assertEqual([(e["actor"], e["action"], e["path"], e["size"]) for e in events],
                         [(ALICE, "added", "hello.txt", 5), (BOB, "deleted", "hello.txt", 20)])

    def test_wrong_viewer_prefix_invalid_signature_and_revoked_share(self):
        with self.assertRaises(s3client.S3Error) as wrong:
            self.alice.put(self.bucket, BOB + "/spoof.txt", b"no")
        self.assertEqual(wrong.exception.status, 403)
        keys = self.store.credentials(ALICE)
        invalid = s3client.S3(self.endpoint, "us-east-1", keys["accessKey"], "not-the-key")
        with self.assertRaises(s3client.S3Error) as bad:
            invalid.put(self.bucket, ALICE + "/spoof.txt", b"no")
        self.assertEqual(bad.exception.code, "SignatureDoesNotMatch")
        self.shares.pop(ALICE)
        with self.assertRaises(s3client.S3Error) as revoked:
            self.alice.put(self.bucket, ALICE + "/no.txt", b"no")
        self.assertEqual(revoked.exception.status, 403)
        self.assertEqual(self.store.pending(), [])

    def test_read_only_and_partial_share_listings_do_not_leak_siblings(self):
        self.backend.put("drive", OWNER + "/private.txt", b"private")
        self.backend.put("drive", OWNER + "/shared/read.txt", b"shared")
        self.shares[ALICE] = ("shared", "read")
        objects, folders = self.alice.list(self.bucket, prefix=ALICE + "/", delimiter="/")
        self.assertTrue(all(item["key"] == ALICE + "/" for item in objects))
        self.assertEqual(folders, [ALICE + "/shared/"])
        objects, _ = self.alice.list(self.bucket, prefix=ALICE + "/shared/")
        self.assertEqual([o["key"] for o in objects if not o["key"].endswith("/")], [ALICE + "/shared/read.txt"])
        with self.assertRaises(s3client.S3Error) as denied:
            self.alice.put(self.bucket, ALICE + "/shared/write.txt", b"no")
        self.assertEqual(denied.exception.status, 403)
        with self.assertRaises(s3client.S3Error):
            self.alice.head(self.bucket, ALICE + "/private.txt")

    def test_batch_delete_authorizes_every_key_before_mutating(self):
        self.alice.put(self.bucket, ALICE + "/keep.txt", b"keep")
        with self.assertRaises(s3client.S3Error) as denied:
            self.alice.delete_many(self.bucket, [ALICE + "/keep.txt", BOB + "/other.txt"])
        self.assertEqual(denied.exception.status, 403)
        self.backend.head("drive", OWNER + "/keep.txt").close()
        self.assertEqual(len(self.store.pending()), 1)

    def test_multipart_is_bound_to_its_mount_and_not_notified_until_complete(self):
        key = ALICE + "/large.txt"
        response = self.alice.request("POST", self.bucket, key, query=[("uploads", "")], body=b"")
        result = ET.fromstring(self.alice._done(response))
        upload_id = result.findtext(driveaudit.NS + "UploadId")
        self.assertTrue(upload_id)
        response = self.alice.request("PUT", self.bucket, key, query=[("uploadId", upload_id), ("partNumber", "1")], body=b"part")
        etag = response.headers["ETag"]
        self.alice._done(response)
        self.assertEqual(self.store.pending(), [])
        with self.assertRaises(s3client.S3Error) as denied:
            self.bob.request("DELETE", self.bucket, BOB + "/large.txt", query=[("uploadId", upload_id)])
        self.assertEqual(denied.exception.status, 403)
        body = ("<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>%s</ETag></Part></CompleteMultipartUpload>" % etag).encode()
        self.alice._done(self.alice.request("POST", self.bucket, key, query=[("uploadId", upload_id)], body=body))
        self.assertEqual([(e["action"], e["size"]) for e in self.store.pending()], [("added", 4)])

    def test_payload_hash_is_preserved_and_failed_write_is_not_notified(self):
        with self.assertRaises(s3client.S3Error):
            self.alice.request("PUT", self.bucket, ALICE + "/bad.txt", body=b"actual", payload_hash="0" * 64)
        self.assertEqual(self.store.pending(), [])
        self.store.recover_intents()
        self.assertEqual(self.store.pending(), [])
        with self.assertRaises(s3client.S3Error):
            self.backend.head("drive", OWNER + "/bad.txt")

    def test_source_backends_do_not_duplicate_observer_events(self):
        self.gateway.source = lambda owner: True
        self.alice.put(self.bucket, ALICE + "/source.txt", b"source")
        self.assertEqual(self.store.pending(), [])

    def test_copy_cannot_read_outside_a_partial_share(self):
        self.backend.put("drive", OWNER + "/private.txt", b"private")
        self.shares[ALICE] = ("shared", "write")
        with self.assertRaises(s3client.S3Error) as denied:
            self.alice.request("PUT", self.bucket, ALICE + "/shared/copy.txt", body=b"",
                               headers={"x-amz-copy-source": "/%s/%s/private.txt" % (self.bucket, ALICE)})
        self.assertEqual(denied.exception.status, 403)
        self.assertEqual(self.store.pending(), [])

    def test_copy_preserves_unicode_and_reserved_characters_in_names(self):
        import urllib.parse
        name = "shared/caf\u00e9 ? report.txt"
        self.alice.put(self.bucket, ALICE + "/" + name, b"copy")
        source = urllib.parse.quote("/%s/%s/%s" % (self.bucket, ALICE, name), safe="/")
        self.alice._done(self.alice.request("PUT", self.bucket, ALICE + "/copied.txt", body=b"",
                                          headers={"x-amz-copy-source": source}))
        self.assertEqual([(e["path"], e["size"]) for e in self.store.pending()], [(name, 4), ("copied.txt", 4)])

    def test_backend_success_then_audit_failure_recovers_as_an_explicit_gap(self):
        with mock.patch.object(self.store, "complete", side_effect=OSError("audit disk unavailable")):
            with self.assertRaises(s3client.S3Error):
                self.alice.put(self.bucket, ALICE + "/committed.txt", b"committed")
        self.assertIsNotNone(self.gateway.metadata(self.backend, "drive", OWNER + "/committed.txt", None))
        store = driveaudit.Store(self.store.path)
        self.assertEqual([item["action"] for item in store.pending()], ["gap"])
        event_id = store.pending()[0]["id"]
        store = driveaudit.Store(self.store.path)
        self.assertEqual([item["id"] for item in store.pending()], [event_id])

    def test_console_directory_delete_reports_prior_subtree_bytes_and_viewer(self):
        import safe
        self.backend.put("drive", OWNER + "/folder/one.txt", b"one")
        self.backend.put("drive", OWNER + "/folder/nested/two.txt", b"two!")
        with mock.patch.object(safe, "_audit", self.store), mock.patch.object(safe, "_audit_gateway", self.gateway), \
                mock.patch.object(safe, "drive_of", self.gateway.resolve), mock.patch.object(safe, "sources", lambda: {}), \
                mock.patch.object(safe, "LOG", lambda **kw: None):
            safe.delete({"id": OWNER, "username": "owner", "auditActor": ALICE}, "folder/")
        self.assertEqual([(e["kind"], e["path"], e["size"], e["actor"]) for e in self.store.pending()],
                         [("directory", "folder", 7, ALICE)])

    def test_oversized_listing_xml_is_rejected(self):
        response = mock.Mock()
        response.read.return_value = b"x" * (driveaudit.MAX_XML + 1)
        client = mock.Mock()
        client.request.return_value = response
        with mock.patch.object(self.gateway, "resolve", lambda owner: (client, "drive", owner + "/", None)):
            with self.assertRaises(s3client.S3Error) as bad:
                self.alice.list(self.bucket, prefix=ALICE + "/")
        self.assertEqual(bad.exception.code, "InvalidBackendResponse")

    def test_partial_listing_cursors_do_not_disclose_private_names_or_cross_mounts(self):
        self.shares[ALICE] = ("shared", "read")
        response = mock.Mock()
        response.read.return_value = ("<ListBucketResult xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\">"
                                     "<Contents><Key>%s/private-secret.txt</Key><Size>8</Size></Contents>"
                                     "<IsTruncated>true</IsTruncated><NextContinuationToken>private-secret.txt</NextContinuationToken>"
                                     "<KeyCount>1</KeyCount></ListBucketResult>" % OWNER).encode()
        client = mock.Mock()
        client.request.return_value = response
        with mock.patch.object(self.gateway, "resolve", lambda owner: (client, "drive", owner + "/", None)):
            result = self.alice._done(self.alice.request("GET", self.bucket, query=[("list-type", "2"), ("prefix", ALICE + "/")]))
        self.assertNotIn(b"private-secret", result)
        document = ET.fromstring(result)
        self.assertEqual(document.findtext(driveaudit.NS + "KeyCount"), "0")
        token = document.findtext(driveaudit.NS + "NextContinuationToken")
        with self.assertRaises(s3client.S3Error) as denied:
            self.bob.request("GET", self.bucket, query=[("list-type", "2"), ("prefix", BOB + "/"), ("continuation-token", token)])
        self.assertEqual(denied.exception.status, 403)

    def test_gateway_tls_accepts_its_ca_and_rejects_an_untrusted_certificate(self):
        if not shutil.which("openssl"):
            self.skipTest("OpenSSL is required for the ephemeral test certificate")
        key = os.path.join(self.directory.name, "tls.key")
        certificate = os.path.join(self.directory.name, "tls.crt")
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                        "-keyout", key, "-out", certificate, "-subj", "/CN=localhost",
                        "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], check=True, capture_output=True)
        server = driveaudit.serve(self.gateway, "127.0.0.1", 0, certificate, key)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        credentials = self.store.credentials(ALICE)
        endpoint = "https://127.0.0.1:%s" % server.server_port
        trusted = s3client.S3(endpoint, "us-east-1", credentials["accessKey"], credentials["secretKey"], ca_file=certificate)
        trusted.put(self.bucket, ALICE + "/tls.txt", b"tls")
        untrusted = s3client.S3(endpoint, "us-east-1", credentials["accessKey"], credentials["secretKey"])
        with self.assertRaises(ssl.SSLCertVerificationError):
            untrusted.head(self.bucket, ALICE + "/tls.txt")

    def test_sse_c_uses_owner_key_and_preserves_it_on_backend_requests(self):
        import base64
        key = b"k" * 32
        with mock.patch.object(self.gateway, "resolve", lambda owner: (self.backend, "drive", owner + "/", key)), \
                mock.patch.object(self.backend, "request", wraps=self.backend.request) as request:
            self.alice.put(self.bucket, ALICE + "/encrypted.txt", b"encrypted")
        backend_headers = [call.kwargs.get("headers") or (call.args[6] if len(call.args) > 6 else {})
                           for call in request.call_args_list]
        self.assertTrue(any(headers.get("x-amz-server-side-encryption-customer-key") == base64.b64encode(key).decode()
                            for headers in backend_headers))


class AuditOutboxTest(unittest.TestCase):
    def test_stable_ids_survive_retry_and_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "audit.sqlite")
            store = driveaudit.Store(path)
            item = driveaudit.event(ALICE, OWNER, "added", "hello.txt", 5)
            store.record(item)
            store.record(item)
            attempted = []

            def send(notification_id, recipient, event):
                attempted.append(notification_id)
                if len(attempted) == 1:
                    raise RuntimeError("delivery failed")

            with self.assertRaises(RuntimeError):
                store.deliver(lambda event: [OWNER], send)
            store = driveaudit.Store(path)
            store.deliver(lambda event: [OWNER], send)
            self.assertEqual(attempted[0], attempted[1])
            self.assertEqual(store.pending(), [])

    def test_notification_content_escapes_markdown_and_source_wording(self):
        pool = mock.Mock()
        query = ("query", ["content", "event"])
        item = driveaudit.event(ALICE, OWNER, "added", "![steal](https://host/secret)\nnext.txt", 1, source=True)
        driveaudit.send_inbox(pool, lambda actor: {"username": "alice"}, str(uuid.uuid4()), OWNER, item, query)
        content, envelope = pool.query.call_args.args[1]
        self.assertIn("Source workspace account alice observed", content)
        self.assertIn(r"\!\[steal\]\(https://host/secret\)", content)
        self.assertNotIn("\n", content)
        self.assertEqual(json.loads(envelope)["inbox_notification"]["content"], content)
        item["source"] = False
        item["action"] = "gap"
        item["message"] = "The backend may have committed the write."
        driveaudit.send_inbox(pool, lambda actor: {"username": "alice"}, str(uuid.uuid4()), OWNER, item, query)
        self.assertTrue(pool.query.call_args.args[1][0].startswith("Mount account alice:"))

    def test_packaged_query_uses_canonical_atomic_insert(self):
        path = os.path.normpath(os.path.join(os.path.dirname(__file__), "../../../../coderd/database/queries/notificationsinbox.sql"))
        query, names = driveaudit.inbox_query(path)
        self.assertIn("ON CONFLICT (id) DO NOTHING", query)
        self.assertIn("pg_notify", query)
        self.assertIn("notification_preferences", query)
        self.assertNotIn("@", query)
        self.assertEqual(set(names), {"id", "user_id", "template_id", "targets", "title", "content", "icon", "actions", "created_at", "channel", "event"})

    def test_unsupported_source_record_is_alerted_without_stalling_the_batch(self):
        import safe
        with tempfile.TemporaryDirectory() as directory:
            store = driveaudit.Store(os.path.join(directory, "audit.sqlite"))
            bad = {"id": str(uuid.uuid4()), "action": "added", "kind": "file", "size": 1,
                   "path": "x" * 5000, "observedAt": "2026-10-24T00:00:00+00:00"}
            good = {**bad, "id": str(uuid.uuid4()), "path": "good.txt"}
            with mock.patch.object(safe, "_audit", store), mock.patch.object(safe, "LOG", lambda **kw: None):
                self.assertEqual(safe.collect_source_events(OWNER, [bad, good]), [bad["id"], good["id"]])
            self.assertEqual([item["action"] for item in store.pending()], ["gap", "added"])

    def test_directory_recipients_require_covering_shares_not_ancestor_traversal(self):
        import safe
        item = driveaudit.event(OWNER, OWNER, "deleted", "parent/", 1234, source=True)
        shares = {ALICE: [{"owner": OWNER, "kind": "folder", "path": "parent/child", "access": "read"}],
                  BOB: [{"owner": OWNER, "kind": "folder", "path": "parent", "access": "read"}]}
        with mock.patch.object(safe.drivepeers, "active", lambda: shares):
            self.assertEqual(safe.audit_recipients(item), sorted([OWNER, BOB]))

    def test_long_source_path_is_retained_but_bounded_in_live_notification(self):
        with tempfile.TemporaryDirectory() as directory:
            store = driveaudit.Store(os.path.join(directory, "audit.sqlite"))
            item = driveaudit.event(OWNER, OWNER, "added", "[" * 3500, 1, source=True)
            store.record(item)
            self.assertEqual(store.pending()[0]["path"], item["path"])
            pool = mock.Mock()
            driveaudit.send_inbox(pool, lambda uid: {"username": "owner"}, str(uuid.uuid4()), OWNER, item,
                                  ("query", ["event"]))
            self.assertLess(len(pool.query.call_args.args[1][0].encode()), 8000)

    def test_source_observer_failure_is_actionable_without_treating_initial_scan_as_failure(self):
        import safe
        with mock.patch.object(safe, "AUDIT_ENABLED", True):
            self.assertIsNone(safe.source_audit_error({"audit": {"ready": False, "error": None}}))
            self.assertIn("read-only filesystem", safe.source_audit_error(
                {"audit": {"ready": False, "error": "read-only filesystem"}}))
            self.assertIn("no Cloud Drive observer", safe.source_audit_error({"audit": None}))

    def test_audited_mount_migration_marks_legacy_workspaces_for_restart(self):
        import safe
        legacy, audited = str(uuid.uuid4()), str(uuid.uuid4())

        def pod(workspace, claim):
            return {"metadata": {"labels": {"com.coder.workspace.id": workspace},
                                 "annotations": {safe.LINK_ANNOTATION: "on"}},
                    "status": {"phase": "Running"},
                    "spec": {"volumes": [{"persistentVolumeClaim": {"claimName": claim}}]}}

        kube = mock.Mock(ok=True)
        kube.call.return_value = 200, {"items": [pod(legacy, safe.CLAIM_PREFIX + OWNER),
                                                pod(audited, safe.audit_claim(OWNER, OWNER))]}
        with mock.patch.object(safe, "AUDIT_ENABLED", True), mock.patch.object(safe, "KUBE", kube), \
                mock.patch.object(safe, "peer_mounts", lambda: {}):
            self.assertEqual(safe.stale_mounts(OWNER, None, set()), [legacy])
            self.assertEqual(safe.claim_holders(OWNER), {legacy, audited})


if __name__ == "__main__":
    unittest.main()
