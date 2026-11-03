#!/usr/bin/env python3
"""Run the operator for the Network page on a trusted cluster management host."""
import argparse
import json
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid


def run(*args, stdin=None, timeout=45):
    result = subprocess.run(args, input=stdin, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(result.stderr.strip()[-600:] or f'{args[0]} returned {result.returncode}')
    return result.stdout.strip()


class Operator:
    def __init__(self, config):
        self.config = config
        self.namespace = config['namespace']
        self.org = str(uuid.UUID(config['organizationID']))
        self.kubectl = ['kubectl', '--context', config['context']]
        self.cm = 'coder-node-provisioning'
        self.uid = self.k('get', 'namespace', 'kube-system', '-o', 'jsonpath={.metadata.uid}')
        if self.uid != config['clusterUID']:
            raise ValueError('The Kubernetes context does not match the enrolled cluster UID.')
        self.profiles = {p['id']: p for p in config['profiles']}
        if not self.profiles or len(self.profiles) != len(config['profiles']) or int(config['maxNodes']) < 1:
            raise ValueError('Set unique provider IDs and a positive maxNodes.')

    def k(self, *args, **kw):
        return run(*self.kubectl, *args, **kw)

    def aws(self, p, *args):
        return json.loads(run('aws', '--region', p['region'], '--output', 'json', '--no-cli-pager', *args))

    def validate(self, p):
        kind = p['kind']
        if kind == 'k3d':
            kubeconfig = run('k3d', 'kubeconfig', 'get', p['cluster'])
            uid = run('kubectl', '--kubeconfig=/dev/stdin', 'get', 'namespace', 'kube-system', '-o',
                      'jsonpath={.metadata.uid}', stdin=kubeconfig)
            if not re.fullmatch(r'[1-9][0-9]*[gGmM]', p['memory']):
                raise ValueError('Set the k3d worker memory limit.')
        elif kind == 'minikube':
            uid = run('minikube', '-p', p['profile'], 'kubectl', '--', 'get', 'namespace', 'kube-system',
                      '-o', 'jsonpath={.metadata.uid}')
        elif kind in ('eks-managed', 'eks-manual'):
            cluster = self.aws(p, 'eks', 'describe-cluster', '--name', p['cluster'])['cluster']
            server = self.k('config', 'view', '--minify', '-o', 'jsonpath={.clusters[0].cluster.server}')
            if server.rstrip('/') != cluster['endpoint'].rstrip('/'):
                raise ValueError('The configured EKS cluster endpoint differs from the Kubernetes context.')
            if kind == 'eks-managed':
                self.group(p)
            elif not re.fullmatch(r'lt-[a-f0-9]+', p['launchTemplate']) or int(p['version']) < 1:
                raise ValueError('Set a launch template ID and a pinned numerical version.')
            return
        elif kind == 'karpenter':
            pool = json.loads(self.k('get', 'nodepools.karpenter.sh', p['pool'], '-o', 'json'))
            if not any(c['type'] == 'Ready' and c['status'] == 'True' for c in pool['status']['conditions']):
                raise ValueError('The Karpenter pool is not Ready.')
            return
        else:
            raise ValueError('Unknown worker provider.')
        if uid != self.uid:
            raise ValueError('The provider targets a different Kubernetes cluster.')

    def group(self, p):
        group = self.aws(p, 'eks', 'describe-nodegroup', '--cluster-name', p['cluster'],
                         '--nodegroup-name', p['group'])['nodegroup']
        if group['status'] != 'ACTIVE':
            raise ValueError('The EKS node group is not active.')
        return group

    def nodes(self):
        return json.loads(self.k('get', 'nodes', '-o', 'json'))['items']

    def launch(self, p, job, nodes):
        kind, rid = p['kind'], job['id']
        if kind == 'k3d':
            run('k3d', 'node', 'create', 'coder-' + rid, '--cluster', p['cluster'], '--role', 'agent',
                '--memory', p['memory'], '--k3s-node-label', 'coder.com/node-request=' + rid,
                '--wait', '--timeout', '10m', timeout=660)
        elif kind == 'minikube':
            run('minikube', 'node', 'add', '-p', p['profile'], '--worker=true', '--delete-on-failure=false', timeout=900)
        elif kind == 'eks-manual':
            result = self.aws(p, 'ec2', 'run-instances', '--launch-template',
                              f"LaunchTemplateId={p['launchTemplate']},Version={p['version']}",
                              '--min-count', '1', '--max-count', '1', '--client-token', rid)
            return result['Instances'][0]['InstanceId']
        elif kind == 'eks-managed':
            scaling = self.group(p)['scalingConfig']
            desired = scaling['desiredSize'] + 1
            if desired > scaling['maxSize']:
                raise ValueError('The node group has reached its configured maximum.')
            # Refuse direct desired-size changes while Cluster Autoscaler controls the group.
            workloads = json.loads(self.k('get', 'deployments', '-A', '-o', 'json'))['items']
            if any('cluster-autoscaler' in c['image'] for w in workloads for c in w['spec']['template']['spec']['containers']):
                raise ValueError('Cluster Autoscaler manages capacity. Use workload demand to scale this group.')
            result = self.aws(p, 'eks', 'update-nodegroup-config', '--cluster-name', p['cluster'], '--nodegroup-name',
                              p['group'], '--scaling-config', 'desiredSize=' + str(desired), '--client-request-token', rid)
            return result['update']['id']
        elif kind == 'karpenter':
            pool = json.loads(self.k('get', 'nodepools.karpenter.sh', p['pool'], '-o', 'json'))
            if pool['spec'].get('replicas') is not None:
                old = pool['spec']['replicas']
                if old + 1 > int(pool['spec'].get('limits', {}).get('nodes', self.config['maxNodes'])):
                    raise ValueError('The Karpenter pool has reached its node limit.')
                self.k('patch', 'nodepools.karpenter.sh', p['pool'], '--type=json', '-p', json.dumps([
                    {'op': 'test', 'path': '/metadata/resourceVersion', 'value': pool['metadata']['resourceVersion']},
                    {'op': 'replace', 'path': '/spec/replicas', 'value': old + 1}]))
                return 'static'
            # Demand that cannot run on the existing nodes lets Karpenter enforce the pool's budgets and constraints.
            spec = {'nodeSelector': {'karpenter.sh/nodepool': p['pool']}, 'automountServiceAccountToken': False,
                    'restartPolicy': 'Never', 'activeDeadlineSeconds': 1800, 'terminationGracePeriodSeconds': 0,
                    'affinity': {'nodeAffinity': {'requiredDuringSchedulingIgnoredDuringExecution': {'nodeSelectorTerms': [
                        {'matchExpressions': [{'key': 'kubernetes.io/hostname', 'operator': 'NotIn', 'values': [n['metadata'].get('labels', {}).get('kubernetes.io/hostname', n['metadata']['name']) for n in nodes]}]}]}}},
                    'tolerations': [{'key': t['key'], 'operator': 'Equal', 'value': t.get('value', ''), 'effect': t['effect']}
                                    for t in pool['spec']['template']['spec'].get('taints', [])],
                    'containers': [{'name': 'reservation', 'image': p['pauseImage'],
                                    'resources': {'requests': {'cpu': '10m', 'memory': '8Mi'}},
                                    'securityContext': {'allowPrivilegeEscalation': False, 'readOnlyRootFilesystem': True,
                                                        'runAsNonRoot': True, 'runAsUser': 65534, 'capabilities': {'drop': ['ALL']}}}],
                    'securityContext': {'seccompProfile': {'type': 'RuntimeDefault'}}}
            self.k('-n', self.namespace, 'create', '-f', '-', stdin=json.dumps({'apiVersion': 'v1', 'kind': 'Pod',
                    'metadata': {'name': 'coder-node-' + rid, 'labels': {'coder.com/node-request': rid}}, 'spec': spec}))
            return 'demand'

    def observe(self, p, job):
        if p['kind'] == 'eks-manual' and not job.get('providerRef'):
            response = self.aws(p, 'ec2', 'describe-instances', '--filters', 'Name=client-token,Values=' + job['id'])
            instances = [i for r in response['Reservations'] for i in r['Instances']]
            if len(instances) == 1:
                job['providerRef'] = instances[0]['InstanceId']
        candidates = []
        for node in self.nodes():
            name, labels = node['metadata']['name'], node['metadata'].get('labels', {})
            if name in job['before']:
                continue
            kind = p['kind']
            if kind == 'k3d' and labels.get('coder.com/node-request') != job['id']:
                continue
            if kind == 'minikube' and labels.get('minikube.k8s.io/name') != p['profile']:
                continue
            if kind == 'karpenter' and labels.get('karpenter.sh/nodepool') != p['pool']:
                continue
            if kind == 'eks-managed' and labels.get('eks.amazonaws.com/nodegroup') != p['group']:
                continue
            if kind == 'eks-manual' and node['spec'].get('providerID', '').split('/')[-1] != job.get('providerRef'):
                continue
            ready = next((c for c in node['status']['conditions'] if c['type'] == 'Ready'), {})
            if ready.get('status') != 'True':
                job['message'] = (f"{name} registered. {ready.get('reason', 'Not Ready')}: "
                                  f"{ready.get('message', 'Waiting for kubelet readiness.')}")[:600]
                continue
            candidates.append(name)
        if p['kind'] == 'karpenter' and job.get('providerRef') != 'static':
            # Recover the demand Pod by its deterministic name if the operator restarted during launch.
            reservation = self.k('-n', self.namespace, 'get', 'pod', 'coder-node-' + job['id'], '--ignore-not-found', '-o', 'name')
            if not reservation and job.get('providerRef') != 'demand':
                return candidates[0] if candidates else None
            name = 'coder-node-' + job['id']
            assigned = self.k('-n', self.namespace, 'get', 'pod', name, '-o', 'jsonpath={.spec.nodeName}')
            if assigned not in candidates:
                return None
            self.k('-n', self.namespace, 'delete', 'pod', name, '--wait=false')
            return assigned
        if p['kind'] == 'eks-managed' and job.get('providerRef'):
            update = self.aws(p, 'eks', 'describe-update', '--name', p['cluster'], '--nodegroup-name', p['group'],
                              '--update-id', job['providerRef'])['update']
            if update['status'] in ('Failed', 'Cancelled'):
                raise ValueError(f"EKS update {update['status']}: {update.get('errors', [])}")
            if update['status'] != 'Successful':
                return None
        return candidates[0] if candidates else None

    def current(self):
        return json.loads(self.k('-n', self.namespace, 'get', 'configmap', self.cm, '-o', 'json'))

    def patch(self, cm, **data):
        payload = {'metadata': {'resourceVersion': cm['metadata']['resourceVersion']}, 'data': data}
        return json.loads(self.k('-n', self.namespace, 'patch', 'configmap', self.cm, '--type=merge',
                                 '-p', json.dumps(payload), '-o', 'json'))

    def enroll(self):
        present = self.k('-n', self.namespace, 'get', 'cm', self.cm, '--ignore-not-found', '-o', 'name')
        if not present:
            self.k('-n', self.namespace, 'create', 'configmap', self.cm, '--from-literal=organization_id=' + self.org)
        if self.current()['data'].get('organization_id') != self.org:
            raise ValueError('Operator already enrolled in another organization.')

    def tick(self):
        cm = self.current()
        if cm['data'].get('organization_id') != self.org:
            raise ValueError('Operator enrollment changed.')
        if time.monotonic() >= getattr(self, 'refresh_at', 0):
            self.available = []
            for p in self.profiles.values():
                try:
                    self.validate(p)
                    self.available.append({'id': p['id'], 'label': p['label'], 'kind': p['kind']})
                except (ValueError, KeyError, RuntimeError, OSError, subprocess.TimeoutExpired) as err:
                    print(f"Provider {p['id']} unavailable: {err}", file=sys.stderr, flush=True)
            self.refresh_at = time.monotonic() + 60
        cm = self.patch(cm, profiles=json.dumps(self.available), heartbeat=str(int(time.time())))
        job = json.loads(cm['data'].get('operation', 'null'))
        if not job or job.get('organization_id') != self.org or job.get('phase') not in ('queued', 'provisioning'):
            return
        rid = str(uuid.UUID(job['id']))
        if rid != job['id']:
            raise ValueError('Invalid request ID.')
        p = self.profiles.get(job['profile'])
        try:
            if not p:
                raise ValueError('The requested provider is no longer configured.')
            if job['phase'] == 'queued':
                nodes = self.nodes()
                if len(nodes) >= self.config['maxNodes']:
                    raise ValueError('The cluster has reached the operator node limit.')
                self.validate(p)
                job.update(phase='provisioning', before=[n['metadata']['name'] for n in nodes], message='Requesting a worker.')
                # Only the process winning this resourceVersion comparison may call the provider.
                try:
                    self.patch(cm, operation=json.dumps(job))
                except RuntimeError:
                    return
                stop = threading.Event()
                def heartbeat():
                    while not stop.wait(20):
                        try:
                            self.patch(self.current(), heartbeat=str(int(time.time())))
                        except (RuntimeError, subprocess.TimeoutExpired):
                            continue
                thread = threading.Thread(target=heartbeat, daemon=True)
                thread.start()
                try:
                    job['providerRef'] = self.launch(p, job, nodes)
                    job['message'] = 'Waiting for a new Kubernetes node to become Ready.'
                except (RuntimeError, subprocess.TimeoutExpired) as err:
                    # A lost CLI response may follow successful provisioning. Reconcile without a second launch.
                    job['message'] = 'Checking registration after a provider error: ' + str(err)[:300]
                finally:
                    stop.set()
                    thread.join()
            elif time.time() - job['created'] > 1800:
                if p['kind'] == 'karpenter':
                    self.k('-n', self.namespace, 'delete', 'pod', 'coder-node-' + rid, '--ignore-not-found', '--wait=false')
                raise ValueError('Timed out waiting for registration. Inspect the provider before submitting another request.')
            else:
                previous_message = job['message']
                name = self.observe(p, job)
                if name:
                    job.update(phase='ready', message=name + ' is Ready.')
                elif previous_message == job['message']:
                    return
        except (ValueError, KeyError, OSError) as err:
            job.update(phase='failed', message=str(err)[:600])
        latest = self.current()
        stored = json.loads(latest['data'].get('operation', 'null'))
        if stored and stored['id'] == rid and stored['phase'] in ('queued', 'provisioning'):
            self.patch(latest, operation=json.dumps(job), heartbeat=str(int(time.time())))



def discover(context, namespace, organization):
    """Print candidate targets for the operator to review before enrollment."""
    k = ['kubectl', '--context', context]
    uid = run(*k, 'get', 'ns', 'kube-system', '-o', 'jsonpath={.metadata.uid}')
    nodes = json.loads(run(*k, 'get', 'nodes', '-o', 'json'))['items']
    profiles = []
    if context.startswith('k3d-') and shutil.which('k3d'):
        name = context.removeprefix('k3d-')
        profiles.append({'id': 'k3d-worker', 'label': 'k3d · ' + name, 'kind': 'k3d', 'cluster': name, 'memory': '8g'})
    local = {n['metadata'].get('labels', {}).get('minikube.k8s.io/name') for n in nodes} - {None}
    for name in sorted(local):
        profiles.append({'id': 'minikube-' + name, 'label': 'minikube · ' + name, 'kind': 'minikube', 'profile': name})
    eks = re.fullmatch(r'arn:[^:]+:eks:([^:]+):[0-9]+:cluster/(.+)', context)
    if eks and shutil.which('aws'):
        region, cluster = eks.groups()
        groups = json.loads(run('aws', '--region', region, '--output', 'json', '--no-cli-pager', 'eks',
                                'list-nodegroups', '--cluster-name', cluster))['nodegroups']
        profiles.extend({'id': 'eks-' + g, 'label': 'EKS group · ' + g, 'kind': 'eks-managed',
                         'region': region, 'cluster': cluster, 'group': g} for g in groups)
    if 'nodepools.karpenter.sh' in run(*k, 'api-resources', '--api-group=karpenter.sh', '-o', 'name').splitlines():
        for pool in json.loads(run(*k, 'get', 'nodepools.karpenter.sh', '-o', 'json'))['items']:
            name = pool['metadata']['name']
            profiles.append({'id': 'karpenter-' + name, 'label': 'Karpenter · ' + name, 'kind': 'karpenter',
                             'pool': name, 'pauseImage': 'registry.k8s.io/pause:3.10'})
    return {'context': context, 'namespace': namespace, 'clusterUID': uid, 'organizationID': str(uuid.UUID(organization)),
            'maxNodes': len(nodes) + 1, 'profiles': profiles}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--config', help='Run using an operator-owned JSON configuration')
    mode.add_argument('--discover', metavar='CONTEXT', help='Print provider configuration for review')
    parser.add_argument('--namespace', default='coder')
    parser.add_argument('--organization', help='Coder organization UUID for discovery')
    args = parser.parse_args()
    if args.discover:
        if not args.organization:
            parser.error('--discover requires --organization')
        print(json.dumps(discover(args.discover, args.namespace, args.organization), indent=2))
        return
    with open(args.config, encoding='utf-8') as file:
        operator = Operator(json.load(file))
    operator.enroll()
    print('Node operator enrolled', flush=True)
    while True:
        try:
            operator.tick()
        except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as err:
            print(str(err), file=sys.stderr, flush=True)
        time.sleep(5)


if __name__ == '__main__':
    main()
