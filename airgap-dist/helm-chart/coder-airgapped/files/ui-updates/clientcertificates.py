"""Administrator-issued device credentials, with account binding and revocation."""
import base64
import datetime as dt
import json
import os
import pathlib
import re
import threading
import urllib.parse
import uuid

import workspacevolumes as volumes

ROUTE = re.compile(r'^/__coder-ui/api/organizations/([^/]+)/users/([^/]+)/client-certificates$')
STATE = LOG = PROVIDER = None
READY = False
LOCK = threading.Lock()
SUBJECT_ATTRIBUTE = 'certificateSubjectDN'
ACCOUNT_ATTRIBUTE = 'coderCertificateAccountId'


def setup(state, log, provider):
    global STATE, LOG, PROVIDER
    STATE, LOG, PROVIDER = state, log, provider


def database():
    global READY
    db = STATE.database()
    with LOCK:
        if not READY:
            with db.transaction() as tx:
                tx.query('SELECT pg_advisory_xact_lock(731945, 0)')
                tx.query('''CREATE TABLE IF NOT EXISTS coder_ui_updates.client_certificates (
                    id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
                    user_id uuid NOT NULL REFERENCES users(id), issued_by uuid NOT NULL REFERENCES users(id),
                    label text NOT NULL, subject text NOT NULL UNIQUE, issuer text NOT NULL,
                    identity_id text NOT NULL, serial text NOT NULL UNIQUE, fingerprint text NOT NULL,
                    expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
                    status text NOT NULL CHECK (status IN ('pending', 'active', 'revoked')),
                    revoked_at timestamptz, revoked_by uuid REFERENCES users(id))''')
                tx.query('CREATE INDEX IF NOT EXISTS client_certificates_user ON coder_ui_updates.client_certificates(organization_id,user_id,created_at DESC)')
            READY = True
    return db


def validate_request(body):
    label, password, days = body.get('label'), body.get('password'), body.get('days', 90)
    if not isinstance(label, str) or not 1 <= len(label.strip()) <= 80 or any(ord(c) < 32 for c in label):
        raise ValueError('Enter a device name between 1 and 80 characters.')
    if not isinstance(password, str) or not 12 <= len(password) <= 128 or '\x00' in password:
        raise ValueError('Use a certificate download password between 12 and 128 characters.')
    if type(days) is not int or not 1 <= days <= 90:
        raise ValueError('Certificate lifetime must be between 1 and 90 days.')
    return label.strip(), password, days


def sign(username, identifier, password, days):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives.serialization import pkcs12
    from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

    root = pathlib.Path(os.environ['CLIENT_CERTIFICATE_CA_DIR'])
    ca = x509.load_pem_x509_certificate((root / 'ca.crt').read_bytes())
    issuer_key = serialization.load_pem_private_key((root / 'ca.key').read_bytes(),
                                                   (root / 'password').read_bytes().strip())
    now = dt.datetime.now(dt.timezone.utc)
    expiry = now + dt.timedelta(days=days)
    if ca.not_valid_before_utc > now or ca.not_valid_after_utc < expiry:
        raise ValueError('The certificate authority cannot cover the requested lifetime.')
    if not ca.extensions.get_extension_for_class(x509.BasicConstraints).value.ca:
        raise RuntimeError('The configured issuer is not a certificate authority.')
    if not ca.extensions.get_extension_for_class(x509.KeyUsage).value.key_cert_sign:
        raise RuntimeError('The certificate authority does not permit certificate signing.')
    if issuer_key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo) != ca.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo):
        raise RuntimeError('Certificate authority key mismatch.')
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}', username):
        raise ValueError('This username cannot be represented in a device certificate.')
    key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    subject = x509.Name([x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, identifier),
                         x509.NameAttribute(NameOID.COMMON_NAME, username)])
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(ca.subject)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - dt.timedelta(minutes=1)).not_valid_after(expiry)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(x509.KeyUsage(True, False, False, False, False, False, False, False, False), critical=True)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.CLIENT_AUTH]), critical=True)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
            .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca.public_key()), critical=False)
            .sign(issuer_key, hashes.SHA256()))
    bundle = pkcs12.serialize_key_and_certificates(('Coder ' + username).encode(), key, cert, [ca],
                                                  serialization.BestAvailableEncryption(password.encode()))
    # Keycloak's non-canonical SubjectDN mapper uses Java's comma-space separators.
    mapped_subject = ', '.join(rdn.rfc4514_string() for rdn in reversed(subject.rdns))
    return {'subject': mapped_subject, 'serial': format(cert.serial_number, 'x'),
            'fingerprint': cert.fingerprint(hashes.SHA256()).hex(), 'expires_at': expiry.isoformat(),
            'pkcs12': base64.b64encode(bundle).decode()}


def verify_provider(kc, realm, client_id):
    """Only issue credentials when the provider protects exact, revocable DN bindings."""
    base = '/' + urllib.parse.quote(realm, safe='')
    profile = kc.api('GET', base + '/users/profile')
    attributes = {item['name']: item for item in profile.get('attributes', [])}
    for name in (SUBJECT_ATTRIBUTE, ACCOUNT_ATTRIBUTE):
        permissions = attributes.get(name, {}).get('permissions', {})
        if permissions.get('edit') != ['admin'] or 'user' in permissions.get('view', []):
            raise RuntimeError('Certificate account attributes must be managed exclusively by administrators.')
    clients = kc.api('GET', base + '/clients?' + urllib.parse.urlencode({'clientId': client_id}))
    if len(clients) != 1 or not clients[0].get('enabled'):
        raise RuntimeError('The configured Coder sign-in client is unavailable.')
    client = kc.api('GET', base + '/clients/' + urllib.parse.quote(clients[0]['id'], safe=''))
    flow_id = client.get('authenticationFlowBindingOverrides', {}).get('browser')
    flows = kc.api('GET', base + '/authentication/flows')
    flow = next((flow for flow in flows if flow.get('id') == flow_id), None)
    if not flow:
        raise RuntimeError('The Coder client requires a dedicated certificate sign-in flow.')
    executions = kc.api('GET', base + '/authentication/flows/' + urllib.parse.quote(flow['alias'], safe='') + '/executions')
    enabled = [entry for entry in executions if entry.get('providerId') == 'auth-x509-client-username-form'
               and entry.get('requirement') in ('ALTERNATIVE', 'REQUIRED')]
    if len(enabled) != 1 or not enabled[0].get('authenticationConfig'):
        raise RuntimeError('Certificate sign-in is not configured on the Coder client.')
    config = kc.api('GET', base + '/authentication/config/' + urllib.parse.quote(enabled[0]['authenticationConfig'], safe=''))['config']
    expected = {
        'x509-cert-auth.mapping-source-selection': 'Match SubjectDN using regular expression',
        'x509-cert-auth.regular-expression': '^(.+)$',
        'x509-cert-auth.mapper-selection': 'Custom Attribute Mapper',
        'x509-cert-auth.mapper-selection.user-attribute-name': SUBJECT_ATTRIBUTE,
        'x509-cert-auth.canonical-dn-enabled': 'false',
        'x509-cert-auth.timestamp-validation-enabled': 'true',
        'x509-cert-auth.keyusage': 'digitalSignature',
        'x509-cert-auth.extendedkeyusage': '1.3.6.1.5.5.7.3.2',
        'x509-cert-auth.confirmation-page-disallowed': 'true',
    }
    if any(config.get(key) != value for key, value in expected.items()):
        raise RuntimeError('Certificate sign-in must validate client credentials and map their complete subject DN.')


def identity(db, kc, realm, issuer, user):
    """Resolve existing identities by immutable OIDC subject, never by name alone."""
    base = '/' + urllib.parse.quote(realm, safe='') + '/users'
    links = db.query("SELECT linked_id FROM user_links WHERE user_id=$1::uuid AND login_type='oidc'", [user['id']])
    linked = links[0][0] if links else ''
    if linked:
        prefix = issuer.rstrip('/') + '||'
        if not linked.startswith(prefix):
            raise ValueError('This account is linked to a different sign-in provider.')
        subject = linked[len(prefix):]
        if not subject:
            raise ValueError('The account has an invalid sign-in provider identity.')
        current = kc.api('GET', base + '/' + urllib.parse.quote(subject, safe=''))
        if current.get('id') != subject:
            raise RuntimeError('The sign-in provider returned a different identity.')
        if not current.get('enabled'):
            raise ValueError('Enable this account in the sign-in provider before issuing a certificate.')
        return current
    by_name = kc.api('GET', base + '?' + urllib.parse.urlencode({'username': user['username'], 'exact': 'true'}))
    by_email = kc.api('GET', base + '?' + urllib.parse.urlencode({'email': user['email'], 'exact': 'true'}))
    matches = {entry['id']: entry for entry in by_name + by_email}
    if matches:
        if len(matches) != 1:
            raise ValueError('Conflicting sign-in identities exist. Link the account before issuing a certificate.')
        current = next(iter(matches.values()))
        if (current.get('attributes', {}).get(ACCOUNT_ATTRIBUTE) != [user['id']] or
                current.get('username', '').lower() != user['username'].lower() or
                current.get('email', '').lower() != user['email'].lower()):
            raise ValueError('Sign in through the existing provider once to link this account before issuing a certificate.')
        if not current.get('enabled'):
            raise ValueError('Enable this account in the sign-in provider before issuing a certificate.')
        return current
    name = user.get('name', '').strip().split(maxsplit=1)
    kc.api('POST', base, {'username': user['username'], 'email': user['email'], 'emailVerified': True,
                         'firstName': name[0] if name else '', 'lastName': name[1] if len(name) > 1 else '',
                         'enabled': True, 'attributes': {ACCOUNT_ATTRIBUTE: [user['id']]}})
    matches = kc.api('GET', base + '?' + urllib.parse.urlencode({'username': user['username'], 'exact': 'true'}))
    if len(matches) != 1 or matches[0].get('attributes', {}).get(ACCOUNT_ATTRIBUTE) != [user['id']]:
        raise RuntimeError('Could not verify the new sign-in identity.')
    return matches[0]


def inventory(db, organization, user_id):
    rows = db.query('''SELECT row_to_json(c)::text FROM (
        SELECT id,label,subject,serial,fingerprint,expires_at,created_at,status,revoked_at
        FROM coder_ui_updates.client_certificates WHERE organization_id=$1::uuid AND user_id=$2::uuid
        ORDER BY created_at DESC) c''', [organization, user_id])
    return [json.loads(row[0]) for row in rows]


def handle(h, method, path):
    capability = path == '/__coder-ui/api/client-certificates'
    match = ROUTE.fullmatch(path)
    if not capability and not match:
        return False
    if method not in ('GET', 'POST') or (method == 'POST' and not h.csrf_ok()):
        h.send_json(403, {'error': 'Request rejected (cross-site protection).'})
        return True
    admin, error = h.user(admin=True)
    if error:
        return True
    try:
        enabled = bool(os.environ.get('CLIENT_CERTIFICATE_CA_DIR'))
        if capability and method == 'GET':
            h.send_json(200, {'enabled': enabled})
            return True
        if not enabled:
            raise ValueError('Device certificate issuance is not configured on this deployment.')
        if not match:
            raise ValueError('Invalid certificate action.')
        organization, user_id = str(uuid.UUID(match[1])), str(uuid.UUID(match[2]))
        status, org = volumes.coder(h.token(), 'GET', '/api/v2/organizations/' + organization)
        if status != 200:
            raise PermissionError('This organization is not accessible.')
        status, user = volumes.coder(h.token(), 'GET', '/api/v2/users/' + user_id)
        if status != 200 or organization not in user.get('organization_ids', []):
            raise PermissionError('This account is not accessible in this organization.')
        permission = 'update' if method == 'POST' else 'read'
        status, result = volumes.coder(h.token(), 'POST', '/api/v2/authcheck', {'checks': {
            'certificates': {'action': permission, 'object': {'resource_type': 'user', 'resource_id': user_id}}}})
        if status != 200 or not isinstance(result, dict) or result.get('certificates') is not True:
            raise PermissionError('Your session cannot manage certificates for this account.')
        db = database()
        if method == 'GET':
            h.send_json(200, {'certificates': inventory(db, organization, user_id)})
            return True
        body = volumes.read_json(h)
        action = body.get('action')
        kc, realm, issuer, client_id = PROVIDER()
        # Issuance and revocation serialize across replicas for an entire identity.
        with db.transaction() as tx:
            tx.query('SELECT pg_advisory_xact_lock(731945, hashtext($1))', [user_id])
            if action == 'issue':
                if user.get('login_type') != 'oidc' or user.get('is_service_account') or user.get('status') == 'suspended':
                    raise ValueError('Certificates require an enabled OpenID Connect user account.')
                label, password, days = validate_request(body)
                verify_provider(kc, realm, client_id)
                tx.query('SELECT pg_advisory_xact_lock(731946, hashtext($1))', [admin['id']])
                count = int(tx.query('''SELECT count(*) FROM coder_ui_updates.client_certificates
                    WHERE issued_by=$1::uuid AND created_at > now()-interval '1 hour' ''', [admin['id']])[0][0])
                if count >= 30:
                    raise ValueError('Certificate issuance limit reached. Try again in an hour.')
                current = identity(tx, kc, realm, issuer, user)
                identifier = str(uuid.uuid4())
                credential = sign(user['username'], identifier, password, days)
                # Commit the public audit record before calling the identity provider.
                # An interrupted operation remains revocable, even if the response is lost.
                db.query('''INSERT INTO coder_ui_updates.client_certificates
                    (id,organization_id,user_id,issued_by,label,subject,issuer,identity_id,serial,fingerprint,expires_at,status)
                    VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11::timestamptz,'pending')''',
                    [identifier, organization, user_id, admin['id'], label, credential['subject'], issuer,
                     current['id'], credential['serial'], credential['fingerprint'], credential['expires_at']])
                attributes = dict(current.get('attributes') or {})
                attributes[SUBJECT_ATTRIBUTE] = list(dict.fromkeys([*attributes.get(SUBJECT_ATTRIBUTE, []), credential['subject']]))
                kc.api('PUT', '/' + realm + '/users/' + urllib.parse.quote(current['id'], safe=''),
                       {**current, 'attributes': attributes})
                tx.query("UPDATE coder_ui_updates.client_certificates SET status='active' WHERE id=$1::uuid", [identifier])
                output = {**credential, 'id': identifier, 'filename': user['username'] + '-' + identifier[:8] + '.p12'}
            elif action == 'revoke':
                identifier = str(uuid.UUID(body.get('id', '')))
                rows = tx.query('''SELECT subject,identity_id,issuer FROM coder_ui_updates.client_certificates
                    WHERE id=$1::uuid AND organization_id=$2::uuid AND user_id=$3::uuid''', [identifier, organization, user_id])
                if not rows:
                    raise LookupError('Certificate not found in this organization.')
                subject, identity_id, issued_at = rows[0]
                if issued_at != issuer:
                    raise ValueError('Restore the original sign-in provider to revoke this certificate.')
                account_path = '/' + realm + '/users/' + urllib.parse.quote(identity_id, safe='')
                current = kc.api('GET', account_path)
                attributes = dict(current.get('attributes') or {})
                attributes[SUBJECT_ATTRIBUTE] = [dn for dn in attributes.get(SUBJECT_ATTRIBUTE, []) if dn != subject]
                kc.api('PUT', account_path, {**current, 'attributes': attributes})
                tx.query("UPDATE coder_ui_updates.client_certificates SET status='revoked',revoked_at=now(),revoked_by=$2::uuid WHERE id=$1::uuid", [identifier, admin['id']])
                output = {'revoked': True}
            else:
                raise ValueError('Unknown certificate action.')
        LOG(event='client-certificate-' + action, certificate=identifier, organization=organization, user=user_id, by=admin['id'])
        h.send_json(200, output)
    except (ValueError, TypeError, AttributeError) as error:
        h.send_json(400, {'error': str(error)})
    except PermissionError as error:
        h.send_json(403, {'error': str(error)})
    except LookupError as error:
        h.send_json(404, {'error': str(error)})
    except Exception:
        # Provider error bodies can include account attributes. Never log credential material.
        LOG(event='client-certificate-failed')
        h.send_json(503, {'error': 'Certificate operation could not be completed. Check the account certificate list before retrying.'})
    return True
