#!/usr/bin/env python3
"""Check or renew internal serving certificates using the retained Kubernetes issuer.

Run `check` from operator monitoring at least daily; it exits nonzero within 30 days
of expiry. Run `renew` before expiry or after changing the public Coder hostname.
Renewal preserves the trust root and restarts each serving deployment so it loads
the new leaf. The signing key is never mounted into a service or workspace.

Requires openssl, kubectl, and operator access to the named TLS Secrets and serving
deployments. Back up issuer Secrets with the cluster's encrypted secret backups.
Root replacement is a separate maintenance operation; this command refuses to
issue a leaf that would outlive its issuer.
"""
import argparse
import base64
import hashlib
import json
import re
import subprocess
import tempfile
from pathlib import Path

SERVICES = ('coder', 'coder-ui-updates', 'coder-ui-logs-db')
DNS_NAME = re.compile(r'^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$')


def command(args, *, data=None):
    result = subprocess.run(args, input=data, capture_output=True, check=False)
    if result.returncode:
        # kubectl errors may echo Secret payloads. Never print stderr or request data.
        raise RuntimeError('%s command failed (exit %s)' % (args[0], result.returncode))
    return result.stdout


def names(service, namespace, hostname):
    result = [service, f'{service}.{namespace}.svc', f'{service}.{namespace}.svc.cluster.local', 'localhost']
    if service == 'coder':
        result.append(hostname)
    if not all(DNS_NAME.fullmatch(name) for name in result):
        raise ValueError('Invalid DNS name')
    return list(dict.fromkeys(result))


def check_certificate(certificate, dns_names, seconds):
    """Reject imminent expiration or a missing service/public hostname."""
    for argument in [['-checkend', str(seconds)], *[['-checkhost', name] for name in dns_names]]:
        command(['openssl', 'x509', '-noout', *argument], data=certificate)


def sign(ca, key, service, dns_names, days=365):
    """Issue a fresh leaf without changing clients' trust anchors."""
    check_certificate(ca, [], (days + 1) * 86400)
    with tempfile.TemporaryDirectory(prefix='coder-internal-tls-') as temporary:
        directory = Path(temporary)
        for name, content in [('ca.pem', ca), ('ca.key', key)]:
            path = directory / name
            path.write_bytes(content)
            path.chmod(0o600)
        public_cert = command(['openssl', 'x509', '-in', str(directory / 'ca.pem'), '-pubkey', '-noout'])
        public_key = command(['openssl', 'pkey', '-in', str(directory / 'ca.key'), '-pubout'])
        if public_cert != public_key:
            raise ValueError('Issuer certificate and private key do not match')
        extensions = directory / 'extensions'
        extensions.write_text('basicConstraints=critical,CA:FALSE\n'
                              'keyUsage=critical,digitalSignature,keyEncipherment\n'
                              'extendedKeyUsage=serverAuth\n'
                              'subjectAltName=' + ','.join('DNS:' + name for name in dns_names)
                              + ',IP:127.0.0.1,IP:::1\n')
        command(['openssl', 'req', '-new', '-newkey', 'rsa:2048', '-nodes',
                 '-subj', '/CN=' + service, '-keyout', str(directory / 'leaf.key'),
                 '-out', str(directory / 'leaf.csr')])
        command(['openssl', 'x509', '-req', '-in', str(directory / 'leaf.csr'),
                 '-CA', str(directory / 'ca.pem'), '-CAkey', str(directory / 'ca.key'),
                 '-CAcreateserial', '-days', str(days), '-sha256', '-extfile', str(extensions),
                 '-out', str(directory / 'leaf.pem')])
        command(['openssl', 'verify', '-CAfile', str(directory / 'ca.pem'), str(directory / 'leaf.pem')])
        certificate = (directory / 'leaf.pem').read_bytes()
        check_certificate(certificate, dns_names, (days - 1) * 86400)
        return certificate + ca, (directory / 'leaf.key').read_bytes()


class Cluster:
    def __init__(self, namespace):
        self.namespace = namespace

    def run(self, args, *, data=None):
        return command(['kubectl', '--namespace', self.namespace, *args], data=data)

    def get(self, kind, name):
        return json.loads(self.run(['get', kind, name, '-o', 'json']))

    def renew(self, service, hostname):
        name = service + '-internal-tls'
        leaf = self.get('secret', name)
        issuer = self.get('secret', name + '-issuer')
        ca = base64.b64decode(issuer['data']['ca.crt'], validate=True)
        key = base64.b64decode(issuer['data']['ca.key'], validate=True)
        trusted = self.get('configmap', name)['data']['ca.crt'].encode()
        if ca != trusted or ca != base64.b64decode(leaf['data']['ca.crt'], validate=True):
            raise ValueError('Issuer and service trust differ; restore matching trust before renewal')
        certificate, private_key = sign(ca, key, service, names(service, self.namespace, hostname))
        leaf['data']['tls.crt'] = base64.b64encode(certificate).decode()
        leaf['data']['tls.key'] = base64.b64encode(private_key).decode()
        # resourceVersion makes replacement fail rather than overwrite a concurrent rotation.
        self.run(['replace', '-f', '-'], data=json.dumps(leaf).encode())
        self.activate(service)

    def activate(self, service):
        """Retry a failed rollout without generating another certificate."""
        leaf = self.get('secret', service + '-internal-tls')
        digest = hashlib.sha256(base64.b64decode(leaf['data']['tls.crt'], validate=True)).hexdigest()
        payload = {'spec': {'template': {'metadata': {'annotations': {'coder.com/internal-tls-revision': digest}}}}}
        self.run(['patch', 'deployment', service, '--type=merge', '--patch-file=/dev/stdin'],
                 data=json.dumps(payload).encode())
        self.run(['rollout', 'status', 'deployment/' + service, '--timeout=300s'])


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('action', choices=['check', 'renew', 'activate'])
    parser.add_argument('--namespace', default='coder')
    parser.add_argument('--hostname', required=True, help='Public Coder hostname, without scheme or port')
    parser.add_argument('--service', choices=SERVICES, action='append', help='Default: all three services')
    args = parser.parse_args()
    cluster = Cluster(args.namespace)
    failures = []
    for service in args.service or SERVICES:
        try:
            dns_names = names(service, args.namespace, args.hostname)
            if args.action == 'renew':
                cluster.renew(service, args.hostname)
            elif args.action == 'activate':
                cluster.activate(service)
            else:
                leaf = cluster.get('secret', service + '-internal-tls')
                issuer = cluster.get('secret', service + '-internal-tls-issuer')
                check_certificate(base64.b64decode(leaf['data']['tls.crt'], validate=True), dns_names, 30 * 86400)
                check_certificate(base64.b64decode(issuer['data']['ca.crt'], validate=True), [], 396 * 86400)
            print(service + ': ' + args.action + ' succeeded')
        except (ValueError, KeyError, RuntimeError) as error:
            failures.append(service)
            print(service + ': ' + str(error))
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
