"""Reboot binding cannot enroll legacy HOME or trust a reused Node hostname."""
import contextlib
import importlib.util
import io
import json
import os
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[3]/'helm-chart/coder-airgapped/files/ui-updates'))
import vmhome

WID='00000000-0000-4000-8000-000000000001'
NODE='00000000-0000-4000-8000-000000000004'
OTHER='00000000-0000-4000-8000-000000000005'


class DevicesTest(unittest.TestCase):
    def setUp(self):
        source=pathlib.Path(__file__).resolve().parents[1]/'runtime/vmhome-devices.py'
        spec=importlib.util.spec_from_file_location('vmhome_devices_test_module',source)
        self.binder=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.binder)
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.parent=pathlib.Path(self.temp.name)
        self.directory=self.parent/WID
        self.directory.mkdir(mode=0o700)
        self.record={'workspace_id':WID,'node_name':'worker','node_uid':NODE,'home_bytes':1000000000,'status':'ready'}
        self.manifest=self.directory/'manifest.json'
        self.write_manifest()
        self.uid=NODE
        self.node_client=mock.Mock()
        self.node_client.call.side_effect=lambda *args:(200,{'metadata':{'uid':self.uid},'status':{'conditions':[{'type':'Ready','status':'False'}]}})
        self.patches=[mock.patch.object(self.binder,'PARENT',self.parent),mock.patch.object(self.binder.os,'geteuid',return_value=0),mock.patch.object(self.binder,'device_for'),mock.patch.object(self.binder,'WorkerIdentityClient',return_value=self.node_client)]
        original=pathlib.Path.lstat
        def root_owned(path):
            values=list(original(path));values[4]=0
            return os.stat_result(values)
        self.patches.append(mock.patch.object(pathlib.Path,'lstat',root_owned))
        for patch in self.patches: patch.start();self.addCleanup(patch.stop)

    def write_manifest(self):
        self.manifest.write_text(json.dumps(self.record))
        self.manifest.chmod(0o600)

    def test_original_node_uid_is_checked_even_before_kubelet_becomes_ready(self):
        self.binder.main()
        self.node_client.call.assert_called_once_with('GET','/api/v1/nodes/worker',None,'application/json')
        self.binder.device_for.assert_called_once_with(self.directory,1000000000)

    def test_missing_uid_or_replacement_hostname_never_publishes_or_rewrites_manifest(self):
        for missing in (False,True):
            if missing: self.record.pop('node_uid')
            else: self.uid=OTHER
            self.write_manifest()
            before=self.manifest.read_bytes()
            with self.subTest(missing=missing),contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit) as error:
                self.binder.main()
            self.assertEqual(error.exception.code,1)
            self.binder.device_for.assert_not_called()
            self.assertEqual(self.manifest.read_bytes(),before)

    def test_no_managed_home_can_bootstrap_without_reading_identity_or_publishing(self):
        self.manifest.unlink();self.directory.rmdir()
        self.binder.main()
        self.binder.WorkerIdentityClient.assert_not_called()
        self.binder.device_for.assert_not_called()

    def test_unavailable_identity_does_not_fall_back_to_hostname(self):
        self.binder.WorkerIdentityClient.side_effect=vmhome.HomeError('Identity unavailable')
        with contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):self.binder.main()
        self.binder.device_for.assert_not_called()
