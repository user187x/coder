"""Announcement receipts preserve certificate proof from the session that created them."""
import hashlib
import json
import runpy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

service = runpy.run_path(str(Path(__file__).with_name("ui-service.py")))


class AnnouncementReceiptsTest(unittest.TestCase):
    def test_first_view_keeps_its_fingerprint_after_confirmation(self):
        with tempfile.TemporaryDirectory() as root:
            store = service["Store"](str(Path(root) / "receipts.sqlite"))
            user = {"id": "viewer", "username": "viewer", "name": "", "email": ""}
            banner = {"id": "banner"}
            store.record("banner", user, False, banner, "a" * 64)
            viewed_at, _, _ = store.receipt_details("banner", "viewer")
            store.record("banner", user, True, banner, "b" * 64)
            first_view, confirmed_at, fingerprint = store.receipt_details("banner", "viewer")
            self.assertEqual(first_view, viewed_at)
            self.assertIsNotNone(confirmed_at)
            self.assertEqual(fingerprint, "a" * 64)
            self.assertEqual(store.report(banner, [user])[0]["receipts"][0]["certificateFingerprint"], fingerprint)

    def test_verified_view_fills_missing_fingerprint_without_changing_history(self):
        with tempfile.TemporaryDirectory() as root:
            store = service["Store"](str(Path(root) / "receipts.sqlite"))
            user = {"id": "viewer", "username": "viewer", "name": "", "email": ""}
            banner = {"id": "banner"}
            store.record("banner", user, True, banner)
            viewed_at, confirmed_at = store.receipt_times("banner", "viewer")
            store.record("banner", user, False, banner, "b" * 64)
            self.assertEqual(store.receipt_details("banner", "viewer"), (viewed_at, confirmed_at, "b" * 64))
            self.assertEqual(store.report(banner, [user])[0]["receipts"][0]["certificateFingerprint"], "b" * 64)

    def test_only_the_exact_oidc_session_can_supply_certificate_proof(self):
        resolve = service["receipt_certificate_fingerprint"]
        issuer = "https://auth.example.test/realms/lab"
        certificate = "a" * 64
        pool = Mock()
        kc = Mock()
        event = {"type": "LOGIN", "clientId": "coder", "userId": "keycloak-user",
                 "details": {"x509_cert_serial_number": "26", "x509_cert_subject_distinguished_name": "CN=viewer"}}
        for sid, expected in (("different-session", None), ("exact-session", certificate)):
            kc.api.return_value = [{**event, "sessionId": sid}]
            pool.query.side_effect = [
                [(json.dumps({"oidc_session_sha256": hashlib.sha256(b"exact-session").hexdigest(),
                              "oidc_issuer": issuer, "oidc_subject": "keycloak-user"}),)],
                [("1a", "CN=viewer", certificate)],
            ]
            with patch.dict(resolve.__globals__, {
                "LOGOS": Mock(pool=pool),
                "certificate_identity_provider": lambda: (kc, "lab", issuer, "coder"),
            }):
                self.assertEqual(resolve("0123456789-secret", "viewer"), expected)


if __name__ == "__main__":
    unittest.main()
