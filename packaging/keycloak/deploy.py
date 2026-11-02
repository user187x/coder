#!/usr/bin/env python3
"""Deploy persistent Keycloak on an existing Coder cluster without disabling password recovery."""
import argparse
import base64
import json
import re
import secrets
import subprocess
import pathlib
import urllib.request
from urllib.parse import urlparse


def run(kube, *arguments, payload=None):
    result = subprocess.run(kube + list(arguments), input=json.dumps(payload) if payload is not None else None,
                            text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout) if result.stdout.strip() else None


def secret(kube, namespace, name, values):
    result = subprocess.run(kube + ['get', 'secret', name, '-o', 'json'], text=True, capture_output=True)
    if result.returncode:
        if '(NotFound)' not in result.stderr:
            raise RuntimeError(result.stderr.strip())
        apply(kube, [{'apiVersion': 'v1', 'kind': 'Secret', 'metadata': {'name': name, 'namespace': namespace},
                      'type': 'Opaque', 'stringData': values}])
        return values
    existing = json.loads(result.stdout)['data']
    return {key: base64.b64decode(existing[key]).decode() for key in values}


def apply(kube, resources):
    run(kube, 'apply', '-f', '-', '-o', 'json', payload={'apiVersion': 'v1', 'kind': 'List', 'items': resources})


def resources(namespace, cluster, hostname, coder_url, image, client_secret,
              server_tls='coder-keycloak-server-tls', client_auth='coder-client-auth'):
    metadata = lambda name: {'name': name, 'namespace': namespace}
    labels = {'app.kubernetes.io/name': 'coder-keycloak'}
    realm = {'realm': 'coder', 'enabled': True, 'registrationAllowed': False, 'sslRequired': 'external',
             'bruteForceProtected': True, 'loginWithEmailAllowed': True,
             'clients': [{'clientId': 'coder', 'enabled': True, 'publicClient': False,
                          'clientAuthenticatorType': 'client-secret', 'secret': client_secret,
                          'standardFlowEnabled': True, 'directAccessGrantsEnabled': False,
                          'redirectUris': [coder_url.rstrip('/') + '/api/v2/users/oidc/callback'],
                          'webOrigins': [coder_url.rstrip('/')], 'defaultClientScopes': ['profile', 'email']}]}
    env = [{'name': name, 'value': value} for name, value in {
        'KC_DB': 'postgres', 'KC_DB_URL': 'jdbc:postgresql://' + cluster + '-rw.' + namespace + '.svc:5432/keycloak?sslmode=verify-full&sslrootcert=/etc/keycloak-db-ca/ca.crt',
        'KC_HOSTNAME': 'https://' + hostname, 'KC_HTTP_ENABLED': 'false',
        'KC_HTTPS_CERTIFICATE_FILE': '/opt/keycloak/conf/server-tls/tls.crt',
        'KC_HTTPS_CERTIFICATE_KEY_FILE': '/opt/keycloak/conf/server-tls/tls.key',
        'KC_HTTPS_CLIENT_AUTH': 'request',
        'KC_HTTPS_TRUST_STORE_FILE': '/opt/keycloak/conf/client-auth/ca.crt',
        'KC_HTTPS_TRUST_STORE_TYPE': 'PEM',
        'KC_HTTP_MANAGEMENT_SCHEME': 'https', 'KC_HTTPS_MANAGEMENT_CLIENT_AUTH': 'none',
        'KC_HEALTH_ENABLED': 'true', 'KC_CACHE': 'local', 'KC_DB_USERNAME': 'keycloak',
    }.items()]
    for name, reference, key in [('KC_DB_PASSWORD', 'coder-keycloak-db', 'password'),
                                 ('KC_BOOTSTRAP_ADMIN_USERNAME', 'coder-keycloak-admin', 'username'),
                                 ('KC_BOOTSTRAP_ADMIN_PASSWORD', 'coder-keycloak-admin', 'password')]:
        env.append({'name': name, 'valueFrom': {'secretKeyRef': {'name': reference, 'key': key}}})
    return [
        {'apiVersion': 'postgresql.cnpg.io/v1', 'kind': 'Database', 'metadata': metadata('coder-keycloak'),
         'spec': {'name': 'keycloak', 'owner': 'keycloak', 'cluster': {'name': cluster},
                  'ensure': 'present', 'databaseReclaimPolicy': 'retain'}},
        {'apiVersion': 'v1', 'kind': 'Secret', 'metadata': metadata('coder-keycloak-realm'),
         'type': 'Opaque', 'stringData': {'coder-realm.json': json.dumps(realm)}},
        {'apiVersion': 'apps/v1', 'kind': 'Deployment', 'metadata': metadata('coder-keycloak'),
         'spec': {'replicas': 1, 'strategy': {'type': 'Recreate'}, 'selector': {'matchLabels': labels},
                  'template': {'metadata': {'labels': labels}, 'spec': {
                      'automountServiceAccountToken': False,
                      'securityContext': {'runAsNonRoot': True, 'runAsUser': 1000, 'fsGroup': 1000,
                                          'seccompProfile': {'type': 'RuntimeDefault'}},
                      'containers': [{'name': 'keycloak', 'image': image, 'args': ['start', '--import-realm'],
                                      'env': env, 'ports': [{'name': 'https', 'containerPort': 8443}, {'name': 'health', 'containerPort': 9000}],
                                      'securityContext': {'allowPrivilegeEscalation': False, 'capabilities': {'drop': ['ALL']}},
                                      'resources': {'requests': {'cpu': '250m', 'memory': '512Mi'}, 'limits': {'cpu': '2', 'memory': '2Gi'}},
                                      'startupProbe': {'httpGet': {'path': '/health/started', 'port': 'health', 'scheme': 'HTTPS'}, 'failureThreshold': 60, 'periodSeconds': 5},
                                      'readinessProbe': {'httpGet': {'path': '/health/ready', 'port': 'health', 'scheme': 'HTTPS'}, 'periodSeconds': 5},
                                      'livenessProbe': {'httpGet': {'path': '/health/live', 'port': 'health', 'scheme': 'HTTPS'}, 'periodSeconds': 10},
                                      'volumeMounts': [{'name': 'realm', 'mountPath': '/opt/keycloak/data/import', 'readOnly': True},
                                                       {'name': 'db-ca', 'mountPath': '/etc/keycloak-db-ca', 'readOnly': True},
                                                       {'name': 'server-tls', 'mountPath': '/opt/keycloak/conf/server-tls', 'readOnly': True},
                                                       {'name': 'client-auth', 'mountPath': '/opt/keycloak/conf/client-auth', 'readOnly': True}]}],
                      'volumes': [{'name': 'realm', 'secret': {'secretName': 'coder-keycloak-realm'}},
                                  {'name': 'db-ca', 'secret': {'secretName': cluster + '-ca'}},
                                  {'name': 'server-tls', 'secret': {'secretName': server_tls, 'defaultMode': 0o440}},
                                  {'name': 'client-auth', 'configMap': {'name': client_auth}}]}}}},
        {'apiVersion': 'v1', 'kind': 'Service', 'metadata': metadata('coder-keycloak-tls'),
         'spec': {'selector': labels, 'ports': [{'name': 'https', 'port': 8443, 'targetPort': 'https'}]}},
        {'apiVersion': 'gateway.networking.k8s.io/v1', 'kind': 'Gateway', 'metadata': metadata('coder-keycloak-client-auth'),
         'spec': {'gatewayClassName': 'traefik', 'listeners': [
             {'name': 'client-auth', 'hostname': hostname, 'port': 8443, 'protocol': 'TLS',
              'tls': {'mode': 'Passthrough'}, 'allowedRoutes': {'namespaces': {'from': 'Same'}}}]}},
        {'apiVersion': 'gateway.networking.k8s.io/v1', 'kind': 'TLSRoute', 'metadata': metadata('coder-keycloak-client-auth'),
         'spec': {'hostnames': [hostname], 'parentRefs': [{'name': 'coder-keycloak-client-auth', 'sectionName': 'client-auth'}],
                  'rules': [{'backendRefs': [{'name': 'coder-keycloak-tls', 'port': 8443}]}]}},
        {'apiVersion': 'networking.k8s.io/v1', 'kind': 'NetworkPolicy', 'metadata': metadata('coder-keycloak'),
         'spec': {'podSelector': {'matchLabels': labels}, 'policyTypes': ['Ingress'],
                  'ingress': [{'from': [{'podSelector': {'matchLabels': {'app.kubernetes.io/name': 'traefik'}}}],
                               'ports': [{'protocol': 'TCP', 'port': 8443}]}]}},
    ]


def gateway_values(hostname):
    """Return a bundled Traefik rule for sign-in requests on a reused dashboard connection."""
    # HostRegexp matches the HTTP authority without claiming Keycloak's TLS SNI.
    # A fresh connection must still reach Keycloak's own certificate listener.
    rule = 'HostRegexp(' + json.dumps('^' + re.escape(hostname) + r'\.?$') + ')'
    router = {'entryPoints': ['websecure'], 'rule': rule, 'priority': 1_000_000,
              'tls': {}, 'middlewares': ['keycloak-no-cache', 'keycloak-retry'], 'service': 'noop@internal'}
    # Traefik's noop service returns 418. Map it to the HTTP/2 fresh-connection response.
    middlewares = {
        'keycloak-retry': {'errors': {'status': ['418'], 'statusRewrites': {'418': 421},
                                      'service': 'noop@internal', 'query': '/'}},
        'keycloak-no-cache': {'headers': {'customResponseHeaders': {'Cache-Control': 'no-store'}}},
    }
    return {'providers': {'file': {'enabled': True, 'content': {'http': {
        'routers': {'keycloak-misdirected': router}, 'middlewares': middlewares}}}}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--connect-coder', action='store_true', help='Connect Coder after verifying public issuer discovery; keep password login enabled')
    parser.add_argument('--values-output', type=pathlib.Path, help='Save Helm values for OIDC and the bundled Traefik sign-in route')
    parser.add_argument('--server-tls-secret', default='coder-keycloak-server-tls', help='Existing exact-host TLS certificate Secret (tls.crt and tls.key)')
    parser.add_argument('--client-auth-configmap', default='coder-client-auth', help='Existing client CA and CRL ConfigMap (ca.crt and clients.crl.pem)')
    parser.add_argument('--client-certificate-issuer-secret', help='Existing encrypted device certificate issuer Secret (ca.crt, ca.key and password)')
    parser.add_argument('--namespace', default='coder')
    parser.add_argument('--cluster', default='coder-db')
    parser.add_argument('--hostname', required=True)
    parser.add_argument('--coder-url', required=True)
    parser.add_argument('--image', default='quay.io/keycloak/keycloak:26.7.3@sha256:e03b95891c214fba3ab72f12f40c983211549e817c5fce8d0f37761db04ae185')
    args = parser.parse_args()
    if not urlparse(args.coder_url).scheme == 'https' or urlparse('https://' + args.hostname).netloc != args.hostname:
        parser.error('Use an HTTPS Coder URL and a bare Keycloak hostname.')
    kube = ['kubectl', '-n', args.namespace]
    if args.client_certificate_issuer_secret:
        material = run(kube, 'get', 'secret', args.client_certificate_issuer_secret, '-o', 'json')
        if any(not material.get('data', {}).get(key) for key in ('ca.crt', 'ca.key', 'password')):
            raise RuntimeError('The device certificate issuer Secret lacks required signing material.')
    for kind, name, keys in [('secret', args.server_tls_secret, ('tls.crt', 'tls.key')),
                             ('configmap', args.client_auth_configmap, ('ca.crt', 'clients.crl.pem'))]:
        material = run(kube, 'get', kind, name, '-o', 'json')
        if any(not material.get('data', {}).get(key) for key in keys):
            raise RuntimeError(kind + '/' + name + ' lacks required TLS material.')
    secret(kube, args.namespace, 'coder-keycloak-db', {'username': 'keycloak', 'password': secrets.token_urlsafe(40)})
    secret(kube, args.namespace, 'coder-keycloak-admin', {'username': 'keycloak-admin', 'password': secrets.token_urlsafe(40)})
    client = secret(kube, args.namespace, 'keycloaking-coder-oidc', {'client-secret': secrets.token_urlsafe(40)})
    cluster = run(kube, 'get', 'cluster', args.cluster, '-o', 'json')
    roles = cluster['spec'].get('managed', {}).get('roles', [])
    expected = {'name': 'keycloak', 'ensure': 'present', 'login': True, 'superuser': False,
                'createdb': False, 'createrole': False, 'passwordSecret': {'name': 'coder-keycloak-db'}}
    existing = next((role for role in roles if role['name'] == 'keycloak'), None)
    if existing and any(existing.get(key) != value for key, value in expected.items()):
        raise RuntimeError('Existing keycloak database role differs from this deployment; inspect it before proceeding.')
    if not existing:
        patch = {'metadata': {'resourceVersion': cluster['metadata']['resourceVersion']}, 'spec': {'managed': {**cluster['spec'].get('managed', {}), 'roles': roles + [expected]}}}
        run(kube, 'patch', 'cluster', args.cluster, '--type=merge', '-p', json.dumps(patch), '-o', 'json')
    apply(kube, resources(args.namespace, args.cluster, args.hostname, args.coder_url, args.image, client['client-secret'], args.server_tls_secret, args.client_auth_configmap))
    # TLS passes through to Keycloak so identity never relies on client-supplied headers.
    run(kube, 'delete', 'httproute', 'coder-keycloak', '--ignore-not-found', '-o', 'json')
    run(kube, 'delete', 'service', 'coder-keycloak', '--ignore-not-found', '-o', 'json')
    issuer = 'https://' + args.hostname + '/realms/coder'
    if args.values_output:
        overrides = {'global': {'disablePasswordAuth': 'false', 'oidc': {
            'issuerUrl': issuer, 'clientId': 'coder', 'signInText': 'Sign in with Keycloak',
            'ignoreEmailVerified': 'false',
        }}, 'uiUpdates': {'keycloak': {'enabled': True, 'namespace': args.namespace, 'adminSecret': 'coder-keycloak-admin'}},
            'traefik': gateway_values(args.hostname)}
        if args.client_certificate_issuer_secret:
            overrides['uiUpdates']['clientCertificates'] = {'enabled': True, 'issuerSecret': args.client_certificate_issuer_secret}
        args.values_output.write_text(json.dumps(overrides, indent=2) + '\n')
        print('Apply %s to the Coder Helm release to configure sign-in routing.' % args.values_output)
    if args.connect_coder:
        with urllib.request.urlopen(issuer + '/.well-known/openid-configuration', timeout=15) as response:
            if json.load(response).get('issuer') != issuer:
                raise RuntimeError('Public discovery does not match the configured issuer.')
        deployment = run(kube, 'get', 'deployment', 'coder', '-o', 'json')
        env = [{'name': key, 'value': value} for key, value in {
            'CODER_OIDC_ISSUER_URL': issuer, 'CODER_OIDC_SIGN_IN_TEXT': 'Sign in with Keycloak',
            'CODER_OIDC_IGNORE_EMAIL_VERIFIED': 'false', 'CODER_DISABLE_PASSWORD_AUTH': 'false',
        }.items()]
        patch = {'spec': {'template': {'spec': {'containers': [{
            'name': deployment['spec']['template']['spec']['containers'][0]['name'], 'env': env,
        }]}}}}
        run(kube, 'patch', 'deployment', 'coder', '--type=strategic', '-p', json.dumps(patch), '-o', 'json')
    print('Keycloak resources applied. Wait for deployment/coder-keycloak before enabling its issuer in Coder.')
    print('Issuer: https://' + args.hostname + '/realms/coder')
    print('Bootstrap admin credentials: Secret ' + args.namespace + '/coder-keycloak-admin')


if __name__ == '__main__':
    main()
