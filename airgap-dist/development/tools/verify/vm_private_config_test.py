"""Guest-only credential boundaries, fixed commands, and mount routing policy."""
import base64
import copy
import importlib.util
import os
import pathlib
import sys
import tempfile
import stat
import unittest
from unittest import mock

CHART = pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped'
sys.path.insert(0, str(CHART / 'files/ui-updates'))
from test_vmprofile import fixture
from vmprofile import ProfileError
spec = importlib.util.spec_from_file_location('private_config', CHART / 'files/vmguest/private_config.py')
private = importlib.util.module_from_spec(spec)
spec.loader.exec_module(private)


class PrivateConfigTest(unittest.TestCase):
    def setUp(self):
        self.runtime, _, _ = fixture()
        self.runtime['cloud_drive'] = {'enabled': True}
        self.runtime['tunnel']['enabled'] = True
        self.config = {k: self.runtime[k] for k in ('version', 'build_id', 'workspace_id', 'workspace_owner_id', 'organization_id')}
        self.mount = {'id': 'own', 'kind': 'own', 'endpoint': 'https://coder-ui-updates.coder.svc:9444',
            'region': 'us-east-1', 'bucket': 'audit-' + self.runtime['workspace_owner_id'],
            'prefix': self.runtime['workspace_owner_id'], 'access_key': 'private-access', 'secret_key': 'private-secret',
            'read_only': False, 'ca_pem_base64': base64.b64encode(b'-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----').decode()}
        self.config.update(cloud_drive={'enabled': True, 'annotation': 'on', 'mounts': [self.mount], 'mounts_state': {'peers': {}, 'sources': {}, 'shared': []}},
            tunnel={'enabled': True, 'endpoint': '10.0.0.20:51871', 'url': 'https://coder.example/__coder-ui/api/workspace-tunnels/agent/sync'}, source={'enabled': False})

    def test_public_mount_ancestors_survive_private_umask(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / 'drives'
            real_lstat = pathlib.Path.lstat
            def root_lstat(target):
                values = list(real_lstat(target))
                values[4] = 0
                return os.stat_result(values)
            old = os.umask(0o077)
            try:
                with mock.patch.object(pathlib.Path, 'lstat', root_lstat):
                    private.public_directory(path)
                    private.public_directory(path / 'peers')
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o755)
                self.assertEqual(stat.S_IMODE((path / 'peers').stat().st_mode), 0o755)
            finally:
                os.umask(old)

    def test_qga_staging_is_sealed_without_relaxing_private_reads(self):
        real_fstat = os.fstat
        foreign = False
        def root_stat(fd):
            values = list(real_fstat(fd))
            values[4] = 1000 if foreign and stat.S_ISREG(values[0]) else 0
            return os.stat_result(values)
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(private, 'CONFIG', pathlib.Path(folder)), mock.patch.object(private.os, 'fstat', side_effect=root_stat):
            os.chmod(folder, 0o700)
            for name in ('private-config.next', 'user-command.next'):
                path = pathlib.Path(folder) / name
                path.write_text('{"ok":true}')
                path.chmod(0o666)
                with self.assertRaises(ProfileError):
                    private.trusted_json(path)
                self.assertEqual(private.trusted_staging_json(path), {'ok': True})
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            path.unlink()
            path.symlink_to(pathlib.Path(folder) / 'private-config.next')
            with self.assertRaises(OSError):
                private.trusted_staging_json(path)

            path.unlink()
            path.write_text('{}')
            os.link(path, pathlib.Path(folder) / 'other')
            with self.assertRaises(ProfileError):
                private.trusted_staging_json(path)
            (pathlib.Path(folder) / 'other').unlink()
            foreign = True
            with self.assertRaises(ProfileError):
                private.trusted_staging_json(path)
            foreign = False
            os.chmod(folder, 0o755)
            with self.assertRaises(ProfileError):
                private.trusted_staging_json(path)

    def test_public_mount_recheck_does_not_chmod_read_only_filesystem(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder)
            info = list(path.lstat())
            info[0], info[4] = stat.S_IFDIR | 0o777, 0
            with mock.patch.object(pathlib.Path, 'lstat', return_value=os.stat_result(info)), \
                    mock.patch.object(private.os.path, 'ismount', return_value=True), \
                    mock.patch.object(private.os, 'chmod', side_effect=OSError('read-only mount')) as chmod:
                private.public_directory(path)
                chmod.assert_not_called()
                info[0] = stat.S_IFDIR | 0o700
                with mock.patch.object(pathlib.Path, 'lstat', return_value=os.stat_result(info)), self.assertRaises(ProfileError):
                    private.public_directory(path)

    def test_identity_build_gateway_and_public_credentials_fail_before_side_effects(self):
        self.assertEqual(private.validate(self.config, self.runtime), self.config)
        changes = [lambda c: c.update(build_id=self.runtime['workspace_id']),
                   lambda c: c.update(workspace_id=self.runtime['organization_id']),
                   lambda c: c['cloud_drive']['mounts'][0].update(endpoint='http://attacker.invalid'),
                   lambda c: c['cloud_drive']['mounts'][0].update(prefix='../escape'),
                   lambda c: c['cloud_drive']['mounts_state'].update(peers={'user': [{'secretKey': 'private-secret'}]}),
                   lambda c: c['tunnel'].update(url='https://attacker.invalid/sync'),
                   lambda c: c['tunnel'].update(endpoint='127.0.0.1:51871')]
        for change in changes:
            config = copy.deepcopy(self.config)
            change(config)
            with self.subTest(change=change), mock.patch.object(private, 'run') as run:
                with self.assertRaises((ProfileError, ValueError)):
                    private.apply(config, self.runtime)
                run.assert_not_called()

    def test_gateway_cannot_target_another_runtime_namespace(self):
        self.runtime['cluster_namespace']='coder'
        self.mount['endpoint']='https://coder-ui-updates.foreign.svc:9444'
        with mock.patch.object(private,'validate_runtime'), self.assertRaises(ProfileError):
            private.validate(self.config,self.runtime)

    def test_private_mount_accepts_the_shared_drive_identifier_format(self):
        for fields in ({'kind': 'peer', 'name': 'peer-account'},
                       {'kind': 'item', 'item_kind': 'folder', 'item': 'folder'},
                       {'kind': 'item', 'item_kind': 'file', 'item': 'file.txt'}):
            with self.subTest(fields=fields):
                config = copy.deepcopy(self.config)
                mount = copy.deepcopy(self.mount)
                mount.update(id='7e855a113a4142b1b7ab24dbce32c41b', **fields)
                config['cloud_drive']['mounts'].append(mount)
                private.validate(config, self.runtime)
                for identity in ('../folder', '7E855A113A4142B1B7AB24DBCE32C41B', '7e855a113a4142b1b7ab24dbce32c41b/child'):
                    mount['id'] = identity
                    with self.subTest(identity=identity), self.assertRaises(ProfileError):
                        private.validate(config, self.runtime)


    def test_file_share_requires_exact_file_and_never_exposes_parent(self):
        item = dict(self.mount, id=self.runtime['workspace_id'], kind='item', item_kind='file', item='report.txt')
        self.config['cloud_drive']['mounts'] = [item]
        private.validate(self.config, self.runtime)
        self.assertEqual(private.destination_for(item), private.DRIVES / 'items' / item['id'])
        for name in ('../credentials', '.', '..', 'line\nbreak', 'line\rbreak', 'nul\0byte', 'dir\\file'):
            item['item'] = name
            with self.subTest(name=name), self.assertRaises(ProfileError):
                private.validate(self.config, self.runtime)

    def test_file_mount_filters_a_literal_basename_without_binding_its_inode(self):
        item = dict(self.mount, id='7e855a113a4142b1b7ab24dbce32c41b', kind='item', item_kind='file', item='report[1]*.txt')
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            def start(*args):
                (private.file_parent(item) / item['item']).write_text('approved file')
            with mock.patch.object(private, 'PRIVATE', root / 'private'), mock.patch.object(private, 'DRIVES', root / 'drives'), \
                    mock.patch.object(private, 'private_directory', side_effect=lambda p:p.mkdir(parents=True, exist_ok=True)), \
                    mock.patch.object(private, 'run', return_value=mock.Mock(returncode=0)) as run, \
                    mock.patch.object(private, 'service', side_effect=start) as service, mock.patch.object(private, 'file_link') as link:
                private.apply_mount(item)
                include = root / 'private' / ('mount-' + item['id']) / 'files'
                self.assertEqual(include.read_text(), 'report[1]*.txt\n')
                self.assertEqual(stat.S_IMODE(include.stat().st_mode), 0o600)
                self.assertIn('"--files-from-raw"', service.call_args.args[1])
                self.assertIn('"--dir-cache-time" "1s"', service.call_args.args[1])
                self.assertFalse(any('--bind' in call.args for call in run.call_args_list))
                link.assert_called_once_with(item)

    def test_file_link_cleanup_preserves_replacement_files_and_links(self):
        item = dict(self.mount, id='7e855a113a4142b1b7ab24dbce32c41b', kind='item', item_kind='file', item='report.txt')
        real_fstat, real_stat = os.fstat, os.stat
        def root_owned(value):
            values = list(value)
            values[4] = 0
            return os.stat_result(values)
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(private, 'DRIVES', pathlib.Path(directory)), \
                mock.patch.object(private.os, 'fstat', side_effect=lambda fd:root_owned(real_fstat(fd))), \
                mock.patch.object(private.os, 'stat', side_effect=lambda *args, **kwargs:root_owned(real_stat(*args, **kwargs))):
            target = private.destination_for(item)
            target.parent.mkdir(mode=0o755)
            private.file_link(item)
            self.assertEqual(os.readlink(target), '../files/' + item['id'] + '/report.txt')
            private.file_link(item, remove=True)
            self.assertFalse(target.is_symlink())
            target.write_text('replacement')
            with self.assertRaises(ProfileError):
                private.file_link(item, remove=True)
            self.assertEqual(target.read_text(), 'replacement')
            target.unlink()
            target.symlink_to('../unapproved')
            with self.assertRaises(ProfileError):
                private.file_link(item, remove=True)
            self.assertEqual(os.readlink(target), '../unapproved')
            target.unlink()
            private.file_link(item)
            calls = 0
            def replaced_inode(*args, **kwargs):
                nonlocal calls
                values = list(root_owned(real_stat(*args, **kwargs)))
                calls += 1
                if calls == 2:
                    values[1] += 1
                return os.stat_result(values)
            with mock.patch.object(private.os, 'stat', side_effect=replaced_inode), self.assertRaises(ProfileError):
                private.file_link(item, remove=True)
            self.assertTrue(target.is_symlink())
            target.parent.chmod(0o777)
            with self.assertRaises(ProfileError):
                private.file_link(item, remove=True)

    def test_socket_scope_is_supervisor_inspected_and_fenced(self):
        identity = 'a' * 64 + ' 123'
        with mock.patch.object(private, 'run', return_value=mock.Mock(stdout=identity)), \
                mock.patch.object(private, 'process_boundary') as boundary, mock.patch.object(private, 'verify_public_binding') as binding, \
                mock.patch.object(private.os, 'readlink', return_value='net:[1234]'), \
                mock.patch.object(private, 'app_address', return_value='172.20.0.2'):
            value = private.app_socket_scope('172.20.0.2')
            self.assertEqual(value, 'WORKSPACE_TUNNEL_APP_PID=123\nWORKSPACE_TUNNEL_APP_NETNS=net:[1234]\nWORKSPACE_TUNNEL_APP_ADDRESS=172.20.0.2\n')
            boundary.assert_called_once_with(123)
            binding.assert_called_once_with(123)
            with mock.patch.object(private, 'run', side_effect=[mock.Mock(stdout=identity), mock.Mock(stdout='b' * 64 + ' 124')]), self.assertRaises(ProfileError):
                private.app_socket_scope('172.20.0.2')

    def test_source_preserves_actor_and_cannot_escape_home(self):
        cfg = {'root': '/home/coder/project', 'bucket': 'drive', 'prefix': self.runtime['workspace_owner_id']+'/',
            'accessKey': 'source-access', 'secretKey': 'source-secret', 'region': 'us-east-1', 'port': 9900,
            'auditEnabled': True, 'auditOwner': self.runtime['workspace_owner_id'], 'auditVersion': 2, 'id': 'a'*16}
        self.config['source'] = {'enabled': True, 'config': cfg}
        private.validate(self.config, self.runtime)
        for path in ('/etc', '/home/coder/../private', '/home/coderx'):
            cfg['root'] = path
            with self.assertRaises(ProfileError):
                private.validate(self.config, self.runtime)
        cfg['root'] = '/home/coder/project'
        cfg['auditOwner'] = self.runtime['organization_id']
        with self.assertRaises(ProfileError):
            private.validate(self.config, self.runtime)

    def test_mount_credentials_are_private_files_and_not_service_arguments(self):
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(private, 'PRIVATE', pathlib.Path(directory)), mock.patch.object(private, 'DRIVES', pathlib.Path(directory)/'drives'), mock.patch.object(private, 'private_directory', side_effect=lambda p:p.mkdir(exist_ok=True)), mock.patch.object(private, 'run', return_value=mock.Mock(returncode=0)), mock.patch.object(private, 'service') as service:
            private.apply_mount(self.mount)
            arguments = repr(service.call_args)
            self.assertNotIn('private-secret', arguments)
            self.assertNotIn('private-access', arguments)
            self.assertIn('--ca-cert', arguments)
            self.assertIn('"--umask" "0000"', arguments)
            self.assertNotIn('no-check-certificate', arguments)
            config = pathlib.Path(directory)/'mount-own/rclone.conf'
            self.assertEqual(config.stat().st_mode & 0o777, 0o600)
            self.assertIn('private-secret', config.read_text())
            self.assertIn('force_path_style = true', config.read_text())

    def test_tunnel_routes_both_protocols_and_never_executes_inside_user_container(self):
        with mock.patch.object(private, 'run', return_value=mock.Mock(returncode=0)) as run:
            private.tunnel_rules('172.17.0.2', True)
        commands = [call.args for call in run.call_args_list]
        dnat = [c for c in commands if 'DNAT' in c]
        self.assertEqual({c[c.index('-p')+1] for c in dnat}, {'tcp', 'udp'})
        self.assertTrue(all(c[-1] == '172.17.0.2' for c in dnat))
        self.assertFalse(any('docker' in c or 'exec' in c for c in commands))
        source_guard = next(i for i, c in enumerate(commands) if 'CODER_VM_APP_SOURCE' in c)
        guard = next(i for i, c in enumerate(commands) if 'CODER_VM_NEKO' in c)
        accept = next(i for i, c in enumerate(commands) if 'ACCEPT' in c)
        self.assertLess(guard, accept)
        self.assertLess(source_guard, guard)

    def test_application_source_guard_fences_input_and_forward_before_allow_rules(self):
        with mock.patch.object(private, 'restore_rules') as restore, mock.patch.object(private, 'run', return_value=mock.Mock(returncode=1)) as run:
            private.app_source_rules('172.20.0.2')
            self.assertEqual(restore.call_args.args, ('filter', [':CODER_VM_APP_SOURCE - [0:0]', '-F CODER_VM_APP_SOURCE',
                '-A CODER_VM_APP_SOURCE -s 172.20.0.2/32 -j RETURN', '-A CODER_VM_APP_SOURCE -j DROP']))
            inserted = [c.args for c in run.call_args_list if '-I' in c.args]
            self.assertEqual({c[4] for c in inserted}, {'INPUT', 'FORWARD'})
            self.assertTrue(all(c[5:] == ('1', '-i', 'docker0', '-j', 'CODER_VM_APP_SOURCE') for c in inserted))

    def test_neko_default_disabled_and_shared_pod_cidr_validation(self):
        private.validate(self.config, self.runtime)
        self.config['neko'] = {'enabled': False, 'relay_sources': []}
        private.validate(self.config, self.runtime)
        self.config['neko'] = {'enabled': True, 'relay_sources': ['100.64.0.2'], 'advertised_ip': '10.0.0.20'}
        private.validate(self.config, self.runtime)
        self.config['neko']['advertised_ip'] = '10.0.0.21'
        with self.assertRaises(ProfileError):
            private.validate(self.config, self.runtime)
        self.config['neko'].pop('advertised_ip')
        with self.assertRaises(ProfileError):
            private.validate(self.config, self.runtime)
        self.config['neko'] = {'enabled': False, 'relay_sources': [], 'advertised_ip': '10.0.0.20'}
        with self.assertRaises(ProfileError):
            private.validate(self.config, self.runtime)

    def test_neko_rejects_malformed_or_non_unicast_sources_before_side_effects(self):
        for source in ('127.0.0.1', '169.254.1.1', '224.0.0.1', '0.0.0.0', '255.255.255.255', '10.0.0.1/32', '10.0.0.01', '10.0.0.1\n-j ACCEPT'):
            config = copy.deepcopy(self.config)
            config['neko'] = {'enabled': True, 'relay_sources': [source], 'advertised_ip': '10.0.0.20'}
            with self.subTest(source=source), mock.patch.object(private, 'run') as run, mock.patch.object(private, 'restore_rules') as restore:
                with self.assertRaises(ValueError):
                    private.apply(config, self.runtime)
                run.assert_not_called()
                restore.assert_not_called()
        for media in ({'enabled': True, 'relay_sources': []}, {'enabled': False, 'relay_sources': ['10.0.0.1']},
                      {'enabled': True, 'relay_sources': ['10.0.0.1', '10.0.0.1']},
                      {'enabled': True, 'relay_sources': ['10.0.0.' + str(i) for i in range(1, 18)]},
                      {'enabled': True, 'relay_sources': ['10.0.0.1'], 'port': 9999}):
            with self.subTest(media=media), self.assertRaises(ValueError):
                private.validate_neko(media)

    def test_neko_replaces_only_owned_udp_rules_and_removes_old_sources(self):
        with mock.patch.object(private, 'restore_rules') as restore, mock.patch.object(private, 'run', return_value=mock.Mock(returncode=1)) as run:
            private.neko_rules('172.20.0.2', {'enabled': True, 'relay_sources': ['10.244.0.2'], 'advertised_ip': '10.244.1.2'})
            self.assertEqual([c.args[0] for c in restore.call_args_list], ['filter', 'nat'])
            self.assertIn('-A CODER_VM_NEKO -s 10.244.0.2/32 -d 172.20.0.2/32 -j ACCEPT', restore.call_args_list[0].args[1])
            self.assertIn('-A CODER_VM_NEKO -d 172.20.0.2/32 -j DROP', restore.call_args_list[0].args[1])
            self.assertTrue(all('59000' in c.args and 'udp' in c.args for c in run.call_args_list))
            restore.reset_mock()
            private.neko_rules('172.20.0.2', {'enabled': True, 'relay_sources': ['10.244.0.3'], 'advertised_ip': '10.244.1.2'})
            self.assertNotIn('10.244.0.2', repr(restore.call_args_list))
            restore.reset_mock()
            private.neko_rules('172.20.0.2', {'enabled': False, 'relay_sources': []})
            self.assertNotIn('ACCEPT', repr(restore.call_args_list))
            self.assertNotIn('DNAT', repr(restore.call_args_list))

    def test_public_files_never_contain_mount_keys_or_agent_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            patches = [mock.patch.object(private, 'PRIVATE', root/'private'), mock.patch.object(private, 'PUBLIC', root/'public'), mock.patch.object(private, 'DRIVES', root/'drives'),
                mock.patch.object(private, 'private_directory', side_effect=lambda p:p.mkdir(exist_ok=True)), mock.patch.object(private, 'public_directory', side_effect=lambda p:p.mkdir(exist_ok=True)), mock.patch.object(private, 'apply_mount'),
                mock.patch.object(private, 'service'), mock.patch.object(private, 'verify_container'), mock.patch.object(private, 'app_address', return_value='172.17.0.2'), mock.patch.object(private, 'app_source_rules'), mock.patch.object(private, 'app_socket_scope', return_value='WORKSPACE_TUNNEL_APP_PID=123\n'), mock.patch.object(private, 'tunnel_rules'), mock.patch.object(private, 'neko_rules')]
            for patch in patches:
                patch.start()
                self.addCleanup(patch.stop)
            private.apply(self.config, self.runtime)
            public = ''.join(path.read_text() for path in (root/'public').iterdir())
            for secret in ('private-secret', 'private-access', self.runtime['agent']['token']):
                self.assertNotIn(secret, public)
            self.assertEqual((root/'public/private-ready').read_text(), 'true\n')
            self.assertEqual((root/'private/tunnel.env').stat().st_mode & 0o777, 0o600)
            self.assertIn('WORKSPACE_TUNNEL_FORWARD_CHAIN=CODER_VM_TUNNEL\n', (root/'private/tunnel.env').read_text())
            self.assertIn(self.runtime['agent']['token'], (root/'private/tunnel.env').read_text())

    def test_shutdown_cannot_acknowledge_an_active_or_uninspectable_service(self):
        for status in (0, 1):
            with mock.patch.object(private, 'run', return_value=mock.Mock(returncode=status)):
                with self.assertRaises(ProfileError):
                    private.service('coder-vm-tunnel', '', enabled=False)
        with mock.patch.object(private, 'run', return_value=mock.Mock(returncode=3)):
            private.service('coder-vm-tunnel', '', enabled=False)

    def test_source_symlink_is_rejected_before_loading_credentials_or_dropping_uid(self):
        self.config['source'] = {'enabled': True, 'config': {'root': '/home/coder/escape', 'bucket':'drive', 'prefix':self.runtime['workspace_owner_id']+'/', 'accessKey':'source-access','secretKey':'source-secret','region':'us-east-1','port':9900,'auditEnabled':True,'auditOwner':self.runtime['workspace_owner_id'],'auditVersion':2,'id':'a'*16}}
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(private, 'ROOT', pathlib.Path(directory)), mock.patch.object(private, 'trusted_json', side_effect=[self.runtime,self.config]), mock.patch.object(private.os,'geteuid',return_value=0), mock.patch.object(private.os,'setuid') as setuid, mock.patch('sys.stderr'):
            home=pathlib.Path(directory)/'home'
            home.mkdir()
            (home/'escape').symlink_to('/etc')
            self.assertEqual(private.source_main(),1)
            setuid.assert_not_called()


    def test_all_features_off_still_requires_actual_container_before_readiness(self):
        self.config['cloud_drive'].update(enabled=False,mounts=[],annotation='off')
        self.config['tunnel']['enabled']=False
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(private,'PRIVATE',pathlib.Path(directory)/'private'), mock.patch.object(private,'PUBLIC',pathlib.Path(directory)/'public'), mock.patch.object(private,'private_directory'), mock.patch.object(private,'verify_container',side_effect=ProfileError('container missing')) as verify, mock.patch.object(private,'service') as service:
            with self.assertRaises(ProfileError):
                private.apply(self.config,self.runtime)
            verify.assert_called_once_with(self.runtime)
            self.assertEqual((pathlib.Path(directory)/'public/private-ready').read_text(),'false\n')
            service.assert_not_called()

    def test_readonly_iso_mount_requires_the_fixed_audited_alias(self):
        self.mount.update(kind='iso',id='iso',bucket='audit-library-isos',read_only=True)
        private.validate(self.config,self.runtime)
        self.mount['read_only']=False
        with self.assertRaises(ProfileError):
            private.validate(self.config,self.runtime)

    def test_actual_container_controls_are_verified_not_only_runtime_intent(self):
        usable=self.runtime['memory_bytes']-self.runtime['reserved_memory_bytes']
        required={'/home/coder':(str(private.ROOT/'home'),True),'/etc/platform':(str(private.PUBLIC),False),'/mnt/coder-vm-drives':(str(private.DRIVES),True),'/run/coder-vm/launch-user.sh':(str(private.LIB/'launch-user.sh'),False),'/run/coder-vm/agent-init.sh':('/run/coder-workspace/agent-init.sh',False),'/run/coder-vm/launch-gate':(str(private.LIB/'launch-gate'),False),'/etc/ssl/certs/ca-certificates.crt':('/run/coder-workspace/ca-certificates.crt',False),'/opt/coder-vm-support/clouddrive_cli.py':(str(private.LIB/'clouddrive_cli.py'),False)}
        for path in ('/proc/cpuinfo','/proc/meminfo','/proc/stat','/proc/swaps','/proc/uptime','/sys/devices/system/cpu'):
            required[path]=('/var/lib/lxcfs'+path,False)
        container={'Id':'current','State':{'Running':True,'Pid':42},'Config':{'User':'1000:1000','Image':self.runtime['workspace_image'],'Entrypoint':['/run/coder-vm/launch-gate'],'Cmd':['--authorization','c'*64],'Healthcheck':{'Test':['NONE']}},'HostConfig':{'Runtime':'sysbox-runc','Privileged':False,'NanoCpus':self.runtime['cpu']*1000000000,'CpusetCpus':'0-'+str(self.runtime['cpu']-1),'Memory':usable,'MemorySwap':usable,'NetworkMode':'default','PidMode':'','IpcMode':'private'},'Mounts':[{'Destination':name,'Source':source,'RW':rw,'Type':'bind','Propagation':'rslave' if name=='/mnt/coder-vm-drives' else 'rprivate'} for name,(source,rw) in required.items()]}
        def run(*args,**_):
            if args[0]=='docker':
                return mock.Mock(stdout=__import__('json').dumps([container]))
            return mock.Mock(stdout=str(self.runtime['home_bytes']) if args[0]=='blockdev' else self.runtime['home_device'])
        with mock.patch.object(private,'run',side_effect=run), mock.patch.object(private,'gate_nonce',return_value='c'*64), mock.patch.object(private,'verify_public_binding'), mock.patch.object(private,'process_boundary') as boundary, mock.patch.object(pathlib.Path,'stat',return_value=mock.Mock(st_mode=stat.S_IFBLK)):
            private.verify_container(self.runtime)
            boundary.assert_called_once_with(42)
            original=copy.deepcopy(container)
            for change in (lambda c:c['HostConfig'].update(Privileged=True),lambda c:c['Config'].update(Healthcheck={'Test':['CMD-SHELL','user-code']}),lambda c:c['Config'].update(Entrypoint=['/bin/sh']),lambda c:c['Config'].update(Cmd=['--authorization','forged']),lambda c:c['HostConfig'].update(Memory=self.runtime['memory_bytes']),lambda c:c['HostConfig'].update(NetworkMode='host'),lambda c:c['State'].update(Running=False),lambda c:c['Mounts'][0].update(Source='/')):
                container=copy.deepcopy(original)
                change(container)
                with self.assertRaises(ProfileError):
                    private.verify_container(self.runtime)


    def test_readiness_binding_cannot_resolve_into_tenant_home(self):
        expected=mock.Mock(st_dev=1,st_ino=20)
        actual=mock.Mock(st_dev=1,st_ino=99)
        with mock.patch.object(pathlib.Path,'stat',side_effect=[expected,actual]),self.assertRaises(ProfileError):
            private.verify_public_binding(42)


    def test_apply_errors_do_not_print_credentials(self):
        with mock.patch.object(private.os, 'geteuid', return_value=0), mock.patch.object(private, 'private_directory', side_effect=RuntimeError('private-secret')), mock.patch('sys.stderr') as stderr:
            self.assertEqual(private.main(), 1)
            self.assertNotIn('private-secret', repr(stderr.write.call_args_list))


if __name__ == '__main__':
    unittest.main()
