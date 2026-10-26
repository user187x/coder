"""Reconcile sealed workspace VM profiles without restoring stopped instances."""
import os
import json
import threading
import urllib.parse

from vmprofile import boot_profile
from workspace_runtime import quantity

MARKER = "platform.coder/applied-profile"
DESIRED = "platform.coder/desired-run-strategy"


class Reconciler:
    def __init__(self, kube, http_json, coder_url, namespace, log, configure=None, build_intent=None, current_intent=None, quarantine=None):
        self.quarantine = quarantine
        self.build_intent = build_intent
        self.current_intent = current_intent
        self.configure = configure
        self.kube, self.http = kube, http_json
        self.coder_url, self.namespace, self.log = coder_url.rstrip("/"), namespace, log
        self.base = "/apis/kubevirt.io/v1/namespaces/" + namespace
        from vmprepare import Preparer
        self.preparer = Preparer(kube.call, namespace, build_intent, log) if build_intent else None

    def fetch(self, path):
        status, result = self.kube.call("GET", path)
        if status != 200:
            raise RuntimeError("VM reconciliation lookup failed (HTTP %s)." % status)
        return result

    def home_ready(self, vm, profile, instance):
        claim_name = next(v['persistentVolumeClaim']['claimName'] for v in vm['spec']['template']['spec']['volumes'] if v.get('name') == 'home')
        claim = self.fetch('/api/v1/namespaces/%s/persistentvolumeclaims/%s' % (self.namespace, claim_name))
        pv_name = claim.get('spec', {}).get('volumeName')
        if claim.get('metadata', {}).get('deletionTimestamp') or claim.get('spec', {}).get('volumeMode') != 'Block' or not pv_name:
            return False
        pv = self.fetch('/api/v1/persistentvolumes/' + urllib.parse.quote(pv_name, safe=''))
        registry_namespace = os.environ.get('WORKSPACE_VM_RUNTIME_NAMESPACE', 'coder-runtime-system')
        registry = self.fetch('/api/v1/namespaces/%s/configmaps/coder-vm-home-provenance' % registry_namespace)
        record = json.loads(registry.get('data', {}).get('homes.json', '{}')).get(profile['workspace_id'])
        expected = {'workspace_id': profile['workspace_id'], 'organization_id': profile['organization_id'],
                    'workspace_owner_id': profile['workspace_owner_id'], 'home_bytes': profile['home_bytes'],
                    'claim_name': claim_name, 'claim_uid': claim['metadata']['uid'], 'pv_name': pv_name,
                    'pv_uid': pv.get('metadata', {}).get('uid'), 'status': 'ready'}
        if not record or any(record.get(k) != value for k, value in expected.items()) or \
                pv.get('spec', {}).get('claimRef', {}).get('uid') != claim['metadata']['uid'] or \
                claim.get('metadata', {}).get('annotations', {}).get('platform.coder/home-disk-bytes') != str(profile['home_bytes']):
            return False
        node = self.fetch('/api/v1/nodes/' + urllib.parse.quote(record.get('node_name', ''), safe=''))
        if not record.get('node_uid') or node.get('metadata', {}).get('uid') != record['node_uid']:
            return False
        if instance and instance.get('status', {}).get('nodeName') != record.get('node_name'):
            return False
        for label, field in (('com.coder.workspace.id', 'workspace_id'), ('com.coder.organization.id', 'organization_id'), ('com.coder.user.id', 'workspace_owner_id')):
            if claim.get('metadata', {}).get('labels', {}).get(label) != profile[field]:
                return False
        return True

    def assigned_node(self, profile):
        registry_namespace = os.environ.get('WORKSPACE_VM_RUNTIME_NAMESPACE', 'coder-runtime-system')
        registry = self.fetch('/api/v1/namespaces/%s/configmaps/coder-vm-home-provenance' % registry_namespace)
        record = json.loads(registry.get('data', {}).get('homes.json', '{}')).get(profile['workspace_id']) or {}
        node = record.get('node_name')
        if record.get('status') != 'ready' or not isinstance(node, str) or not node or len(node) > 253 or '/' in node:
            raise RuntimeError('VM HOME has no verified node placement.')
        actual = self.fetch('/api/v1/nodes/' + urllib.parse.quote(node, safe=''))
        if not record.get('node_uid') or actual.get('metadata', {}).get('uid') != record['node_uid']:
            raise RuntimeError('VM HOME worker identity changed; the previous worker requires fencing.')
        return node

    def revoke_obsolete(self, vm):
        if not self.current_intent:
            return False
        metadata = vm['metadata']
        wid = metadata.get('labels', {}).get('com.coder.workspace.id')
        current = self.current_intent(wid)
        captured = metadata.get('annotations', {}).get('platform.coder/build-id')
        if not current or not captured or any(current.get(field) != metadata.get('labels', {}).get(label) for field, label in (
                ('workspace_id', 'com.coder.workspace.id'), ('organization_id', 'com.coder.organization.id'),
                ('owner_id', 'com.coder.user.id'))):
            return False
        obsolete = current.get('build_id') != captured
        canceled = current.get('transition') == 'start' and current.get('job_status') in ('failed', 'canceled', 'canceling')
        if not obsolete and not canceled:
            return False
        if vm.get('spec', {}).get('runStrategy') == 'Halted' and metadata.get('annotations', {}).get(DESIRED) == 'Halted':
            return True
        latest = self.fetch(self.base + '/virtualmachines/' + metadata['name'])
        if any(latest['metadata'].get(key) != metadata.get(key) for key in ('uid', 'resourceVersion')) or self.current_intent(wid) != current:
            return True
        patch = [{'op': 'test', 'path': '/metadata/uid', 'value': metadata['uid']},
                 {'op': 'test', 'path': '/metadata/resourceVersion', 'value': metadata['resourceVersion']},
                 {'op': 'add', 'path': '/metadata/annotations/' + DESIRED.replace('/', '~1'), 'value': 'Halted'},
                 {'op': 'add', 'path': '/spec/runStrategy', 'value': 'Halted'}]
        status, _ = self.kube.call('PATCH', self.base + '/virtualmachines/' + metadata['name'], patch, 'application/json-patch+json')
        if status not in (200, 409, 422):
            raise RuntimeError('Obsolete VM revocation failed (HTTP %s).' % status)
        return True

    def reconcile(self, vm):
        metadata, spec = vm["metadata"], vm["spec"]
        wid = metadata.get("labels", {}).get("com.coder.workspace.id")
        name = "coder-vm-" + str(wid)
        if metadata.get("name") != name or metadata.get("deletionTimestamp"):
            return
        if self.quarantine and self.quarantine(vm):
            return
        if self.revoke_obsolete(vm):
            return
        volumes = spec["template"]["spec"]["volumes"]
        secret_name = next(v["cloudInitNoCloud"]["secretRef"]["name"] for v in volumes if v["name"] == "cloudinit")
        secret = self.fetch("/api/v1/namespaces/%s/secrets/%s" % (self.namespace, secret_name))
        profile = boot_profile(secret)
        if any(metadata.get("labels", {}).get(label) != profile[field] for label, field in (
                ("com.coder.workspace.id", "workspace_id"), ("com.coder.organization.id", "organization_id"),
                ("com.coder.user.id", "workspace_owner_id"))):
            raise RuntimeError("VM reconciliation owner mismatch.")
        desired = metadata.get("annotations", {}).get(DESIRED, spec.get("runStrategy"))
        intent = self.build_intent(wid, profile.get("build_id")) if self.build_intent else None
        if not intent or any(intent.get(key) != profile[field] for key, field in (
                ("workspace_id", "workspace_id"), ("organization_id", "organization_id"),
                ("owner_id", "workspace_owner_id"), ("build_id", "build_id"))) or \
                intent.get("transition") != ("start" if desired == "Always" else "stop") or \
                intent.get("job_status") not in ("pending", "running", "succeeded") or \
                metadata.get("annotations", {}).get("platform.coder/build-id") != profile.get("build_id"):
            raise RuntimeError("VM profile does not belong to the current Coder build.")
        status, instance = self.kube.call("GET", self.base + "/virtualmachineinstances/" + name)
        if status not in (200, 404):
            raise RuntimeError("VM instance lookup failed (HTTP %s)." % status)
        instance = instance if status == 200 else None
        if desired == "Always" and not self.home_ready(vm, profile, instance):
            return
        marker = secret_name.rsplit("-boot-", 1)[-1]
        if desired == "Always" and spec.get("runStrategy") == "Halted":
            # The protected claim permits one start per profile, including builds
            # completed before initialization, without undoing an operator halt.
            if metadata.get("annotations", {}).get(MARKER) in ("starting:" + marker, marker) or instance:
                return
            latest = self.fetch(self.base + "/virtualmachines/" + name)
            if any(latest["metadata"].get(k) != metadata.get(k) for k in ("uid", "resourceVersion")):
                return
            current = self.build_intent(wid, profile.get("build_id"))
            if current != intent or not self.home_ready(latest, profile, None):
                return
            node = self.assigned_node(profile)
            selector = spec['template']['spec'].get('nodeSelector', {})
            if selector.get('kubernetes.io/hostname', node) != node:
                raise RuntimeError('VM HOME placement differs from its requested node.')
            patch = [{"op": "test", "path": "/metadata/uid", "value": metadata["uid"]},
                     {"op": "test", "path": "/metadata/resourceVersion", "value": metadata["resourceVersion"]},
                     {"op": "add", "path": "/metadata/annotations/" + MARKER.replace("/", "~1"), "value": "starting:" + marker},
                     {"op": "add", "path": "/spec/template/spec/nodeSelector/kubernetes.io~1hostname", "value": node},
                     {"op": "test", "path": "/spec/runStrategy", "value": "Halted"},
                     {"op": "add", "path": "/spec/runStrategy", "value": "Always"}]
            if self.build_intent(wid, profile.get("build_id")) != intent:
                return
            status, _ = self.kube.call("PATCH", self.base + "/virtualmachines/" + name, patch, "application/json-patch+json")
            if status not in (200, 409, 422):
                raise RuntimeError("VM start changed or failed (HTTP %s)." % status)
            return
        if desired == "Halted" and spec.get("runStrategy") != "Halted":
            patch = [{"op": "test", "path": "/metadata/uid", "value": metadata["uid"]},
                     {"op": "test", "path": "/metadata/resourceVersion", "value": metadata["resourceVersion"]},
                     {"op": "add", "path": "/spec/runStrategy", "value": "Halted"}]
            if self.build_intent(wid, profile.get("build_id")) != intent:
                return
            status, _ = self.kube.call("PATCH", self.base + "/virtualmachines/" + name, patch, "application/json-patch+json")
            if status not in (200, 409, 422):
                raise RuntimeError("VM halt changed or failed (HTTP %s)." % status)
            return
        if desired == "Halted":
            if instance:
                return
            marker = "halted:" + marker
        elif desired == "Always":
            if not instance:
                return
            if not any(o.get("controller") and o.get("kind") == "VirtualMachine" and o.get("uid") == metadata["uid"]
                       for o in instance.get("metadata", {}).get("ownerReferences", [])):
                raise RuntimeError("VM instance has a different controller.")
            current = next((v.get("cloudInitNoCloud", {}).get("secretRef", {}).get("name")
                            for v in instance.get("spec", {}).get("volumes", []) if v.get("name") == "cloudinit"), None)
            if current != secret_name:
                # A changed current-build profile must boot a fresh immutable root.
                # Recheck VM version; never restore Always after a concurrent stop.
                latest = self.fetch(self.base + "/virtualmachines/" + name)
                if any(latest["metadata"].get(k) != metadata.get(k) for k in ("uid", "resourceVersion")):
                    return
                im = instance["metadata"]
                status, _ = self.kube.call("DELETE", self.base + "/virtualmachineinstances/" + name,
                    {"apiVersion": "v1", "kind": "DeleteOptions", "gracePeriodSeconds": 30,
                     "preconditions": {"uid": im["uid"], "resourceVersion": im["resourceVersion"]}})
                if status not in (200, 202, 404, 409):
                    raise RuntimeError("VM profile restart failed (HTTP %s)." % status)
                return
            domain = instance.get("spec", {}).get("domain", {})
            cpu = domain.get("cpu", {})
            if any(cpu.get(k) != v for k, v in spec["template"]["spec"]["domain"]["cpu"].items()) or \
                    quantity(domain.get("memory", {}).get("guest", "0")) != profile["memory_bytes"]:
                raise RuntimeError("Running VM hardware differs from the current sealed profile.")
            if not any(c.get("type") == "Ready" and c.get("status") == "True"
                       for c in instance.get("status", {}).get("conditions", [])):
                return
        else:
            return
        if desired == "Always" and not self.home_ready(vm, profile, instance):
            return
        if desired == "Always" and self.configure and not self.configure(profile, vm, instance):
            return
        if self.build_intent(wid, profile.get("build_id")) != intent:
            return
        if metadata.get("annotations", {}).get(MARKER) == marker:
            return
        status, latest_instance = self.kube.call("GET", self.base + "/virtualmachineinstances/" + name)
        if instance and (status != 200 or any(latest_instance.get("metadata", {}).get(k) != instance["metadata"].get(k) for k in ("uid", "resourceVersion"))):
            return
        if not instance and status != 404:
            return
        patch = [{"op": "test", "path": "/metadata/uid", "value": metadata["uid"]},
                 {"op": "test", "path": "/metadata/resourceVersion", "value": metadata["resourceVersion"]},
                 {"op": "add", "path": "/metadata/annotations/" + MARKER.replace("/", "~1"), "value": marker}]
        status, _ = self.kube.call("PATCH", self.base + "/virtualmachines/" + name, patch, "application/json-patch+json")
        if status not in (200, 409, 422):
            raise RuntimeError("VM profile acknowledgement failed (HTTP %s)." % status)

    def tick(self):
        if self.preparer:
            self.preparer.tick()
        result = self.fetch(self.base + "/virtualmachines?labelSelector=" + urllib.parse.quote("com.coder.workspace.id"))
        for vm in result.get("items", [])[:1000]:
            try:
                self.reconcile(vm)
            except Exception:
                # Profiles contain credentials. Never log exception arguments or bodies.
                self.log(event="workspace-vm-profile", status="pending", workspace=vm.get("metadata", {}).get("name"))

    def run(self):
        delay = threading.Event()
        while not delay.wait(3):
            try:
                self.tick()
            except Exception:
                self.log(event="workspace-vm-reconcile", status="unavailable")


def start(kube, http_json, coder_url, namespace, log, safe=None, build_intent=None, current_intent=None, quarantine=None, quarantine_policy=None, neko_settings=None):
    if os.environ.get("WORKSPACE_VM_ENABLED", "false").lower() != "true":
        return
    from vmconfig import Configurator
    reconciler = Reconciler(kube, http_json, coder_url, namespace, log,
        Configurator(kube, namespace, coder_url, safe, build_intent, quarantine_policy, neko_settings), build_intent, current_intent, quarantine)
    threading.Thread(target=reconciler.run, name="workspace-vm-profiles", daemon=True).start()
