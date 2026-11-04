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

    def maintenance(self, action="restart-node"):
        self.node.update(spec={}, status={"nodeInfo": {"bootID": "boot-old"}, "conditions": [{"type": "Ready", "status": "True"}]})
        self.node["metadata"].update(uid="node-uid")
        self.job.update(node="worker-a", uid="node-uid", action=action)
        self.op.k.return_value = json.dumps(self.node)
        self.op.validate = Mock()

    def test_replaced_node_is_never_restarted(self):
        self.maintenance()
        self.job["uid"] = "stale"
        with self.assertRaisesRegex(ValueError, "replaced"):
            self.op.prepare_maintenance({"kind": "k3d"}, self.job)
        self.op.validate.assert_not_called()

    @patch.object(worker, "run")
    def test_k3d_membership_and_container_identity(self, run):
        self.maintenance()
        run.return_value = '[{"name":"worker-a","runtimeLabels":{"k3d.cluster":"wrong"}}]'
        with self.assertRaisesRegex(ValueError, "enrolled k3d"):
            self.op.prepare_maintenance({"kind": "k3d", "cluster": "lab"}, self.job)
        run.side_effect = ['[{"name":"worker-a","runtimeLabels":{"k3d.cluster":"lab"}}]', 'container-1 old-start']
        self.op.prepare_maintenance({"kind": "k3d", "cluster": "lab"}, self.job)
        self.assertEqual(self.job["containerID"], "container-1")
        run.side_effect = None
        run.return_value = "container-replaced"
        with self.assertRaisesRegex(ValueError, "replaced"):
            self.op.maintain({"kind": "k3d"}, self.job)
        self.assertFalse(any("stop" in c.args for c in run.call_args_list))

    @patch.object(worker, "run")
    def test_stopped_k3d_node_is_recovered_without_second_stop(self, run):
        self.maintenance()
        self.job.update(containerID="container-1", containerStarted="old-start")
        run.side_effect = ['container-1', '{"Running":false,"StartedAt":"old-start"}', '']
        self.assertIsNone(self.op.observe_maintenance({"kind": "k3d"}, self.job))
        self.assertEqual(run.call_args.args, ('k3d', 'node', 'start', 'worker-a'))
        run.side_effect = ['container-1', '{"Running":true,"StartedAt":"new-start"}']
        self.assertEqual(self.op.observe_maintenance({"kind": "k3d"}, self.job), 'worker-a restarted and is Ready.')
        self.assertFalse(any("stop" in c.args for c in run.call_args_list))

    def test_drain_honors_budgets_and_local_data(self):
        self.maintenance("drain-node")
        self.op.maintain(None, self.job)
        self.assertEqual(self.op.k.call_args.args, ('drain', 'worker-a', '--ignore-daemonsets', '--timeout=10m'))
        self.assertTrue(self.job['commandCompleted'])
        self.node['spec']['unschedulable'] = True
        self.op.k.side_effect = [json.dumps(self.node), '{"items":[{"metadata":{"ownerReferences":[{"kind":"DaemonSet","controller":true}]}}]}']
        self.assertIn('drained and cordoned', self.op.observe_maintenance(None, self.job))

    def test_aws_reboot_needs_cluster_tags_and_new_boot_identity(self):
        self.maintenance()
        self.node['spec']['providerID'] = 'aws:///us-east-1a/i-abcdef1234'
        self.op.k.return_value = json.dumps(self.node)
        p = {'kind':'eks-manual','region':'us-east-1','cluster':'lab'}
        self.op.aws.return_value = {'Reservations':[{'Instances':[{'InstanceId':'i-abcdef1234','Tags':[]}]}]}
        with self.assertRaisesRegex(ValueError, 'membership'):
            self.op.prepare_maintenance(p, self.job)
        self.op.aws.return_value['Reservations'][0]['Instances'][0]['Tags'] = [{'Key':'kubernetes.io/cluster/lab','Value':'owned'}]
        self.op.prepare_maintenance(p, self.job)
        self.op.maintain(p, self.job)
        self.assertEqual(self.op.aws.call_args.args, (p,'ec2','reboot-instances','--instance-ids','i-abcdef1234'))
        self.assertIsNone(self.op.observe_maintenance(p, self.job))
        self.node['status']['nodeInfo']['bootID'] = 'boot-new'
        self.op.k.return_value = json.dumps(self.node)
        self.assertIn('restarted and is Ready', self.op.observe_maintenance(p, self.job))

    def test_claimed_operation_is_observed_without_replaying_restart(self):
        self.op.org = RID
        self.op.refresh_at = float('inf')
        self.op.available = []
        self.op.profiles = {'local':{'id':'local','kind':'k3d'}}
        job = {'id':RID,'profile':'local','organization_id':RID,'action':'restart-node','phase':'provisioning',
               'node':'worker-a','uid':'node-uid','created':worker.time.time(),'message':'checking'}
        cm = {'metadata':{'resourceVersion':'3'},'data':{'organization_id':RID,'operation':json.dumps(job)}}
        self.op.current = Mock(return_value=cm)
        self.op.patch = Mock(return_value=cm)
        self.op.maintain = Mock()
        self.op.observe_maintenance = Mock(return_value='worker-a restarted and is Ready.')
        self.op.tick()
        self.op.maintain.assert_not_called()
        self.op.observe_maintenance.assert_called_once()
        self.assertEqual(json.loads(self.op.patch.call_args.kwargs['operation'])['phase'], 'ready')


if __name__ == '__main__':
    unittest.main()
