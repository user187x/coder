#!/usr/bin/env python3
"""Provision an authenticated, workspace-scoped TURN/TLS route on existing HTTPS ingress."""
import argparse
import base64
import json
import secrets
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--kubeconfig', required=True)
parser.add_argument('--namespace', default='coder')
parser.add_argument('--workspace-id', required=True)
parser.add_argument('--hostname', required=True)
parser.add_argument('--tls-secret', required=True)
parser.add_argument('--pod-cidr-range', required=True)
parser.add_argument('--name', default='coder-neko-turn')
parser.add_argument('--gateway-class', default='traefik')
parser.add_argument('--gateway-port', type=int, default=8443)
args = parser.parse_args()
kubectl = ['kubectl', '--kubeconfig', args.kubeconfig, '-n', args.namespace]
name = args.name
metadata = {'name': name, 'namespace': args.namespace}
labels = {'app.kubernetes.io/name': name}
workspace = {'com.coder.workspace.id': args.workspace_id}
credentials = subprocess.run(kubectl + ['get', 'secret', name, '-o', 'json'], capture_output=True, text=True)
if credentials.returncode:
    password = secrets.token_urlsafe(32)
    config = '\n'.join([
        'realm=' + args.hostname, 'server-name=' + args.hostname,
        'listening-port=3478', 'tls-listening-port=5349', 'no-udp', 'no-tcp',
        'no-tcp-relay', 'no-cli', 'no-multicast-peers', 'no-software-attribute',
        'lt-cred-mech', 'user=browser:' + password,
        'cert=/tls/tls.crt', 'pkey=/tls/tls.key',
        'min-port=49160', 'max-port=49200', 'user-quota=8', 'total-quota=16',
        'max-bps=10485760', 'max-allocate-lifetime=600',
        'denied-peer-ip=0.0.0.0-255.255.255.255',
        'allowed-peer-ip=' + args.pod_cidr_range,
        'denied-peer-ip=::-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
        'log-file=stdout', 'simple-log', 'pidfile=/tmp/turnserver.pid',
    ]) + '\n'
    ice = json.dumps([{'urls': ['turns:' + args.hostname + ':443?transport=tcp'], 'username': 'browser', 'credential': password}])
    secret = {'apiVersion': 'v1', 'kind': 'Secret', 'metadata': metadata, 'type': 'Opaque',
              'stringData': {'turnserver.conf': config, 'ice-servers': ice}}
    subprocess.run(kubectl + ['apply', '-f', '-'], input=json.dumps(secret), text=True, check=True)
else:
    existing = json.loads(credentials.stdout)
    ice = json.loads(base64.b64decode(existing['data']['ice-servers']))
    if ice[0]['urls'] != ['turns:' + args.hostname + ':443?transport=tcp']:
        raise SystemExit('Existing TURN credentials belong to a different hostname.')

resources = [
    {'apiVersion': 'apps/v1', 'kind': 'Deployment', 'metadata': metadata, 'spec': {
        'replicas': 1, 'selector': {'matchLabels': labels},
        'template': {'metadata': {'labels': labels}, 'spec': {
            'automountServiceAccountToken': False,
            'securityContext': {'runAsUser': 65532, 'runAsGroup': 65532, 'fsGroup': 65532, 'runAsNonRoot': True},
            'containers': [{'name': 'turn',
                'image': 'coturn/coturn:4.17.1-r0@sha256:ed84c3109f3f0a57ccc829ae9413f70b95fc0452322efb9279db308717138280',
                'command': ['/bin/sh', '-c', 'exec turnserver -c /config/turnserver.conf --listening-ip="$POD_IP" --relay-ip="$POD_IP"'],
                'env': [{'name': 'POD_IP', 'valueFrom': {'fieldRef': {'fieldPath': 'status.podIP'}}}],
                'ports': [{'name': 'turn-tls', 'containerPort': 5349}],
                'securityContext': {'allowPrivilegeEscalation': False, 'capabilities': {'drop': ['ALL'], 'add': ['NET_BIND_SERVICE']}},
                'resources': {'requests': {'cpu': '100m', 'memory': '64Mi'}, 'limits': {'cpu': '1', 'memory': '256Mi'}},
                'readinessProbe': {'tcpSocket': {'port': 5349}, 'initialDelaySeconds': 2},
                'volumeMounts': [{'name': 'config', 'mountPath': '/config', 'readOnly': True}, {'name': 'tls', 'mountPath': '/tls', 'readOnly': True}]}],
            'volumes': [{'name': 'config', 'secret': {'secretName': name, 'defaultMode': 288}},
                        {'name': 'tls', 'secret': {'secretName': args.tls_secret, 'defaultMode': 288}}],
        }}}},
    {'apiVersion': 'v1', 'kind': 'Service', 'metadata': metadata, 'spec': {
        'selector': labels, 'ports': [{'name': 'turn-tls', 'port': 5349, 'targetPort': 5349}]}},
    {'apiVersion': 'gateway.networking.k8s.io/v1', 'kind': 'Gateway', 'metadata': metadata, 'spec': {
        'gatewayClassName': args.gateway_class, 'listeners': [{'name': 'turn-tls', 'hostname': args.hostname,
            'port': args.gateway_port, 'protocol': 'TLS', 'tls': {'mode': 'Passthrough'},
            'allowedRoutes': {'namespaces': {'from': 'Same'}}}]}},
    {'apiVersion': 'gateway.networking.k8s.io/v1', 'kind': 'TLSRoute', 'metadata': metadata, 'spec': {
        'parentRefs': [{'name': name, 'sectionName': 'turn-tls'}], 'hostnames': [args.hostname],
        'rules': [{'backendRefs': [{'name': name, 'port': 5349}]}]}},
    {'apiVersion': 'networking.k8s.io/v1', 'kind': 'NetworkPolicy', 'metadata': metadata, 'spec': {
        'podSelector': {'matchLabels': labels}, 'policyTypes': ['Ingress', 'Egress'],
        'ingress': [
            {'from': [{'podSelector': {'matchLabels': {'app.kubernetes.io/name': 'traefik'}}}], 'ports': [{'protocol': 'TCP', 'port': 5349}]},
            {'from': [{'podSelector': {'matchLabels': workspace}}], 'ports': [{'protocol': 'UDP', 'port': 49160, 'endPort': 49200}]}],
        'egress': [{'to': [{'podSelector': {'matchLabels': workspace}}], 'ports': [{'protocol': 'UDP', 'port': 30590, 'endPort': 30595}]}]}},
]
subprocess.run(kubectl + ['apply', '-f', '-'], input=json.dumps({'apiVersion': 'v1', 'kind': 'List', 'items': resources}), text=True, check=True)
