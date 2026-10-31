"""Administrator note persistence, privacy and concurrent edits on isolated Postgres."""
import importlib
import io
import json
import os
import unittest
import urllib.parse
import uuid
from types import SimpleNamespace
from unittest import mock

import adminnotes
import pgwire


class Handler:
    def __init__(self, identity, body, csrf=True):
        self.identity, self.csrf = identity, csrf
        self.rfile = io.BytesIO(json.dumps(body or {}).encode())
        self.headers = {'Content-Length': str(len(self.rfile.getvalue()))}

    def user(self, admin=False):
        if not self.identity:
            self.send_json(401, {})
            return None, True
        if admin and 'owner' not in self.identity.get('roles', []):
            self.send_json(403, {})
            return None, True
        return self.identity, None

    def token(self):
        return 'test-session'

    def csrf_ok(self):
        return self.csrf

    def send_json(self, status, body):
        self.status, self.body = status, body


@unittest.skipUnless(os.environ.get('UI_STATE_TEST_DATABASE_URL'), 'Test Postgres required')
class AdminNotesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        url = os.environ['UI_STATE_TEST_DATABASE_URL']
        cls.admin = pgwire.Connection(url)
        cls.name = 'admin_notes_test_' + uuid.uuid4().hex
        cls.admin.query('CREATE DATABASE ' + cls.name)
        cls.pool = pgwire.Pool(urllib.parse.urlunsplit(urllib.parse.urlsplit(url)._replace(path='/' + cls.name)))
        cls.pool.query('CREATE SCHEMA coder_ui_updates')
        cls.pool.query('CREATE TABLE users(id uuid PRIMARY KEY, username text)')
        cls.pool.query('CREATE TABLE organizations(id uuid PRIMARY KEY)')

    @classmethod
    def tearDownClass(cls):
        for connection in cls.pool.idle:
            connection.close()
        cls.admin.query('DROP DATABASE ' + cls.name)
        cls.admin.close()

    def setUp(self):
        self.author, self.other, self.org, self.other_org = [str(uuid.uuid4()) for _ in range(4)]
        self.pool.query('INSERT INTO users VALUES($1::uuid,$2),($3::uuid,$4)', [self.author, 'first', self.other, 'second'])
        self.pool.query('INSERT INTO organizations VALUES($1::uuid),($2::uuid)', [self.org, self.other_org])
        adminnotes.setup(SimpleNamespace(database=lambda: self.pool), lambda **kw: None)
        self.coder = mock.patch.object(adminnotes.volumes, 'coder', return_value=(200, {'notes_write': True}))
        self.auth = self.coder.start()
        self.addCleanup(self.coder.stop)

    def call(self, uid, body=None, org=None, roles=None, csrf=True):
        h = Handler({'id': uid, 'roles': roles if roles is not None else ['owner']} if uid else None, body, csrf)
        adminnotes.handle(h, 'POST' if body is not None else 'GET', '/__coder-ui/api/organizations/' + (org or self.org) + '/admin-notes')
        return h

    def test_private_shared_persistent_and_author_owned(self):
        created = self.call(self.author, {'action': 'create', 'text': 'Private operations note', 'shared': False})
        self.assertEqual(created.status, 200, created.body)
        note = created.body['notes'][0]
        self.assertTrue(note['can_edit'])
        self.assertEqual(self.call(self.other).body['notes'], [])
        self.assertEqual(self.call(self.author, org=self.other_org).body['notes'], [])
        for action in ('update', 'delete'):
            self.assertEqual(self.call(self.other, {'action': action, 'id': note['id'], 'revision': note['revision'], 'text': 'Overwrite', 'shared': True}).status, 404)
        shared = self.call(self.author, {'action': 'update', 'id': note['id'], 'revision': note['revision'], 'text': note['text'], 'shared': True}).body['notes'][0]
        viewed = self.call(self.other).body['notes'][0]
        self.assertEqual(viewed['text'], note['text'])
        self.assertFalse(viewed['can_edit'])
        importlib.reload(adminnotes)
        adminnotes.setup(SimpleNamespace(database=lambda: self.pool), lambda **kw: None)
        self.assertEqual(self.call(self.author).body['notes'][0], shared)
        stale = self.call(self.author, {'action': 'update', 'id': note['id'], 'revision': note['revision'], 'text': 'Stale update', 'shared': False})
        self.assertEqual(stale.status, 409)
        self.assertEqual(self.call(self.author).body['notes'][0]['text'], note['text'])
        private = self.call(self.author, {'action': 'update', 'id': shared['id'], 'revision': shared['revision'], 'text': 'Edited private note', 'shared': False}).body['notes'][0]
        self.assertEqual(self.call(self.other).body['notes'], [])
        self.assertEqual(self.call(self.author, {'action': 'delete', 'id': note['id'], 'revision': note['revision']}).status, 409)
        self.assertEqual(self.call(self.author, {'action': 'delete', 'id': private['id'], 'revision': private['revision']}).body['notes'], [])
        self.assertEqual(self.call(self.author).body['notes'], [])

    def test_read_receipts_are_private_persistent_and_revision_specific(self):
        note = self.call(self.author, {'action': 'create', 'text': 'Shared handover', 'shared': True}).body['notes'][0]
        self.assertFalse(note['unread'])
        self.assertTrue(self.call(self.other).body['notes'][0]['unread'])
        read = {'action': 'read', 'id': note['id'], 'revision': 1}
        self.assertEqual(self.call(self.other, read, org=self.other_org).status, 404)
        self.assertEqual(self.call(self.other, read, roles=['member']).status, 403)
        self.assertEqual(self.call(self.other, read, csrf=False).status, 403)
        self.assertEqual(self.call(self.other, {**read, 'revision': 2}).status, 409)
        self.assertFalse(self.call(self.other, read).body['notes'][0]['unread'])
        importlib.reload(adminnotes)
        adminnotes.setup(SimpleNamespace(database=lambda: self.pool), lambda **kw: None)
        self.assertFalse(self.call(self.other).body['notes'][0]['unread'])
        third = str(uuid.uuid4())
        self.pool.query('INSERT INTO users VALUES($1::uuid,$2)', [third, 'third'])
        self.assertTrue(self.call(third).body['notes'][0]['unread'])
        self.call(self.author, {'action': 'update', 'id': note['id'], 'revision': 1, 'text': 'Revised handover', 'shared': True})
        self.assertTrue(self.call(self.other, read).body['notes'][0]['unread'])
        self.assertFalse(self.call(self.other, {**read, 'revision': 2}).body['notes'][0]['unread'])
        self.assertFalse(self.call(self.other, read).body['notes'][0]['unread'])
        self.call(self.author, {'action': 'update', 'id': note['id'], 'revision': 2, 'text': 'Private again', 'shared': False})
        self.assertEqual(self.call(self.other, {**read, 'revision': 3}).status, 404)
        self.call(self.author, {'action': 'delete', 'id': note['id'], 'revision': 3})
        self.assertEqual(self.pool.query('SELECT note_id FROM coder_ui_updates.admin_note_reads WHERE note_id=$1::uuid', [note['id']]), [])

    def test_authorization_validation_and_organization_boundary(self):
        self.assertEqual(self.call(None).status, 401)
        self.assertEqual(self.call(self.author, roles=['member']).status, 403)
        self.assertEqual(self.call(self.author, {'action': 'create', 'text': 'x'}, csrf=False).status, 403)
        for body in ({'action': 'create', 'text': ''}, {'action': 'create', 'text': ' '}, {'action': 'create', 'text': 'x' * 10001}, {'action': 'create', 'text': 'x', 'shared': 'true'}, {'action': 'unknown'}):
            self.assertEqual(self.call(self.author, body).status, 400)
        with mock.patch.object(adminnotes.volumes, 'coder', return_value=(403, {})):
            self.assertEqual(self.call(self.author).status, 403)
            self.assertEqual(self.call(self.author, {'action': 'create', 'text': 'denied'}).status, 403)
        self.assertEqual(self.call(self.author).body['notes'], [])

    def test_read_only_owner_token_cannot_mutate_notes_or_receipts(self):
        note = self.call(self.author, {'action': 'create', 'text': 'Private', 'shared': False}).body['notes'][0]
        self.auth.return_value = (200, {'notes_write': False})
        self.assertEqual(self.call(self.author).body['notes'][0]['text'], 'Private')
        for action in ('create', 'update', 'delete', 'read'):
            with self.subTest(action=action):
                denied = self.call(self.author, {'action': action, 'id': note['id'], 'revision': note['revision'], 'text': 'Changed', 'shared': True})
                self.assertEqual(denied.status, 403)
                self.auth.assert_called_with('test-session', 'POST', '/api/v2/authcheck', {'checks': {
                    'notes_write': {'action': 'update', 'object': {'resource_type': 'organization', 'organization_id': self.org}}}})
        self.assertEqual(self.call(self.author).body['notes'], [note])
        self.assertEqual(self.pool.query('SELECT note_id FROM coder_ui_updates.admin_note_reads WHERE note_id=$1::uuid', [note['id']]), [])


if __name__ == '__main__':
    unittest.main()
