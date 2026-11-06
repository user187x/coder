"""The browser PIN lock: rate limits, and the gateway refusing every session path while locked."""
import asyncio
import importlib.util
import pathlib
import unittest

from browser_pin import BrowserPIN

try:
    from aiohttp import ServerDisconnectedError, web
    from aiohttp.test_utils import TestClient, TestServer
except ImportError:  # the gateway image ships aiohttp; a bare host may not
    web = None

HERE = pathlib.Path(__file__).resolve().parent


class Clock:
    now = 1000.0

    def __call__(self):
        return self.now


class PINTest(unittest.TestCase):
    def test_backoff_after_five_failures_and_correct_pin_waits_for_it(self):
        clock = Clock()
        pin = BrowserPIN(clock)
        pin.configure("123456")
        for _ in range(5):
            self.assertIsNone(pin.unlock("000000"))
        self.assertEqual(pin.retry_after(), 30)
        self.assertIsNone(pin.unlock("123456"))
        clock.now += 30
        self.assertTrue(pin.unlock("123456"))
        self.assertEqual(pin.failures, 0)

    def test_new_unlock_replaces_older_token_and_lock_revokes_it(self):
        pin = BrowserPIN()
        first = pin.configure("123456")
        second = pin.unlock("123456")
        self.assertFalse(pin.allows(first))
        self.assertTrue(pin.allows(second))
        pin.lock()
        self.assertFalse(pin.allows(second))

    def test_clear_requires_the_pin(self):
        pin = BrowserPIN()
        pin.configure("123456")
        self.assertFalse(pin.clear("654321"))
        self.assertTrue(pin.configured)
        self.assertTrue(pin.clear("123456"))
        self.assertTrue(pin.allows(None))

    def test_rejects_malformed_pins(self):
        for value in ("12345", "1234567890123", "12345a", None, 123456):
            with self.subTest(value=value), self.assertRaises(ValueError):
                BrowserPIN().configure(value)


@unittest.skipIf(web is None, "aiohttp is not installed")
class GatewayLockTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        spec = importlib.util.spec_from_file_location("neko_sessions", HERE / "neko-sessions.py")
        self.gateway = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.gateway)
        self.started = asyncio.Event()

        async def hold(_request):
            self.started.set()
            await asyncio.sleep(3600)
            return web.Response()

        app = web.Application(middlewares=[self.gateway.pin_gate])
        app.router.add_route("*", "/control", self.gateway.control)
        app.router.add_get("/sessions", self.gateway.list_sessions)
        app.router.add_get("/sessions/{session}/desktop-socket", hold)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()
        self.cookie = ""

    async def asyncTearDown(self):
        await self.client.close()

    async def control(self, **body):
        csrf = (await (await self.client.get("/control")).json())["csrf"]
        response = await self.client.post("/control", json=body, headers=self.headers({"X-Browser-CSRF": csrf}))
        if "coder_browser_unlock" in response.cookies:
            self.cookie = response.cookies["coder_browser_unlock"].value
        return response

    def headers(self, extra=None):
        headers = dict(extra or {})
        if self.cookie:
            headers["Cookie"] = "coder_browser_unlock=" + self.cookie
        return headers

    async def get(self, path, **headers):
        return await self.client.get(path, headers=self.headers(headers))

    async def test_lock_refuses_every_session_path_and_unlock_restores_it(self):
        self.assertEqual((await self.get("/sessions")).status, 200)
        self.assertEqual((await self.control(action="pin-set", pin="123456")).status, 200)
        self.assertEqual((await self.get("/sessions")).status, 200)
        holder = self.cookie
        self.assertEqual((await self.control(action="pin-lock")).status, 200)
        self.cookie = holder
        self.assertEqual((await self.get("/sessions")).status, 423)
        self.assertEqual((await self.get("/sessions/a/desktop-socket")).status, 423)
        page = await self.get("/sessions", Accept="text/html")
        self.assertEqual(page.status, 423)
        self.assertEqual(page.content_type, "text/html")
        status = await (await self.get("/control")).json()
        self.assertEqual(status["pin"], {"configured": True, "locked": True, "retryAfter": 0})
        self.assertEqual((await self.control(action="pin-unlock", pin="000000")).status, 403)
        self.assertEqual((await self.control(action="pin-unlock", pin="123456")).status, 200)
        self.assertNotEqual(self.cookie, holder)
        self.assertEqual((await self.get("/sessions")).status, 200)

    async def test_lock_cancels_open_session_connections(self):
        await self.control(action="pin-set", pin="123456")
        request = asyncio.create_task(self.get("/sessions/a/desktop-socket"))
        await asyncio.wait_for(self.started.wait(), 5)
        self.assertEqual(len(self.gateway.ACTIVE), 1)
        await self.control(action="pin-lock")
        (dropped,) = await asyncio.wait_for(asyncio.gather(request, return_exceptions=True), 5)
        self.assertIsInstance(dropped, ServerDisconnectedError)
        self.assertFalse(self.gateway.ACTIVE)

    async def test_pin_changes_need_an_unlocked_gateway(self):
        await self.control(action="pin-set", pin="123456")
        self.assertEqual((await self.control(action="pin-set", pin="654321")).status, 409)
        await self.control(action="pin-lock")
        self.cookie = ""
        self.assertEqual((await self.control(action="pin-clear", pin="123456")).status, 423)
        await self.control(action="pin-unlock", pin="123456")
        self.assertEqual((await self.control(action="pin-clear", pin="123456")).status, 200)
        self.assertEqual((await self.get("/sessions")).status, 200)

    async def test_session_stop_still_works_while_locked(self):
        await self.control(action="pin-set", pin="123456")
        await self.control(action="pin-lock")
        self.assertEqual((await self.control(id="gone")).status, 200)


if __name__ == "__main__":
    unittest.main()
