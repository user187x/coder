"""Hostile HOME bytes may only reach a credential-free appliance boundary."""
import io
import os
import pathlib
import sys
import tarfile
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped/files/ui-updates'))
import vmfs


class FilesystemTest(unittest.TestCase):
    def test_missing_appliance_fails_before_work_copy_or_process(self):
        with tempfile.TemporaryDirectory() as directory:
            raw = pathlib.Path(directory) / 'home.raw'
            raw.write_bytes(b'a' * 512)
            raw.chmod(0o600)
            real = vmfs.regular
            def root_owned(path, size=None):
                fd, info = real(path, size)
                fields = list(info)
                fields[4] = 0
                return fd, os.stat_result(fields)
            with mock.patch.object(vmfs, 'regular', side_effect=root_owned), mock.patch.object(vmfs, 'ROOTFS', pathlib.Path(directory)/'missing'), mock.patch.object(vmfs, 'copy_file') as copy, mock.patch.object(vmfs.subprocess, 'Popen') as launch:
                with self.assertRaisesRegex(RuntimeError, 'unavailable'):
                    vmfs.operate(raw, 'grow', size=1024)
                copy.assert_not_called()
                launch.assert_not_called()
                self.assertEqual(raw.read_bytes(), b'a' * 512)

    def test_oversized_appliance_is_rejected_before_process_or_disk_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            for name in ('usr/bin/python3','app/vmfs.py','opt/coder-vmfs/appliance/kernel','opt/coder-vmfs/appliance/initrd','opt/coder-vmfs/appliance/root'):
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'fixed')
            for name,maximum in (('root',vmfs.MAX_APPLIANCE_ROOT),('initrd',vmfs.MAX_BOOT_BYTES)):
                with self.subTest(file=name):
                    for previous in ('root','initrd'):
                        (root/'opt/coder-vmfs/appliance'/previous).write_bytes(b'fixed')
                    with (root/'opt/coder-vmfs/appliance'/name).open('r+b') as disk:
                        disk.truncate(maximum+1)
                    with mock.patch.object(vmfs,'ROOTFS',root),self.assertRaisesRegex(RuntimeError,'scratch policy'):
                        vmfs.available()


    def test_failed_isolated_child_never_commits_original_disk(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            raw = root / 'home.raw'
            raw.write_bytes(b'a' * 512)
            raw.chmod(0o600)
            for name in ('usr/bin/python3','app/vmfs.py','opt/coder-vmfs/appliance/kernel','opt/coder-vmfs/appliance/initrd','opt/coder-vmfs/appliance/root'):
                path = root/'rootfs'/name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'fixed')
            real = vmfs.regular
            def root_owned(path, size=None):
                fd, info = real(path, size)
                fields = list(info)
                fields[4] = 0
                return fd, os.stat_result(fields)
            process = mock.Mock()
            process.wait.return_value = 1
            process.poll.return_value = 1
            with mock.patch.object(vmfs,'ROOTFS',root/'rootfs'), mock.patch.object(vmfs,'regular',side_effect=root_owned), mock.patch.object(vmfs.os,'chown'), mock.patch.object(vmfs,'processes',return_value=[]), mock.patch.object(vmfs,'stop_children') as teardown, mock.patch.object(vmfs.subprocess,'Popen',return_value=process) as launch:
                with self.assertRaisesRegex(RuntimeError,'isolated filesystem operation failed'):
                    vmfs.operate(raw,'grow',size=1024)
                self.assertEqual(raw.read_bytes(), b'a'*512)
                teardown.assert_called_once()
                command=launch.call_args.args[0]
                for namespace in ('--mount','--net','--pid','--ipc','--uts','--kill-child=KILL'):
                    self.assertIn(namespace,command)
                self.assertEqual(launch.call_args.kwargs['env'],{'PATH':'/usr/sbin:/usr/bin:/sbin:/bin'})
                self.assertTrue(launch.call_args.kwargs['close_fds'])

    def test_successful_grow_commits_only_after_children_are_gone(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            raw = root / 'home.raw'; raw.write_bytes(b'a'*512); raw.chmod(0o600)
            inode = raw.stat().st_ino
            for name in ('usr/bin/python3','app/vmfs.py','opt/coder-vmfs/appliance/kernel','opt/coder-vmfs/appliance/initrd','opt/coder-vmfs/appliance/root'):
                path=root/'rootfs'/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'fixed')
            identity={}
            real=vmfs.regular
            def root_owned(path,size=None):
                fd,info=real(path,size);fields=list(info)
                fields[4]=0 if pathlib.Path(path)==raw else identity['uid']
                return fd,os.stat_result(fields)
            def launch(command,**kwargs):
                identity['uid']=int(command[-1])
                work=pathlib.Path(command[command.index('--supervise')+2])
                process=mock.Mock();process.poll.return_value=0
                def finish(timeout):
                    (work/'home.raw').write_bytes(b'b'*1024)
                    return 0
                process.wait.side_effect=finish
                return process
            def teardown(uid):
                self.assertEqual(uid,identity['uid'])
                self.assertEqual(raw.read_bytes(),b'a'*512)
            with mock.patch.object(vmfs,'ROOTFS',root/'rootfs'),mock.patch.object(vmfs,'regular',side_effect=root_owned),mock.patch.object(vmfs.os,'chown'),mock.patch.object(vmfs,'processes',return_value=[]),mock.patch.object(vmfs,'stop_children',side_effect=teardown) as stopped,mock.patch.object(vmfs.subprocess,'Popen',side_effect=launch):
                vmfs.operate(raw,'grow',size=1024)
                stopped.assert_called_once()
            self.assertEqual(raw.read_bytes(),b'b'*1024)
            self.assertEqual(raw.stat().st_ino,inode)

    def test_restore_sends_absolute_symlinks_last_without_write_through(self):
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)/'archive.tar.gz'
            with tarfile.open(path,'w:gz') as archive:
                item=tarfile.TarInfo('normal');item.size=2;item.uid=1000;item.gid=1000;item.mtime=-0.5
                archive.addfile(item,io.BytesIO(b'ok'))
                link=tarfile.TarInfo('cloud');link.type=tarfile.SYMTYPE;link.linkname='/mnt/cloud-drive'
                archive.addfile(link)
            guest=mock.Mock()
            guest.ls.return_value=['old']
            guest.pwrite.side_effect=lambda path,data,offset:len(data)
            vmfs.restore_files(guest,path)
            guest.pwrite.assert_called_once_with('/normal',b'ok',0)
            guest.ln_s.assert_called_once_with('/mnt/cloud-drive','/cloud')
            operations=[call[0] for call in guest.mock_calls]
            self.assertLess(operations.index('pwrite'),operations.index('ln_s'))
            guest.lchown.assert_any_call(1000,1000,'/normal')
            guest.utimens.assert_any_call('/normal',-1,500000000,-1,500000000)

    def test_supervisor_drops_all_authority_inside_credential_free_root(self):
        libc=mock.Mock();libc.prctl.return_value=0;libc.capset.return_value=0
        with mock.patch.object(vmfs,'run') as run,mock.patch.object(vmfs.os,'mknod'),mock.patch.object(vmfs.os,'chmod') as permissions,mock.patch.object(vmfs.os,'chroot') as chroot,mock.patch.object(vmfs.os,'chdir'),mock.patch.object(vmfs.resource,'setrlimit'),mock.patch.object(vmfs.ctypes,'CDLL',return_value=libc),mock.patch.object(vmfs.os,'setgroups') as groups,mock.patch.object(vmfs.os,'setgid') as gid,mock.patch.object(vmfs.os,'setuid') as uid,mock.patch.object(vmfs.os,'execve') as execute:
            vmfs.supervise('/jail','/private/work','grow','1024','100000001')
            chroot.assert_called_once_with(pathlib.Path('/jail'))
            self.assertEqual(permissions.call_args_list, [mock.call(pathlib.Path('/jail/dev')/name,0o666) for name in ('null','zero','random','urandom')])
            groups.assert_called_once_with([]);gid.assert_called_once_with(100000001);uid.assert_called_once_with(100000001)
            libc.capset.assert_called_once()
            libc.prctl.assert_any_call(38,1,0,0,0)
            run.assert_any_call('mount','-o','remount,bind,ro','/jail')
            run.assert_any_call('mount','--bind','/private/work','/jail/work')
            environment=execute.call_args.args[2]
            self.assertEqual(environment['LIBGUESTFS_BACKEND_SETTINGS'],'force_tcg')
            self.assertEqual(environment['LIBGUESTFS_PATH'],vmfs.APPLIANCE)
            self.assertNotIn('KUBERNETES_SERVICE_HOST',environment)

    def test_appliance_uses_installed_fsck_signature_and_private_work_copy(self):
        def e2fsck(device, correct=None, forceall=None):
            pass
        for action in ('grow', 'backup'):
            with self.subTest(action=action):
                guest=mock.Mock()
                guest.e2fsck=mock.create_autospec(e2fsck)
                guest.blockdev_getsize64.return_value=512
                binding=mock.Mock();binding.GuestFS.return_value=guest
                with mock.patch.dict(sys.modules,{'guestfs':binding}),mock.patch.object(vmfs.os,'getuid',return_value=100000001):
                    vmfs.appliance(action,512)
                guest.set_network.assert_called_once_with(False)
                guest.add_drive_opts.assert_called_once_with('/work/home.raw',format='raw',readonly=False)
                guest.e2fsck.assert_any_call('/dev/sda',correct=True)
                self.assertFalse(guest.e2fsck_f.called)
                self.assertFalse(guest.command.called)
                if action == 'grow':
                    guest.resize2fs.assert_called_once_with('/dev/sda')
                else:
                    guest.mount_vfs.assert_called_once_with('ro,noload,nodev,nosuid,noexec','ext4','/dev/sda','/')
                    guest.tar_out.assert_called_once_with('/','/work/archive.tar.gz',compress='gzip',numericowner=True)
                guest.close.assert_called_once()



if __name__ == '__main__':
    unittest.main()
