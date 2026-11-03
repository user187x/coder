"""Provider commands and safety checks that run without buying cloud capacity."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('operator_node', Path(__file__).resolve().parents[1] / 'node-provisioner.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
RID = 'f6dc811c-a5db-4be6-b36d-65293f2828f9'


class Providers(unittest.TestCase):
    def setUp(self):
        self.op = object.__new__(worker.Operator)
        self.op.config = {'maxNodes': 6}
        self.op.namespace = 'coder'
        self.op.k = Mock()
        self.op.aws = Mock()
        self.op.group = Mock(return_value={'scalingConfig': {'desiredSize': 3, 'maxSize': 4}})
        self.job = {'id': RID}
        self.node = {'metadata': {'name': 'worker-a', 'labels': {'kubernetes.io/hostname': 'host-a'}}}

    def test_managed_group_adds_one_and_preserves_limits(self):
        self.op.k.return_value = '{"items":[]}'
        self.op.aws.return_value = {'update': {'id': 'update-id'}}
        p = {'kind': 'eks-managed', 'cluster': 'qa', 'group': 'workers'}
        self.assertEqual(self.op.launch(p, self.job, []), 'update-id')
        self.op.aws.assert_called_once_with(p, 'eks', 'update-nodegroup-config', '--cluster-name', 'qa',
                                           '--nodegroup-name', 'workers', '--scaling-config', 'desiredSize=4',
                                           '--client-request-token', RID)
        self.op.group.return_value['scalingConfig']['maxSize'] = 3
        with self.assertRaisesRegex(ValueError, 'maximum'):
            self.op.launch(p, self.job, [])
        self.op.aws.assert_called_once()

    def test_managed_group_respects_autoscaler(self):
        self.op.k.return_value = json.dumps({'items': [{'spec': {'template': {'spec': {'containers': [
            {'image': 'registry.k8s.io/autoscaling/cluster-autoscaler:v1'}]}}}}]})
        with self.assertRaisesRegex(ValueError, 'Cluster Autoscaler'):
            self.op.launch({'kind': 'eks-managed'}, self.job, [])
        self.op.aws.assert_not_called()

    def test_manual_instance_uses_pinned_template_and_request_id(self):
        self.op.aws.return_value = {'Instances': [{'InstanceId': 'i-worker'}]}
        p = {'kind': 'eks-manual', 'launchTemplate': 'lt-abcd', 'version': '3'}
        self.assertEqual(self.op.launch(p, self.job, []), 'i-worker')
        self.op.aws.assert_called_once_with(p, 'ec2', 'run-instances', '--launch-template', 'LaunchTemplateId=lt-abcd,Version=3',
                                           '--min-count', '1', '--max-count', '1', '--client-token', RID)

    def test_dynamic_karpenter_pool_requests_a_new_node(self):
        self.op.k.return_value = json.dumps({'spec': {'template': {'spec': {'taints': []}}}})
        self.assertEqual(self.op.launch({'kind': 'karpenter', 'pool': 'default', 'pauseImage': 'local/pause'}, self.job, [self.node]), 'demand')
        pod = json.loads(self.op.k.call_args.kwargs['stdin'])
        self.assertEqual(pod['spec']['nodeSelector'], {'karpenter.sh/nodepool': 'default'})
        expressions = pod['spec']['affinity']['nodeAffinity']['requiredDuringSchedulingIgnoredDuringExecution']['nodeSelectorTerms'][0]['matchExpressions']
        self.assertEqual(expressions, [{'key': 'kubernetes.io/hostname', 'operator': 'NotIn', 'values': ['host-a']}])
        self.assertFalse(pod['spec']['automountServiceAccountToken'])

    def test_static_karpenter_pool_uses_version_guard(self):
        self.op.k.return_value = json.dumps({'metadata': {'resourceVersion': 'v42'}, 'spec': {'replicas': 2}})
        self.assertEqual(self.op.launch({'kind': 'karpenter', 'pool': 'fixed'}, self.job, []), 'static')
        self.assertEqual(json.loads(self.op.k.call_args.args[-1]), [
            {'op': 'test', 'path': '/metadata/resourceVersion', 'value': 'v42'},
            {'op': 'replace', 'path': '/spec/replicas', 'value': 3}])

    @patch.object(worker, 'run')
    def test_minikube_adds_worker_in_enrolled_profile(self, run):
        self.op.launch({'kind': 'minikube', 'profile': 'lab'}, self.job, [])
        run.assert_called_once_with('minikube', 'node', 'add', '-p', 'lab', '--worker=true', '--delete-on-failure=false', timeout=900)

    @patch.object(worker, 'run', return_value='other-uid')
    def test_mismatched_cluster_is_refused(self, _run):
        self.op.uid = 'enrolled'
        with self.assertRaisesRegex(ValueError, 'different Kubernetes cluster'):
            self.op.validate({'kind': 'minikube', 'profile': 'other'})


if __name__ == '__main__':
    unittest.main()
