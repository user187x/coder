"""Two-person sign-off for Global Terminate on isolated Postgres."""
import io
import json
import os
import unittest
import urllib.parse
import uuid
from types import SimpleNamespace

import pgwire
import terminatesignoff


class Handler:
    def __init__(self, identity, body=None, csrf=True):
        self.identity, self.csrf = identity, csrf
        self.rfile = io.BytesIO(json.dumps(body or {}).encode())
        self.headers = {'Content-Length': str(len(self.rfile.getvalue()))}

    def user(self, admin=False):
        if admin and 'owner' not in self.identity.get('roles', []):
            self.send_json(403, {})
            return None, True
        return self.identity, None

    def csrf_ok(self):
        return self.csrf

    def send_json(self, status, body):
        self.status, self.body = status, body


@unittest.skipUnless(os.environ.get('UI_STATE_TEST_DATABASE_URL'), 'Test Postgres required')
class TerminateSignoffTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        url = os.environ['UI_STATE_TEST_DATABASE_URL']
        cls.admin = pgwire.Connection(url)
        cls.name = 'terminate_signoff_test_' + uuid.uuid4().hex
        cls.admin.query('CREATE DATABASE ' + cls.name)
        cls.pool = pgwire.Pool(urllib.parse.urlunsplit(urllib.parse.urlsplit(url)._replace(path='/' + cls.name)))
        cls.pool.query('CREATE SCHEMA coder_ui_updates')
        cls.pool.query('CREATE TABLE users(id uuid PRIMARY KEY, username text)')
        cls.pool.query('''CREATE TABLE coder_ui_updates.client_certificates (user_id uuid, status text,
            expires_at timestamptz, created_at timestamptz DEFAULT now(), fingerprint text)''')

    @classmethod
    def tearDownClass(cls):
        for connection in cls.pool.idle:
            connection.close()
        cls.admin.query('DROP DATABASE ' + cls.name)
        cls.admin.close()

    def setUp(self):
        terminatesignoff.setup(SimpleNamespace(database=lambda: self.pool), lambda **_: None)
        terminatesignoff.READY = False
        self.pool.query('DROP TABLE IF EXISTS coder_ui_updates.terminate_signoffs')
        self.admins = []
        for name, fingerprint in (('ada', 'ab' * 32), ('grace', 'cd' * 32), ('nocert', None)):
            uid = str(uuid.uuid4())
            self.pool.query('INSERT INTO users VALUES ($1::uuid, $2)', [uid, name])
            if fingerprint:
                self.pool.query("""INSERT INTO coder_ui_updates.client_certificates (user_id, status, expires_at, fingerprint)
                    VALUES ($1::uuid, 'active', now() + interval '1 day', $2)""", [uid, fingerprint])
            self.admins.append({'id': uid, 'username': name, 'name': name.title(), 'roles': ['owner']})

    def call(self, method, who, path=terminatesignoff.PATH, body=None):
        h = Handler(who, body)
        self.assertTrue(terminatesignoff.handle(h, method, path))
        return h

    def test_two_admins_sign_with_their_thumbprints(self):
        ada, grace, _ = self.admins
        first = self.call('POST', ada)
        self.assertEqual(first.status, 200, first.body)
        self.assertEqual(first.body['signoffs'][0]['fingerprint'], ':'.join(['AB'] * 32))
        self.assertEqual(first.body['signoffs'][0]['name'], 'Ada')
        with self.assertRaises(PermissionError):
            terminatesignoff.ready(first.body['round_id'])
        again = self.call('POST', ada)
        self.assertEqual(again.status, 400, 'one administrator cannot sign twice')
        second = self.call('POST', grace)
        self.assertEqual(second.status, 200, second.body)
        self.assertEqual(second.body['round_id'], first.body['round_id'])
        terminatesignoff.ready(second.body['round_id'])
        with self.assertRaises(PermissionError):
            terminatesignoff.ready(str(uuid.uuid4()))
        done = self.call('POST', grace, terminatesignoff.PATH + '/complete', {'round_id': second.body['round_id']})
        self.assertEqual(done.status, 200, done.body)
        self.assertIsNone(done.body['round_id'])
        with self.assertRaises(PermissionError):
            terminatesignoff.ready(second.body['round_id'])

    def test_cancel_and_certificate_and_role_required(self):
        ada, _, nocert = self.admins
        self.assertEqual(self.call('POST', nocert).status, 403, 'no device certificate, no sign-off')
        self.assertEqual(self.call('POST', dict(ada, roles=['member'])).status, 403)
        self.call('POST', ada)
        cancelled = self.call('DELETE', ada)
        self.assertEqual(cancelled.status, 200, cancelled.body)
        self.assertEqual(cancelled.body['signoffs'], [])
        self.assertEqual(self.call_without_csrf(ada), 403)

    def call_without_csrf(self, who):
        h = Handler(who, csrf=False)
        terminatesignoff.handle(h, 'POST', terminatesignoff.PATH)
        return h.status


if __name__ == '__main__':
    unittest.main()
