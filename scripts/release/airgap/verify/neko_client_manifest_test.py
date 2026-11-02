"""The trusted browser artifact must be bounded, complete and path-safe."""
import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest

MODULE = pathlib.Path(__file__).resolve().parents[1] / 'neko/manifest.py'
spec = importlib.util.spec_from_file_location('neko_client_manifest', MODULE)
manifest = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manifest)


class ClientManifestTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        (self.root / 'index.html').write_text('<html>trusted</html>')
        (self.root / 'LICENSE-neko.txt').write_text('Apache-2.0')

    def test_every_asset_is_hashed_and_manifest_digest_uses_exact_bytes(self):
        (self.root / 'js').mkdir()
        (self.root / 'js/client.js').write_text('new RTCPeerConnection({iceTransportPolicy:"relay"})')
        digest, count, size = manifest.seal(self.root)
        raw = (self.root / manifest.MANIFEST).read_bytes()
        value = json.loads(raw)
        self.assertEqual(set(value), {'version', 'protocol', 'relay_only', 'files'})
        self.assertEqual(value['version'], 1)
        self.assertEqual(value['protocol'], 'neko-v3.1.6-legacy')
        self.assertIs(value['relay_only'], True)
        self.assertEqual(count, 3)
        self.assertEqual(digest, hashlib.sha256(raw).hexdigest())
        self.assertEqual(value['files'], {name: hashlib.sha256((self.root / name).read_bytes()).hexdigest()
                                         for name in ('index.html', 'LICENSE-neko.txt', 'js/client.js')})
        self.assertEqual(size, sum(path.stat().st_size for path in self.root.rglob('*') if path.is_file()))


    def test_entrypoint_normalization_removes_build_path_hash_variation(self):
        (self.root / 'js').mkdir()
        modern = b'modern-client'
        legacy = b'legacy-client'
        for name, data in (('app.12345678.js', modern), ('app-legacy.87654321.js', legacy)):
            (self.root / 'js' / name).write_bytes(data)
        (self.root / 'index.html').write_text('<script src="js/app.12345678.js"></script><script src="js/app-legacy.87654321.js"></script>')
        manifest.normalize_entrypoints(self.root)
        for stem, data in (('app', modern), ('app-legacy', legacy)):
            name = 'js/%s.%s.js' % (stem, hashlib.sha256(data).hexdigest()[:16])
            self.assertEqual((self.root / name).read_bytes(), data)
            self.assertIn(name, (self.root / 'index.html').read_text())

    def test_symlinks_cannot_import_unreviewed_files(self):
        for directory in (False, True):
            with self.subTest(directory=directory):
                link = self.root / 'link'
                link.symlink_to(self.root if directory else self.root / 'index.html')
                with self.assertRaises(ValueError):
                    manifest.seal(self.root)
                link.unlink()

    def test_reserved_manifest_and_unsafe_asset_names_fail_closed(self):
        for name in (manifest.MANIFEST, 'url%2fescape.js', 'back\\slash.js'):
            with self.subTest(name=name):
                path = self.root / name
                path.write_text('unexpected')
                with self.assertRaises(ValueError):
                    manifest.seal(self.root)
                path.unlink()

    def test_total_size_limit_applies_before_reading_large_assets(self):
        with (self.root / 'large.bin').open('wb') as stream:
            stream.truncate(manifest.LIMIT)
        with self.assertRaises(ValueError):
            manifest.seal(self.root)
        self.assertFalse((self.root / manifest.MANIFEST).exists())

    def test_entrypoint_and_upstream_license_are_required(self):
        (self.root / 'LICENSE-neko.txt').unlink()
        with self.assertRaises(ValueError):
            manifest.seal(self.root)


if __name__ == '__main__':
    unittest.main()
