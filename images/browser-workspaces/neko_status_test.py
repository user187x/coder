"""A closed Chromium window ends its disposable browser session."""
import asyncio
import importlib.util
import json
import pathlib
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch


@unittest.skipUnless(importlib.util.find_spec('aiohttp'), 'Requires aiohttp in the browser image')
class BrowserStatusTest(unittest.IsolatedAsyncioTestCase):
    async def test_status_distinguishes_running_closed_and_missing_sessions(self):
        spec = importlib.util.spec_from_file_location('neko_sessions', pathlib.Path(__file__).with_name('neko-sessions.py'))
        gateway = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gateway)
        gateway.LOCK = asyncio.Lock()
        for code, exists, expected in [(None, True, True), (0, True, False), (1, True, False), (None, False, False)]:
            gateway.SESSIONS = {'panel': {'browser': SimpleNamespace(returncode=code)}} if exists else {}
            with patch.object(gateway, 'stop_session', new_callable=AsyncMock) as stop:
                response = await gateway.status(SimpleNamespace(match_info={'session': 'panel'}))
                self.assertEqual(json.loads(response.body), {'running': expected})
                self.assertEqual(response.headers['Cache-Control'], 'no-store')
                self.assertEqual(stop.await_count, int(exists and code is not None))

    async def test_support_only_lists_and_joins_existing_windows(self):
        spec = importlib.util.spec_from_file_location('neko_sessions', pathlib.Path(__file__).with_name('neko-sessions.py'))
        gateway = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gateway)
        gateway.LOCK = asyncio.Lock()
        gateway.SESSIONS = {'open': {'browser': SimpleNamespace(returncode=None)}, 'closed': {'browser': SimpleNamespace(returncode=0)}}
        response = await gateway.list_sessions(None)
        self.assertEqual(json.loads(response.body), {'sessions': ['open']})
        with patch.object(gateway, 'start_session', new_callable=AsyncMock) as start:
            with self.assertRaises(gateway.web.HTTPGone):
                await gateway.proxy(SimpleNamespace(match_info={'session': 'missing', 'path': ''}, query={'existing': '1'}))
            start.assert_not_awaited()


if __name__ == '__main__':
    unittest.main()
