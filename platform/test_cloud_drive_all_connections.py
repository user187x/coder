"""Admin Settings > Cloud Drive: every account's Cloud Drive and the workspaces connected to it."""
import unittest
from unittest.mock import patch

import safe

OWNER = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"
IDLE = "33333333-3333-3333-3333-333333333333"


class AllConnectionsTest(unittest.TestCase):
    def setUp(self):
        workspaces = {
            OWNER: [{"id": "w-dev", "name": "dev"}, {"id": "w-ci", "name": "ci"}, {"id": "w-pair", "name": "pair"}],
            OTHER: [{"id": "w-lab", "name": "lab"}],
            IDLE: [],
        }
        for patcher in (
            patch.object(safe, "IS_ADMIN", lambda user: "owner" in user.get("roles", [])),
            patch.object(safe, "USERS", lambda: [(OTHER, "bob"), (OWNER, "alice"), (IDLE, "carol")]),
            patch.object(safe, "WORKSPACES", lambda owner: workspaces[owner]),
            patch.object(safe, "disconnected", return_value={"w-ci": {"owner": OWNER}}),
            patch.object(safe, "shared_now", return_value={"w-pair": OWNER}),
            patch.object(safe, "sources", return_value={OTHER: {"workspace": "w-lab"}}),
            patch.object(safe, "encryption_records", return_value={OWNER: {"state": "on"}}),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_every_account_with_workspaces_and_each_workspace_state(self):
        result = safe.all_connections({"id": OWNER, "roles": ["owner"]})
        self.assertEqual(result, {"drives": [
            {"owner": {"id": OWNER, "username": "alice"}, "encrypted": True, "source": None,
             "workspaces": [{"id": "w-dev", "name": "dev", "state": "connected"},
                            {"id": "w-ci", "name": "ci", "state": "disconnected"},
                            {"id": "w-pair", "name": "pair", "state": "shared"}]},
            {"owner": {"id": OTHER, "username": "bob"}, "encrypted": False, "source": "w-lab",
             "workspaces": [{"id": "w-lab", "name": "lab", "state": "connected"}]},
        ]})

    def test_members_are_refused(self):
        with self.assertRaises(PermissionError):
            safe.all_connections({"id": OTHER, "roles": []})

    def test_unreadable_database_is_an_error_not_an_empty_view(self):
        with patch.object(safe, "USERS", lambda: None):
            with self.assertRaises(RuntimeError):
                safe.all_connections({"id": OWNER, "roles": ["owner"]})


if __name__ == "__main__":
    unittest.main()
