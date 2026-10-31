"""Device issuance, authorization, identity binding and revocation on isolated Postgres."""
import base64
import copy
import datetime as dt
import io
import json
import os
import pathlib
import tempfile
import unittest
import urllib.parse
import uuid
from types import SimpleNamespace
from unittest import mock

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

import clientcertificates as certificates
import pgwire


class Provider:
    def __init__(self):
        self.users = {}
        self.profile = {'attributes': [{'name': name, 'permissions': {'edit': ['admin'], 'view': ['admin']}}
                                       for name in (certificates.SUBJECT_ATTRIBUTE, certificates.ACCOUNT_ATTRIBUTE)]}
        self.config = {
            'x509-cert-auth.mapping-source-selection': 'Match SubjectDN using regular expression',
            'x509-cert-auth.regular-expression': '^(.+)$',
            'x509-cert-auth.mapper-selection': 'Custom Attribute Mapper',
            'x509-cert-auth.mapper-selection.user-attribute-name': certificates.SUBJECT_ATTRIBUTE,
            'x509-cert-auth.canonical-dn-enabled': 'false',
            'x509-cert-auth.timestamp-validation-enabled': 'true',
            'x509-cert-auth.keyusage': 'digitalSignature',
            'x509-cert-auth.extendedkeyusage': '1.3.6.1.5.5.7.3.2',
            'x509-cert-auth.confirmation-page-disallowed': 'true',
        }
        self.fail_update = False

    def api(self, method, path, body=None):
        if path == '/coder/users/profile':
            return copy.deepcopy(self.profile)
        if path.startswith('/coder/clients?'):
            return [{'id': 'coder-client', 'enabled': True}]
        if path == '/coder/clients/coder-client':
            return {'authenticationFlowBindingOverrides': {'browser': 'certificate-flow'}}
        if path == '/coder/authentication/flows':
            return [{'id': 'certificate-flow', 'alias': 'certificates'}]
        if path == '/coder/authentication/flows/certificates/executions':
            return [{'providerId': 'auth-x509-client-username-form', 'requirement': 'ALTERNATIVE',
                     'authenticationConfig': 'certificate-config'}]
        if path == '/coder/authentication/config/certificate-config':
            return {'config': copy.deepcopy(self.config)}
        if path.startswith('/coder/users?'):
            fields = urllib.parse.parse_qs(urllib.parse.urlsplit(path).query)
            field = 'username' if 'username' in fields else 'email'
            return copy.deepcopy([user for user in self.users.values() if user[field] == fields[field][0]])
        if path == '/coder/users' and method == 'POST':
            identifier = str(uuid.uuid4())
            self.users[identifier] = dict(body, id=identifier)
            return None
        prefix = '/coder/users/'
        if path.startswith(prefix):
            user = self.users[path[len(prefix):]]
            if method == 'PUT':
                # Keycloak user-profile updates clear omitted profile fields.
                for field in ('email', 'firstName', 'lastName'):
                    user.pop(field, None)
                user.update(copy.deepcopy(body))
                if self.fail_update:
                    raise RuntimeError('Provider response lost after update')
                return None
            return copy.deepcopy(user)
        raise AssertionError((method, path))


class Handler:
    def __init__(self, user, body=None, csrf=True, admin=True):
        self.identity, self.csrf, self.admin = user, csrf, admin
        self.rfile = io.BytesIO(json.dumps(body or {}).encode())
        self.headers = {'Content-Length': str(len(self.rfile.getvalue()))}

    def token(self):
        return 'test-session'

    def csrf_ok(self):
        return self.csrf

    def user(self, admin=False):
        if admin and not self.admin:
            self.send_json(403, {})
            return None, True
        return self.identity, None

    def send_json(self, status, body):
        self.status, self.body = status, body


class SigningTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.root = pathlib.Path(cls.directory.name)
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        now = dt.datetime.now(dt.timezone.utc)
        subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Test-only issuer')])
        cls.ca = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject)
                  .public_key(cls.key.public_key()).serial_number(x509.random_serial_number())
                  .not_valid_before(now - dt.timedelta(days=1)).not_valid_after(now + dt.timedelta(days=365))
                  .add_extension(x509.BasicConstraints(ca=True, path_length=0), True)
                  .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), True)
                  .sign(cls.key, hashes.SHA256()))
        (cls.root / 'ca.crt').write_bytes(cls.ca.public_bytes(serialization.Encoding.PEM))
        (cls.root / 'ca.key').write_bytes(cls.key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                                              serialization.BestAvailableEncryption(b'issuer-password')))
        (cls.root / 'password').write_bytes(b'issuer-password')

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def test_encrypted_bundle_has_unique_complete_dn_and_only_client_auth(self):
        identifier = str(uuid.uuid4())
        with mock.patch.dict(os.environ, {'CLIENT_CERTIFICATE_CA_DIR': str(self.root)}):
            result = certificates.sign('admin', identifier, 'device-password', 30)
        bundle = base64.b64decode(result['pkcs12'])
        for password in (None, b'wrong-password'):
            with self.assertRaises(ValueError):
                pkcs12.load_key_and_certificates(bundle, password)
        key, cert, issuers = pkcs12.load_key_and_certificates(bundle, b'device-password')
        self.assertEqual(result['subject'], 'CN=admin, OU=' + identifier)
        self.assertEqual(cert.subject.rfc4514_string(), 'CN=admin,OU=' + identifier)
        self.assertEqual(cert.public_key().public_numbers(), key.public_key().public_numbers())
        self.assertEqual(issuers[0], self.ca)
        self.assertFalse(cert.extensions.get_extension_for_class(x509.BasicConstraints).value.ca)
        self.assertFalse(cert.extensions.get_extension_for_class(x509.KeyUsage).value.key_cert_sign)
        self.assertEqual(list(cert.extensions.get_extension_for_class(x509.ExtendedKeyUsage).value), [ExtendedKeyUsageOID.CLIENT_AUTH])
        cert.verify_directly_issued_by(self.ca)

    def test_rejects_invalid_request_fields_and_unprotected_provider(self):
        request = {'label': 'Phone', 'password': 'device-password', 'days': 90}
        for key, value in [('label', ''), ('label', 'bad\nname'), ('password', 'short'), ('days', True), ('days', 91), ('days', 0)]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                certificates.validate_request(dict(request, **{key: value}))
        provider = Provider()
        certificates.verify_provider(provider, 'coder', 'coder')
        for index in range(2):
            provider.profile['attributes'][index]['permissions']['edit'] = ['admin', 'user']
            with self.assertRaises(RuntimeError):
                certificates.verify_provider(provider, 'coder', 'coder')
            provider.profile['attributes'][index]['permissions']['edit'] = ['admin']
        provider.config['x509-cert-auth.regular-expression'] = 'CN=([^,]+)'
        with self.assertRaises(RuntimeError):
            certificates.verify_provider(provider, 'coder', 'coder')


@unittest.skipUnless(os.environ.get('UI_STATE_TEST_DATABASE_URL'), 'Test Postgres required')
class CertificateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        url = os.environ['UI_STATE_TEST_DATABASE_URL']
        cls.admin_db = pgwire.Connection(url)
        cls.name = 'certificates_test_' + uuid.uuid4().hex
        cls.admin_db.query('CREATE DATABASE ' + cls.name)
        cls.pool = pgwire.Pool(urllib.parse.urlunsplit(urllib.parse.urlsplit(url)._replace(path='/' + cls.name)))
        for sql in ['CREATE SCHEMA coder_ui_updates', 'CREATE TABLE organizations(id uuid PRIMARY KEY)',
                    'CREATE TABLE users(id uuid PRIMARY KEY)', 'CREATE TABLE user_links(user_id uuid,login_type text,linked_id text)']:
            cls.pool.query(sql)
        certificates.READY = False

    @classmethod
    def tearDownClass(cls):
        for connection in cls.pool.idle:
            connection.close()
        cls.admin_db.query('DROP DATABASE ' + cls.name)
        cls.admin_db.close()

    def setUp(self):
        self.org, self.user_id, self.admin_id, self.identity_id = (str(uuid.uuid4()) for _ in range(4))
        self.pool.query('INSERT INTO organizations VALUES($1::uuid)', [self.org])
        self.pool.query('INSERT INTO users VALUES($1::uuid),($2::uuid)', [self.user_id, self.admin_id])
        self.issuer = 'https://identity.example.com/realms/coder'
        self.user = {'id': self.user_id, 'organization_ids': [self.org], 'username': 'user-' + self.user_id[:8],
                     'email': self.user_id + '@example.com', 'login_type': 'oidc', 'status': 'active'}
        self.provider = Provider()
        self.provider.users[self.identity_id] = dict(self.user, id=self.identity_id, enabled=True,
                                                     firstName='Test', lastName='Person', attributes={})
        self.pool.query('INSERT INTO user_links VALUES($1::uuid,$2,$3)', [self.user_id, 'oidc', self.issuer + '||' + self.identity_id])
        self.log = mock.Mock()
        certificates.setup(SimpleNamespace(database=lambda: self.pool), self.log, lambda: (self.provider, 'coder', self.issuer, 'coder'))
        self.auth = mock.patch.object(certificates.volumes, 'coder', side_effect=self.coder).start()
        self.signer = mock.patch.object(certificates, 'sign', side_effect=lambda username, identifier, password, days: {
            'subject': 'CN=' + username + ', OU=' + identifier, 'serial': identifier, 'fingerprint': 'public-fingerprint',
            'expires_at': '2030-01-01T00:00:00Z', 'pkcs12': 'test-only-encrypted-key'}).start()
        mock.patch.dict(os.environ, {'CLIENT_CERTIFICATE_CA_DIR': 'test-only'}).start()
        self.addCleanup(mock.patch.stopall)

    def coder(self, token, method, path, body=None):
        if path.startswith('/api/v2/organizations/'):
            return 200, {'id': self.org}
        if path.startswith('/api/v2/users/'):
            return 200, self.user
        return 200, {'certificates': True}

    def call(self, body=None, org=None, admin=True, csrf=True):
        handler = Handler({'id': self.admin_id}, body, csrf, admin)
        certificates.handle(handler, 'POST' if body else 'GET', '/__coder-ui/api/organizations/' + (org or self.org) + '/users/' + self.user_id + '/client-certificates')
        return handler

    def issue(self, **options):
        return self.call({'action': 'issue', 'label': 'Phone', 'password': 'device-password', 'days': 30}, **options)

    def test_authorization_is_checked_before_signing_or_provider_changes(self):
        self.assertEqual(self.issue(csrf=False).status, 403)
        self.assertEqual(self.issue(admin=False).status, 403)
        self.assertEqual(self.issue(org=str(uuid.uuid4())).status, 403)
        with mock.patch.object(certificates.volumes, 'coder', return_value=(200, {'certificates': False})):
            self.assertEqual(self.issue().status, 403)
        for field, value in [('status', 'suspended'), ('is_service_account', True), ('login_type', 'password')]:
            with mock.patch.dict(self.user, {field: value}):
                self.assertEqual(self.issue().status, 400)
        self.signer.assert_not_called()
        self.assertEqual(self.provider.users[self.identity_id]['attributes'], {})

    def test_issue_inventory_revocation_and_unknown_organization(self):
        first, second = self.issue(), self.issue()
        self.assertEqual(first.status, 200, first.body)
        self.assertEqual(second.status, 200, second.body)
        self.assertNotEqual(first.body['subject'], second.body['subject'])
        subjects = self.provider.users[self.identity_id]['attributes'][certificates.SUBJECT_ATTRIBUTE]
        self.assertEqual(subjects, [first.body['subject'], second.body['subject']])
        inventory = self.call().body
        self.assertEqual(len(inventory['certificates']), 2)
        self.assertNotIn('pkcs12', json.dumps(inventory))
        self.assertNotIn('device-password', json.dumps(inventory))
        self.assertEqual(self.call({'action': 'revoke', 'id': first.body['id']}, org=str(uuid.uuid4())).status, 403)
        self.assertEqual(self.call({'action': 'revoke', 'id': first.body['id']}).status, 200)
        self.assertEqual(self.provider.users[self.identity_id]['attributes'][certificates.SUBJECT_ATTRIBUTE], [second.body['subject']])
        statuses = {item['id']: item['status'] for item in self.call().body['certificates']}
        self.assertEqual(statuses[first.body['id']], 'revoked')
        self.assertEqual(statuses[second.body['id']], 'active')
        self.assertNotIn('device-password', str(self.log.call_args_list))
        self.assertNotIn('test-only-encrypted-key', str(self.log.call_args_list))
        account = self.provider.users[self.identity_id]
        self.assertEqual(account['email'], self.user['email'])
        self.assertEqual(account['firstName'], 'Test')
        self.assertEqual(account['lastName'], 'Person')

    def test_interrupted_provider_update_leaves_revocable_public_record(self):
        self.provider.fail_update = True
        result = self.issue()
        self.assertEqual(result.status, 503)
        self.assertNotIn('pkcs12', result.body)
        inventory = self.call().body['certificates']
        self.assertEqual(len(inventory), 1)
        self.assertEqual(inventory[0]['status'], 'pending')
        self.provider.fail_update = False
        self.assertEqual(self.call({'action': 'revoke', 'id': inventory[0]['id']}).status, 200)
        self.assertEqual(self.provider.users[self.identity_id]['attributes'][certificates.SUBJECT_ATTRIBUTE], [])

    def test_immutable_oidc_binding_rejects_name_collision_disabled_and_foreign_issuer(self):
        self.provider.users[self.identity_id]['enabled'] = False
        self.assertEqual(self.issue().status, 400)
        self.provider.users[self.identity_id]['enabled'] = True
        self.pool.query('UPDATE user_links SET linked_id=$2 WHERE user_id=$1::uuid', [self.user_id, 'https://other.example.com||' + self.identity_id])
        self.assertEqual(self.issue().status, 400)
        self.pool.query('DELETE FROM user_links WHERE user_id=$1::uuid', [self.user_id])
        self.assertEqual(self.issue().status, 400)
        self.signer.assert_not_called()
        del self.provider.users[self.identity_id]
        self.user['name'] = 'Test Person'
        result = self.issue()
        self.assertEqual(result.status, 200, result.body)
        created = next(iter(self.provider.users.values()))
        self.assertEqual(created['attributes'][certificates.ACCOUNT_ATTRIBUTE], [self.user_id])
        self.assertTrue(created['enabled'])
        self.assertEqual(created['firstName'], 'Test')
        self.assertEqual(created['lastName'], 'Person')
        self.assertEqual(created['attributes'][certificates.SUBJECT_ATTRIBUTE], [result.body['subject']])

    def test_limit_is_enforced_across_target_accounts(self):
        certificates.database()
        for _ in range(30):
            identifier = str(uuid.uuid4())
            self.pool.query('''INSERT INTO coder_ui_updates.client_certificates
                (id,organization_id,user_id,issued_by,label,subject,issuer,identity_id,serial,fingerprint,expires_at,status)
                VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'Phone',$1,$5,$6,$1,'public',now()+interval '1 day','revoked')''',
                [identifier, self.org, self.user_id, self.admin_id, self.issuer, self.identity_id])
        result = self.issue()
        self.assertEqual(result.status, 400)
        self.signer.assert_not_called()


if __name__ == '__main__':
    unittest.main()
