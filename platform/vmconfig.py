"""Build private guest mounts from existing audited Cloud Drive permissions."""
import base64
import hashlib
import ipaddress
import json
import urllib.parse
import driveaudit

from vmguest import Guest


class Configurator:
    def __init__(self, kube, namespace, coder_url, safe, build_intent=None, quarantine_policy=None, neko_settings=None):
        self.kube, self.namespace, self.coder_url, self.safe = kube, namespace, coder_url.rstrip('/'), safe
        self.pending, self.done = {}, {}
        self.build_intent = build_intent
        self.quarantine_policy = quarantine_policy
        self.neko_settings = neko_settings

    def restricted(self, workspace_id):
        if self.quarantine_policy is None:
            return False
        current = self.quarantine_policy(workspace_id)
        return current['enabled'] or current['manual_start_required']

    def drive(self, profile):
        safe = self.safe
        owner, wid = profile['workspace_owner_id'], profile['workspace_id']
        if not profile.get('cloud_drive', {}).get('enabled'):
            return {'enabled': False, 'annotation': 'off', 'mounts': [], 'mounts_state': {}}
        if not safe.AUDIT_ENABLED or safe._audit is None:
            raise RuntimeError('VM Cloud Drive requires actor-attributed audit mounts.')
        sources = safe.sources()
        linked = wid not in safe.disconnected() and wid not in safe.shared_now() and safe.turned_off() is None
        credentials = safe._audit.credentials(owner)
        with open('/etc/coder-drive-audit/ca.crt', 'rb') as source:
            ca = base64.b64encode(source.read()).decode()
        def mount(identity, kind, drive_owner, prefix='', read_only=False, name=None):
            result = {'id': identity, 'kind': kind,
                'endpoint': 'https://coder-ui-updates.%s.svc:9444' % self.namespace,
                'region': 'us-east-1', 'bucket': 'audit-' + drive_owner,
                'prefix': owner + ('/' + prefix if prefix else ''),
                'access_key': credentials['accessKey'], 'secret_key': credentials['secretKey'],
                'ca_pem_base64': ca, 'read_only': read_only}
            if name is not None:
                result['name'] = name
            return result
        iso = mount('iso', 'iso', driveaudit.ISO_LIBRARY_OWNER, read_only=True)
        if not linked:
            return {'enabled': True, 'annotation': 'off', 'mounts': [iso], 'mounts_state': {}}
        own_source = sources.get(owner)
        is_source = own_source and not own_source.get('suspended') and own_source.get('workspace') == wid
        mounts = [] if is_source else [mount('own', 'own', owner)]
        peers = safe.peer_mounts().get(owner, [])
        for peer in peers:
            kind = 'peer' if peer['kind'] == 'drive' else 'item'
            path = peer.get('path', '')
            prefix = path.rsplit('/', 1)[0] if peer['kind'] == 'file' and '/' in path else '' if peer['kind'] == 'file' else path
            entry = mount(peer['id'], kind, peer['owner'], prefix, peer['readOnly'], peer['name'])
            if kind == 'item':
                entry.update(item_kind='file' if peer['kind'] == 'file' else 'folder', item=peer.get('item') or path.rsplit('/', 1)[-1])
            mounts.append(entry)
        visible = {owner} | {peer['owner'] for peer in peers}
        public_sources = {uid: {'workspace': source.get('workspace'), 'path': source.get('path'),
                               'running': bool((safe._sources_seen.get(uid) or {}).get('running'))}
                          for uid, source in sources.items() if uid in visible}
        return {'enabled': True, 'annotation': 'source:' + own_source['path'] if is_source else 'on', 'mounts': mounts + [iso],
                'mounts_state': {'peers': {owner: peers}, 'sources': public_sources, 'shared': []}}

    def __call__(self, profile, vm, instance):
        wid = profile['workspace_id']
        if self.restricted(wid):
            return False
        selector = urllib.parse.quote('com.coder.workspace.id=' + wid)
        status, listing = self.kube.call('GET', '/api/v1/namespaces/%s/pods?labelSelector=%s' % (self.namespace, selector))
        pods = [p for p in listing.get('items', []) if p.get('status', {}).get('phase') == 'Running'
                and not p.get('metadata', {}).get('deletionTimestamp') and any(
                    o.get('kind') == 'VirtualMachineInstance' and o.get('controller') and o.get('uid') == instance['metadata']['uid']
                    for o in p.get('metadata', {}).get('ownerReferences', []))] if status == 200 else []
        if len(pods) != 1:
            raise RuntimeError('VM guest requires exactly one current launcher.')
        endpoint = str(ipaddress.IPv4Address(pods[0]['status']['podIP'])) + ':51871'
        config = {key: profile[key] for key in ('version', 'workspace_id', 'organization_id', 'workspace_owner_id', 'build_id')}
        config['cloud_drive'] = self.drive(profile)
        source = self.safe.sources().get(profile['workspace_owner_id']) if profile.get('cloud_drive', {}).get('enabled') else None
        config['source'] = {'enabled': bool(source and not source.get('suspended') and source.get('workspace') == wid)}
        if config['source']['enabled']:
            config['source']['config'] = self.safe.source_config(profile['workspace_owner_id'], source)
        config['tunnel'] = {'enabled': profile['tunnel']['enabled'], 'endpoint': endpoint,
                            'url': profile['agent']['url'].rstrip('/') + '/__coder-ui/api/workspace-tunnels/agent/sync'}
        if self.neko_settings:
            settings = self.neko_settings(profile, vm, instance, pods[0])
            if settings is not None:
                config['neko'] = settings
        digest = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
        key = instance['metadata']['uid']
        if self.build_intent:
            intent = self.build_intent(wid, profile.get('build_id'))
            if not intent or intent.get('transition') != 'start' or intent.get('job_status') not in ('pending', 'running', 'succeeded') or any(
                    intent.get(key) != profile[field] for key, field in (('workspace_id', 'workspace_id'),
                    ('organization_id', 'organization_id'), ('owner_id', 'workspace_owner_id'), ('build_id', 'build_id'))):
                return False
        if self.done.get(key) == digest:
            return True
        guest = Guest(self.kube, self.namespace, vm, instance, pods[0])
        previous = self.pending.get(key)
        if previous and previous[0] == digest:
            try:
                applied = guest.applied(previous[1])
            except RuntimeError:
                self.pending.pop(key, None)
                raise
            if not applied:
                return False
            self.done[key] = digest
            self.pending.pop(key, None)
            return True
        if self.restricted(wid):
            return False
        self.pending[key] = (digest, guest.deliver(config))
        # Keep only current instances; no root credentials are retained in cache.
        if len(self.pending) + len(self.done) > 2000:
            self.pending, self.done = {key: self.pending[key]}, {}
        return False
