"""VM HOME backups must not touch live, foreign, or unregistered disks."""
import contextlib
import copy
import io
import gzip
import tarfile
import json
import os
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__),
    '../../../helm-chart/coder-airgapped/files/ui-updates')))
import vmbackup
import vmhome
import vmfs
import workspacevolumes

RESTORE_RESERVATION = vmhome.restore_reservation


class BackupTest(unittest.TestCase):
    def setUp(self):
        self.ws = {'id': '00000000-0000-4000-8000-000000000001', 'organization_id': 'org',
                   'owner_id': 'user', 'latest_build': {'status': 'stopped'}}
        self.current = {'vm': {'spec': {'runStrategy': 'Halted'}}, 'size': 1000000000,
            'pvc': {'metadata': {'uid': 'claim-uid', 'name': 'home'}, 'spec': {'volumeName': 'home-pv'}}}
        self.record = {'workspace_id': self.ws['id'], 'organization_id': 'org', 'workspace_owner_id': 'user',
            'claim_uid': 'claim-uid', 'claim_name': 'home', 'pv_name': 'home-pv', 'pv_uid': 'pv-uid',
            'home_bytes': 1000000000, 'status': 'ready', 'node_name': 'qualified-worker'}
        available = mock.patch.object(vmfs, 'available')
        available.start()
        self.addCleanup(available.stop)
        reservation = mock.patch.object(vmhome, 'restore_reservation', side_effect=lambda kube, request, amount, **kwargs: contextlib.nullcontext(request))
        reservation.start()
        self.addCleanup(reservation.stop)
        parent = mock.patch.object(vmhome, 'PARENT', pathlib.Path(tempfile.gettempdir()))
        parent.start()
        self.addCleanup(parent.stop)
        self.kube = mock.Mock()
        self.kube.side_effect = self.call
        for patch in (mock.patch.object(vmbackup.vmgrow, 'runtime', return_value=self.current),
                      mock.patch.object(vmbackup.vmgrow, 'IMAGE', 'registry/helper@sha256:' + 'a' * 64)):
            patch.start()
            self.addCleanup(patch.stop)

    def test_restore_reserves_archive_and_raw_copy_before_registry_mutation(self):
        request = {'workspace_id': self.ws['id'], 'organization_id': 'org', 'workspace_owner_id': 'user', 'old_bytes': 1000000000, 'record_resource_version': '7'}
        module = vmhome
        with mock.patch.object(module, 'get', return_value={'metadata': {'resourceVersion': '7'}, 'data': {'homes.json': json.dumps({self.ws['id']: self.record})}}), mock.patch.object(module, 'request_identity'), mock.patch.object(module, 'ensure_capacity', side_effect=module.HomeError('insufficient capacity')) as capacity, mock.patch.object(module, 'update_record') as update:
            with self.assertRaises(module.HomeError):
                with RESTORE_RESERVATION(self.kube, request, 1067108864):
                    self.fail('must not acquire a restore reservation')
            capacity.assert_called_once_with(self.kube, request, additional_bytes=4134217728 + vmfs.SCRATCH_BYTES)
            update.assert_not_called()

    def test_restore_budget_failure_precedes_download_and_quarantine(self):
        with mock.patch.object(vmhome, 'restore_reservation', side_effect=vmhome.HomeError('insufficient capacity')), mock.patch.object(vmbackup, 'download_archive') as download, mock.patch.object(vmhome, 'locked_home') as lock:
            with self.assertRaises(vmhome.HomeError):
                vmbackup.worker(self.kube, {'old_bytes': 1024}, 'restore', 'http://service/__coder-ui/internal/volumes/' + 'a' * 43 + '/restore')
            download.assert_not_called()
            lock.assert_not_called()

    def call(self, method, path, body=None):
        if '/virtualmachineinstances/' in path:
            return 404, {}
        if '/configmaps/' in path:
            return 200, {'metadata': {'resourceVersion': '7'}, 'data': {'homes.json': json.dumps({self.ws['id']: self.record})}}
        raise AssertionError((method, path))

    def test_running_workspace_is_refused_before_any_storage_job(self):
        self.ws['latest_build']['status'] = 'running'
        with self.assertRaises(ValueError):
            vmbackup.prepare(self.kube, self.ws)
        self.kube.assert_not_called()

    def test_foreign_rebound_or_busy_home_never_creates_storage_job(self):
        original = copy.deepcopy(self.record)
        for field, value in (('claim_uid', 'rebound'), ('organization_id', 'foreign'), ('status', 'resizing')):
            self.record = {**original, field: value}
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                vmbackup.prepare(self.kube, self.ws)
        self.assertTrue(all(call.args[0] == 'GET' for call in self.kube.call_args_list))

    def test_exact_registered_disk_uses_external_fixed_job_and_no_legacy_claim_mount(self):
        prepared = vmbackup.prepare(self.kube, self.ws)
        body = vmbackup.job_body(prepared, 'backup', 'http://service/__coder-ui/internal/volumes/' + 'a' * 43 + '/archive')
        spec = body['spec']['template']['spec']
        self.assertEqual(body['metadata']['namespace'], vmbackup.vmgrow.RUNTIME_NAMESPACE)
        self.assertEqual(spec['nodeSelector'], {'kubernetes.io/hostname': 'qualified-worker'})
        self.assertEqual(spec['containers'][0]['command'][:3], ['python3', '/app/vmbackup.py', 'backup'])
        self.assertFalse(any('persistentVolumeClaim' in volume for volume in spec['volumes']))
        self.assertEqual(prepared['request']['pvc_uid'], 'claim-uid')

    def test_corrupt_restore_is_rejected_before_disk_copy_or_mount(self):
        with tempfile.TemporaryDirectory() as folder:
            @contextlib.contextmanager
            def locked(*_args):
                yield {'directory': folder, 'device': '/dev/loop-test', 'record': {}}
            with mock.patch.object(vmhome, 'locked_home', side_effect=locked), \
                    mock.patch.object(vmhome, 'run') as execute, \
                    mock.patch.object(vmbackup, 'safety_copy') as backup, \
                    mock.patch.object(vmbackup.urllib.request, 'urlopen', return_value=io.BytesIO(b'invalid archive')):
                with self.assertRaises(ValueError):
                    vmbackup.worker(mock.Mock(), {'old_bytes': 1000000000}, 'restore',
                        'http://service/__coder-ui/internal/volumes/' + 'a' * 43 + '/restore')
                backup.assert_not_called()
                execute.assert_not_called()
            self.assertFalse(list(pathlib.Path(folder).iterdir()))

    def archive_file(self, directory, members):
        path = pathlib.Path(directory)/'archive.tar.gz'
        with tarfile.open(path, 'w:gz') as archive:
            for member, data in members:
                archive.addfile(member, io.BytesIO(data) if data is not None else None)
        return path

    def test_archive_rejects_devices_escaping_links_and_symlink_parent_traversal(self):
        normal=tarfile.TarInfo('./normal')
        normal.size=2
        for kind, target in ((tarfile.CHRTYPE,''),(tarfile.FIFOTYPE,''),(tarfile.LNKTYPE,'../../outside'),(tarfile.LNKTYPE,'/etc')):
            bad=tarfile.TarInfo('./bad')
            bad.type,bad.linkname=kind,target
            with tempfile.TemporaryDirectory() as directory:
                path=self.archive_file(directory,[(normal,b'ok'),(bad,None)])
                with self.assertRaises(ValueError):
                    vmbackup.check_archive(path,1000000)
        link=tarfile.TarInfo('./alias')
        link.type,link.linkname=tarfile.SYMTYPE,'inside'
        child=tarfile.TarInfo('./alias/file')
        child.size=2
        with tempfile.TemporaryDirectory() as directory:
            path=self.archive_file(directory,[(link,None),(child,b'ok')])
            with self.assertRaises(ValueError):
                vmbackup.check_archive(path,1000000)

    def test_oversized_pax_header_is_rejected_before_tarfile_extension_parser(self):
        header=tarfile.TarInfo('./metadata')
        header.type,header.size=tarfile.XHDTYPE,vmbackup.MAX_METADATA+1
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)/'bad.tar.gz'
            path.write_bytes(gzip.compress(header.tobuf()))
            with mock.patch.object(vmbackup.tarfile,'open') as parser:
                with self.assertRaises(ValueError):
                    vmbackup.check_archive(path,1000000)
                parser.assert_not_called()

    def test_cumulative_extension_metadata_is_bounded_before_tarfile_parsing(self):
        value='x'*300
        length=0
        while True:
            record=(str(length)+' comment='+value+'\n').encode()
            if len(record)==length:
                break
            length=len(record)
        header=tarfile.TarInfo('./pax')
        header.type,header.size=tarfile.XHDTYPE,len(record)
        payload=header.tobuf()+record+b'\0'*(-len(record)%512)
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)/'bad.tar.gz'
            path.write_bytes(gzip.compress(payload+payload+bytes(1024)))
            with mock.patch.object(vmbackup,'CONTROL_BUDGET',len(record)+1), mock.patch.object(vmbackup.tarfile,'open') as parser, self.assertRaises(ValueError):
                vmbackup.check_archive(path,1000000000000)
            parser.assert_not_called()


    def test_contents_and_trailing_gzip_data_have_explicit_capacity_budget(self):
        normal=tarfile.TarInfo('./normal')
        normal.size=4
        with tempfile.TemporaryDirectory() as directory:
            path=self.archive_file(directory,[(normal,b'data')])
            with self.assertRaises(ValueError):
                vmbackup.check_archive(path,3)
            path.write_bytes(gzip.compress(bytes(4096)))
            with mock.patch.object(vmbackup,'METADATA_BUDGET',1024), self.assertRaises(ValueError):
                vmbackup.check_archive(path,1024)

    def test_normal_files_and_internal_hardlinks_are_supported(self):
        normal=tarfile.TarInfo('./normal')
        normal.size=2
        link=tarfile.TarInfo('./another')
        link.type,link.linkname=tarfile.LNKTYPE,'./normal'
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(vmbackup.check_archive(self.archive_file(directory,[(normal,b'ok'),(link,None)]),1024),2)


    def test_absolute_symlink_metadata_is_preserved_but_write_through_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            base=pathlib.Path(directory)
            home=base/'home'
            home.mkdir()
            outside=base/'outside'
            outside.mkdir()
            (outside/'retained').write_text('safe')
            link=tarfile.TarInfo('./link')
            link.type,link.linkname=tarfile.SYMTYPE,str(outside)
            link.uid,link.gid=os.getuid(),os.getgid()
            normal=tarfile.TarInfo('./normal')
            normal.size,normal.uid,normal.gid=2,os.getuid(),os.getgid()
            path=self.archive_file(base,[(normal,b'ok'),(link,None)])
            self.assertEqual(vmbackup.check_archive(path,1024),2)
            guest = mock.Mock()
            guest.ls.return_value = []
            guest.pwrite.side_effect = lambda target, data, offset: len(data)
            vmfs.restore_files(guest,path)
            guest.ln_s.assert_called_once_with(str(outside), '/link')
            guest.pwrite.assert_called_once_with('/normal', b'ok', 0)
            self.assertEqual((outside/'retained').read_text(),'safe')
            child=tarfile.TarInfo('./link/retained')
            child.size=3
            path=self.archive_file(base,[(link,None),(child,b'bad')])
            with self.assertRaises(ValueError):
                vmbackup.check_archive(path,1024)
            self.assertEqual((outside/'retained').read_text(),'safe')

    def test_cumulative_path_budget_is_independent_of_home_capacity(self):
        normal=tarfile.TarInfo('./long-name')
        normal.size=2
        with tempfile.TemporaryDirectory() as directory:
            path=self.archive_file(directory,[(normal,b'ok')])
            with mock.patch.object(vmbackup,'CONTROL_BUDGET',3), self.assertRaises(ValueError):
                vmbackup.check_archive(path,1000000000)


    def test_invalid_restore_is_rejected_before_provenance_quarantine(self):
        with mock.patch.object(vmhome,'locked_home') as lock, mock.patch.object(vmbackup.urllib.request,'urlopen',return_value=io.BytesIO(b'invalid')):
            with self.assertRaises(ValueError):
                vmbackup.worker(mock.Mock(),{'old_bytes':1024},'restore','http://service/__coder-ui/internal/volumes/'+'a'*43+'/restore')
            lock.assert_not_called()

    def test_backup_never_mounts_or_checks_tenant_filesystem_on_host(self):
        with tempfile.TemporaryDirectory() as directory:
            @contextlib.contextmanager
            def locked(*_):
                yield {'directory':directory,'device':'/dev/loop-test','record':{}}
            with mock.patch.object(vmhome,'locked_home',side_effect=locked), mock.patch.object(vmhome,'run') as run, mock.patch.object(vmfs,'operate') as appliance, mock.patch.object(vmbackup,'check_archive'), mock.patch.object(vmbackup,'upload_archive'):
                vmbackup.worker(mock.Mock(),{'old_bytes':1024},'backup','http://service/__coder-ui/internal/volumes/'+'a'*43+'/archive')
                self.assertEqual(appliance.call_args.args, (pathlib.Path(directory)/'home.raw', 'backup'))
                run.assert_not_called()


    def test_create_timeout_conflict_recovers_only_the_exact_job_intent(self):
        prepared=vmbackup.prepare(self.kube,self.ws)
        body=vmbackup.job_body(prepared,'backup','http://service/__coder-ui/internal/volumes/'+'a'*43+'/archive')
        actual=copy.deepcopy(body)
        actual['metadata']['uid']='job-uid'
        calls=[]
        def kube(method,path,payload=None):
            calls.append(method)
            if method=='POST':
                return 201,{'kind':'Status','reason':'AlreadyExists'}
            if len(calls)==2:
                return 200,actual
            return 200,{'metadata':{'uid':'job-uid'},'status':{'succeeded':1}}
        with mock.patch.object(vmbackup,'job_body',return_value=body):
            vmbackup.run(kube,prepared,'backup','private-transfer-url')
        self.assertEqual(calls,['POST','GET','GET'])
        actual['spec']['template']['spec']['containers'][0]['command']=['wrong-command']
        calls.clear()
        with mock.patch.object(vmbackup,'job_body',return_value=body), self.assertRaises(RuntimeError):
            vmbackup.run(kube,prepared,'backup','private-transfer-url')
        self.assertEqual(calls,['POST','GET'])


    def test_archive_receipt_does_not_complete_vm_operation_before_job_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            store=mock.Mock()
            handler=mock.Mock(headers={'Content-Length':'2'},rfile=io.BytesIO(b'ok'))
            operation={'id':1,'workspace_id':self.ws['id'],'target':'download','mode':'vm-block'}
            with mock.patch.object(workspacevolumes,'STORE',store), mock.patch.object(workspacevolumes.ib,'FILES',directory):
                workspacevolumes.receive_archive(handler,operation)
            final=store.update.call_args.kwargs
            self.assertEqual(final['status'],'running')
            self.assertIsNone(final['finished_at'])
            self.assertFalse(workspacevolumes.public({**operation,**final})['downloadable'])
        store=mock.Mock()
        store.op.return_value={'status':'running','path':'retained.tar.gz','target':'download'}
        def job(*_):
            self.assertFalse(any(c.kwargs.get('status')=='done' for c in store.update.call_args_list))
        with mock.patch.object(workspacevolumes,'STORE',store),mock.patch.object(vmbackup,'run',side_effect=job):
            workspacevolumes.run_backup(self.ws,1,'token',{'request':{},'node':'node'})
        self.assertEqual(store.update.call_args.kwargs['status'],'done')


    def test_vm_stop_waits_for_instance_and_terminating_home_consumer(self):
        ws = {**self.ws, 'latest_build': {'id': 'stop-build', 'status': 'stopped'}}
        current = copy.deepcopy(self.current)
        current['vm']['metadata'] = {'name': 'owned-vm', 'uid': 'owned-uid'}
        turns = [0]
        def refresh():
            turns[0] += 1
            return ws
        def kube(method, path):
            if '/virtualmachines/' in path:
                return 200, current['vm']
            if '/virtualmachineinstances/' in path:
                return (200, {}) if turns[0] == 1 else (404, {})
            pod = {'metadata': {'deletionTimestamp': 'terminating'}, 'status': {'phase': 'Succeeded'},
                   'spec': {'volumes': [{'persistentVolumeClaim': {'claimName': 'home'}}]}}
            return 200, {'items': [pod] if turns[0] == 2 else []}
        with mock.patch.object(vmbackup.threading, 'Event') as event:
            self.assertEqual(vmbackup.wait_stopped(kube, ws, refresh, current=current), ws)
        self.assertEqual(turns[0], 3)
        self.assertEqual(event.return_value.wait.call_count, 2)

    def test_vm_stop_wait_aborts_concurrent_build_change_and_deadline(self):
        ws = {**self.ws, 'latest_build': {'id': 'stop-build', 'status': 'stopped'}}
        current = copy.deepcopy(self.current)
        current['vm']['metadata'] = {'name': 'owned-vm', 'uid': 'owned-uid'}
        def kube(method, path):
            if '/virtualmachines/' in path:
                return 200, current['vm']
            if '/virtualmachineinstances/' in path:
                return 200, {}
            return 200, {'items': []}
        refresh = mock.Mock(side_effect=[ws, {**ws, 'latest_build': {'id': 'new-start', 'status': 'running'}}])
        with mock.patch.object(vmbackup.threading, 'Event'), self.assertRaisesRegex(RuntimeError, 'build changed'):
            vmbackup.wait_stopped(kube, ws, refresh, current=current)
        with mock.patch.object(vmbackup.time, 'monotonic', side_effect=[0, 1]), self.assertRaisesRegex(RuntimeError, 'deadline'):
            vmbackup.wait_stopped(kube, ws, lambda: ws, current=current, timeout=1)

    def test_vm_stop_wait_rejects_resource_replacement_or_lookup_failure(self):
        ws = {**self.ws, 'latest_build': {'id': 'stop-build', 'status': 'stopped'}}
        current = copy.deepcopy(self.current)
        current['vm']['metadata'] = {'name': 'owned-vm', 'uid': 'owned-uid'}
        for status, value in ((503, {}), (200, {'metadata': {'uid': 'foreign'}, 'spec': {'runStrategy': 'Halted'}})):
            with self.subTest(status=status), self.assertRaisesRegex(RuntimeError, 'VM changed'):
                vmbackup.wait_stopped(lambda *_: (status, value), ws, lambda: ws, current=current)

    def test_vm_backup_never_falls_through_to_legacy_directory_job(self):
        store = mock.Mock()
        store.op.return_value = {'status': 'done'}
        with mock.patch.object(workspacevolumes, 'STORE', store), \
                mock.patch.object(vmbackup, 'run') as run, \
                mock.patch.object(workspacevolumes, 'run_job') as legacy:
            workspacevolumes.run_backup(self.ws, 1, 'private-one-use-token', {'request': {}, 'node': 'node'})
        run.assert_called_once()
        legacy.assert_not_called()


if __name__ == '__main__':
    unittest.main()
