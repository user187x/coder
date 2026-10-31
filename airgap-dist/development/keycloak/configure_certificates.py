#!/usr/bin/env python3
"""Configure verified, exact-DN certificate authentication for the Coder OIDC client."""
import argparse
import base64
import json
import subprocess
import urllib.parse
import urllib.request


ATTRIBUTES = ('certificateSubjectDN', 'coderCertificateAccountId')
FLOW = 'coder-device-certificate'


def configure(api, realm, client_id):
    base = urllib.parse.quote(realm, safe='')
    clients = api(base + '/clients?' + urllib.parse.urlencode({'clientId': client_id}))
    if len(clients) != 1 or not clients[0].get('enabled'):
        raise RuntimeError('Expected one enabled Coder client.')
    client = api(base + '/clients/' + urllib.parse.quote(clients[0]['id'], safe=''))
    profile = api(base + '/users/profile')
    attributes = profile.setdefault('attributes', [])
    by_name = {entry['name']: entry for entry in attributes}
    unprotected = [name for name in ATTRIBUTES if by_name.get(name, {}).get('permissions', {}).get('edit') != ['admin']]
    # Never promote a potentially self-assigned attribute into a sign-in credential.
    if unprotected:
        offset = 0
        while True:
            users = api(base + '/users?' + urllib.parse.urlencode({'first': offset, 'max': 100, 'briefRepresentation': 'false'}))
            if any(user.get('attributes', {}).get(name) for user in users for name in unprotected):
                raise RuntimeError('Existing unprotected certificate attributes need an administrator audit before configuring sign-in.')
            if len(users) < 100:
                break
            offset += len(users)
    for name in ATTRIBUTES:
        entry = by_name.get(name)
        if entry is None:
            entry = {'name': name}
            attributes.append(entry)
        entry.update({'multivalued': name == ATTRIBUTES[0], 'permissions': {'view': ['admin'], 'edit': ['admin']}})
    # Coder permits accounts without a display name, including device-only users.
    for name in ('firstName', 'lastName'):
        if name in by_name:
            by_name[name].pop('required', None)
    api(base + '/users/profile', 'PUT', profile)
    flows = api(base + '/authentication/flows')
    if not any(flow['alias'] == FLOW for flow in flows):
        api(base + '/authentication/flows/browser/copy', 'POST', {'newName': FLOW})
    flow_path = base + '/authentication/flows/' + FLOW
    executions = api(flow_path + '/executions')
    matches = [entry for entry in executions if entry.get('providerId') == 'auth-x509-client-username-form']
    if len(matches) > 1:
        raise RuntimeError('Multiple certificate authenticators require manual review.')
    if not matches:
        api(flow_path + '/executions/execution', 'POST', {'provider': 'auth-x509-client-username-form'})
        matches = [entry for entry in api(flow_path + '/executions') if entry.get('providerId') == 'auth-x509-client-username-form']
    execution = matches[0]
    execution['requirement'] = 'ALTERNATIVE'
    api(flow_path + '/executions', 'PUT', execution)
    config = {'alias': 'verified-device-subject', 'config': {
        'x509-cert-auth.mapping-source-selection': 'Match SubjectDN using regular expression',
        'x509-cert-auth.regular-expression': '^(.+)$',
        'x509-cert-auth.mapper-selection': 'Custom Attribute Mapper',
        'x509-cert-auth.mapper-selection.user-attribute-name': ATTRIBUTES[0],
        'x509-cert-auth.canonical-dn-enabled': 'false',
        'x509-cert-auth.timestamp-validation-enabled': 'true',
        'x509-cert-auth.keyusage': 'digitalSignature',
        'x509-cert-auth.extendedkeyusage': '1.3.6.1.5.5.7.3.2',
        'x509-cert-auth.confirmation-page-disallowed': 'true',
        'x509-cert-auth.crl-checking-enabled': 'true',
        'x509-cert-auth.crl-relative-path': 'client-auth/clients.crl.pem',
        'x509-cert-auth-crl-abort-if-non-updated': 'true',
        'x509-cert-auth.ocsp-checking-enabled': 'false',
    }}
    if execution.get('authenticationConfig'):
        api(base + '/authentication/config/' + execution['authenticationConfig'], 'PUT', config)
    else:
        api(base + '/authentication/executions/' + execution['id'] + '/config', 'POST', config)
    for _ in range(len(executions) + 1):
        api(base + '/authentication/executions/' + execution['id'] + '/raise-priority', 'POST')
    flows = api(base + '/authentication/flows')
    client.setdefault('authenticationFlowBindingOverrides', {})['browser'] = next(flow['id'] for flow in flows if flow['alias'] == FLOW)
    api(base + '/clients/' + client['id'], 'PUT', client)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True, help='Public HTTPS Keycloak origin')
    parser.add_argument('--namespace', default='coder')
    parser.add_argument('--admin-secret', default='coder-keycloak-admin')
    parser.add_argument('--realm', default='coder')
    parser.add_argument('--client-id', default='coder')
    args = parser.parse_args()
    origin = urllib.parse.urlsplit(args.url)
    if origin.scheme != 'https' or not origin.hostname or origin.username or origin.password or origin.path not in ('', '/') or origin.query or origin.fragment:
        parser.error('Use a bare HTTPS Keycloak origin.')
    url = args.url.rstrip('/')
    result = subprocess.run(['kubectl', '-n', args.namespace, 'get', 'secret', args.admin_secret, '-o', 'json'], capture_output=True, text=True, check=True)
    secret = json.loads(result.stdout)['data']
    request = urllib.request.Request(url + '/realms/master/protocol/openid-connect/token', data=urllib.parse.urlencode({
        'client_id': 'admin-cli', 'grant_type': 'password',
        'username': base64.b64decode(secret['username']).decode(),
        'password': base64.b64decode(secret['password']).decode(),
    }).encode())
    with urllib.request.urlopen(request, timeout=20) as response:
        token = json.load(response)['access_token']

    def api(path, method='GET', body=None):
        request = urllib.request.Request(url + '/admin/realms/' + path, method=method,
                                         headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
                                         data=json.dumps(body).encode() if body is not None else None)
        with urllib.request.urlopen(request, timeout=20) as response:
            data = response.read()
            return json.loads(data) if data else None

    configure(api, args.realm, args.client_id)
    print('Coder certificate authentication configured. Existing password recovery is retained.')


if __name__ == '__main__':
    main()
