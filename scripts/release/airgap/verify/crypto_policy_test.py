"""Crypto policy must be active, repeatable, and preserve existing provider setup."""
import json
import pathlib
import sys
import tempfile
import unittest

SOURCE = pathlib.Path(__file__).resolve().parents[3] / 'helm-chart/coder-airgapped/files/ui-updates'
sys.path.insert(0, str(SOURCE))
import cryptopolicy
import imagebuilder


class CryptoPolicyTest(unittest.TestCase):
    def setUp(self):
        self.rules = json.loads((SOURCE / 'fips-rules.json').read_text())

    def test_tls_requires_initialization_chain_not_an_orphan_setting(self):
        self.assertIsNone(cryptopolicy.tls_minimum('[unused]\nMinProtocol = TLSv1.2\n'))
        text = cryptopolicy.tls_config('openssl_conf = openssl_init\n[openssl_init]\nproviders = existing\n', 'TLSv1.2')
        self.assertEqual(cryptopolicy.tls_minimum(text), 'TLSv1.2')
        self.assertIn('providers = existing', text)
        self.assertEqual(cryptopolicy.tls_config(text, 'TLSv1.2'), text)

    def test_ssh_include_precedes_vendor_and_host_defaults(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / 'etc/ssh').mkdir(parents=True)
            config = root / 'etc/ssh/ssh_config'
            config.write_text('Host *\n    Ciphers chacha20-poly1305@openssh.com\n')
            cryptopolicy.apply(root, self.rules)
            original = config.read_text()
            self.assertTrue(original.startswith('Include /etc/ssh/ssh_config.d/00-coder-crypto.conf\n'))
            self.assertIn('Ciphers aes256-gcm@openssh.com', (root / 'etc/ssh/ssh_config.d/00-coder-crypto.conf').read_text())
            cryptopolicy.apply(root, self.rules)
            self.assertEqual(config.read_text(), original)
            self.assertEqual(cryptopolicy.tls_minimum((root / 'etc/ssl/openssl.cnf').read_text()), 'TLSv1.2')
            self.assertFalse((root / 'etc/ssl/fipsmodule.cnf').exists())

    def test_provider_path_matches_real_module_and_report_keeps_vendor_requirement(self):
        files = {'usr/lib/x86_64-linux-gnu/ossl-modules/fips.so': (0o644, 1, 'f')}
        report = imagebuilder.fips_checks(files, {}, ['openssl-fips-module-3', 'libgnutls30t64'], self.rules)
        checks = {item['id']: item for item in report['checks']}
        self.assertEqual(checks['module']['status'], 'pass')
        self.assertEqual(checks['openssl-default']['status'], 'fail')
        self.assertEqual(checks['other-libs']['status'], 'warn')
        self.assertIn('vendor-validated', checks['other-libs']['detail'])

    def test_invalid_fips_module_fails_before_global_configuration_changes(self):
        from unittest.mock import patch
        import subprocess
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / 'etc/ssl').mkdir(parents=True)
            config = root / 'etc/ssl/openssl.cnf'
            config.write_text('openssl_conf = existing\n[existing]\n')
            module = root / 'usr/lib/x86_64-linux-gnu/ossl-modules/fips.so'
            module.parent.mkdir(parents=True)
            module.write_text('invalid module')
            with patch.object(cryptopolicy.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'openssl')):
                with self.assertRaises(subprocess.CalledProcessError):
                    cryptopolicy.apply(root, self.rules, provider=True)
            self.assertEqual(config.read_text(), 'openssl_conf = existing\n[existing]\n')

    def test_builder_runs_shared_policy_and_propagates_provider_failure(self):
        from unittest.mock import patch
        with patch.object(imagebuilder.securitydata, 'rules', return_value=self.rules):
            script = '\n'.join(imagebuilder.fips_script())
        self.assertIn('provider=True', script)
        self.assertNotIn('|| true', script)
        self.assertIn('verify_runtime()', script)
        self.assertEqual(len(script.splitlines()), 2)


if __name__ == '__main__':
    unittest.main()
