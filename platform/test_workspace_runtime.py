"""Resource and escape-path regression tests for mandatory Sysbox admission."""
import copy
import unittest

from workspace_runtime import RuntimePolicyError, quantity, validate_pod, pod_budget, prepare_pod, platform_owned, admission_review


class RuntimePolicyTests(unittest.TestCase):
    def pod(self):
        return prepare_pod({'spec': {'runtimeClassName': 'sysbox-runc', 'hostUsers': False,
                         'containers': [{'env': [{'name': 'SYSBOX_HONOR_CAPS', 'value': 'TRUE'}],
                                         'resources': {'limits': {'cpu': '2', 'memory': '2Gi'},
                                                       'requests': {'cpu': '250m', 'memory': '512Mi'}}}]}})

    def test_exact_quantities(self):
        self.assertEqual(quantity('2000m'), quantity('2'))
        self.assertEqual(quantity('2Gi'), 2147483648)
        self.assertEqual(quantity('1e3'), 1000)
        for value in ('NaN', 'Infinity', '1foo', '', None, '1e9999999999999', '1e-99999999'):
            with self.subTest(value=value), self.assertRaises(RuntimePolicyError):
                quantity(value)

    def test_valid_allocation(self):
        validate_pod(self.pod())

    def test_missing_or_excessive_limits(self):
        for resource in ('cpu', 'memory'):
            for limit in ('0', '-1', None):
                pod = self.pod()
                pod['spec']['containers'][0]['resources']['limits'][resource] = limit
                with self.subTest(resource=resource, limit=limit), self.assertRaises(RuntimePolicyError):
                    validate_pod(pod)
        pod = self.pod()
        pod['spec']['containers'][0]['resources']['requests']['cpu'] = '3'
        with self.assertRaises(RuntimePolicyError):
            validate_pod(pod)

    def test_runtime_and_namespace_escapes(self):
        for key, value in [('runtimeClassName', 'runc'), ('hostUsers', True), ('hostPID', True),
                           ('hostNetwork', True), ('hostIPC', True)]:
            pod = self.pod()
            pod['spec'][key] = value
            with self.subTest(key=key), self.assertRaises(RuntimePolicyError):
                validate_pod(pod)

    def test_mount_unmask_capability_rejected(self):
        for security in ({'privileged': True}, {'capabilities': {'add': ['SYS_ADMIN']}},
                         {'capabilities': {'add': ['CAP_SYS_ADMIN']}}, {'capabilities': {'add': ['ALL']}}):
            pod = self.pod()
            pod['spec']['containers'][0]['securityContext'] = security
            with self.subTest(security=security), self.assertRaises(RuntimePolicyError):
                validate_pod(pod)

    def test_sidecars_and_init_cannot_omit_caps(self):
        for key in ('containers', 'initContainers'):
            pod = self.pod()
            if key == 'initContainers':
                pod['spec'][key] = []
            pod['spec'][key].append({'name': 'unbounded'})
            with self.subTest(key=key), self.assertRaises(RuntimePolicyError):
                validate_pod(pod)

    def test_restartable_init_budget(self):
        spec = self.pod()['spec']
        spec['initContainers'] = [
            {'restartPolicy': 'Always', 'resources': {'limits': {'cpu': '1', 'memory': '1Gi'}}},
            {'resources': {'limits': {'cpu': '4', 'memory': '4Gi'}}},
            {'restartPolicy': 'Always', 'resources': {'limits': {'cpu': '1', 'memory': '1Gi'}}},
        ]
        self.assertEqual(pod_budget(spec), {'cpu': 5, 'memory': 5 * 1024 ** 3})

    def test_guaranteed_requests_match_authored_limits(self):
        pod = self.pod()
        base = copy.deepcopy(pod['spec']['containers'][0])
        sidecar = copy.deepcopy(base)
        sidecar.update(name='sidecar', restartPolicy='Always')
        sidecar['resources']['requests'] = {'cpu': '100m', 'memory': '16Mi'}
        sequential = copy.deepcopy(base)
        sequential['name'] = 'initialize'
        sequential['resources']['requests'] = {'cpu': '500m', 'memory': '32Mi'}
        pod['spec']['initContainers'] = [sidecar, sequential]
        prepared = prepare_pod(pod)
        self.assertEqual(pod_budget(prepared['spec'], 'requests')['cpu'], quantity('4'))
        self.assertEqual(pod_budget(prepared['spec'], 'requests')['memory'], quantity('4Gi'))
        self.assertEqual(pod_budget(prepared['spec'])['cpu'], 4)
        validate_pod(prepared)

    def test_ephemeral_requires_finite_guaranteed_parent(self):
        pod = self.pod()
        pod['spec']['ephemeralContainers'] = [copy.deepcopy(pod['spec']['containers'][0])]
        del pod['spec']['ephemeralContainers'][0]['resources']
        validate_pod(pod)
        del pod['spec']['containers'][0]['resources']['limits']['cpu']
        with self.assertRaises(RuntimePolicyError):
            validate_pod(pod)

    def test_prepare_is_idempotent_and_rejects_substitution(self):
        pod = self.pod()
        prepared = prepare_pod(pod)
        self.assertEqual(prepare_pod(prepared), prepared)
        self.assertEqual(len(prepared['spec']['volumes']), 6)
        prepared['spec']['volumes'][0]['hostPath']['path'] = '/'
        with self.assertRaises(RuntimePolicyError):
            prepare_pod(prepared)

    def test_forged_platform_owner_from_provisioner_is_not_exempt(self):
        request = {'kind': {'kind': 'Pod'}, 'userInfo': {'username': 'system:serviceaccount:coder:coder'},
                   'object': {'metadata': {'ownerReferences': [{'controller': True, 'kind': 'Deployment',
                                                               'name': 'coder', 'uid': 'copied'}]}}}
        self.assertFalse(platform_owned(request, lambda _: self.fail('must not trust supplied owner'),
                                        {('Deployment', 'coder')}, 'coder'))

    def test_hostpath_alias_and_duplicate_targets_rejected(self):
        pod = self.pod()
        pod['spec']['volumes'].append({'name': 'alias', 'hostPath': {'path': '/var/lib/lxcfs/proc/cpuinfo', 'type': 'File'}})
        with self.assertRaises(RuntimePolicyError):
            validate_pod(pod)
        pod = self.pod()
        pod['spec']['containers'][0]['volumeMounts'].append(copy.deepcopy(pod['spec']['containers'][0]['volumeMounts'][0]))
        with self.assertRaises(RuntimePolicyError):
            validate_pod(pod)

    def test_controller_chain_requires_matching_trusted_template(self):
        deployment = {'metadata': {'uid': 'deployment'}, 'spec': {'template': {'spec': {'containers': [{'image': 'trusted'}]}}}}
        replica = {'metadata': {'uid': 'replica', 'ownerReferences': [{'controller': True, 'kind': 'Deployment', 'name': 'coder', 'uid': 'deployment'}]},
                   'spec': {'template': copy.deepcopy(deployment['spec']['template'])}}
        request = {'kind': {'kind': 'Pod'}, 'userInfo': {'username': 'system:kube-controller-manager'},
                   'object': {'metadata': {'ownerReferences': [{'controller': True, 'kind': 'ReplicaSet', 'name': 'coder-rs', 'uid': 'replica'}]}}}
        def fetch(path):
            return replica if '/replicasets/' in path else deployment
        self.assertTrue(platform_owned(request, fetch, {('Deployment', 'coder')}, 'coder'))
        replica['spec']['template']['spec']['containers'][0]['image'] = 'attacker'
        self.assertFalse(platform_owned(request, fetch, {('Deployment', 'coder')}, 'coder'))

    def test_namespace_policy_has_no_workspace_label_optout(self):
        request = {'uid': 'fixture', 'operation': 'CREATE', 'kind': {'kind': 'Pod'},
                   'userInfo': {'username': 'system:serviceaccount:coder:coder'},
                   'object': {'spec': {'containers': [{'name': 'unbounded'}]}}}
        response = admission_review({'request': request}, lambda _: None, set(), 'coder', True, mode='native-sysbox')['response']
        self.assertFalse(response['allowed'])
        self.assertEqual(response['status']['code'], 403)

    def test_forged_platform_replicaset_is_rejected_at_creation(self):
        request = {'uid': 'fixture', 'operation': 'CREATE', 'kind': {'kind': 'ReplicaSet'},
                   'userInfo': {'username': 'system:serviceaccount:coder:coder'},
                   'object': {'metadata': {'ownerReferences': [{'controller': True, 'kind': 'Deployment', 'name': 'coder', 'uid': 'copied'}]}}}
        response = admission_review({'request': request}, lambda _: None, {('Deployment', 'coder')}, 'coder', mode='native-sysbox')['response']
        self.assertFalse(response['allowed'])

    def test_platform_admin_group_is_explicit(self):
        request = {'kind': {'kind': 'Deployment'}, 'object': {'metadata': {'name': 'coder'}},
                   'userInfo': {'username': 'kubernetes-admin', 'groups': ['kubeadm:cluster-admins']}}
        self.assertTrue(platform_owned(request, lambda _: None, {('Deployment', 'coder')}, 'coder'))
        request['userInfo']['groups'] = ['coder-admins']
        with self.assertRaises(RuntimePolicyError):
            platform_owned(request, lambda _: None, {('Deployment', 'coder')}, 'coder')
        self.assertTrue(platform_owned(request, lambda _: None, {('Deployment', 'coder')}, 'coder', ['coder-admins']))

    def test_fractional_cpu_and_pod_level_resources_are_rejected(self):
        pod = self.pod()
        pod['spec']['containers'][0]['resources']['limits']['cpu'] = '500m'
        with self.assertRaisesRegex(RuntimePolicyError, 'whole CPU'):
            prepare_pod(pod)
        pod = self.pod()
        pod['spec']['resources'] = {'limits': {'cpu': '2', 'memory': '2Gi'}}
        with self.assertRaisesRegex(RuntimePolicyError, 'static CPU pinning'):
            prepare_pod(pod)

    def test_worker_selector_and_direct_binding_cannot_bypass_preflight(self):
        pod = self.pod()
        pod['spec']['nodeSelector']['platform.coder/runtime-ready'] = 'false'
        with self.assertRaises(RuntimePolicyError):
            prepare_pod(pod)
        pod = self.pod()
        pod['spec']['nodeName'] = 'unverified-worker'
        request = {'uid': 'fixture', 'operation': 'CREATE', 'kind': {'kind': 'Pod'}, 'object': pod}
        for mutate in (True, False):
            response = admission_review({'request': request}, lambda _: None, set(), 'coder', mutate, mode='native-sysbox')['response']
            self.assertFalse(response['allowed'])
        request['operation'] = 'UPDATE'
        self.assertTrue(admission_review({'request': request}, lambda _: None, set(), 'coder', mode='native-sysbox')['response']['allowed'])

    def test_proc_unmask_and_explicit_unconfined_are_rejected(self):
        for kind in ('containers', 'initContainers', 'ephemeralContainers'):
            for security in ({'procMount': 'Unmasked'}, {'seccompProfile': {'type': 'Unconfined'}}):
                pod = self.pod()
                target = copy.deepcopy(pod['spec']['containers'][0])
                target['securityContext'] = security
                if kind == 'ephemeralContainers':
                    del target['resources']
                pod['spec'][kind] = [target]
                with self.subTest(kind=kind, security=security), self.assertRaises(RuntimePolicyError):
                    validate_pod(pod)
        pod = self.pod()
        pod['spec']['securityContext'] = {'seccompProfile': {'type': 'Unconfined'}}
        with self.assertRaises(RuntimePolicyError):
            validate_pod(pod)
        pod['spec']['securityContext'] = {'seccompProfile': {'type': 'RuntimeDefault'}}
        validate_pod(pod)

    def test_honor_caps_cannot_be_indirect_or_duplicated(self):
        for env in ([], [{'name': 'SYSBOX_HONOR_CAPS', 'value': 'FALSE'}],
                    [{'name': 'SYSBOX_HONOR_CAPS', 'valueFrom': {'secretKeyRef': {}}}]):
            pod = self.pod()
            pod['spec']['containers'][0]['env'] = copy.deepcopy(env)
            with self.subTest(env=env), self.assertRaises(RuntimePolicyError):
                validate_pod(pod)


if __name__ == '__main__':
    unittest.main()
