"""Sandbox policy transactions against an isolated PostgreSQL database."""
import os
import pathlib
import sys
import unittest
import urllib.parse
import uuid
from unittest import mock

SRC = pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped/files/ui-updates'
sys.path.insert(0, str(SRC))
import pgwire
import sandbox


@unittest.skipUnless(os.environ.get('UI_STATE_TEST_DATABASE_URL'), 'Set UI_STATE_TEST_DATABASE_URL to a test PostgreSQL server')
class SandboxDatabaseTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        url = os.environ['UI_STATE_TEST_DATABASE_URL']
        cls.admin = pgwire.Connection(url)
        cls.name = 'sandbox_test_' + uuid.uuid4().hex
        cls.admin.query('CREATE DATABASE ' + cls.name)
        cls.addClassCleanup(cls.cleanup_database)
        cls.pool = pgwire.Pool(urllib.parse.urlunsplit(urllib.parse.urlsplit(url)._replace(path='/' + cls.name)))
        cls.pool.query('CREATE TABLE workspaces(id uuid PRIMARY KEY)')
        cls.pool.query('CREATE TABLE organizations(id uuid PRIMARY KEY)')
        migration = SRC.parents[4] / 'coderd/database/migrations/000615_workspace_sandbox_members.up.sql'
        for statement in migration.read_text().split(';'):
            if statement.strip():
                cls.pool.query(statement)

    @classmethod
    def cleanup_database(cls):
        if hasattr(cls, 'pool'):
            for connection in cls.pool.idle:
                connection.close()
        cls.admin.query('DROP DATABASE ' + cls.name)
        cls.admin.close()

    def test_membership_survives_reconnect_and_failed_changes_roll_back(self):
        workspace, org, group = (str(uuid.uuid4()) for _ in range(3))
        self.pool.query('INSERT INTO workspaces VALUES($1::uuid)', [workspace])
        self.pool.query('INSERT INTO organizations VALUES($1::uuid)', [org])
        with mock.patch.object(sandbox, 'PERSISTENCE', mock.Mock(database=lambda: self.pool)):
            with sandbox.member_state(write=True) as members:
                members[workspace] = {'organization_id': org, 'sandbox_group': group}
            self.assertEqual(sandbox.settings()[workspace]['sandbox_group'], group)
            with self.assertRaises(RuntimeError):
                with sandbox.member_state(write=True) as members:
                    members.pop(workspace)
                    raise RuntimeError('projection failed')
            self.assertIn(workspace, sandbox.settings())
            with sandbox.member_state(write=True) as members:
                members.pop(workspace)
            self.assertNotIn(workspace, sandbox.settings())


if __name__ == '__main__':
    unittest.main()
