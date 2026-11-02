"""Provision pending HOME claims only for an authoritative current Coder build."""
import json
import re
import threading
import time
import uuid

import vmgrow
from vmprofile import home_request_profile


class Preparer:
    def __init__(self, kube, namespace, build_intent, log):
        self.kube, self.namespace, self.build_intent, self.log = kube, namespace, build_intent, log
        self.active = set()
        self.retry = {}
        self.lock = threading.Lock()

    def fetch(self, path):
        status, result = self.kube('GET', path)
        if status != 200:
            raise RuntimeError('VM HOME provisioning lookup failed.')
        return result

    def request(self, claim):
        meta, spec = claim.get('metadata', {}), claim.get('spec', {})
        if meta.get('deletionTimestamp') or spec.get('volumeMode') != 'Block' or spec.get('storageClassName') != 'coder-vm-home':
            raise ValueError('Not a managed pending Block HOME.')
        wid = str(uuid.UUID(meta.get('labels', {}).get('com.coder.workspace.id', '')))
        if meta.get('name') != 'coder-vm-' + wid + '-home':
            raise ValueError('Pending HOME has an invalid canonical name.')
        secret_name = meta.get('annotations', {}).get('platform.coder/home-request', '')
        if not re.fullmatch('coder-vm-home-request-' + wid + '-[0-9a-f]{16}', secret_name):
            raise ValueError('Invalid pending HOME request reference.')
        secret = self.fetch('/api/v1/namespaces/%s/secrets/%s' % (self.namespace, secret_name))
        request = home_request_profile(secret)
        size = request['home_bytes']
        from workspace_runtime import quantity
        if quantity(spec.get('resources', {}).get('requests', {}).get('storage', '0')) != size or meta.get('annotations', {}).get('platform.coder/home-disk-bytes') != str(size):
            raise ValueError('Pending HOME capacity differs from its sealed request.')
        if request['workspace_id'] != wid or any(meta.get('labels', {}).get(label) != request[field] for label, field in (
                ('com.coder.organization.id', 'organization_id'), ('com.coder.user.id', 'workspace_owner_id'))):
            raise ValueError('Pending HOME owner differs from its request.')
        intent = self.build_intent(wid, request['build_id'])
        if not intent or intent.get('transition') != 'start' or intent.get('job_status') not in ('pending', 'running') or any(
                intent.get(key) != request[field] for key, field in (('workspace_id', 'workspace_id'),
                ('organization_id', 'organization_id'), ('owner_id', 'workspace_owner_id'), ('build_id', 'build_id'))):
            raise ValueError('Pending HOME does not belong to a current starting workspace build.')
        return request

    def prepare(self, claim):
        request = self.request(claim)
        nodes = self.fetch('/api/v1/nodes?labelSelector=platform.coder%2Fvm-ready%3Dtrue')
        eligible = [n for n in nodes.get('items', []) if any(c.get('type') == 'Ready' and c.get('status') == 'True'
            for c in n.get('status', {}).get('conditions', [])) and not any(t.get('effect') == 'NoSchedule'
            and t.get('key') != 'platform.coder/workspace-vm-host' for t in n.get('spec', {}).get('taints', [])) and (not request['node_name'] or n['metadata']['name'] == request['node_name'])]
        if not eligible:
            raise RuntimeError('No qualified VM worker is ready for HOME provisioning.')
        selected = sorted(eligible, key=lambda n: n['metadata']['name'])[0]
        node = selected['metadata']['name']
        node_uid = str(uuid.UUID(selected['metadata']['uid']))
        status, registry = self.kube('GET', '/api/v1/namespaces/%s/configmaps/coder-vm-home-provenance' % vmgrow.RUNTIME_NAMESPACE)
        if status == 404:
            path = '/api/v1/namespaces/%s/configmaps' % vmgrow.RUNTIME_NAMESPACE
            code, _ = self.kube('POST', path, {'apiVersion': 'v1', 'kind': 'ConfigMap',
                'metadata': {'name': 'coder-vm-home-provenance', 'namespace': vmgrow.RUNTIME_NAMESPACE},
                'data': {'homes.json': '{}'}})
            if code not in (201, 409):
                raise RuntimeError('VM HOME provenance could not be initialized.')
            registry = self.fetch(path + '/coder-vm-home-provenance')
            status = 200
        if status != 200:
            raise RuntimeError('VM HOME provenance cannot be inspected.')
        if request['workspace_id'] in json.loads(registry.get('data', {}).get('homes.json', '{}')):
            raise RuntimeError('VM HOME is already registered or awaiting administrator review; no duplicate preparation job was created.')
        fields = {key: request[key] for key in ('workspace_id', 'organization_id', 'workspace_owner_id', 'build_id')}
        fields.update(version=1, old_bytes=0, new_bytes=request['home_bytes'], pvc_uid=claim['metadata']['uid'],
                      claim_name=claim['metadata']['name'], node_name=node, node_uid=node_uid,
                      record_resource_version=registry.get('metadata', {}).get('resourceVersion', '') if status == 200 else '')
        # Re-read the immutable claim identity and current build immediately before
        # creating the privileged fixed job; a canceled/replaced request gets no job.
        current = self.fetch('/api/v1/namespaces/%s/persistentvolumeclaims/%s' % (self.namespace, claim['metadata']['name']))
        if current.get('metadata', {}).get('uid') != claim['metadata']['uid'] or self.request(current) != request:
            raise RuntimeError('Pending HOME changed before provisioning.')
        vmgrow.run(self.kube, {'request': fields, 'node': node}, action='prepare')

    def work(self, claim):
        uid = claim['metadata']['uid']
        try:
            self.prepare(claim)
        except Exception:
            self.log(event='workspace-vm-home', status='pending', workspace=claim.get('metadata', {}).get('name'))
        finally:
            with self.lock:
                self.active.discard(uid)
                self.retry[uid] = time.monotonic() + 30

    def tick(self):
        result = self.fetch('/api/v1/namespaces/%s/persistentvolumeclaims?labelSelector=com.coder.workspace.id' % self.namespace)
        for claim in result.get('items', [])[:1000]:
            if claim.get('status', {}).get('phase') != 'Pending' or claim.get('spec', {}).get('storageClassName') != 'coder-vm-home':
                continue
            uid = claim['metadata']['uid']
            with self.lock:
                if uid in self.active or self.retry.get(uid, 0) > time.monotonic() or len(self.active) >= 4:
                    continue
                self.active.add(uid)
            threading.Thread(target=self.work, args=(claim,), name='workspace-vm-home', daemon=True).start()
