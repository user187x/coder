"""Disabled recording rejects stale clients without writing history or notifications."""
import unittest
from unittest import mock
from platform_unit_test import ui


class AnnouncementRecordingTest(unittest.TestCase):
    def test_disabled_or_unavailable_banner_never_records(self):
        for ack in (False, True):
            for banner in (None, {"id": "abc123", "receipts": False}):
                handler = mock.Mock()
                handler.user.return_value = ({"id": "u", "username": "user"}, None)
                with mock.patch.object(ui, "current_banner", return_value=banner) as current, \
                     mock.patch.object(ui, "STORE") as store, \
                     mock.patch.object(ui, "publish_announcement_notification") as notify:
                    ui.Handler.receipt(handler, ack, {"id": "abc123"})
                    current.assert_called_once_with(fresh=True)
                    store.record.assert_not_called()
                    notify.assert_not_called()
                    self.assertEqual(handler.send_json.call_args.args[0], 409)

    def test_enabled_recording_accepts_views_and_confirmations(self):
        for ack in (False, True):
            banner = {"id": "abc123", "receipts": True}
            user = {"id": "u", "username": "user"}
            handler = mock.Mock()
            handler.user.return_value = (user, None)
            with mock.patch.object(ui, "current_banner", return_value=banner), \
                 mock.patch.object(ui, "STORE") as store, \
                 mock.patch.object(ui, "publish_announcement_notification"), mock.patch.object(ui, "log"):
                ui.Handler.receipt(handler, ack, {"id": "abc123"})
                store.record.assert_called_once_with("abc123", user, ack, banner)
                handler.send_json.assert_called_once_with(200, {"ok": True})

    def test_disabled_report_does_not_create_an_event(self):
        db = mock.Mock()
        ui.Store.ensure_event(mock.Mock(), db, {"id": "abc123", "receipts": False})
        db.execute.assert_not_called()


if __name__ == "__main__":
    unittest.main()
