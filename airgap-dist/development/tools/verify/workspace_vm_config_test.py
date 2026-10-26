"""Guest mount plans preserve existing actor attribution and sharing controls."""
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__),
    '../../../helm-chart/coder-airgapped/files/ui-updates')))
import vmconfig


class ConfigTest(unittest.TestCase):
    def setUp(self):
        self.safe = mock.Mock(AUDIT_ENABLED=True)
        self.safe.sources.return_value = {}
        self.safe.disconnected.return_value = set()
        self.safe.shared_now.return_value = {}
        self.safe.turned_off.return_value = None
        self.safe.peer_mounts.return_value = {'actor': [{'id': 'share', 'owner': 'other', 'name': 'other',
            'kind': 'folder', 'path': 'allowed/folder', 'readOnly': True}]}
        self.safe._audit.credentials.return_value = {'accessKey': 'actor-access', 'secretKey': 'actor-secret'}
        self.profile = {'workspace_id': 'workspace', 'workspace_owner_id': 'actor', 'cloud_drive': {'enabled': True}}
        self.config = vmconfig.Configurator(mock.Mock(), 'coder', 'http://coder', self.safe)

    def test_own_and_approved_shared_mounts_use_actor_credentials_and_verified_tls(self):
        with mock.patch('builtins.open', mock.mock_open(read_data=b'public-ca')):
            result = self.config.drive(self.profile)
        self.safe._audit.credentials.assert_called_once_with('actor')
        self.assertEqual([m['bucket'] for m in result['mounts']], ['audit-actor', 'audit-other', 'audit-library-isos'])
        self.assertEqual(result['mounts'][1]['prefix'], 'actor/allowed/folder')
        self.assertTrue(result['mounts'][1]['read_only'])
        self.assertTrue(all(m['endpoint'] == 'https://coder-ui-updates.coder.svc:9444' for m in result['mounts']))
        self.assertTrue(all(m['secret_key'] == 'actor-secret' for m in result['mounts']))
        self.assertNotIn('actor-secret', str(result['mounts_state']))

    def test_disconnected_workspace_keeps_only_the_existing_readonly_iso_library(self):
        with mock.patch('builtins.open', mock.mock_open(read_data=b'public-ca')):
            for reason in ('shared', 'disconnected', 'global'):
                self.safe.shared_now.return_value = {'workspace': 'actor'} if reason == 'shared' else {}
                self.safe.disconnected.return_value = {'workspace'} if reason == 'disconnected' else set()
                self.safe.turned_off.return_value = {} if reason == 'global' else None
                result = self.config.drive(self.profile)
                self.assertEqual(result['annotation'], 'off')
                self.assertEqual([m['kind'] for m in result['mounts']], ['iso'])
                self.assertTrue(result['mounts'][0]['read_only'])

    def test_disabled_features_still_receive_current_build_private_authorization(self):
        profile = {'version': 1, 'workspace_id': 'workspace', 'organization_id': 'org',
            'workspace_owner_id': 'actor', 'build_id': 'build', 'cloud_drive': {'enabled': False},
            'tunnel': {'enabled': False}, 'agent': {'url': 'https://coder.example.com'}}
        intent = {'workspace_id': 'workspace', 'organization_id': 'org', 'owner_id': 'actor',
                  'build_id': 'build', 'transition': 'start', 'job_status': 'running'}
        self.config.build_intent = lambda wid, bid: intent
        instance = {'metadata': {'uid': 'instance'}}
        pod = {'metadata': {'name': 'launcher', 'uid': 'pod', 'ownerReferences': [
            {'kind': 'VirtualMachineInstance', 'controller': True, 'uid': 'instance'}]},
            'status': {'phase': 'Running', 'podIP': '10.0.0.1'}}
        self.config.kube.call.return_value = (200, {'items': [pod]})
        with mock.patch.object(vmconfig, 'Guest') as guest:
            guest.return_value.deliver.return_value = 7
            self.assertFalse(self.config(profile, {}, instance))
            delivered = guest.return_value.deliver.call_args.args[0]
            self.assertEqual(delivered['build_id'], 'build')
            self.assertFalse(delivered['cloud_drive']['enabled'])
            self.assertFalse(delivered['tunnel']['enabled'])
            guest.return_value.applied.return_value = True
            self.assertTrue(self.config(profile, {}, instance))
            intent['transition'] = 'stop'
            self.assertFalse(self.config(profile, {}, instance))
            guest.return_value.deliver.assert_called_once()
        self.safe._audit.credentials.assert_not_called()

    def test_missing_audit_fails_instead_of_plain_storage_fallback(self):
        self.safe.AUDIT_ENABLED = False
        with self.assertRaises(RuntimeError):
            self.config.drive(self.profile)
        self.safe._audit.credentials.assert_not_called()

    def test_source_links_own_folder_and_does_not_mount_own_s3_over_it(self):
        self.safe.sources.return_value = {'actor': {'workspace': 'workspace', 'path': '/home/coder/project', 'secretKey': 'private-source-key'}}
        with mock.patch('builtins.open', mock.mock_open(read_data=b'public-ca')):
            result = self.config.drive(self.profile)
        self.assertEqual(result['annotation'], 'source:/home/coder/project')
        self.assertEqual([m['kind'] for m in result['mounts']], ['item', 'iso'])
        self.assertNotIn('private-source-key', str(result['mounts_state']))



if __name__ == '__main__':
    unittest.main()
