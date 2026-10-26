"""The boot binder uses only a fixed root-private self-Node TLS identity."""
import json
import os
import pathlib
import stat
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[3]/'helm-chart/coder-airgapped/files/ui-updates'))
import vmhome


class NodeIdentityTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root=pathlib.Path(self.temp.name)
        self.config=root/'node-identity.json'
        self.ca=root/'node-api-ca.crt'
        pki=root/'pki';pki.mkdir()
        self.pem=pki/'kubelet-client-2026-10-24.pem'
        self.current=pki/'kubelet-client-current.pem'
        self.pem.write_text('fixture-private-key');self.pem.chmod(0o600)
        self.current.symlink_to(self.pem.name)
        self.ca.write_text('fixture-public-ca');self.ca.chmod(0o644)
        self.write_config('https://api.example:6443')
        self.context=mock.Mock()
        self.opener=mock.MagicMock()
        self.patches=[mock.patch.object(vmhome,'NODE_IDENTITY',self.config),mock.patch.object(vmhome,'NODE_CA',self.ca),mock.patch.object(vmhome,'NODE_CERTIFICATE',self.current),mock.patch.object(vmhome.ssl,'create_default_context',return_value=self.context),mock.patch.object(vmhome.urllib.request,'build_opener',return_value=self.opener)]
        original=pathlib.Path.lstat
        def root_owned(path):
            values=list(original(path));values[4]=0
            return os.stat_result(values)
        self.patches.append(mock.patch.object(pathlib.Path,'lstat',root_owned))
        for patch in self.patches:patch.start();self.addCleanup(patch.stop)

    def write_config(self,server):
        self.config.write_text(json.dumps({'server':server,'node_name':'worker'}));self.config.chmod(0o600)

    def test_fixed_ca_and_rotated_kubelet_key_only_read_this_node(self):
        client=vmhome.WorkerIdentityClient()
        vmhome.ssl.create_default_context.assert_called_once_with(cafile=str(self.ca))
        self.context.load_cert_chain.assert_called_once_with(str(self.pem))
        response=mock.Mock(status=200)
        response.read.return_value=b'{"metadata":{"uid":"00000000-0000-4000-8000-000000000004"}}'
        self.opener.open.return_value.__enter__.return_value=response
        self.assertEqual(client.call('GET','/api/v1/nodes/worker')[0],200)
        self.opener.open.assert_called_once_with('https://api.example:6443/api/v1/nodes/worker',timeout=5)
        for method,path in (('GET','/api/v1/nodes/other'),('POST','/api/v1/nodes/worker')):
            with self.subTest(method=method,path=path),self.assertRaises(vmhome.HomeError):client.call(method,path)
        self.assertEqual(self.opener.open.call_count,1)

    def test_api_origin_has_no_insecure_scheme_credentials_path_query_fragment_or_invalid_port(self):
        for origin in ('http://api','https://user:password@api','https://api/path','https://api/','https://api?','https://api#','https://api?next=x','https://api#x','https://api:0','https://api:65536'):
            self.write_config(origin)
            with self.subTest(origin=origin),self.assertRaises((ValueError,vmhome.HomeError)):vmhome.WorkerIdentityClient()
        self.context.load_cert_chain.assert_not_called()

    def test_key_cannot_be_world_readable_or_redirected_outside_kubelet_pki(self):
        self.pem.chmod(0o644)
        with self.assertRaises(vmhome.HomeError):vmhome.WorkerIdentityClient()
        self.pem.chmod(0o600)
        self.current.unlink();self.current.symlink_to(self.ca)
        with self.assertRaises(vmhome.HomeError):vmhome.WorkerIdentityClient()
        self.context.load_cert_chain.assert_not_called()

    def test_private_config_or_wrong_owner_never_reaches_tls(self):
        self.config.chmod(0o644)
        with self.assertRaises(vmhome.HomeError):vmhome.WorkerIdentityClient()
        with mock.patch.object(pathlib.Path,'lstat',return_value=SimpleNamespace(st_uid=1,st_mode=stat.S_IFREG|0o600)),self.assertRaises(vmhome.HomeError):vmhome.trusted_host_file(self.config,private=True)
        self.context.load_cert_chain.assert_not_called()

    def test_oversized_node_response_and_redirects_are_not_accepted(self):
        client=vmhome.WorkerIdentityClient()
        self.opener.open.return_value.__enter__.return_value.read.return_value=b'x'*2097153
        with self.assertRaises(vmhome.HomeError):client.call('GET','/api/v1/nodes/worker')
        self.assertIsNone(vmhome.NoRedirect().redirect_request(None,None,302,'redirect',{},'https://other'))

    def test_boot_network_failure_retries_then_reads_identity(self):
        client=vmhome.WorkerIdentityClient()
        response=mock.Mock(status=200)
        response.read.return_value=b'{"metadata":{"uid":"00000000-0000-4000-8000-000000000004"}}'
        ready=mock.MagicMock()
        ready.__enter__.return_value=response
        self.opener.open.side_effect=[vmhome.urllib.error.URLError(ConnectionRefusedError()),ready]
        with mock.patch.object(vmhome.time,'sleep') as wait:
            self.assertEqual(client.call('GET','/api/v1/nodes/worker')[0],200)
        wait.assert_called_once_with(2)
        self.assertEqual(self.opener.open.call_count,2)

    def test_transport_retry_is_bounded_and_permanent_failures_do_not_retry(self):
        client=vmhome.WorkerIdentityClient()
        unavailable=vmhome.urllib.error.URLError(ConnectionRefusedError())
        self.opener.open.side_effect=unavailable
        with mock.patch.object(vmhome.time,'sleep') as wait,self.assertRaises(vmhome.urllib.error.URLError):
            client.call('GET','/api/v1/nodes/worker')
        self.assertEqual(self.opener.open.call_count,6)
        self.assertEqual(wait.call_count,5)
        for error in (vmhome.urllib.error.URLError(vmhome.ssl.SSLCertVerificationError()),
                      vmhome.urllib.error.HTTPError(client.url,403,'Forbidden',{},None),
                      vmhome.urllib.error.HTTPError(client.url,302,'Redirect',{},None)):
            if isinstance(error,vmhome.urllib.error.HTTPError):
                self.addCleanup(error.close)
            self.opener.open.reset_mock()
            self.opener.open.side_effect=error
            with self.subTest(error=error),mock.patch.object(vmhome.time,'sleep') as wait,self.assertRaises(type(error)):
                client.call('GET','/api/v1/nodes/worker')
            self.opener.open.assert_called_once()
            wait.assert_not_called()

    def test_temporarily_unavailable_api_retries_without_accepting_its_body(self):
        client=vmhome.WorkerIdentityClient()
        error=vmhome.urllib.error.HTTPError(client.url,503,'Unavailable',{},None)
        self.addCleanup(error.close)
        ready=mock.MagicMock()
        ready.__enter__.return_value.status=200
        ready.__enter__.return_value.read.return_value=b'{"metadata":{"uid":"00000000-0000-4000-8000-000000000004"}}'
        self.opener.open.side_effect=[error,ready]
        with mock.patch.object(vmhome.time,'sleep') as wait:
            self.assertEqual(client.call('GET','/api/v1/nodes/worker')[0],200)
        wait.assert_called_once_with(2)
