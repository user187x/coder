"""Support signaling authorization and lifecycle, using an isolated Postgres database."""
import base64
import hashlib
import hmac
import io
import json
import os
import tempfile
import unittest
import urllib.parse
import uuid
from unittest import mock
from types import SimpleNamespace

import pgwire
import screenshare


class HousekeepingTest(unittest.TestCase):
    def test_idle_polling_bounds_retention_and_scopes_revocation(self):
        db = mock.Mock()
        with mock.patch.object(screenshare, 'NEXT_PRUNE', 0), \
             mock.patch.object(screenshare.time, 'monotonic', return_value=100):
            for _ in range(100):
                screenshare.prune_history(db)
                screenshare.reconcile(db, 'participant')
        deletes = [call for call in db.query.call_args_list if call.args[0].startswith('DELETE')]
        updates = [call for call in db.query.call_args_list if call.args[0].startswith('UPDATE')]
        self.assertEqual(len(deletes), 1)
        self.assertEqual(len(updates), 100)
        for call in updates:
            self.assertIn('($1::uuid IS NULL OR sharer=$1::uuid OR viewer=$1::uuid)', call.args[0])
            self.assertEqual(call.args[1][0], 'participant')

    def test_relay_credentials_expire_and_are_bound_to_the_session(self):
        with tempfile.NamedTemporaryFile() as secret:
            secret.write(b'a' * 48)
            secret.flush()
            with mock.patch.dict(os.environ, {'SCREEN_SHARE_TURN_SECRET_FILE': secret.name,
                                             'SCREEN_SHARE_TURN_URL': 'turns:relay.example.com:443?transport=tcp'}), \
                 mock.patch.object(screenshare.time, 'time', return_value=1000):
                session = {'id': 'session-one', 'created_at': '1970-01-01T00:16:40+00:00'}
                server = screenshare.relay_servers('user-one', [session])[0]
                self.assertEqual(server['username'], 'user-one:4600:session-one')
                self.assertEqual(server['credential'], base64.b64encode(hmac.new(
                    b'a' * 48, b'user-one:4600:session-one', hashlib.sha1).digest()).decode())
                other = screenshare.relay_servers('user-two', [session])[0]
                self.assertNotEqual(server['credential'], other['credential'])
                later = screenshare.relay_servers('user-one', [dict(session, id='session-two')])[0]
                self.assertNotEqual(server['credential'], later['credential'])
                self.assertEqual(screenshare.relay_servers('user-one', []), [])
                with mock.patch.object(screenshare.time, 'time', return_value=4601):
                    self.assertEqual(screenshare.relay_servers('user-one', [session]), [])
                with mock.patch.dict(os.environ, {'SCREEN_SHARE_TURN_URL': 'turn:relay.example.com:3478'}):
                    with self.assertRaisesRegex(ValueError, 'TLS'):
                        screenshare.relay_servers('user-one', [session])


class Handler:
    def __init__(self, user, body=None, csrf=True):
        self.identity = user
        self.rfile = io.BytesIO(json.dumps(body or {}).encode())
        self.headers = {'Content-Length':str(len(self.rfile.getvalue()))}
        self.csrf = csrf

    def user(self, admin=False):
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
class SupportTest(unittest.TestCase):
    def setUp(self):
        self.auth = mock.patch.object(screenshare.volumes, 'coder', return_value=(200, {'screen_share': True})).start()
        self.addCleanup(mock.patch.stopall)
        secret = tempfile.NamedTemporaryFile()
        self.addCleanup(secret.close)
        secret.write(b'test-only-secret' * 4)
        secret.flush()
        mock.patch.dict(os.environ, {'SCREEN_SHARE_TURN_SECRET_FILE': secret.name,
                                    'SCREEN_SHARE_TURN_URL': 'turns:relay.example.com:443?transport=tcp'}).start()

    @classmethod
    def setUpClass(cls):
        url = os.environ['UI_STATE_TEST_DATABASE_URL']
        cls.admin = pgwire.Connection(url)
        cls.name = 'support_test_' + uuid.uuid4().hex
        cls.admin.query('CREATE DATABASE ' + cls.name)
        cls.pool = pgwire.Pool(urllib.parse.urlunsplit(urllib.parse.urlsplit(url)._replace(path='/'+cls.name)))
        for sql in ['CREATE SCHEMA coder_ui_updates', 'CREATE TABLE organizations(id uuid PRIMARY KEY)',
                    "CREATE TABLE users(id uuid PRIMARY KEY, username text DEFAULT 'test', rbac_roles text[] DEFAULT '{}', deleted boolean DEFAULT false, status text DEFAULT 'active')",
                    'CREATE TABLE workspaces(id uuid PRIMARY KEY, organization_id uuid, owner_id uuid, deleted boolean DEFAULT false)', 'CREATE TABLE organization_members(user_id uuid, organization_id uuid)']:
            cls.pool.query(sql)
        screenshare.setup(SimpleNamespace(database=lambda:cls.pool),lambda **kw:None,lambda user,peer:None, lambda:True)
        screenshare.READY = False

    @classmethod
    def tearDownClass(cls):
        for connection in cls.pool.idle:
            connection.close()
        cls.admin.query('DROP DATABASE '+cls.name)
        cls.admin.close()

    def test_consent_signaling_private_roles_and_end_cleanup(self):
        sharer, viewer, stranger, org = (str(uuid.uuid4()) for _ in range(4))
        self.pool.query('INSERT INTO organizations VALUES($1::uuid)',[org])
        self.pool.query('INSERT INTO users(id) VALUES($1::uuid),($2::uuid),($3::uuid)',[sharer,viewer,stranger])
        self.pool.query('INSERT INTO organization_members VALUES($1::uuid,$3::uuid),($2::uuid,$3::uuid)',[sharer,viewer,org])
        def call(user,body=None,method='POST',csrf=True):
            h=Handler({'id':user,'username':'test'},body,csrf)
            self.assertTrue(screenshare.handle(h,method,screenshare.BASE))
            return h
        self.assertEqual(call(sharer,{'action':'create','peer':viewer},csrf=False).status,403)
        created=call(sharer,{'action':'create','peer':viewer})
        with mock.patch.object(screenshare, 'USER_SHARING', return_value=False):
            self.assertFalse(call(sharer, method='GET').body['canShare'])
            self.assertEqual(call(sharer, {'action':'create','peer':viewer}).status,403)
        created=call(sharer,{'action':'create','peer':viewer})
        self.assertEqual(created.status,200,created.body)
        sid=created.body['session']['id']
        self.assertEqual(created.body['session']['status'],'requested')
        self.assertEqual(len(call(sharer, method='GET').body['iceServers']), 1)
        self.assertIsNone(created.body['session']['offer'])
        self.assertEqual(call(stranger,method='GET').body['sessions'],[])
        self.assertEqual(call(stranger,method='GET').body['iceServers'],[])
        self.assertEqual(call(stranger,{'action':'heartbeat','id':sid}).status,403)
        self.assertEqual(call(viewer,{'action':'offer','id':sid,'sdp':'v=0\r\n'}).status,403)
        self.assertEqual(call(sharer,{'action':'offer','id':sid,'sdp':'v=0\r\n'}).status,200)
        self.assertEqual(call(viewer,{'action':'answer','id':sid,'sdp':'v=0\r\n'}).status,200)
        for participant, action in ((sharer, 'offer'), (viewer, 'answer')):
            self.assertEqual(call(participant, {'action': action, 'id': sid, 'sdp': 'v=0\r\n'}).status, 200)
            conflict = call(participant, {'action': action, 'id': sid, 'sdp': 'v=0\r\ndifferent-connection'})
            self.assertEqual(conflict.status, 409)
            self.assertIn('another browser or tab', conflict.body['error'])
        self.assertEqual(call(viewer, {'action': 'offer', 'id': sid, 'sdp': 'v=0\r\n'}).status, 403)
        self.assertEqual(call(sharer, {'action': 'answer', 'id': sid, 'sdp': 'v=0\r\n'}).status, 403)
        self.assertEqual(call(viewer,method='GET').body['sessions'][0]['offer'],'v=0\r\n')
        ended=call(viewer,{'action':'end','id':sid})
        self.assertEqual(ended.body['session']['status'],'ended')
        self.assertIsNone(ended.body['session']['offer'])
        self.assertEqual(call(sharer,method='GET').body['sessions'],[])
        self.assertEqual(call(sharer,method='GET').body['iceServers'],[])
        self.assertEqual(call(sharer,{'action':'create','peer':stranger}).status,403)
        sid=call(sharer,{'action':'create','peer':viewer}).body['session']['id']
        self.pool.query("UPDATE coder_ui_updates.screen_shares SET expires_at=now()-interval '1 second' WHERE id=$1::uuid",[sid])
        self.assertEqual(call(viewer,method='GET').body['sessions'],[])
        sid=call(sharer,{'action':'create','peer':viewer}).body['session']['id']
        with mock.patch.object(screenshare, 'USER_SHARING', return_value=False):
            self.assertEqual(call(sharer, {'action':'offer','id':sid,'sdp':'v=0\r\n'}).body['session']['status'], 'ended')
            self.assertTrue(screenshare.can_share({'roles':['owner']}))
        sid=call(sharer,{'action':'create','peer':viewer}).body['session']['id']
        call(sharer,{'action':'offer','id':sid,'sdp':'v=0\r\n'})
        self.pool.query('DELETE FROM organization_members WHERE user_id=$1::uuid',[viewer])
        self.assertEqual(call(viewer,{'action':'heartbeat','id':sid}).body['session']['status'],'ended')
        self.assertIsNone(call(sharer,{'action':'heartbeat','id':sid}).body['session']['offer'])

    def test_restricted_credentials_cannot_signal_or_read_descriptions(self):
        sharer, viewer, org = (str(uuid.uuid4()) for _ in range(3))
        self.pool.query('INSERT INTO organizations VALUES($1::uuid)', [org])
        self.pool.query('INSERT INTO users(id) VALUES($1::uuid),($2::uuid)', [sharer, viewer])
        self.pool.query('INSERT INTO organization_members VALUES($1::uuid,$3::uuid),($2::uuid,$3::uuid)', [sharer, viewer, org])
        def call(uid, body=None):
            h = Handler({'id': uid, 'username': 'test'}, body)
            screenshare.handle(h, 'POST' if body else 'GET', screenshare.BASE)
            return h
        sid = call(sharer, {'action': 'create', 'peer': viewer}).body['session']['id']
        call(sharer, {'action': 'offer', 'id': sid, 'sdp': 'v=0\r\n'})
        self.assertEqual(len(call(viewer).body['iceServers']), 1)
        self.auth.return_value = (200, {'screen_share': False})
        self.assertEqual(call(viewer).body['sessions'], [])
        self.assertEqual(call(viewer).body['iceServers'], [])
        for action in ('answer', 'offer', 'heartbeat'):
            self.assertEqual(call(viewer, {'action': action, 'id': sid, 'sdp': 'v=0\r\n'}).status, 403)
        self.assertEqual(call(sharer, {'action': 'create', 'peer': viewer}).status, 403)
        self.assertIsNone(self.pool.query('SELECT answer FROM coder_ui_updates.screen_shares WHERE id=$1::uuid', [sid])[0][0])
        self.assertEqual(call(viewer, {'action': 'end', 'id': sid}).body['session']['status'], 'ended')

    def test_peer_request_requires_admin_shared_membership_policy_and_consent(self):
        admin, peer, outsider, org = (str(uuid.uuid4()) for _ in range(4))
        self.pool.query('INSERT INTO organizations VALUES($1::uuid)', [org])
        self.pool.query("INSERT INTO users(id,rbac_roles) VALUES($1::uuid,'{owner}'),($2::uuid,'{}'),($3::uuid,'{}')", [admin, peer, outsider])
        self.pool.query('INSERT INTO organization_members VALUES($1::uuid,$3::uuid),($2::uuid,$3::uuid)', [admin, peer, org])

        def call(uid=admin, target=peer, csrf=True):
            h = Handler({'id': uid, 'username': 'test', 'roles': ['owner'] if uid == admin else []},
                        {'action': 'request_peer', 'peer': target}, csrf)
            screenshare.handle(h, 'POST', screenshare.BASE)
            return h

        self.assertEqual(call(csrf=False).status, 403)
        self.assertEqual(call(uid=peer, target=admin).status, 403)
        self.assertEqual(call(target=outsider).status, 403)
        self.assertEqual(call(target=admin).status, 400)
        with mock.patch.object(screenshare, 'USER_SHARING', return_value=False):
            self.assertEqual(call().status, 403)
        with mock.patch.object(screenshare, 'MAY_CHAT', return_value='Chat is disabled.'):
            self.assertEqual(call().status, 403)
        self.auth.return_value = (200, {'screen_share': False})
        self.assertEqual(call().status, 403)
        self.auth.return_value = (200, {'screen_share': True})
        self.pool.query("UPDATE users SET status='suspended' WHERE id=$1::uuid", [peer])
        self.assertEqual(call().status, 403)
        self.pool.query("UPDATE users SET status='active' WHERE id=$1::uuid", [peer])
        requested = call()
        self.assertEqual(requested.status, 200, requested.body)
        session = requested.body['session']
        self.assertEqual((session['sharer'], session['viewer'], session['organization_id']), (peer, admin, org))
        self.assertIsNone(session['workspace_id'])
        self.assertIsNone(session['offer'])
        self.assertIsNone(session['answer'])
        self.assertEqual(session['status'], 'requested')
        self.assertEqual(call().status, 400)
        h = Handler({'id': admin, 'username': 'test', 'roles': ['owner']},
                    {'action': 'offer', 'id': session['id'], 'sdp': 'v=0\r\n'})
        screenshare.handle(h, 'POST', screenshare.BASE)
        self.assertEqual(h.status, 403)
        h = Handler({'id': peer, 'username': 'test'}, {'action': 'end', 'id': session['id']})
        screenshare.handle(h, 'POST', screenshare.BASE)
        self.assertEqual(h.body['session']['status'], 'ended')

    def test_dashboard_control_requires_admin_request_and_revokes_removed_role(self):
        admin, peer, org = (str(uuid.uuid4()) for _ in range(3))
        self.pool.query('INSERT INTO organizations VALUES($1::uuid)', [org])
        self.pool.query("INSERT INTO users(id,rbac_roles) VALUES($1::uuid,'{owner}'),($2::uuid,'{}')", [admin, peer])
        self.pool.query('INSERT INTO organization_members VALUES($1::uuid,$3::uuid),($2::uuid,$3::uuid)', [admin, peer, org])
        def call(uid, body=None):
            h = Handler({'id': uid, 'username': 'test', 'roles': ['owner'] if uid == admin else []}, body)
            screenshare.handle(h, 'POST' if body else 'GET', screenshare.BASE)
            return h
        self.assertEqual(call(peer, {'action': 'create', 'peer': admin, 'mode': 'dashboard'}).status, 403)
        self.assertEqual(call(peer, {'action': 'request_peer', 'peer': admin, 'mode': 'dashboard'}).status, 403)
        self.assertEqual(call(admin, {'action': 'request_peer', 'peer': peer, 'mode': 'arbitrary'}).status, 400)
        request = call(admin, {'action': 'request_peer', 'peer': peer, 'mode': 'dashboard'})
        self.assertEqual(request.status, 200, request.body)
        session = request.body['session']
        self.assertEqual(session['mode'], 'dashboard')
        self.assertEqual(session['sharer'], peer)
        self.assertIsNone(session['offer'])
        self.assertEqual(call(admin, {'action': 'offer', 'id': session['id'], 'sdp': 'v=0\r\n'}).status, 403)
        self.assertEqual(call(peer, {'action': 'offer', 'id': session['id'], 'sdp': 'v=0\r\n'}).status, 200)
        self.pool.query("UPDATE users SET rbac_roles='{}' WHERE id=$1::uuid", [admin])
        self.assertEqual(call(peer).body['sessions'], [])
        self.assertEqual(call(admin, {'action': 'heartbeat', 'id': session['id']}).body['session']['status'], 'ended')

    def test_workspace_support_revokes_owner_membership_and_checks_current_scope(self):
        sharer, viewer, org, wid = (str(uuid.uuid4()) for _ in range(4))
        self.pool.query('INSERT INTO organizations VALUES($1::uuid)', [org])
        self.pool.query("INSERT INTO users(id,rbac_roles) VALUES($1::uuid,'{}'),($2::uuid,'{owner}')", [sharer, viewer])
        self.pool.query('INSERT INTO organization_members VALUES($1::uuid,$2::uuid)', [sharer, org])
        self.pool.query('INSERT INTO workspaces VALUES($1::uuid,$2::uuid,$3::uuid,false)', [wid, org, sharer])
        workspace = {'id': wid, 'organization_id': org, 'owner_id': sharer, 'owner_name': 'owner', 'name': 'dev'}
        def call(uid, body=None, roles=None):
            h = Handler({'id': uid, 'username': 'test', 'roles': roles or []}, body)
            screenshare.handle(h, 'POST' if body else 'GET', screenshare.BASE)
            return h
        with mock.patch.object(screenshare.volumes, 'workspace', return_value=workspace), mock.patch.object(screenshare.volumes, 'can_update', return_value=True):
            self.assertEqual(call(sharer, {'action': 'request', 'workspace': wid}).status, 403)
            created = call(viewer, {'action': 'request', 'workspace': wid}, ['owner'])
        self.assertEqual(created.status, 200, created.body)
        sid = created.body['session']['id']
        self.assertEqual(call(sharer, {'action': 'offer', 'id': sid, 'sdp': 'v=0\r\n'}).status, 200)
        self.auth.assert_called_with('test-session', 'POST', '/api/v2/authcheck', {'checks': {'screen_share': {
            'action': 'application_connect', 'object': {'resource_type': 'workspace', 'resource_id': wid, 'owner_id': sharer, 'organization_id': org}}}})
        self.auth.return_value = (200, {'screen_share': False})
        self.assertEqual(call(viewer).body['sessions'], [])
        self.assertEqual(call(viewer, {'action': 'answer', 'id': sid, 'sdp': 'v=0\r\n'}).status, 403)
        self.auth.return_value = (200, {'screen_share': True})
        self.assertEqual(len(call(viewer).body['sessions']), 1)  # Deployment admins need not join the owner's organization.
        self.pool.query('DELETE FROM organization_members WHERE user_id=$1::uuid', [sharer])
        self.assertEqual(call(viewer, {'action': 'heartbeat', 'id': sid}).body['session']['status'], 'ended')
        self.assertIsNone(call(viewer, {'action': 'heartbeat', 'id': sid}).body['session']['offer'])

if __name__ == '__main__':
    unittest.main()
