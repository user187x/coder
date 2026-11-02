"""Source Cloud Drive observations use inotify and a persistent SQLite outbox."""
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import threading
import unittest
from unittest import mock


SOURCE = Path(__file__).resolve().parents[3] / "helm-chart/coder-airgapped/files/ui-updates/drivesource.py"
spec = importlib.util.spec_from_file_location("source_audit_server", SOURCE)
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)


class SourceAuditTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "source"
        self.root.mkdir()
        self.state = str(Path(self.tmp.name) / "source-audit.sqlite")
        self.audit = source.SourceAudit(str(self.root), self.state)
        self.audit.start_watching()

    def tearDown(self):
        self.audit.close()
        self.tmp.cleanup()

    def drain(self):
        self.assertTrue(self.audit.poll(1), "the completed operation produced no inotify event")

    def changes(self):
        return [(e["action"], e["path"], e["kind"], e["size"])
                for e in self.audit.events(1000) if e["action"] != "gap"]

    def test_add_waits_for_completed_write_and_keeps_its_real_size(self):
        with open(self.root / "file.txt", "wb") as out:
            out.write(b"hello world")
            out.flush()
            self.drain()
            self.assertEqual(self.changes(), [])
        self.drain()
        self.assertEqual(self.changes(), [("added", "file.txt", "file", 11)])

    def test_rename_emits_removed_and_added_with_the_cached_size(self):
        path = self.root / "before.txt"
        path.write_bytes(b"data")
        self.drain()
        self.audit.acknowledge([e["id"] for e in self.audit.events()])
        path.rename(self.root / "after.txt")
        self.drain()
        self.assertEqual(self.changes(), [
            ("removed", "before.txt", "file", 4), ("added", "after.txt", "file", 4)])

    def test_directory_move_in_includes_descendants_and_total_bytes(self):
        outside = Path(self.tmp.name) / "outside"
        (outside / "nested").mkdir(parents=True)
        (outside / "a").write_bytes(b"abc")
        (outside / "nested" / "b").write_bytes(b"defgh")
        outside.rename(self.root / "folder")
        self.drain()
        self.assertCountEqual(self.changes(), [
            ("added", "folder", "directory", 8),
            ("added", "folder/a", "file", 3),
            ("added", "folder/nested", "directory", 5),
            ("added", "folder/nested/b", "file", 5),
        ])

    def test_recursive_remove_preserves_batch_subtree_sizes(self):
        folder = self.root / "folder"
        (folder / "nested").mkdir(parents=True)
        (folder / "a").write_bytes(b"abc")
        (folder / "nested" / "b").write_bytes(b"defgh")
        self.drain()
        self.audit.acknowledge([e["id"] for e in self.audit.events()])
        shutil.rmtree(folder)
        self.drain()
        self.assertCountEqual(self.changes(), [
            ("removed", "folder/a", "file", 3),
            ("removed", "folder/nested/b", "file", 5),
            ("removed", "folder/nested", "directory", 5),
            ("removed", "folder", "directory", 8),
        ])

    def test_separate_emptying_then_directory_removal_does_not_reuse_old_bytes(self):
        folder = self.root / "folder"
        folder.mkdir()
        (folder / "a").write_bytes(b"data")
        self.drain()
        (folder / "a").unlink()
        self.drain()
        folder.rmdir()
        self.drain()
        self.assertEqual(self.changes()[-1], ("removed", "folder", "directory", 0))

    def test_atomic_upload_is_observed_once_and_temporary_files_are_hidden(self):
        temporary = self.root / (source.TMP + "upload")
        temporary.write_bytes(b"complete upload")
        temporary.rename(self.root / "uploaded")
        self.drain()
        self.assertEqual(self.changes(), [("added", "uploaded", "file", 15)])

    def test_same_path_has_distinct_ids_for_distinct_lifecycles(self):
        path = self.root / "again"
        path.write_bytes(b"a")
        self.drain()
        path.unlink()
        self.drain()
        path.write_bytes(b"bb")
        self.drain()
        events = self.audit.events()
        self.assertEqual(len({event["id"] for event in events}), 3)
        self.assertEqual(self.changes(), [
            ("added", "again", "file", 1), ("removed", "again", "file", 1),
            ("added", "again", "file", 2)])

    def test_restart_retains_ids_reconciles_cached_tree_and_reports_downtime_gap(self):
        path = self.root / "old"
        path.write_bytes(b"old content")
        self.drain()
        retained = self.audit.events()[0]
        self.audit.close()
        path.unlink()
        (self.root / "new").write_bytes(b"new")
        self.audit = source.SourceAudit(str(self.root), self.state)
        self.audit.start_watching()
        self.assertEqual(self.audit.events()[0], retained)
        self.assertIn(("removed", "old", "file", 11), self.changes())
        self.assertIn(("added", "new", "file", 3), self.changes())
        self.assertTrue(any(e["action"] == "gap" for e in self.audit.events()))
        self.assertEqual(self.audit.events(), self.audit.events())
        self.audit.acknowledge([retained["id"]])
        self.assertNotIn(retained, self.audit.events())

    def test_overflow_reconciles_cached_deleted_size_and_exposes_gap(self):
        path = self.root / "before"
        path.write_bytes(b"seven77")
        self.drain()
        self.audit.acknowledge([e["id"] for e in self.audit.events()])
        path.unlink()
        (self.root / "after").write_bytes(b"four")
        self.audit.process([(-1, source.SourceAudit.OVERFLOW, "")])
        self.assertCountEqual(self.changes(), [
            ("removed", "before", "file", 7), ("added", "after", "file", 4)])
        gaps = [e for e in self.audit.events() if e["action"] == "gap"]
        self.assertEqual(len(gaps), 1)
        self.assertIn("overflowed", gaps[0]["message"])

    def test_unobserved_transient_metadata_is_reported_as_a_gap(self):
        path = self.root / "transient"
        path.write_bytes(b"unknown at observation time")
        path.unlink()
        self.drain()
        self.assertEqual(self.changes(), [])
        self.assertTrue(any(e["action"] == "gap" for e in self.audit.events()))

    def test_database_failure_rolls_back_event_and_cache_together(self):
        path = self.root / "recover"
        path.write_bytes(b"recover me")
        with mock.patch.object(self.audit, "_save", side_effect=RuntimeError("commit unavailable")):
            with self.assertRaises(RuntimeError):
                self.audit.poll(1)
        self.assertEqual(self.audit.events(), [])
        self.audit.reconcile("Recovering an interrupted transaction.")
        self.assertEqual(self.changes(), [("added", "recover", "file", 10)])

    def test_links_special_files_and_internal_temporaries_are_not_exposed(self):
        os.symlink("/etc", self.root / "outside")
        os.mkfifo(self.root / "pipe")
        (self.root / (source.TMP + "private")).write_bytes(b"private")
        self.drain()
        self.assertEqual(self.audit.events(), [])

    def test_state_file_cannot_be_inside_observed_directory(self):
        with self.assertRaisesRegex(ValueError, "outside"):
            source.SourceAudit(str(self.root), str(self.root / "loop.sqlite"))

    def test_state_boundary_uses_resolved_paths_and_not_textual_prefixes(self):
        for root in (str(self.tmp.name), "/"):
            with self.subTest(root=root), self.assertRaisesRegex(ValueError, "control-state"):
                source.SourceAudit(root, self.state)
        alias = Path(self.tmp.name) / "alias"
        alias.symlink_to(self.tmp.name, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "control-state"):
            source.SourceAudit(str(alias), self.state)
        sibling = Path(self.tmp.name) / "source-extra"
        sibling.mkdir()
        allowed = source.SourceAudit(str(self.root), str(sibling / "audit.sqlite"))
        allowed.close()

    def test_replacing_an_ancestor_with_a_symlink_cannot_observe_outside_files(self):
        parent = self.root / "parent"
        raw = parent / "raw"
        raw.mkdir(parents=True)
        outside = Path(self.tmp.name) / "outside"
        (outside / "raw").mkdir(parents=True)
        (outside / "raw" / "private").write_bytes(b"not shared")
        nested = source.SourceAudit(str(raw), str(Path(self.tmp.name) / "nested.sqlite"))
        try:
            nested.start_watching()
            parent.rename(self.root / "original")
            os.symlink(outside, parent)
            with self.assertRaises(OSError):
                nested.reconcile()
            self.assertEqual(nested.events(), [])
        finally:
            nested.close()


class SourceAuditAPITest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "source"
        self.root.mkdir()
        config = Path(self.tmp.name) / "config.json"
        config.write_text(json.dumps({"root": str(self.root), "bucket": "drive", "prefix": "owner/",
                                      "accessKey": "AK", "secretKey": "SK", "auditEnabled": True}))
        source.load(str(config))
        source.AUDIT.start_watching()
        self.server = source.Server(("127.0.0.1", 0), source.Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        s3spec = importlib.util.spec_from_file_location("source_audit_client", SOURCE.parent / "s3client.py")
        self.client_module = importlib.util.module_from_spec(s3spec)
        s3spec.loader.exec_module(self.client_module)
        self.url = "http://127.0.0.1:%d" % self.server.server_address[1]
        self.client = self.client_module.S3(self.url, "us-east-1", "AK", "SK", timeout=5)
        (self.root / "example.txt").write_bytes(b"example")
        source.AUDIT.poll(1)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        source.AUDIT.close()
        source.AUDIT = None
        self.tmp.cleanup()

    @staticmethod
    def response_json(response):
        try:
            return json.loads(response.read())
        finally:
            response.close()
            response.conn.close()

    def test_signed_poll_replays_until_a_durable_acknowledgement(self):
        first = self.response_json(self.client.request("GET", "__events"))["events"]
        second = self.response_json(self.client.request("GET", "__events"))["events"]
        self.assertEqual(first, second)
        self.assertEqual((first[0]["path"], first[0]["size"]), ("example.txt", 7))
        body = json.dumps({"ids": [event["id"] for event in first]}).encode()
        self.assertTrue(self.response_json(self.client.request("POST", "__events", "ack", body=body))["ok"])
        self.assertEqual(self.response_json(self.client.request("GET", "__events"))["events"], [])

    def test_invalid_signature_cannot_read_or_acknowledge_events(self):
        bad = self.client_module.S3(self.url, "us-east-1", "AK", "wrong", timeout=5)
        before = source.AUDIT.events()
        with self.assertRaises(self.client_module.S3Error) as error:
            bad.request("GET", "__events")
        self.assertEqual(error.exception.status, 403)
        with self.assertRaises(self.client_module.S3Error):
            bad.request("POST", "__events", "ack", body=json.dumps({"ids": [before[0]["id"]]}).encode())
        self.assertEqual(source.AUDIT.events(), before)

    def test_ack_requires_a_signed_body_and_valid_id_list(self):
        before = source.AUDIT.events()
        body = json.dumps({"ids": [before[0]["id"]]}).encode()
        with self.assertRaises(self.client_module.S3Error) as error:
            self.client.request("POST", "__events", "ack", body=io.BytesIO(body), length=len(body))
        self.assertEqual(error.exception.status, 400)
        with self.assertRaises(self.client_module.S3Error):
            self.client.request("POST", "__events", "ack", body=b'{"ids":"not a list"}')
        self.assertEqual(source.AUDIT.events(), before)


if __name__ == "__main__":
    unittest.main()
