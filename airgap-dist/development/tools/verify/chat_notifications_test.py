"""Inbox routing, directory permissions, and participant-scoped message deletion."""
import os
import tempfile
import unittest
from unittest import mock
from platform_unit_test import ui


class ChatNotificationsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.chat = ui.ChatStore(os.path.join(self.tmp.name, "chat.sqlite"))
        self.ann = {"id": "00000000-0000-0000-0000-000000000001", "username": "ann"}
        self.bob = {"id": "00000000-0000-0000-0000-000000000002", "username": "bob"}
        self.eve = {"id": "00000000-0000-0000-0000-000000000003", "username": "eve"}

    def test_selected_deletion_is_scoped_and_preserves_other_messages(self):
        first = self.chat.send(self.ann, False, self.bob, "first")
        second = self.chat.send(self.bob, False, self.ann, "second")
        private = self.chat.send(self.bob, False, self.eve, "private")
        removed = self.chat.delete_messages(self.ann["id"], self.bob["id"], [first["id"], private["id"]])
        self.assertEqual(removed, [first["id"]])
        self.assertEqual([m["id"] for m in self.chat.history(self.ann["id"], self.bob["id"])[0]], [second["id"]])
        self.assertEqual([m["id"] for m in self.chat.history(self.bob["id"], self.eve["id"])[0]], [private["id"]])
        event = self.chat.message_removed[self.bob["id"]][-1][1]
        self.assertEqual(event["ids"], [first["id"]])
        self.assertEqual(event["conversation"]["last"]["id"], second["id"])
        self.assertGreater(self.chat.last_clear(self.bob["id"]), 0)

    def test_invalid_selection_rejected(self):
        for ids in (None, [], [True], ["1"], [1] * 101):
            with self.assertRaises(ValueError):
                self.chat.delete_messages(self.ann["id"], self.bob["id"], ids)

    def test_discovery_setting_includes_offline_users_but_preserves_invisibility(self):
        people = {p["id"]: {**p, "name": "", "lastSeen": None} for p in (self.ann, self.bob, self.eve)}
        with mock.patch.object(ui, "CHAT", self.chat), mock.patch.object(ui, "chat_people", return_value=people):
            self.assertEqual(ui.chat_people_for(self.ann, False), [])
            self.chat.put_settings({"discoverAll": True}, "boss")
            self.chat.invisible.add(self.eve["id"])
            self.assertEqual([p["id"] for p in ui.chat_people_for(self.ann, False)], [self.bob["id"]])
            self.assertEqual(len(ui.chat_people_for(self.ann, True)), 2)
            self.assertTrue(ui.ChatStore(self.chat.path).settings["discoverAll"])

    def test_new_drive_events_use_inbox_instead_of_chat(self):
        with mock.patch.object(ui, "publish_drive_notification") as publish, mock.patch.object(ui, "CHAT", self.chat):
            ui.drive_chat_post(self.ann, self.bob["id"], "Requested access", "share")
            self.assertEqual(publish.call_args.args, (self.ann["id"], self.bob["id"], "Requested access", "share"))
            self.assertTrue(publish.call_args.kwargs["event_id"])
            self.assertEqual(self.chat.conversations(self.ann["id"]), [])

    def test_migration_preserves_human_messages_and_retries_failed_inbox_delivery(self):
        tagged = self.chat.send(self.ann, False, self.bob, "Requested access", drive="share")
        human = self.chat.send(self.ann, False, self.bob, "hello")
        with mock.patch.object(ui, "CHAT", self.chat), mock.patch.object(ui, "publish_drive_notification", side_effect=RuntimeError("offline")):
            ui.migrate_drive_chat_notifications(self.ann["id"])
            self.assertEqual(len(self.chat.history(self.ann["id"], self.bob["id"])[0]), 2)
        with mock.patch.object(ui, "CHAT", self.chat), mock.patch.object(ui, "publish_drive_notification") as publish:
            ui.migrate_drive_chat_notifications(self.ann["id"])
            self.assertEqual(publish.call_count, 2)
            self.assertEqual([m["id"] for m in self.chat.history(self.ann["id"], self.bob["id"])[0]], [human["id"]])

    def test_selected_inbox_deletion_is_scoped_to_the_signed_in_user(self):
        handler = object.__new__(ui.Handler)
        handler.user = lambda: (self.ann, None)
        handler.send_json = lambda status, value: (status, value)
        logos = mock.Mock()
        logos.pool.query.return_value = [["id"]]
        with mock.patch.object(ui, "LOGOS", logos):
            status, body = handler.clear_inbox([self.bob["id"]])
            self.assertEqual(status, 200)
            sql, values = logos.pool.query.call_args.args
            self.assertIn("user_id = $1::uuid AND id = ANY($2::uuid[])", sql)
            self.assertEqual(values[0], self.ann["id"])
            logos.pool.query.reset_mock()
            self.assertEqual(handler.clear_inbox(["invalid"])[0], 400)
            logos.pool.query.assert_not_called()

    def test_announcement_delivery_marker_survives_inbox_deletion(self):
        store = ui.Store(os.path.join(self.tmp.name, "settings.sqlite"))
        banner = {"enabled": True, "id": "announcement", "title": "News", "message": "Hello"}
        with mock.patch.object(ui, "STORE", store), mock.patch.object(ui, "publish_inbox_notification") as publish:
            ui.publish_announcement_notification(self.ann, banner)
            ui.publish_announcement_notification(self.ann, banner)
            self.assertEqual(publish.call_count, 1)
            ui.publish_announcement_notification(self.ann, {**banner, "id": "colored", "title": "{{colors bg=#111111 fg=#ffffff}}"})
            self.assertEqual(publish.call_args.args[2], "Announcement")

    def test_discovery_does_not_enable_peer_messaging(self):
        self.chat.put_settings({"discoverAll": True}, "boss")
        handler = object.__new__(ui.Handler)
        handler.user = lambda: ({**self.ann, "roles": []}, None)
        handler.send_json = lambda status, value: (status, value)
        with mock.patch.object(ui, "CHAT", self.chat), mock.patch.object(ui, "chat_people_for", return_value=[self.bob]):
            self.assertEqual(handler.chat_get("people", {})[1]["people"], [self.bob])
            self.assertIsNotNone(self.chat.may_write(self.ann, False, self.bob["id"], set(), set()))
