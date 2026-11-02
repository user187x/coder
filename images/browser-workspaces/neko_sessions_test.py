"""Integration coverage; run inside a disposable image with its session gateway running."""
import json
import os
import pathlib
import unittest
import urllib.error
import urllib.request
import uuid


@unittest.skipUnless(os.environ.get('TEST_NEKO_SESSIONS') == '1', 'Requires disposable Neko container')
class SessionsTest(unittest.TestCase):
    def test_independent_profiles_close_and_fresh_reopen(self):
        base = 'http://127.0.0.1:8090/'
        first, second = 'test-' + uuid.uuid4().hex, 'test-' + uuid.uuid4().hex
        root = pathlib.Path('/tmp/coder-browser-sessions')
        def get(path):
            return urllib.request.urlopen(base + path, timeout=30)
        csrf = json.load(get('control'))['csrf']
        def stop(session_id, token=csrf):
            return urllib.request.urlopen(urllib.request.Request(base + 'control', data=json.dumps({'id': session_id}).encode(), headers={'Content-Type': 'application/json', 'X-Browser-CSRF': token}), timeout=30)
        try:
            self.assertEqual(get(f'sessions/{first}/?embed=1').status, 200)
            self.assertEqual(get(f'sessions/{second}/?embed=1').status, 200)
            one = next(root.glob(first + '-*'))
            two = next(root.glob(second + '-*'))
            self.assertNotEqual(one, two)
            prefs = json.loads((one / '.config/chromium/Default/Preferences').read_text())
            self.assertFalse(prefs['ntp']['shortcust_visible'])
            with self.assertRaises(urllib.error.HTTPError) as error:
                stop(first, 'wrong')
            self.assertEqual(error.exception.code, 403)
            self.assertTrue(one.exists())
            self.assertEqual(stop(first).status, 200)
            self.assertFalse(one.exists())
            self.assertTrue(two.exists())
            with self.assertRaises(urllib.error.HTTPError) as error:
                get(f'sessions/{first}/api/whoami')
            self.assertEqual(error.exception.code, 410)
            self.assertEqual(get(f'sessions/{second}/?embed=1').status, 200)
            self.assertEqual(get(f'sessions/{first}/?embed=1').status, 200)
            self.assertNotEqual(next(root.glob(first + '-*')), one)
            self.assertEqual(next(root.glob(second + '-*')), two)
        finally:
            stop(first)
            stop(second)


if __name__ == '__main__':
    unittest.main()
