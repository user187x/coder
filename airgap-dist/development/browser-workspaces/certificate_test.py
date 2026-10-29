"""Exercise encrypted PKCS#12 import with an isolated NSS database."""
import importlib.util
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest


@unittest.skipUnless(shutil.which('pk12util') and shutil.which('certutil'), 'NSS tools required')
class CertificateTest(unittest.TestCase):
    def test_encrypted_certificate_requires_password_and_imports_private_key(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            os.environ.update(HOME=directory, WORKSPACE_OWNER='test-user', VNC_PW='test-only-password')
            spec = importlib.util.spec_from_file_location('browser', pathlib.Path(__file__).with_name('kasm-browser.py'))
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-keyout', str(root / 'key.pem'), '-out', str(root / 'cert.pem'), '-days', '1', '-nodes', '-subj', '/CN=Workspace Test'], check=True, capture_output=True)
            subprocess.run(['openssl', 'pkcs12', '-export', '-in', str(root / 'cert.pem'), '-inkey', str(root / 'key.pem'), '-out', str(root / 'test.p12'), '-passout', 'pass:test-password'], check=True, capture_output=True)
            with self.assertRaises(ValueError):
                module.import_certificate(root / 'test.p12', 'wrong')
            self.assertIsNone(module.INSTALLED_DIGEST)
            module.import_certificate(root / 'test.p12', 'test-password')
            keys = subprocess.run(['certutil', '-K', '-d', 'sql:' + str(module.DB)], check=True, capture_output=True, text=True)
            self.assertIn('rsa', keys.stdout)
            self.assertIsNotNone(module.INSTALLED_DIGEST)
            self.assertFalse((root / 'password').exists())


if __name__ == '__main__':
    unittest.main()
