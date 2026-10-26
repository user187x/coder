"""Bounded trusted host process observation and identity fences."""
from datetime import datetime, timezone
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped/files/ui-updates'))
import vmquarantineobserver as observer

WID = '6d850b68-7d82-48ce-9ab1-721b79042f2a'
NODE = '106f0caf-4151-48a6-9c6d-21a326cb60c2'
BOOT = '58b1008c-994d-4d70-aa62-75aad45fe375'
POD = '0e4f6f1c-6c52-45e3-b7eb-bcb601325ecb'
FIRMWARE = 'aae428af-2311-4c1f-8ead-8ecf2bb29222'
REV = '339490de-9d8c-48b4-a51b-6af3ba0e46ec'
VM = 'cc81342f-bc15-45f6-969f-d088f12987c8'


class ObserverTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.proc = pathlib.Path(self.temp.name)
        self.process(1, 'systemd', '0::/init.scope\n')
        self.target = {WID: {'revision': REV, 'vm_uid': VM, 'node_name': 'worker', 'node_uid': NODE,
                             'launcher_pod_uids': [POD], 'firmware_uuid': FIRMWARE}}

    def process(self, pid, comm, cgroup, args=None):
        root = self.proc / str(pid)
        root.mkdir()
        (root / 'comm').write_text(comm + '\n')
        (root / 'cgroup').write_text(cgroup)
        (root / 'cmdline').write_bytes(b'\0'.join(arg.encode() for arg in (args or [])) + b'\0')

    def proof(self, **kwargs):
        return observer.observation(self.target, NODE, BOOT, BOOT, 'coder', str(self.proc), **kwargs)['targets'][WID]

    def test_exact_live_qemu_or_launcher_or_firmware_each_prevents_verified_absence(self):
        cases = (
            ('qemu-kvm', '0::/unrelated\n', ['qemu', '-name', 'guest=coder_coder-vm-' + WID + ',debug-threads=on', '-uuid', FIRMWARE]),
            ('pause', '0::/kubepods.slice/kubepods-pod' + POD.replace('-', '_') + '.slice/cri-containerd-ab.scope\n', []),
            ('qemu-kvm', '0::/unrelated\n', ['qemu', '-name', 'guest=coder_coder-vm-' + VM, '-uuid', FIRMWARE]),
        )
        for index, (comm, cgroup, args) in enumerate(cases):
            with self.subTest(index=index):
                self.process(100 + index, comm, cgroup, args)
                self.assertFalse(self.proof()['verified'])
                for child in (self.proc / str(100 + index)).iterdir():
                    child.unlink()
                (self.proc / str(100 + index)).rmdir()

    def test_absence_echoes_only_target_identity_and_timestamp(self):
        now = datetime(2026, 10, 24, tzinfo=timezone.utc)
        value = observer.observation(self.target, NODE, BOOT, BOOT, 'coder', str(self.proc), now)
        self.assertEqual(value['collected_at'], now.isoformat())
        self.assertEqual(value['node_uid'], NODE)
        self.assertEqual(value['boot_id'], BOOT)
        self.assertEqual(value['targets'][WID], {'revision': REV, 'vm_uid': VM, 'launcher_pod_uids': [POD],
                                               'firmware_uuid': FIRMWARE, 'qemu_absent': True,
                                               'cgroups_absent': True, 'verified': True})
        self.assertNotIn('cmdline', json.dumps(value))

    def test_virtqemud_is_not_guest_qemu_but_its_launcher_cgroup_still_counts(self):
        self.process(124, 'virtqemud', '0::/unrelated\n', ['virtqemud'])
        self.assertTrue(self.proof()['verified'])
        (self.proc / '124/cgroup').write_text('0::/kubepods/pod' + POD + '/daemon\n')
        self.assertFalse(self.proof()['verified'])

    def test_unknown_qemu_or_unreadable_live_process_never_proves_absence(self):
        self.process(123, 'qemu-kvm', '0::/unknown\n', ['qemu', '-name', 'libguestfs'])
        self.assertFalse(self.proof()['verified'])
        (self.proc / '123/comm').unlink()
        self.assertFalse(self.proof()['verified'])

    def test_hidden_pid_tree_and_scan_overflow_fail_closed(self):
        (self.proc / '1/comm').unlink()
        self.assertFalse(self.proof()['verified'])
        (self.proc / '1/comm').write_text('systemd\n')
        with patch.object(observer, 'MAX_PROCESSES', 0):
            self.assertFalse(self.proof()['verified'])
        with patch.object(observer, 'MAX_SCAN_SECONDS', -1):
            self.assertFalse(self.proof()['verified'])

    def test_node_uid_and_boot_mismatch_do_not_prove_absence(self):
        self.target[WID]['node_uid'] = VM
        self.assertFalse(self.proof()['verified'])
        self.target[WID]['node_uid'] = NODE
        value = observer.observation(self.target, NODE, BOOT, VM, 'coder', str(self.proc))
        self.assertFalse(value['targets'][WID]['verified'])

    def test_strict_bounded_targets_and_no_cross_node_proof(self):
        self.assertEqual(observer.targets(json.dumps(self.target).encode(), 'other-node'), {})
        self.assertEqual(observer.targets(json.dumps(self.target).encode(), 'worker'), self.target)
        invalid = [b'{"duplicate":1,"duplicate":2}', b'[]', b'x' * (observer.MAX_TARGET_BYTES + 1)]
        for raw in invalid:
            with self.subTest(raw=raw[:20]), self.assertRaises(ValueError):
                observer.targets(raw, 'worker')
        self.target[WID]['launcher_pod_uids'] = ['../../proc/1']
        with self.assertRaises(ValueError):
            observer.targets(json.dumps(self.target).encode(), 'worker')

    def test_exact_qemu_identity_requires_bounded_canonical_uuid(self):
        with self.assertRaises(ValueError):
            observer.qemu_identity(b'qemu\0-name\0guest=coder_coder-vm-' + WID.encode() + b'\0-uuid\0secret-invalid\0', 'coder')
        with patch.object(observer, 'MAX_PROOF_BYTES', 1), self.assertRaises(ValueError):
            self.proof()
